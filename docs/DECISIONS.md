# Decisions log

Newest at the bottom. Format: ID, date, decision, why, revisit when.

- **D-001 (2026-11-09) Product name is Crowded.** "Line Check" is retired everywhere.
- **D-002 (2026-11-09) uv for Python packaging.** Fast, one lockfile (`uv.lock`), Dependabot
  supports it, and the Docker build uses `uv sync --frozen`. Poetry was the alternative.
- **D-003 (2026-11-09) Sync SQLAlchemy 2 with psycopg 3.** FastAPI runs sync routes in a thread
  pool. Simpler to test and reason about at pilot scale. Revisit if p95 latency matters.
- **D-004 (2026-11-09) Estimation is computed on read, snapshots written at most every 2 min per
  bar.** With 3 bars this is cheap and always fresh. Snapshots feed the hour chart and history.
  Revisit at 20+ bars (move to a background job).
- **D-005 (2026-11-09) "Tonight" runs from local noon to local noon** in the bar's IANA timezone.
  Door headcount resets at noon. No manual reset button needed.
- **D-006 (2026-11-09) Phones and Apple subs stored only as peppered HMAC-SHA256** plus the last 2
  phone digits. We can look users up but a DB dump alone reveals no numbers.
- **D-007 (2026-11-09) Raw retention proposal: 30 days** (owner asked for a number). Thirty days
  covers four weekends, enough to calibrate and debug. Bar level aggregates (snapshots, estimate
  errors) carry no user ids and are kept 365 days. Configurable via `CROWDED_RAW_RETENTION_DAYS`.
  Owner signed off 2026-11-09.
- **D-008 (2026-11-09) In-process rate limiter for v1.** Single instance pilot. Must move to Redis
  before running more than one replica.
- **D-009 (2026-11-09) Web client is no-build vanilla JS with CSS tokens, served by the backend.**
  Gives the owner a UI to tune today without Xcode, doubles as the Phase 2 staff door counter,
  and keeps a strict same origin CSP. The iOS app (Phase 3) mirrors its tokens.
- **D-010 (2026-11-09) Web refresh token in localStorage, access token in memory.** Strict CSP is
  the XSS defense. iOS uses the Keychain only. Revisit with an HttpOnly cookie if web grows.
- **D-011 (2026-11-09) No certificate pinning in v1.** ATS on, public CA TLS, HSTS. Pinning adds
  outage risk on rotation for a small team. Revisit before public launch.
- **D-012 (2026-11-09) All bar data requires sign in.** Keeps the 21+ gate meaningful and raises
  the bar for scraping. Revisit if we want a public teaser page.
- **D-013 (2026-11-09) Prod refuses to boot with dev secrets or the stub SMS provider.** Dev mode
  returns login codes in the response, so it must never run on a public host.
- **D-014 (2026-11-09) Calibration uses a one day half life** (separate from the 12 min live
  recency half life) so a week of timers actually contributes.
- **D-015 (2026-11-09) Visual direction for v1: Uber-like minimal.** Light theme is monochrome
  (black on white, black pill buttons). Dark theme uses the spec palette. Amber accent only for
  the verdict and the active timer. Fonts Bricolage Grotesque (display) and DM Sans (body).
- **D-016 (2026-11-09) Crowd and line sourcing is the core.** The pass verdict stays but is
  secondary in the UI. Reports and timers are first class actions.
- **D-017 (2026-11-09) Black and white UI for now** (owner). Accent tokens remain so color can
  come back with a single token change.
- **D-018 (2026-11-09) Separate entry points for students and staff.** Students use `/`, staff use
  `/staff.html` with its own sign in and invite flow. Same account system, roles decide access.
- **D-019 (2026-11-09) App Review demo login** through `CROWDED_REVIEW_PHONE` and
  `CROWDED_REVIEW_CODE`, off by default. Turn it on only while a review is open.
- **D-020 (2026-11-09) Refresh token grace of 10 seconds** for concurrent refreshes, which would
  otherwise log out users with two tabs. A thief racing within 10 s of a rotation is accepted.
- **D-021 (2026-11-09) Client IP comes only from uvicorn's proxy handling**
  (`FORWARDED_ALLOW_IPS`). The app never reads X-Forwarded-For.
- **D-022 (2026-11-09) iOS 17 minimum** (owner signed off).
- **D-023 (2026-11-09) Staff and student line readings are fused, not ranked.** One weighted median
  where staff start at 3x weight, and every source's weight is scaled by a reliability learned from
  completed timers (actual wait x entry rate = people really in line). Big gaps are flagged and
  shown as "Staff and reports differ". See docs/SOURCING.md.
- **D-024 (2026-11-09) Launch through social with a direct download link** (TestFlight public link,
  later App Store) instead of hosting a marketing site. Apple still requires a hosted privacy
  policy and support URL, so those two pages need a free host.
- **D-025 (2026-11-09) iOS builds and tests run in CI on GitHub macOS runners** (owner has little
  disk). Project generated with XcodeGen, API client by swift-openapi-generator.
- **D-026 (2026-11-09) Worker model policy** (owner). Haiku for docs, Sonnet for implementation,
  tests and assets, Opus only for design taste, architecture and security gates. Table in CLAUDE.md.
- **D-027 (2026-11-09) Pilot may start with one bar.** Nothing in the system assumes more than one.
- **D-028 (2026-11-09) Legal pages on GitHub Pages.** GitHub Pages needs a public repo on the free
  plan. If the main repo goes private, the pages live in a small public repo (crowded-legal).
- **D-029 (2026-11-10) Staff levels.** Door staff only do fast door work: count IN, report the
  line wait, report how busy it is inside. Counting OUT is optional. Managers (and admins) also
  edit specials and bar settings. Door staff get 403 `manager_only` on those routes. The level
  comes from the admin invite (`door` by default). Owner feedback.
- **D-030 (2026-11-10) Door code off by default.** The rotating code slowed students down at the
  door. `CROWDED_DOOR_CODE_ENABLED` defaults to false. The route returns 404 `door_code_disabled`
  and a typed code is never verified. All code and tests stay so we can turn it back on.
- **D-031 (2026-11-10) Drink wait.** Staff and students report how long a drink takes in four
  buckets. A 10 minute line plus a 20 minute drink wait matters. One weighted median over staff and
  student readings, shown as the nearest bucket with its basis. Nothing recent means none.
- **D-032 (2026-11-10) Count in only bars.** A bar can skip exit counting (`counts_exits` false).
  No headcount or capacity mode from the door. Entry rate still comes from IN events and crowd
  level comes from the inside reports.
- **D-033 (2026-11-12) Black and white theme stays for now** (owner). Color is held back for brand
  moments only (logo, marketing) if we add one later. Data never uses color to carry meaning.
