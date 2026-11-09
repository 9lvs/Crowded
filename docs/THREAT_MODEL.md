# Threat model (STRIDE), Phase 1

Last updated: Phase 1. Update at the end of every phase.

## Assets
1. User accounts and sessions (access and refresh tokens).
2. Phone number to account link (stored only as a peppered HMAC).
3. Whereabouts: which bar a user was at and when (line sessions, reports). Sensitive for a
   nightlife app even without coordinates.
4. Integrity of wait and crowd numbers (the product's whole value, and the verdict drives money).
5. Staff and admin capabilities (door counts, pass prices, invites).
6. Server secrets: `CROWDED_JWT_SECRET`, `CROWDED_HASH_PEPPER`, database credentials.

## Actors
- Student user (21+). Malicious user trying to skew numbers or read others' data.
- Door staff at one bar. Malicious or careless staff at a rival bar.
- Admin (founder team).
- Outside attacker with no account. Bots running SMS pumping or credential stuffing.
- A competitor scraping our numbers.

## Trust boundaries
Client (iOS, web) to API over TLS. API to Postgres. API to SMS provider (stub today). API to
Apple JWKS. Admin CLI (`make_admin`) on the server.

## STRIDE
| # | Threat | Where | Mitigation (status) |
|---|---|---|---|
| S1 | Spoof a user by guessing a login code | `/v1/auth/verify-code` | 6 digits, 5 min TTL, 5 attempts then 15 min lockout per phone, IP rate limit, constant time compare (done) |
| S2 | Spoof via stolen refresh token | `/v1/auth/refresh` | Rotation on every use, reuse revokes the family, hashed at rest, 30 day TTL (done). Device binding with App Attest (Phase 2) |
| S3 | Forged Apple identity token | `/v1/auth/apple` | RS256 against Apple JWKS, `aud` and `iss` checked (done). Nonce check (Phase 3, needs the iOS flow) |
| S4 | Forged access token | all | HS256, 32+ byte secret enforced outside dev, `aud`, `iss`, `typ` checked (done) |
| T1 | Fake reports or timers to skew a rival bar | reports, line sessions | Per user, user plus bar, and per bar rate limits. Reliability weighting. Far reports weighted 0.3. Outlier trimming (done). App Attest (Phase 2). Staff vs reports mismatch flag (done) |
| T2 | Staff at bar A edits bar B | staff routes | Staff scoped to one bar via invite, 404 on other bars, tested for every staff route (done) |
| T3 | Mass assignment (set own role) | `PATCH /v1/me` | Strict models with `extra="forbid"` (done, tested) |
| T4 | SQL injection | all | ORM and bound parameters only (done). Bandit and CodeQL in CI |
| R1 | Staff or admin denies a change | staff and admin routes | `audit_log` on every staff and admin write, with hashed IP (done) |
| I1 | Location trail leaks | reports, sessions | Coordinates never stored. Only `near_bar` and a distance bucket (done, tested) |
| I2 | Phone numbers leak from DB dump | users | Peppered HMAC only plus last 2 digits. Pepper lives outside the DB (done) |
| I3 | User A reads user B's session | line sessions | Ownership check, 404 for not yours (done, tested) |
| I4 | Errors leak internals | all | Generic 500 handler. Validation errors do not echo input (done) |
| I5 | Whereabouts history after deletion | `DELETE /v1/me` | Hard delete with FK cascades (done, tested). Raw data purged after 30 days (script done, scheduler at deploy) |
| I6 | Scraping our numbers | bars | All bar routes need an account. Per user read limit (done). Accepted risk for a public pilot |
| D1 | SMS pumping (toll fraud) | request-code | Per phone and per IP limits (done). Country allowlist and provider fraud guard when a real provider is chosen (Phase 2) |
| D2 | Large bodies | all | 64 KB request limit (done) |
| D3 | Limiter bypass across instances | all | In-memory limiter is per process. Move to Redis before scaling out (Phase 2, D-008) |
| E1 | User becomes admin | roles | No API grants admin. Only the server side CLI, which is audited (done) |
| E2 | Under-21 use | signup | Attestation required, timestamp stored (done). Attestation is self reported (accepted risk, see SECURITY.md) |

## Open items for Phase 2
- App Attest spike (T1, S2).
- Redis backed rate limits (D3).
- Real SMS provider with fraud controls (D1). Needs owner approval.
- Abuse and load tests.
- Scheduled retention job in the deploy.
