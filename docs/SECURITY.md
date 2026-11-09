# Crowded security packet

This document is written for outside reviewers. It describes what the system is, what data it
holds, how data moves, and which controls exist. See THREAT_MODEL.md for the STRIDE analysis and
`security-review-phaseN.md` for each phase's independent review.

Baseline: OWASP ASVS 4.0 Level 1, with Level 2 for authentication (V2), session management
(V3), access control (V4) and data protection (V8). OWASP MASVS applies to the iOS app (Phase 3).

## 1. Architecture
```
iOS app (Phase 3) ─┐
Web client (/)  ───┼── HTTPS ──> FastAPI (uvicorn, non-root container) ──> PostgreSQL 16
Staff counter page ┘                  │
                                      ├──> SMS provider (interface, dev stub only today)
                                      └──> Apple JWKS (Sign in with Apple token verification)
```
- One stateless API process for the pilot. In-memory rate limiter (Redis before scaling out).
- The web client is static files served by the same origin with a strict CSP, so no CORS is
  needed. CORS is off unless `CROWDED_CORS_ORIGINS` lists origins.
- OpenAPI docs and `/openapi.json` are only served in dev and test.

## 2. Data inventory
| Data | Table | Stored as | Why | Retention |
|---|---|---|---|---|
| Phone number | users, login_codes | HMAC-SHA256 with server pepper, plus last 2 digits | Login lookup, "ending in 42" hint | Until account deletion |
| Apple user id | users | HMAC-SHA256 with pepper | Login lookup | Until deletion |
| Age | users | `age_attested_at` timestamp only. No date of birth | 21+ gate | Until deletion |
| Wait threshold, reliability score | users | Integer, float | Verdict, weighting | Until deletion |
| Login code | login_codes | HMAC bound to the phone hash | Verification | 5 min validity, purged after 1 day |
| Refresh token | refresh_tokens | SHA-256 | Session | 30 days, purged when expired |
| Access token | not stored | JWT HS256, 15 min | Session | n/a |
| Line session | line_sessions | Bar, start, end, `near_bar`, distance bucket | Wait measurement | 30 days (proposed) |
| Crowd report | crowd_reports | Bar, time, level, line bucket, `near_bar`, distance bucket | Estimate | 30 days (proposed) |
| Coordinates | none | Never stored or logged | Distance check only, in memory | 0 |
| Door counts, line status | door_events, outside_line_status | Bar, staff id, time | Estimate | 30 days |
| Snapshots, estimate errors | bar_snapshots, estimate_errors | Bar level aggregates, no user ids | Charts, accuracy | 365 days |
| Audit log | audit_log | Actor id, role, action, target, hashed IP | Accountability | 365 days |

Account deletion (`DELETE /v1/me`) is a hard delete. FK cascades remove devices, tokens, line
sessions, reports and rewards. Door events and audit rows written by a staff member keep the
bar level facts with the user link set to null.

## 3. Data flow: a crowd report
1. App reads location once (`getCurrentPosition`, never a watch) only when the user taps Report.
2. HTTPS POST `/v1/reports` with bar id, level, line bucket and optional coordinates.
3. Server computes haversine distance to the bar in memory, maps it to `at_door` (< 75 m),
   `nearby` (< 300 m) or `far`, and drops the coordinates. Nothing else sees them.
4. Report stored with the bucket. Reliability updated if a fresh staff reading exists.
5. The estimate is recomputed on read and a bar level snapshot is stored at most every 2 min.

## 4. Controls
| Area | Control | Where | ASVS |
|---|---|---|---|
| Authn | Passwordless phone code, 6 digits, 5 min TTL, single use, older codes invalidated | services/auth.py | 2.7 |
| Authn | 5 wrong attempts per phone (across all codes) in 15 min lock the phone for 15 min. 3 code requests per phone per 10 min. IP limits. ASCII digits only | services/auth.py, core/ratelimit.py | 2.2.1 |
| Authn | Constant time code comparison (`hmac.compare_digest`) | core/security.py | 2.7 |
| Authn | Sign in with Apple, RS256 against Apple JWKS, `aud` and `iss` pinned | core/apple.py | 2.x |
| Session | Access JWT 15 min, `aud`, `iss`, `typ`, `exp`, `nbf` required | core/security.py | 3.5 |
| Session | Refresh tokens opaque, hashed, rotated on use, reuse revokes the family (10 s grace for two tabs), logout revokes. 30 day idle, 180 day absolute lifetime | services/auth.py | 3.3, 3.5 |
| Session | Weak or default secrets refused outside dev | config.py | 2.10, 6.4 |
| Authz | Deny by default: every `/v1` route except auth requires a token (tested by enumerating routes) | core/deps.py, tests | 4.1 |
| Authz | Roles user, staff, admin. Staff bound to one bar by single use invite. 404 on other bars | core/deps.py | 4.2 |
| Authz | Object ownership on line sessions. Same 404 for missing and not yours | services/activity.py | 4.2.1 |
| Authz | No API grants admin. Only an audited server CLI | scripts/make_admin.py | 4.1 |
| Age | 21+ attestation required at signup. Only the timestamp is stored | services/auth.py | n/a |
| Input | Pydantic models with `extra="forbid"`, ranges on every number, E.164 phones | schemas.py | 5.1 |
| Input | 64 KB request body limit (header and streamed) | core/middleware.py | 13.1 |
| Input | ORM and bound parameters only | all | 5.3.4 |
| Output | Strict CSP, nosniff, frame DENY, no-referrer, COOP, Permissions-Policy, `no-store` on API | core/middleware.py | 14.4 |
| Output | HSTS (2 years) outside dev. TLS terminates at the host | core/middleware.py | 9.1 |
| Errors | Generic 500 body. Validation errors never echo input | main.py | 7.4 |
| Logs | No tokens, codes, coordinates or full phones are logged. Phones masked to last 2 digits | core/sms.py | 7.1 |
| Abuse | Client IP resolved only by uvicorn with `FORWARDED_ALLOW_IPS`. Rate limits per user, IP and bar. Reliability weighting. Outlier trimming. Mismatch flag | ratelimit.py, estimation | 11.1 |
| Audit | Every staff and admin write lands in `audit_log`, including staff removal and invite revocation | core/audit.py | 7.1 |
| Review | App Review demo login: one configured phone with a fixed 6 digit code (strength checked), no SMS, normal limits | services/auth.py | 2.x |
| Privacy | Coordinates discarded, distance bucket only. Raw data retention job | core/location.py, scripts/retention.py | 8.3 |
| Supply chain | Locked deps (`uv.lock`), pip-audit, Dependabot, bandit, CodeQL, gitleaks | CI | 14.2 |
| Container | `python:3.12-slim`, non-root uid 10001, app files owned by root (read only to the app) | backend/Dockerfile | 14.1 |

## 5. Decisions reviewers should know
- **Web token storage**: the web client keeps the access token in memory and the refresh token in
  `localStorage`. The strict CSP (no inline script, same origin only) is the main XSS defense. iOS
  will use the Keychain only. Revisit with an HttpOnly cookie if the web client goes beyond the
  pilot. See DECISIONS.md D-010.
- **Certificate pinning**: not planned for v1. ATS plus public CA TLS is the baseline. Pinning adds
  outage risk on certificate rotation for a small team. Revisit before public launch (D-011).
- **Self attested age**: Apple and the bars do the real ID checks at the door. We store only the
  attestation and block signup without it.

## 6. Independent reviews
- Phase 1: `security-review-phase1.md`. Verdict PASS (0 Critical, 0 High, 4 Medium fixed).

## 7. Open risks
| Risk | Impact | Plan |
|---|---|---|
| In-memory rate limiter is per process | Limits weaken with replicas | Redis in Phase 2 |
| No device attestation | Scripted fake reports from many accounts | App Attest spike in Phase 2 |
| SMS stub only | Cannot launch. Toll fraud risk once real | Provider choice with owner, Phase 2 |
| Dev mode returns the login code in the response | Account takeover if dev mode runs in prod | Prod refuses dev secrets and the stub SMS provider, so a prod config cannot start in dev mode by accident. Deploy checklist item |
| Public repo | Design is visible | No secrets or data in git, gitleaks in CI. Owner to make the repo private |
| Retention job not scheduled | Raw data kept longer than promised | Schedule at deploy (Phase 2) |
