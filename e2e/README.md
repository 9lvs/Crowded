# Crowded end to end tests

Playwright tests for the web client and API, run at iPhone 14 size in Chromium. All data is
FAKE (seeded bars, +1555 phone numbers).

| File | Needs | Covers |
|---|---|---|
| `tests/student.spec.ts` | real backend | 21+ gate (UI and API), Tonight with basis lines, bar detail, crowd report, line timer, settings, sign out, account deletion |
| `tests/staff.spec.ts` | real backend | staff sign in, invite, door counter, line size, staff banner in the student app, user versus staff API separation |
| `tests/mock.spec.ts` | any server on localhost | mock mode student and staff flows with zero console errors, mock storage isolation |
| `tests/a11y.spec.ts` | any server on localhost | accessible names, labels, alt text, 44px targets, crowd level not color only |

## Run locally
1. Start a seeded backend in dev mode (from `backend/`, with a scratch database):
```bash
export CROWDED_ENV=dev CROWDED_DATABASE_URL=postgresql+psycopg://crowded:crowded@localhost:5432/crowded_e2e
```
```bash
uv run alembic upgrade head && uv run python scripts/seed.py && uv run python scripts/simulate_night.py --live
```
```bash
uv run uvicorn app.main:app --port 8000
```
2. Run the tests (from `e2e/`):
```bash
npm ci
```
```bash
npx playwright install chromium
```
```bash
BASE_URL=http://localhost:8000 npx playwright test --trace off
```
Skip `playwright install` if your machine already has a matching Chromium (the cloud sandbox does).

Mock and accessibility tests only need the static files: `npm run test:mock` against any local
server works, for example `python3 -m http.server 8000 --directory web`.

## Notes
- The backend must run with `CROWDED_ENV=dev` so `request-code` returns `dev_code`.
- One full run signs in about 8 times. The API allows 20 code requests per IP per hour and 3 per
  phone per 10 minutes (the seed admin signs in once per run). Restart the backend to reset the
  in-memory limits if you run the suite many times in a row.
- Tests run serially on one worker because they share one seeded database.
- `playwright-report/` holds the HTML report after a run (`npm run report`).
