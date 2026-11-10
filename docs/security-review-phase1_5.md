# Security review: Phase 1.5 (interim)

Reviewer: security-reviewer (independent, read only). Date: 2026-11-10.
Commit reviewed: `45dfab3` on `claude/pensive-cray-yaaoaf`. The review started at `f909a36`. The
specials items merge (`8c37cca`) that landed during the review was also read.

## Summary
One High finding. A line timer has no row lock when it ends, so one account can end the same
timer many times in parallel. Verified live: one session ended by 10 parallel requests returned
10 successes, wrote 10 reward rows (100 points for one timer) and 10 estimate error rows. Every
duplicate also runs the reliability referee again, so a single 30 second fake timer can move the
reliability of every staff member and student who reported at that bar most of the way to zero,
and can pin the bar's calibration factor for up to a week. The start path has the same race (3
active sessions for one user from 10 parallel starts). This breaks the core sourcing design and
the planned rewards, and it needs only one ordinary account.

Three Medium findings are about who controls the ground truth. Staff line samples referee the
same staff member's own line readings and feed calibration with no hourly cap. The door code
proves where a student was when the timer ended, not when it started. Calibration accepts every
completed timer, trusted or not, and a single timer is enough to set the factor.

BOLA and role checks on every new route held up under direct testing. The web and iOS clients
render specials as plain text only. No secrets, real phones or real bar data were found in git
history. The iOS app keeps the refresh token in the Keychain only and logs nothing sensitive.

Counts: Critical 0, High 1, Medium 3, Low 5, Info 8. **Verdict: BLOCK** until H-1 is fixed.

## Scope
New since `security-review-phase1.md`:
- Backend: bar specials (models, schemas, `services/specials.py`, `api/v1/specials.py`, deal
  items and all day), staff line samples (`services/samples.py`), rotating door code
  (`services/door.py`, `activity.end_session`), count sync, sourcing v2 reliability scoring
  (`activity.score_line_sources`), estimation changes for verified timers and sync events, admin
  staff removal and invite revocation, the three new migrations, seed, simulator and smoke test.
- Web: `web/js/staff.js` door mode (offline tap queue in localStorage, keyboard clicker keys,
  wake lock, clicker total pad, door code tab, line samples), student door code entry and
  specials display in `web/js/app.js`, `web/js/api.js`, `web/js/ui.js`.
- iOS (`ios/`): Keychain store, token store and refresh single flight, middleware, LiveAPI, door
  mode, specials views, one shot location, `Info.plist`, `PrivacyInfo.xcprivacy`, xcconfig ATS
  posture, `project.yml`. Read only, not compiled.
- CI/CD: `.github/workflows/ci.yml`, `ios.yml`, `codeql.yml`, `cd.yml`, `.github/dependabot.yml`,
  `backend/Dockerfile`, `.dockerignore`.
- Git history: all 49 commits scanned for credentials, real phone numbers and real data.
- Baseline: OWASP ASVS 4.0 L1, L2 for V2, V3, V4 and V8. OWASP MASVS for the iOS app (STORAGE,
  CRYPTO, NETWORK, PLATFORM, PRIVACY, CODE).

## Method
1. Read CLAUDE.md, SECURITY.md, THREAT_MODEL.md, SOURCING.md, ESTIMATION.md and the Phase 1
   review with its remediation table, then every file in scope.
2. Ran the suite against an isolated scratch database (`crowded_secrev2`): 274 passed, 0
   skipped. `bandit -r app scripts`: no issues. `pip-audit --strict` on the frozen runtime
   requirements: no known vulnerabilities.
3. Started the server in dev mode on port 8012 against the scratch database (migrated and seeded
   with FAKE data) and probed it with small Python scripts:
   - Cross bar access by staff of bar A and by a student to door-code, count-sync, line-samples
     (start, list, end), and specials (list, create, patch with another bar's special id).
   - Special titles with HTML, U+202E (right to left override), zero width spaces and
     non breaking spaces.
   - Count sync to 5000, 60 taps of 20 on top, then sync to 0. Eight parallel syncs. Sync into
     capacity mode with a line reading.
   - 10 parallel starts of a line session by one user. 10 and 30 parallel ends of one session,
     repeated over five trials. Checked `reward_ledger` and `estimate_errors` in the database.
4. Scanned `git log -p --all` for key and token patterns, secret assignments, phone numbers that
   are not 555 numbers, and email addresses.
5. Stopped the server and dropped the scratch database afterwards. Nothing in the repository was
   changed except this file.

## Findings

### H-1 High: a line timer can be ended many times in parallel (points, calibration and reliability multiplied)
- Location: `backend/app/services/activity.py:121-152` (`end_session` reads with `db.get`, checks
  `status`, then writes, with no row lock and no conditional update),
  `backend/app/services/activity.py:83-101` (`start_session` checks for an active session the
  same way), `backend/app/services/samples.py:81-103` (`end_sample`, same pattern),
  `backend/app/models.py:370-378` (`reward_ledger` has no unique key on `reason, ref_id`),
  `backend/app/api/v1/activity.py:35-39` (no rate limit on the end route)
- Description: two requests that end the same active session both pass the `status == active`
  check and both commit. Each one adds a reward row, an `estimate_errors` row, a reliability
  update for the owner, and a full `score_line_sources` pass over every staff reading and student
  report made in the 10 minutes before the timer started. The wrong door code limiter is also
  checked before any miss is recorded, so parallel ends can each carry a different code guess.
  Starts race the same way, so one user can hold several active timers (each one raises the
  "people in line" floor).
- Exploit scenario: verified live. 10 parallel ends of one 30 second timer returned 10 times 200
  with `points_awarded: 10`. The database then held 10 `reward_ledger` rows with the same
  `ref_id` and 10 `estimate_errors` rows for that one timer. Over four more trials with warmed
  connections, 5, 2, 1 and 1 of 10 parallel ends succeeded, so the race is easy to hit. 10
  parallel starts created 3 active sessions for one user. With spoofed "at the door" coordinates
  (accepted risk L-4 from Phase 1), one account can then:
  1. Farm points without limit (each duplicate pays again). The rewards plan in SOURCING.md
     turns points into skip the line passes and free cover.
  2. Wreck staff reliability at a rival bar. `update_reliability` moves 20 percent toward the
     target per call, so 10 duplicates move a staff member 89 percent of the way to the value
     implied by the fake timer. A 0.5 minute timer implies a tiny line, so staff who said "long"
     drop near the 0.05 floor in one shot and stop counting in the estimate.
  3. Pin the bar's calibration factor to 0.5 or 2.0 (see M-3), which halves or doubles every
     formula wait at that bar for days.
  The `line_user` limit (10 timers per hour) does not bound any of this, because it only counts
  starts.
- Recommended fix: end with one atomic statement, for example `UPDATE line_sessions SET ...
  WHERE id = :id AND user_id = :uid AND status = 'active' RETURNING ...`, or load the row with
  `with_for_update()` before the status check. Do the same in `end_sample`. Add a partial unique
  index on `line_sessions (user_id) WHERE status = 'active'` (catch `IntegrityError` and return
  409) so starts cannot race. Add a unique constraint on `reward_ledger (reason, ref_id)` as
  defense in depth. Rate limit the end route. Add tests: 10 parallel ends give exactly one 200,
  one ledger row and one error row, and 10 parallel starts give exactly one 201.

### M-1 Medium: staff line samples let staff produce the ground truth that referees them
- Location: `backend/app/services/samples.py:61-103`,
  `backend/app/services/activity.py:179-223` (`score_line_sources` is called for samples with no
  `exclude_user`), `backend/app/services/live.py:172-181` (samples are verified, near bar timers),
  `backend/app/services/samples.py:16` (only a cap of 2 active samples)
- Description: SOURCING.md says timers referee everyone and staff who inflate the line lose
  weight. A finished sample is treated as a verified timer (2x weight in the timer median), writes
  a calibration row, and scores every line claim from the 10 minutes before it started,
  including the same staff member's own `outside_line_status` rows. Duration is whatever the
  staff member chooses (0.5 to 240 minutes). There is no hourly cap, only 2 active at once and
  the general `staff_user` limit (240 per minute).
- Exploit scenario: a door staffer wants the wait to look long to sell skip passes (the bias
  SOURCING.md names). They set the line to "very long", start a sample, and end it at a duration
  that matches 65 people at the current entry rate. Their own reliability rises toward 1, the
  students who reported "short" lose reliability, the timer median moves up at double weight,
  and the calibration factor rises. Running two staggered samples all night keeps it there. The
  reverse (many 0.5 minute samples) hides a real line. Every sample is in the audit log, so it
  is detectable after the fact, but nothing flags it.
- Recommended fix: never let a sample score its author. Better, let samples score only student
  reports and let staff readings be scored only by student timers. Cap samples per staff member
  per hour (for example 4) and require a minimum gap between starts. Keep samples out of
  calibration, or give them a capped share. Add an admin metric that compares each staff
  member's samples with student timers at the same bar and time.

### M-2 Medium: the door code proves presence at the end of a timer, not during it
- Location: `backend/app/services/activity.py:131-146` (`trusted = s.near_bar or s.verified`),
  `backend/app/services/live.py:167` (`near_bar=s.near_bar or s.verified`),
  `backend/app/services/door.py:34-39` (current and previous 2 minute buckets accepted)
- Description: a correct code marks the whole timer verified and trusted, even when the timer
  was started far away or with no location, and even when it ran for up to 240 minutes. A code is
  usable for 2 to 4 minutes by anyone who has it. Staff show it on a screen at the door, so a
  photo in a group chat is enough to share it. Codes are bound to the bar (a code from bar A does
  not verify a timer at bar B, verified by test and by reading `code_matches`).
- Exploit scenario: a student starts a timer at home, arrives 60 minutes later, walks straight
  in and types the code from the door screen. The result is a verified 60 minute wait at 2x
  weight, 20 points, a reliability boost for the student, a calibration row, and a referee pass
  that marks staff and students who correctly said "short" as unreliable. A friend who received
  the code by text can do the same from anywhere. Brute force is not the realistic path: the
  wrong code limiter allows 5 misses per hour per user, each guess has a 2 in 10000 chance (two
  valid buckets), so about 0.1 percent per account per hour. H-1 and L-4 raise that a little.
  Staff leaking the code cannot be prevented, so the fix should limit what a verified timer is
  worth rather than rely on secrecy.
- Recommended fix: only let a door code upgrade a timer that started near the bar (verified
  means "near at start and confirmed at the door"). Ignore or down weight verified timers whose
  duration is far above the live estimate when the timer started (for example more than 2x plus
  15 minutes) until a second source agrees. Accept the previous bucket only for a short grace
  (for example 30 seconds after rotation) instead of the full 2 minutes. Optionally cap verified
  timers per bar per bucket by the entries tapped in that bucket.

### M-3 Medium: calibration accepts every completed timer and one timer is enough to set it
- Location: `backend/app/services/activity.py:136-137` (`record_error` runs for every completed
  timer, trusted or not), `backend/app/services/live.py:79-93`,
  `backend/app/estimation/engine.py:394-409` (`calibration_factor` has no minimum count)
- Description: completed timers that were neither near the bar nor verified are excluded from
  rewards and refereeing, but they still write `estimate_errors` rows, and calibration is the
  weighted median of those rows over 7 days with a 1 day half life. With a single row the factor
  is that row's ratio, clamped to 0.5 to 2.0. The same rows drive the admin accuracy metric.
  Untrusted completed timers also count in the timer median at full weight
  (`engine.py:119-145` does not look at `near_bar`). That part dates from Phase 1 and was not
  raised then.
- Exploit scenario: reproduced in a smaller form. At a FAKE bar with a staff line of "medium" and
  a formula wait of 7 minutes, one 30 second timer created one calibration row with ratio 0.08.
  The factor became 0.5 and the shown wait dropped from 7 to 2 minutes. At a pilot bar with
  sparse timers, any one user (no location needed) can halve or double the formula wait for that
  bar for days. With H-1 one user can outvote every honest timer of the week.
- Recommended fix: write calibration rows only for trusted timers, at most one per user per bar
  per night. Return 1.0 until there are at least 5 points from at least 3 distinct users. Exclude
  untrusted timers from the timer median, or give them the far report weight (0.3).

### L-1 Low: line samples are missing from the retention job and the data inventory
- Location: `backend/scripts/retention.py:37-59`, `docs/SECURITY.md` section 2
- Description: `line_samples` holds `staff_user_id`, bar and start and end times, which is a work
  hours trail for each door staffer. It is never purged. SECURITY.md section 2 also does not list
  `line_samples`, `bar_specials` (with `created_by`) or the new `line_sessions.verified` flag.
  Account deletion is fine: `line_samples.staff_user_id` and `bar_specials.created_by` are set to
  null, and verified sessions cascade with the user.
- Exploit scenario: a DB dump shows when a given staffer worked the door months later.
- Recommended fix: purge `line_samples` with the raw window (30 days) and add a retention test.
  Add the three items to the data inventory.

### L-2 Low: the web offline tap queue replays as a burst and is not tied to the signed in user
- Location: `web/js/staff.js:455-505` (queue load and persist), `web/js/staff.js:614-665`
  (`drain`, `enqueue`), `web/js/staff.js:22` and `web/js/api.js:124-130` (sign out does not clear
  `crowded.door.queue.*`)
- Description: the queue stores only `{dir, n, ts}` per bar, with no token, which is good, and
  entries are validated on load (direction, 1 to 20, younger than 6 hours). But the server stamps
  every event at receipt time, so a queue that built up offline lands in one burst. Entry rate
  uses tap events in the last 15 minutes, so a burst shows a fast moving door and a short wait.
  The queue also survives sign out and is replayed by whoever next opens that bar's counter on the
  same browser, and entries from before local noon can land in the next night.
- Exploit scenario: no attacker gain beyond what staff can already do. A shared door tablet
  posts one staffer's taps under the next staffer's account (wrong audit attribution), and a
  reconnect after a dead zone makes the wait look shorter for 15 minutes.
- Recommended fix: send the client tap time and let the server accept it within a small window
  (for example up to 15 minutes in the past, never in the future), or mark replayed taps so they
  do not set a rate. Key the queue by user id and clear it on sign out. Drop entries from before
  the current night.

### L-3 Low: count sync fails above a 5000 difference and can force capacity mode
- Location: `backend/app/api/v1/staff.py:150-178`, `backend/app/models.py:289-295`
  (`door_count_range`), `docs/SOURCING.md` "Clicker sync"
- Description: the difference is computed from tonight's totals and inserted as one sync event.
  When the current headcount is above 5000 (taps alone can get there), syncing to a lower total
  violates the CHECK constraint and returns 500. Verified live: headcount 6200, sync to 0, 500 and
  a full traceback in the log. Separately, a sync to 95 percent of capacity puts the bar in
  capacity mode, where the entry rate becomes the exit rate (floor 0.5 per minute). Verified live:
  sync to capacity, a "long" line and one tap gave a 76 minute wait (flagged `line_not_moving`,
  low confidence). SOURCING.md only says a sync cannot fake a fast line. Staff can already reach
  the same state with taps, so this is not a new privilege. The read, compute, insert sequence
  has no lock. Eight parallel syncs did not produce a wrong total in testing.
- Exploit scenario: a staffer with a clicker typo or a bad night of taps cannot recover with
  sync. A biased staffer can make a long wait with one request instead of many taps.
- Recommended fix: split a large difference into several events, or reject with 409 and a clear
  message. Lock the bar row (`SELECT ... FOR UPDATE`) during sync. Document that sync can trigger
  capacity mode, and consider requiring a tap based exit rate before capacity mode applies.

### L-4 Low: the wrong door code limiter is not atomic and lives in process memory
- Location: `backend/app/core/ratelimit.py:79-89`, `backend/app/services/activity.py:104-111`
- Description: `door_code_allowed` counts misses, then `door_code_miss` records one later. Parallel
  ends (H-1) all pass the check before any miss is recorded. The counter is per process, per user
  only, and resets on every deploy or restart (known D3).
- Exploit scenario: with H-1 unfixed, each line session can carry several guesses. Still only a
  few percent per account per hour, and a hit is worth +10 points and 2x weight.
- Recommended fix: fixing H-1 removes most of this. Record the attempt and check the count in one
  step (count first, then always record, then compare). Move to Redis with the other limits.

### L-5 Low: iOS packages and some build inputs are not pinned
- Location: `ios/project.yml:20-32` (`from:` ranges), `ios/.gitignore` and `.gitignore`
  (`*.xcworkspace/` excludes `Package.resolved`), `.github/dependabot.yml` (no `swift`
  ecosystem), `.github/workflows/ios.yml` (`brew install xcodegen` unpinned),
  `backend/Dockerfile:3-4,12` (Phase 1 L-10 carryover)
- Description: every iOS CI run and release build resolves the newest matching versions of the
  swift-openapi packages, with no lock file in git. The OpenAPI generator runs as a build plugin
  with `-skipPackagePluginValidation`, so a compromised release would run code at build time. The
  Docker base images and `ghcr.io/astral-sh/uv:0.11` are still tags, not digests.
- Recommended fix: commit `Package.resolved` (for example with XcodeGen
  `options.packageResolvedPath` or by un-ignoring `xcshareddata/swiftpm/Package.resolved`), pin
  exact versions, add the `swift` ecosystem to Dependabot, pin XcodeGen to a version, and pin the
  Docker images by digest.

### I-1 Info: special text accepts Unicode bidi and zero width characters
- Location: `backend/app/schemas.py:135-138` (`_clean_text` only rejects code points below 32
  and 127)
- Description: verified live. A title with U+202E (right to left override) and one with zero
  width spaces were accepted and returned. Both clients render text only, so there is no XSS, but
  a staffer can make a title read differently from what is stored (for example a reversed price).
  The same applies to deal item names, price labels and notes.
- Fix: also reject Unicode category `Cf` (format) characters and U+2028 and U+2029.

### I-2 Info: unhandled database errors log SQL bound parameters
- Location: `backend/app/db.py:20`, `backend/app/main.py:53-56`
- Description: the L-3 500 above logged the full statement with bar id and staff user id. No
  phone, code or coordinate goes into SQL today, so nothing sensitive leaked, but a future column
  could.
- Fix: `create_engine(..., hide_parameters=True)` outside dev.

### I-3 Info: admins pass `StaffBar` (answer to question 3)
- Location: `backend/app/core/deps.py:77-98`
- Description: admins can act as door staff at every bar, including taps, line readings, samples,
  count sync and door code reads. Writes are audited with `actor_role = admin`. Door code reads
  are not audited for anyone, by design. This is reasonable for a founder team running a pilot,
  and it is pinned by `test_staff_scoped_to_their_bar`. Admin line readings get the staff weight,
  and an admin's samples also fall under M-1.
- Fix: keep it. Consider auditing admin door code reads, and make the admin path explicit in the
  OpenAPI description of the staff routes.

### I-4 Info: admin staff and invite routes are not in the role test list
- Location: `backend/tests/api/test_authorization.py:60-85` (`ADMIN_CALLS`),
  `backend/app/api/v1/admin.py` (list staff, remove staff, revoke invite)
- Description: the three routes use `AdminUser` and the deny by default enumeration covers 401,
  but no test asserts that staff and users get 403. `remove_staff` also leaves the removed
  staffer's active samples counting as timers until they expire (3 hours).
- Fix: add the routes to `ADMIN_CALLS`. Abandon active samples of a removed staffer.

### I-5 Info: iOS Keychain token survives reinstall, and a failed write is silent
- Location: `ios/Crowded/Core/Auth/KeychainStore.swift:40-58`,
  `ios/Crowded/Core/Auth/TokenStore.swift:36-39,74`
- Description: Keychain items persist after the app is deleted, so a reinstall signs the previous
  user back in. If a write fails after a refresh, the old token stays and the next launch triggers
  reuse detection (sign out). Accessibility is `AfterFirstUnlockThisDeviceOnly`, which keeps the
  token out of backups and iCloud. Good.
- Fix: on first launch after install (flag in UserDefaults), delete the stored refresh token.
  Log or surface a failed write.

### I-6 Info: iOS sends full precision coordinates
- Location: `ios/Crowded/Core/Location/OneShotLocation.swift:19,42`
- Description: one shot `requestLocation` at 100 m accuracy with When In Use only is a good
  posture, and the server drops the coordinates. Rounding on the device would mean exact
  coordinates never leave it, which is a stronger claim for the privacy policy and App Review.
  The privacy manifest matches what is collected: phone number, user id, coarse location and user
  content, all linked, none tracking, and UserDefaults with reason CA92.1 (theme only).
- Fix: round to 3 decimals (about 100 m) before sending. The 75 m door bucket may then need
  4 decimals (about 11 m).

### I-7 Info: FAKE seed coordinates sit in a real college downtown
- Location: `backend/scripts/_common.py:36-72`
- Description: the bars are labeled FAKE, with FAKE addresses and 555 phones, but the coordinates
  point at a real US college downtown a few hundred meters apart. In a public repo this hints at
  the pilot town and could match real venues.
- Fix: move the FAKE bars to an obviously fictional location (for example near 0, 0) or offset
  them far from any town.

### I-8 Info: bar list responses grow with specials, and the 30 per bar cap is racy
- Location: `backend/app/api/v1/specials.py:33-40`, `backend/app/schemas.py:141-163`
- Description: every bar summary carries tonight's specials with up to 20 deal items each, so a
  bar list can carry tens of KB per bar on every poll. The count check and insert are not locked,
  so parallel creates can pass 30. Staff only, small impact.
- Fix: lock the bar row during create, and consider leaving deal items to the bar detail route.

## Answers to the lead's questions
1. Door code: see M-2, L-4 and H-1. Brute force is about 0.1 percent per account per hour with
   the limiter working (5 misses, 2 in 10000 per guess). Session creation is 10 per hour per
   user. A code from one bar does not work at another. Staff can leak a code, which stays valid
   for 2 to 4 minutes. Realistic impact: +10 points per timer and a 2x weight timer whose start
   was never checked. The bigger problem is that a verified timer's duration is not checked.
2. Estimates: see H-1, M-1, M-3 and L-3. Count sync up to 5000 moves the headcount and can force
   capacity mode, but staff could already do that with taps. The samples cap of 2 active does not
   limit the number of samples per hour, and samples referee their own author. A coordinated
   group of students can win the line median (5 default reports outweigh one default staff
   reading), which is the accepted T1 and L-4 risk. With H-1, one account is enough.
3. BOLA: held on every new route, verified live and covered by tests (door-code, count-sync,
   line-samples start, list and end with another bar's id, specials CRUD with another bar's id).
   Admins passing `StaffBar` is fine for the pilot (I-3).
4. Stored XSS: none. Web specials go through `h(..., {text: ...})` and text nodes only. The one
   `innerHTML` sink is still constant icon markup. iOS uses `Text(String)`, which does not parse
   Markdown, and there is no web view or `openURL`. Deal items are not rendered by any client
   yet. Keep to text only when they are. Bidi characters are I-1.
5. Privacy: no coordinates or raw phones in the new tables or logs. Missing from retention:
   `line_samples` (L-1). `bar_specials` is bar data and does not need a window. Verified sessions
   are deleted with the user and purged with `line_sessions`.
6. Offline queue: only `{dir, n, ts}`, no tokens. Replay risks are L-2. The refresh token stays
   in `crowded.rt` as decided in D-010.
7. iOS: tokens only in memory and the Keychain, no logging calls at all, no ATS exceptions
   (Release uses https, Debug points at localhost), and the privacy manifest matches. See I-5,
   I-6 and L-5.
8. Public repo: nothing found. No key, token or secret patterns in any commit. Number like
   strings outside 555 are all package hashes in `uv.lock`. Emails are `crowded.example`
   placeholders. Seed and sim data are labeled FAKE (I-7 is the only note).

## Verified as good
- Deny by default: the OpenAPI based enumeration covers the new routes automatically and is not
  empty. Unauthenticated calls to every new staff route return 401, and students get 404.
- Staff scoping: staff of bar A got 404 on bar B for door-code, count-sync, line-samples (start,
  active, end) and specials (list, create). A bar B sample or special id through a bar A url
  returned 404 and left the row unchanged. Admin specials routes check the special's bar too.
- Door code: HMAC with the pepper and a `door` purpose, per bar and per 2 minute bucket, nothing
  stored, both buckets compared in constant time, strict `^[0-9]{4}$` input, a wrong code never
  fails the request, and the code endpoint is `no-store`.
- Count sync: `0 <= inside_now <= 5000`, audited with `inside_now` and `delta`, and sync events
  never set a rate (verified live: a sync only bar used the default rate).
- Samples: at most 2 active per bar under a row lock, 0.5 to 240 minute bounds, 3 hour expiry,
  every start and end audited.
- Specials: strict models with `extra="forbid"`, length limits, control characters rejected,
  unique days, HH:MM times, 20 items max, 30 per bar, IANA timezone handling, all writes audited
  with the field names changed (not the values).
- Web: no new HTML sinks, no dynamic `href` from server data, CSP compatible (CSSOM only), the
  clicker key handler skips inputs, modifiers and repeats, and the wake lock is released when the
  page is hidden or the tab changes. Mock mode still uses its own storage key.
- iOS: refresh token in the Keychain with `AfterFirstUnlockThisDeviceOnly`, access token in
  memory, single flight refresh inside an actor, the refresh call uses a client without the auth
  middleware (no recursion), local sign out when the refresh is rejected, no `print`, `NSLog`,
  `os_log` or `Logger`, UserDefaults only for the theme, no ATS exceptions, Release base URL is
  https, location is When In Use with one `requestLocation`, and the `-mockAPI` switch uses an in
  memory store.
- Privacy: no coordinate columns in the new tables. `line_samples.staff_user_id` and
  `bar_specials.created_by` are set to null on account deletion. Audit details carry no phone or
  location.
- CI/CD: all actions pinned to commit SHAs, `pull_request` only (no `pull_request_target`), read
  only tokens except `packages: write` in the CD image job, which runs only on `main`, tags and
  manual dispatch. `.dockerignore` keeps `.env`, `.git`, `.claude`, `ios` and `docs` out of the
  image. The container still runs as uid 10001 with `--no-access-log`.
- Tests: 274 passed with no skips. Bandit and pip-audit clean.

## Gate verdict
**BLOCK.** H-1 must be fixed first: lock or conditionally update the session and sample rows on
end, add the partial unique index for one active session per user, and add the parallel end and
start tests. M-1 and M-3 are small changes and should land in the same pass, since together with
H-1 they decide whether timers can be trusted as the referee. M-2 can follow before the pilot
opens. Schedule the Low items for Phase 2.

## Remediation status (backend-implementer, after review)
Awaiting re-review by the lead's security gate.

| ID | Status | Fix |
|---|---|---|
| H-1 | Fixed | `end_session` and `end_sample` load the row with `SELECT ... FOR UPDATE` and re-check the status. Rewards, estimate errors, reliability and refereeing run only for the request that won. Partial unique index `uq_line_sessions_one_active` on `line_sessions (user_id) WHERE status = 'active'`. `start_session` turns the `IntegrityError` into 409 `session_already_active`. Sample starts hold the bar row lock until the insert commits (the old code committed inside the lock, which released it). Partial unique index `uq_reward_ledger_reason_ref` on `reward_ledger (reason, ref_id) WHERE ref_id IS NOT NULL`. The migration abandons duplicate active timers and drops duplicate rewards first. New limit `line_end_user` (20 per hour). Tests with 10 real parallel requests: `test_parallel_ends_of_one_timer_have_one_winner`, `test_parallel_starts_give_one_active_timer`, `test_parallel_sample_ends_have_one_winner`, `test_parallel_sample_starts_respect_the_active_cap` |
| M-1 | Fixed | `score_line_sources` excludes the author from staff readings and student reports. Samples pass their `staff_user_id`. 4 samples per staff member per hour (409 `sample_rate_limited`). Sample errors are stored with `source = "sample"` and are never eligible for calibration. Tests `test_sample_never_scores_its_own_author`, `test_samples_are_capped_per_staff_per_hour`, `test_samples_never_move_calibration`. Not done: the admin metric that compares staff samples with student timers |
| M-2 | Fixed | `verified` = started near the bar AND a valid code. A timer started away or with no location ends normally and unverified, and the code is not checked. Documented in SOURCING.md. Test `test_door_code_does_not_verify_a_timer_started_away`. Not done: the duration sanity check and the shorter grace for the previous bucket |
| M-3 | Fixed | `estimate_errors.eligible` is true only for completed timers that started near the bar, the first per user per bar per night. `live._calibration` uses eligible timer rows only and returns 1.0 until there are 5 points from 3 distinct users. Distinct users are counted through `line_sessions.calibration_eligible`, so `estimate_errors` stays free of user ids and user keys. Older rows are kept for MAE but are not eligible. Tests `test_calibration_needs_five_points_from_three_users`, `test_one_calibration_point_per_user_per_night`. Open: untrusted completed timers still count in the timer median at full weight (Phase 1 behavior) |
| L-1 | Fixed | `line_samples` purged with the raw window. The data inventory lists line samples, specials and the `verified` and `calibration_eligible` flags. Test `test_retention_purges_old_line_samples` |
| L-2 | Open | Web client work (offline queue). Not in this backend pass |
| L-3 | Partly fixed | A difference over 5000 returns 422 `sync_too_large`, never 500. Sync locks the bar row. Capacity mode through sync is documented, not changed. Test `test_count_sync_too_large_is_422_not_500` |
| L-4 | Partly fixed | Wrong door code check, match and miss count run in one step under the limiter lock (`RateLimiter.guarded`). Still in process memory until Redis (D3). Test `test_guarded_limiter_counts_misses_atomically` |
| L-5 | Open | iOS and Docker pinning. Not in this backend pass |
| I-2 | Fixed | Engine created with `hide_parameters=True`. Test `test_engine_hides_sql_parameters` |
| I-7 | Fixed | FAKE seed and simulator bars moved to a made up point in the open ocean near 0.5 N, 0.5 E. Test fixtures use the same spot |
| Others | Open, tracked | I-1, I-3, I-4, I-5, I-6, I-8 |
