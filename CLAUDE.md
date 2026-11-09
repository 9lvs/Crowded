# Crowded: shared context for every session

Crowded is a mobile app for college students (21+) that shows live line wait times and crowd
levels at downtown bars, plus a verdict on whether a line-skip pass is worth buying. Pilot: 2 to 3
bars in one college town. Earlier working name "Line Check" is retired. Use "Crowded".

Start here: docs/ROADMAP.md (what is done and next), docs/DECISIONS.md (why things are the way
they are), docs/SECURITY.md (controls), docs/ESTIMATION.md (the wait formula).

## Layout
- `backend/` FastAPI app (Python 3.12, uv). `app/` code, `tests/`, `scripts/`, `alembic/`.
- `backend/app/estimation/` pure functions only. No DB, no clock, no I/O.
- `web/` no-build web client (vanilla JS + CSS tokens), served by the backend at `/`.
  Student screens plus the staff door counter at `/staff`. Has a mock mode (`?mock=1`).
- `ios/` SwiftUI app (Phase 3, not started).
- `docs/` roadmap, decisions, security packet, threat model, OpenAPI export.

## Run and test (from `backend/`)
```bash
uv sync
uv run alembic upgrade head          # needs CROWDED_DATABASE_URL
uv run uvicorn app.main:app --reload # http://localhost:8000, docs at /docs in dev
uv run pytest                        # needs CROWDED_TEST_DATABASE_URL (Postgres)
uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts
uv run python scripts/simulate_night.py --help
uv run python scripts/export_openapi.py   # writes docs/openapi.json (CI checks it is current)
```
Local Postgres in the cloud sandbox: `pg_ctlcluster 16 main start`, user and db `crowded`.

## Hard product constraints
- No Line Leap integration and no scraping of anyone. Pass price is a manual admin field.
- Never store a location trail. Location is read once per action, the server computes distance
  to the bar, stores only `near_bar` and a distance bucket, and discards the coordinates.
- Every number ships with its basis ("Based on 6 reports in the last 30 min"). With nothing
  recent, show "No recent data", never a stale number.
- Verdict: recommend the pass when estimated wait exceeds the user's threshold (default 20).

## Security rules (non negotiable)
- The repo is PUBLIC. Never commit secrets, real data, real phone numbers or business numbers.
  Seed and sim data is labeled FAKE.
- Deny by default. Every route declares its auth dependency. Staff are scoped to one bar.
  Every endpoint taking a bar or session id has a BOLA test.
- No raw phone numbers or Apple subs at rest (peppered HMAC only). No date of birth, only an
  attestation timestamp. No coordinates.
- Secrets only from env vars. Never log tokens, codes, phones or coordinates.
- Staff and admin actions write to `audit_log`.
- Strict Pydantic models (`extra="forbid"`). ORM or bound parameters only, no string SQL.

## Conventions
- Feature branches and PRs. Small commits. Never push to `main`.
- API is versioned under `/v1`. OpenAPI (`docs/openapi.json`) is the contract for web and iOS.
- Times are UTC in the API and DB. Bars carry an IANA timezone for "tonight" and hour charts.
- Writing style in docs and UI copy: short plain sentences, no em dashes, no semicolons.

## Team
Lead session (Opus) plans, reviews, merges and runs the security gate. Subagents live in
`.claude/agents/`: backend-implementer and test-and-sim (Sonnet), security-reviewer (Opus,
read only), docs-light (Haiku). Parallel work only across different directories, one branch
per worker, written brief per task. The lead merges.

## Phase gates
A phase is done when: tests pass, estimation coverage >= 90 percent, `docs/openapi.json` is
current, README run steps work, and `docs/security-review-phaseN.md` has no open High or
Critical findings.
