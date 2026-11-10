# Security review: Phase 1 gate

Reviewer: security-reviewer (independent, read only). Date: 2026-11-09.
Commit reviewed: `7ecdbfb` on `claude/pensive-cray-yaaoaf` (review started at `be07452`. The
simulator merge that landed during the review was also read).

## Summary
No Critical or High findings. The core controls hold up under direct testing: every protected
route returns 401 without a token, `alg=none` tokens are refused, staff are scoped to one bar,
line sessions are owner checked, refresh rotation and reuse detection work under concurrency,
concurrent code verifies cannot double spend a code, coordinates are never stored, and phones are
stored only as peppered HMACs.

There are 4 Medium findings. Two weaken login brute force and SMS abuse limits (the lockout
resets when a new code is requested, and the phone validator accepts non ASCII digits). One is a
fragile client IP derivation that either lets clients spoof their IP or puts every user in one
rate limit bucket, depending on how the host is set up. One is a silently vacuous deny by default
test. None of them is exploitable for account takeover at pilot scale, but all four should be
fixed before Phase 2 adds a real SMS provider and a public host.

Counts: Critical 0, High 0, Medium 4, Low 10, Info 10. **Verdict: PASS.**

## Scope
- `backend/app` (config, main, core, services, api/v1, models, schemas, estimation glue)
- `backend/alembic` (env and the initial migration's foreign keys)
- `backend/scripts` (retention, make_admin, export_openapi, seed, simulate_night, _common)
- `backend/Dockerfile`, `backend/pyproject.toml`, `uv.lock` (via pip-audit), `.dockerignore`
- `web/` (index, staff, all JS, CSP compatibility, mock mode, token storage)
- `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`,
  `.pre-commit-config.yaml`
- Baseline: OWASP ASVS 4.0 L1, L2 for V2 (authn), V3 (session), V4 (access control), V8 (data
  protection). MASVS not applicable yet (no iOS code).

## Method
1. Read CLAUDE.md, SECURITY.md, THREAT_MODEL.md, DECISIONS.md, then every file in scope.
2. Ran the test suite against an isolated scratch database (the shared `crowded_test` database
   was in use by another session). Result: 135 passed, 1 skipped (see M-4).
3. `bandit -r app scripts`: no issues. `pip-audit` on the frozen runtime requirements: no known
   vulnerabilities (fastapi 0.162.2, starlette 1.10.0, uvicorn 0.54.0, pyjwt 2.15.1,
   cryptography 50.0.2, sqlalchemy 2.1.8, psycopg 3.3.8).
4. Started the server in dev mode on port 8011 against the dev database and probed it with curl
   and small Python scripts: unauthenticated access to all 21 protected routes, a forged
   `alg=none` admin token, lockout behaviour, 10 parallel correct verifies, 12 parallel wrong
   verifies, 5 parallel refreshes of one token, the age gate path, Unicode phone numbers,
   oversized bodies (with and without chunked encoding, and an invalid Content-Length),
   validation error echo, X-Forwarded-For handling, security headers, CORS preflight, static
   file path traversal and redirect behaviour.
5. Reproduced the invalid timezone 500 (L-5) with a TestClient against the scratch database.
   The scratch database was dropped afterwards and the server was stopped.

Side effect to note: the probes created about eight FAKE users with 555 numbers in the dev
database (four of them with non ASCII digit phones, from the M-2 test).

## Findings

### M-1 Medium: phone lockout resets every time a new code is requested
- Location: `backend/app/services/auth.py:65-70` (request invalidates the old code row),
  `backend/app/services/auth.py:104-108` (attempts and lock live on the code row)
- Description: `attempts` and `locked_until` are stored per `login_codes` row, not per phone.
  `request_code` marks the current row consumed and inserts a fresh row with `attempts=0`. The
  lock only fires on the 5th wrong guess against one row, so an attacker who makes 4 guesses and
  then requests a new code is never locked. SECURITY.md and THREAT_MODEL.md S1 describe "5 wrong
  attempts lock the phone for 15 min", which is not what the code does.
- Exploit scenario: verified live. Three rounds of "request code, 4 wrong guesses" gave 12 wrong
  guesses with no lockout, and the correct code still worked at the end. Per phone throughput
  is bounded only by `code_request_phone` (3 per 10 min), so about 72 guesses per hour per phone
  instead of the intended 20 per hour. Spread over many IPs (or with M-3) the IP limits do not
  help. Each guess round sends an SMS to the victim, so it is noisy, and success odds stay small
  (about 0.17 percent per target per day), but the documented control is not in place.
- Recommended fix: count failed attempts per phone hash over a window (for example a
  `login_attempts` count keyed on `phone_hash` with a 15 min window, or carry `attempts` forward
  from the invalidated row into the new row). Lock when the per phone count reaches 5 regardless
  of how many codes were issued. Add a test that interleaves request-code and wrong verifies.

### M-2 Medium: phone validator accepts any Unicode decimal digit
- Location: `backend/app/schemas.py:14`, `backend/app/schemas.py:32-38`
- Description: `E164 = re.compile(r"^\+[1-9]\d{7,14}$")` is a `str` pattern, so `\d` matches
  every Unicode decimal digit (Arabic-Indic, Bengali, fullwidth and about 60 other scripts). The
  same real number written with different digit scripts produces different `phone_hash` values.
- Exploit scenario: verified live. `+15550107788`, `+1555010٧٧٨٨`, `+1555010７７８８` and
  `+1555010৭৭৮৮` each received a code and created a separate account (`phone_hint` "ending in
  ٨٨", and so on). Today the stub SMS sender delivers nothing, so the impact is latent. Once a
  real provider is plugged in, if it normalizes digits (many SMS gateways and carriers do), one
  phone can own an unlimited number of accounts (defeating per user report limits and T1
  reliability weighting), and the per phone code limit (3 per 10 min) and the M-1 lockout key can
  be sidestepped by cycling digit scripts to SMS bomb a victim (D1 toll fraud).
- Recommended fix: use `re.compile(r"^\+[1-9][0-9]{7,14}$", re.ASCII)` (or `[0-9]` explicitly),
  and reject any input with non ASCII characters before stripping separators. Apply the same to
  the login code pattern (`^[0-9]{6}$`). Consider parsing with a phone number library before the
  real provider lands. Add a regression test with a non ASCII digit phone.

### M-3 Medium: client IP derivation is either spoofable or collapses to the proxy IP
- Location: `backend/app/core/deps.py:25-30`, `backend/Dockerfile:22` (`--proxy-headers`
  without `--forwarded-allow-ips`), `.env.example` comment for `CROWDED_TRUST_PROXY_HEADERS`
- Description: there are two independent proxy trust layers and neither is right for a typical
  deploy.
  1. When `trust_proxy_headers=true`, `client_ip` returns the leftmost `X-Forwarded-For` entry.
     Standard proxies (nginx `$proxy_add_x_forwarded_for`, AWS ALB, most PaaS routers) append the
     real client to whatever the client sent, so the leftmost entry is attacker controlled.
  2. When `trust_proxy_headers=false`, the app uses `request.client.host`. Uvicorn has
     `proxy_headers` on by default and trusts `127.0.0.1`, so behind a proxy on another address
     every request appears to come from the proxy. All users then share one bucket for
     `code_request_ip` (20 per hour), `code_verify_ip`, `apple_ip` and `refresh_ip`.
  Live check: from 127.0.0.1 with the setting false, uvicorn already rewrote the client to the
  forwarded value (`10.9.N.1` in the access log), and 24 code requests with rotating
  `X-Forwarded-For` all returned 200, past the 20 per hour IP limit. So the app setting does not
  control what it claims to.
- Exploit scenario: on a host where the proxy is not loopback, an attacker sends 20 code
  requests per hour and nobody else can sign in, and 30 refreshes per 10 min log out every web
  user whose access token expires. The obvious operator fix is to set
  `CROWDED_TRUST_PROXY_HEADERS=true`, which then lets anyone rotate `X-Forwarded-For` to get
  unlimited code requests and verifies (amplifies M-1 and D1). Audit `ip_hash` values become
  attacker chosen too.
- Recommended fix: pick one layer. Simplest: drop the app level header parsing and always use
  `request.client.host`, and configure uvicorn with `--forwarded-allow-ips=<proxy address or
  CIDR>` in the deploy (uvicorn picks the rightmost untrusted hop). If app level parsing stays,
  take the rightmost entry after skipping a configured list of trusted proxy hops. Add a deploy
  checklist item and a test that a spoofed leftmost header does not change the rate limit key.

### M-4 Medium: the deny by default route enumeration test is vacuous and silently skipped
- Location: `backend/tests/api/test_authorization.py:28-43`
- Description: `_routes()` iterates `create_app().routes` looking for `.path` and `.methods`. On
  the installed FastAPI 0.162.2, `include_router` adds `_IncludedRouter` objects with neither
  attribute, so the list is empty and pytest reports `SKIPPED ... got empty parameter set`. CI
  stays green. SECURITY.md row "Deny by default ... (tested by enumerating routes)" and the
  CLAUDE.md non negotiable rule rely on this test.
- Exploit scenario: no current route is exposed (verified by hand: all 21 protected routes
  return 401 without a token, and the OpenAPI document marks each with bearer security). But a
  future route added without `CurrentUser` would ship with no test catching it.
- Recommended fix: enumerate from `app.openapi()["paths"]` (which is correct today) or walk
  included routers, and assert the parameter list is non empty (for example
  `assert len(_routes()) >= 21` in a separate test) so a framework change cannot turn the guard
  into a skip. Consider `-p no:skip`-style strictness, for example failing CI on unexpected
  skips.

### L-1 Low: retention script misses several per user tables
- Location: `backend/scripts/retention.py:36-48`, `backend/app/services/activity.py:55-67`
- Description: `reward_ledger` (user id, time, reason "timer" or "report", ref id) is never
  purged, and points are only awarded when `near_bar` is true, so each row records that a user
  was near some bar at a given time. `devices` (one row per login, with `created_at` and
  `last_seen_at`) is never purged. Line sessions still `active` are skipped, and they only flip to
  abandoned when the same user calls the API again, so a user who starts a timer and never
  returns keeps a bar plus time row forever. `staff_invites` (with `redeemed_by`) is never purged.
- Exploit scenario: a DB dump or a later subpoena shows whereabouts older than the promised 30
  days (asset 3 in the threat model).
- Recommended fix: purge `reward_ledger` with the raw window (or drop `created_at` precision and
  `ref_id` after it), purge devices with no live refresh token, delete line sessions older than
  the window regardless of status (or abandon sessions older than `ACTIVE_SESSION_MAX` in the
  job), and purge expired or redeemed invites. Extend `test_retention.py` to cover each table.

### L-2 Low: refresh sessions never require re-authentication
- Location: `backend/app/services/auth.py:155` (`expires_at = now + 30 days` on every rotation)
- Description: each rotation issues a new token with a fresh 30 day expiry in the same family,
  so an active session never ends. The web client keeps the refresh token in localStorage
  (D-010), so one XSS or one stolen device yields indefinite access.
- Exploit scenario: a refresh token lifted from a shared laptop keeps working for as long as the
  attacker refreshes at least once a month.
- Recommended fix: store a family `created_at` (or `absolute_expires_at`) and refuse refresh
  after an absolute lifetime (for example 90 days for users, shorter for staff and admin).

### L-3 Low: no way to remove a staff member or revoke an invite
- Location: `backend/app/api/v1/admin.py` (no route), `backend/app/models.py:202`
  (`StaffInvite.revoked_at` is never set)
- Description: once a door staffer redeems an invite they keep staff rights at that bar until a
  DB edit, and with L-2 their session never expires. An invite code that leaks before use cannot
  be revoked for 3 days.
- Exploit scenario: a bouncer fired on Friday can still post door counts and line status for the
  bar on Saturday (T1, T2 integrity of numbers).
- Recommended fix: add audited admin routes to revoke an invite and to remove a staff member
  (delete the `bar_staff` row, set role to user, revoke all refresh families of that user).

### L-4 Low: near bar weighting trusts client supplied coordinates
- Location: `backend/app/services/activity.py:34-38`, `backend/app/schemas.py:138-139`
  (`BarDetail` returns the bar's exact latitude and longitude)
- Description: `near_bar`, the distance bucket, reliability updates and reward points depend
  only on coordinates the client sends. The exact bar coordinates are served to every signed in
  user, so a script can always claim `at_door`. THREAT_MODEL T1 lists "Far reports weighted 0.3"
  as done, which overstates it.
- Exploit scenario: a rival bar's promoter runs a few accounts that report "packed" and a long
  line "at the door" from home, at full weight and earning points.
- Recommended fix: document this as accepted until App Attest (Phase 2), adjust T1 wording, and
  consider capping the weight of a user's reports until they have a completed near bar timer.

### L-5 Low: an invalid bar timezone takes down the bar list for every user
- Location: `backend/app/schemas.py:244` (`timezone` is any string up to 64 chars),
  `backend/app/services/live.py:52`
- Description: `BarCreate.timezone` is not validated. `ZoneInfo()` raises on every compute for
  that bar.
- Exploit scenario: reproduced. An admin creating a bar with `Not/AZone` makes `GET /v1/bars`
  return 500 for all users until the bar is deactivated. Admin only, so this is an availability
  foot gun rather than an attack.
- Recommended fix: validate with `zoneinfo.available_timezones()` (or try `ZoneInfo(v)`) in a
  field validator and return 422.

### L-6 Low: anyone can keep a known phone locked out of login
- Location: `backend/app/services/auth.py:60-64`
- Description: once a phone is locked, `request_code` refuses for 15 min. Locking only needs one
  code request and 5 wrong guesses, which any caller can do for any number.
- Exploit scenario: an attacker locks a specific staffer's number every 15 minutes during a busy
  night, so they cannot sign in to the door counter. Also sends that person an SMS each time.
- Recommended fix: accept this as the standard lockout trade off but keep it per phone and short,
  or let request-code proceed during a lock while verify stays locked. Revisit with the per phone
  counter from M-1.

### L-7 Low: two tabs refreshing at once trigger reuse detection and log the user out
- Location: `web/js/api.js:68-86` (dedup is per tab only), `backend/app/services/auth.py:195-200`
- Description: verified live. Five parallel refreshes of one token gave one 200 and four 401, and
  the winner's new token was then revoked too. Two open tabs whose access tokens expire together
  (or a tab plus the staff page) will hit this. Besides the user impact, frequent false "reuse
  detected" warnings teach operators to ignore a real token theft signal.
- Exploit scenario: no attacker gain. Availability and signal quality issue.
- Recommended fix: coordinate refresh across tabs in the client (Web Locks API or a
  BroadcastChannel), or allow a short grace window (a few seconds) in which the just rotated
  token returns the same successor instead of revoking the family.

### L-8 Low: mock mode can be forced on the production origin
- Location: `web/js/api.js:9`, `web/js/api.js:79`, `web/js/app.js:916-919`
- Description: `?mock=1` switches any deploy to the in-memory mock. On boot the app calls
  `refresh()` with the real refresh token, the mock rejects it with 401, and `setTokens(null)`
  deletes the real token from localStorage. The token is not sent anywhere, so nothing leaks.
- Exploit scenario: a link to `https://<prod>/?mock=1` signs the victim out (their server side
  family stays valid but orphaned until expiry) and shows FAKE bars and verdicts on the real
  domain. There is a "Demo mode" banner, which limits the confusion.
- Recommended fix: only honour `?mock=1` when served from localhost or when a build time flag is
  set (the preview bundler already sets `window.CROWDED_MOCK`). At minimum, do not touch the real
  refresh token key in mock mode (use a separate storage key).

### L-9 Low: raw client IPs in uvicorn access logs
- Location: `backend/Dockerfile:22` (default access log on), observed in the server log
- Description: access logs record the full client IP with timestamps and paths such as
  `/v1/bars/{bar_id}`. The audit log hashes IPs, but the access log keeps them raw, which links an
  IP to a bar being viewed. SECURITY.md section 2 does not list this data.
- Exploit scenario: whoever reads host logs can tie a home IP to nightlife activity.
- Recommended fix: run with `--no-access-log` and emit a structured access log with the hashed
  IP, or set a short log retention and list it in the data inventory.

### L-10 Low: CI and container dependencies are pinned to mutable tags
- Location: `.github/workflows/ci.yml:32,33,59`, `.github/workflows/codeql.yml:21,22,25`,
  `backend/Dockerfile:3-4,12`
- Description: third party actions `astral-sh/setup-uv@v5` and `gitleaks/gitleaks-action@v2`
  (and the GitHub owned ones) use major version tags, `ghcr.io/astral-sh/uv:0.11` is a floating
  minor tag, and `python:3.12-slim` is not pinned by digest. A compromised tag would run in CI
  (with `GITHUB_TOKEN` in the gitleaks job) or ship in the image. Top level
  `permissions: contents: read` limits the CI blast radius, which is good.
- Recommended fix: pin third party actions to full commit SHAs with a version comment (Dependabot
  updates SHAs), pin the uv image to an exact version and digest, and pin the base image by
  digest (Dependabot docker updates digests).

### I-1 Info: chunked oversized bodies get 400, not 413
- Location: `backend/app/core/middleware.py:41-55`
- Description: with a Content-Length the limit returns 413. With chunked encoding FastAPI catches
  the `_TooLargeError` raised from `receive()` and returns 400 "There was an error parsing the
  body". The body is still rejected after 64 KB, so the control works. Only the status differs.
- Fix: optional. Document it or test both paths.

### I-2 Info: in-memory rate limiter never evicts keys
- Location: `backend/app/core/ratelimit.py:19-36`
- Description: `defaultdict(deque)` keeps a key per phone hash, IP hash, user and bar forever.
  Slow memory growth, bounded by the IP limits. Will go away with Redis (D-008).

### I-3 Info: access tokens survive logout for up to 15 minutes
- Location: `backend/app/services/auth.py:214-218`
- Description: logout revokes the refresh family only. Standard for stateless JWTs with a 15 min
  TTL. Account deletion does invalidate immediately (user lookup fails).

### I-4 Info: `CROWDED_ENV=test` behaves like dev
- Location: `backend/app/config.py:47-48`, `backend/app/services/auth.py:84`
- Description: `test` allows dev secrets and the stub SMS sender and returns `dev_code` in the
  response. The D-013 guard only covers staging and prod. A host started with `test` would hand
  out login codes. The Dockerfile sets `prod`, so this needs an explicit misconfiguration.
- Fix: return `dev_code` only when `env == "dev"` and refuse to bind a non loopback address when
  `is_dev`, or log a loud warning at startup.

### I-5 Info: concurrent invite redemption by one user returns 500
- Location: `backend/app/api/v1/staff.py:64-69`
- Description: two different invites redeemed at once by the same user both pass the
  `existing` check and the second insert hits the unique `bar_staff.user_id`. Generic 500, no
  leak, no double membership. Catch `IntegrityError` and return 409.

### I-6 Info: concurrent code requests can leave two live codes
- Location: `backend/app/services/auth.py:66-79`
- Description: two simultaneous request-code calls each invalidate nothing and insert a row.
  Verify only checks the newest, so there is no guessing gain, but the older code becomes usable
  after the newest is consumed. Negligible. Fixable with an advisory lock on the phone hash.

### I-7 Info: docs say `nbf` and `typ` are required, decode requires neither
- Location: `backend/app/core/security.py:75-78`
- Description: `typ` is checked manually after decode (good) and PyJWT validates `nbf` when
  present. Add `nbf` to `require` or fix SECURITY.md.

### I-8 Info: repository tooling is served as static files
- Location: `backend/app/main.py:79` (mount of all of `web/`), `backend/Dockerfile:16`
- Description: `/tools/bundle_preview.py` and `/README.md` return 200. Nothing sensitive (the repo
  is public), but keep `web/` to shippable assets or exclude `tools/` from the image.

### I-9 Info: Sign in with Apple has no nonce check and a 30 s JWKS fetch timeout
- Location: `backend/app/core/apple.py:23-36`
- Description: nonce is a documented Phase 3 item (S3). `PyJWKClient` refetches the JWKS for an
  unknown `kid` with its default timeout, so slow Apple responses tie up worker threads. Bounded
  by `apple_ip`. Set a short timeout when the iOS flow lands.

### I-10 Info: tooling drift
- Location: `.pre-commit-config.yaml:4` (ruff v0.8.6 vs ruff 0.17 in dev deps),
  `.github/workflows/ci.yml:59`
- Description: the pre-commit ruff can disagree with CI formatting. `gitleaks-action@v2` needs a
  `GITLEAKS_LICENSE` secret when the repo is owned by an organization, otherwise the secrets job
  fails. Check this when the owner moves the repo.

## Verified as good
- Deny by default in practice: all 21 non auth `/v1` routes returned 401 without a token, and the
  OpenAPI document lists bearer security on each of them. Authorization uses the role from the
  database, never the JWT `role` claim.
- Forged tokens: `alg=none` with an admin role claim is refused. HS256 only. `aud`, `iss`, `exp`,
  `iat`, `sub` required and `typ=access` enforced.
- Prod refuses `dev-only` or short secrets and the stub SMS provider (staging and prod).
- Login codes: `secrets.randbelow`, 6 digits, 5 min TTL, stored as a peppered HMAC bound to the
  phone hash, compared with `hmac.compare_digest`. Single use: 10 parallel correct verifies gave
  exactly one 200. 12 parallel wrong verifies gave exactly five 400 and seven 429, and the
  correct code was then refused while locked (the `SELECT ... FOR UPDATE` serializes attempts).
- No account enumeration: request-code does the same work for known and unknown phones and never
  looks up the user. Verify looks up the user only after the code matches.
- Age gate: a correct code without attestation returns 403 `age_gate`, the code stays usable,
  attestation then succeeds, and replay afterwards returns 400. Only `age_attested_at` is stored.
- Refresh tokens: 256 bit opaque, stored as SHA-256, rotated on use, reuse of a used or revoked
  token revokes the whole family (verified under concurrency), logout revokes the family.
- Staff scoping: the `staff_bar` dependency joins `bar_staff` and returns 404 for other bars.
  Admins cannot become staff, existing staff cannot redeem a second invite, invites are single
  use (row lock), hashed with the pepper, 3 day TTL, 50 bits of entropy, 10 tries per user per
  hour. Every staff and admin write calls `audit()` in the same transaction.
- BOLA on line sessions: same 404 for missing and not yours. Inactive bars are hidden from users.
- No admin grant API. `make_admin` is a CLI and writes an audit row.
- Privacy: no coordinate columns anywhere. `LocationIn` is reduced to a bucket in
  `_distance()` and not logged. Phones are HMAC plus last 2 digits. The SMS stub logs only the
  last 2 digits. Log calls contain no tokens, codes, phones or coordinates. Validation errors
  return `loc`, `msg` and `type` only, never the submitted input (checked with a bad phone, bad
  code, extra fields, bad JSON and wrong types). The 500 handler returns a generic body.
- Account deletion is a real hard delete: login codes deleted explicitly, all user owned tables
  cascade, staff linked rows go to NULL. Migration foreign keys match the models.
- Security headers on every response: strict CSP with no `unsafe-inline`, nosniff, frame DENY,
  `no-referrer`, COOP, Permissions-Policy, `no-store` on `/v1`. HSTS outside dev. Docs and
  `/openapi.json` only in dev and test. CORS off by default, no credentials, preflight from a
  foreign origin gets 405.
- Body limit: Content-Length above 64 KB gets 413, a malformed Content-Length is rejected, and
  chunked bodies are cut off after 64 KB.
- Static files: path traversal (`..` and `%2e%2e`) returns 404 and there are no directory
  redirects, so no open redirect.
- Web client: all server and user text goes through `textContent` or text nodes. The only
  `innerHTML` sink (`web/js/ui.js:26`) is fed constant icon SVG. No `eval`, no inline scripts or
  handlers, no `style` attributes (CSSOM `setProperty` only), no dynamic `href`, so the CSP does
  not break anything. Geolocation uses `getCurrentPosition` once per action, never `watch`.
- SQL: ORM and bound parameters only. The only `text()` SQL is in test fixtures.
- Container: non root uid 10001, app files owned by root, `.env` excluded by `.dockerignore`,
  `--no-server-header`.
- CI: `pull_request` (not `pull_request_target`), read only default token, bandit, pip-audit
  `--strict`, gitleaks, CodeQL for Python and JavaScript, Dependabot for uv, actions and docker.
  Seed and simulator refuse to run outside dev and test and use 555 numbers labelled FAKE.

## Gate verdict
**PASS.** No Critical or High findings. Recommended before Phase 2 (real SMS provider, public
host): fix M-1, M-2 and M-3 together with the SMS provider work, fix M-4 now since it is a small
test change, and schedule L-1 and L-3.

## Remediation status (lead, after review)
| ID | Status | Fix |
|---|---|---|
| M-1 | Fixed | Failures counted per phone across all codes in the lockout window. Lock checked on every verify and request. Test `test_lockout_survives_new_code_requests` |
| M-2 | Fixed | ASCII only phone and code patterns (`[0-9]`, `re.ASCII`). Test `test_non_ascii_digits_rejected` |
| M-3 | Fixed | App no longer parses X-Forwarded-For. One trust layer: uvicorn `FORWARDED_ALLOW_IPS`. Code request IP limit raised to 60 per hour for campus NAT |
| M-4 | Fixed | Route enumeration reads the OpenAPI contract, plus a non empty guard test. No skips in the suite |
| L-1 | Fixed | Retention covers devices, stale active sessions, expired invites and reward ledger |
| L-2 | Fixed | Refresh: 30 day sliding idle lifetime capped at 180 days per login |
| L-3 | Fixed | Admin can list and remove staff and revoke invites (audited) |
| L-4 | Accepted for now | Client coordinates are trusted. App Attest spike in Phase 2. Bar coordinates are public addresses |
| L-5 | Fixed | Timezone validated as IANA on create |
| L-6 | Accepted | Lockout DoS on a known phone. Revisit with the SMS provider (per IP lock scoring) |
| L-7 | Fixed | 10 second grace for a concurrent refresh of the just rotated token. Test added |
| L-8 | Fixed in web v2 | Mock mode only on localhost or when explicitly bundled, separate storage keys |
| L-9 | Fixed | Container runs uvicorn with `--no-access-log` |
| L-10 | Partly fixed | All GitHub Actions pinned to commit SHAs. Docker base images still on tags (Dependabot docker updates on) |
| I-5 | Fixed | Concurrent redeem returns 409 |
| I-7 | Fixed | JWT decode requires `nbf` and `typ` |
| I-8 | Fixed | Preview bundler moved out of the served `web/` directory to `tools/` |
| Others | Open, tracked | I-1, I-2, I-3, I-4, I-6, I-9, I-10 go to Phase 2 |
