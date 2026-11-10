# Crowded

Know the line before you go. Crowded shows live line wait times and crowd levels at downtown
bars for college students (21+), and tells you whether a line-skip pass is worth it tonight.

Every number shows what it is based on. With no recent data, Crowded says so instead of
showing a stale number.

> Status: v1 pilot build. Backend and web client work end to end with fake data. iOS app is
> Phase 3. All seed and simulated data in this repo is FAKE.

## What is in here
| Path | What |
|---|---|
| `backend/` | FastAPI API (Python 3.12, SQLAlchemy 2, Alembic, PostgreSQL) |
| `backend/app/estimation/` | Wait and crowd estimation, pure functions ([how it works](docs/ESTIMATION.md)) |
| `web/` | Mobile web client served at `/` and the staff door counter at `/staff.html` |
| `docs/` | [Roadmap](docs/ROADMAP.md), [decisions](docs/DECISIONS.md), [security packet](docs/SECURITY.md), [threat model](docs/THREAT_MODEL.md), [OpenAPI](docs/openapi.json) |

## Run it locally
Needs Python 3.12, [uv](https://docs.astral.sh/uv/) and PostgreSQL 16.

1. Create a database (once):
```bash
createuser -s crowded && createdb -O crowded crowded && psql -c "ALTER USER crowded PASSWORD 'crowded'"
```
2. Install and migrate:
```bash
cd backend && uv sync && uv run alembic upgrade head
```
3. Seed fake bars and simulate a few nights of history plus tonight:
```bash
uv run python scripts/seed.py
```
```bash
uv run python scripts/simulate_night.py --reset --nights thu,fri,sat --weeks-ago 1
```
```bash
uv run python scripts/simulate_night.py --nights thu,fri,sat --weeks-ago 0 && uv run python scripts/simulate_night.py --live
```
4. Start the server:
```bash
uv run uvicorn app.main:app --reload
```
5. Open http://localhost:8000 on your phone or in a browser with mobile emulation. In dev mode
   the login code is shown on screen, no SMS is sent. The staff counter is at
   http://localhost:8000/staff.html (use an invite code printed by `seed.py`). API docs are at
   http://localhost:8000/docs.

To see the UI with no backend at all, open `web/index.html?mock=1` from any static server.

Make yourself an admin after signing in once:
```bash
uv run python scripts/make_admin.py +15551234567
```

## Tests and checks
```bash
cd backend && uv run pytest
```
```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts
```
Tests need Postgres at `CROWDED_TEST_DATABASE_URL` (default
`postgresql+psycopg://crowded:crowded@localhost:5432/crowded_test`). The estimation tests need no
database.

## Docker
```bash
docker build -f backend/Dockerfile -t crowded .
```
The image runs as a non-root user with `CROWDED_ENV=prod`, which refuses to start without strong
`CROWDED_JWT_SECRET` and `CROWDED_HASH_PEPPER` values and a real SMS provider.

## Hard rules
No Line Leap integration and no scraping. Pass prices are entered by an admin. No location trail
is ever stored. See [CLAUDE.md](CLAUDE.md) for the full list.
