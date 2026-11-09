# Testing and CI/CD

## Layers
| Layer | What | Where | Runs in |
|---|---|---|---|
| Unit | Estimation math as pure functions. 100 percent coverage, 90 percent gate | `backend/tests/estimation` | CI `test`, `make test` |
| API | Every endpoint against real Postgres: auth, privacy, flows, rate limits, retention, config safety | `backend/tests/api` | CI `test` |
| Authorization | Deny by default on every route in the OpenAPI contract, admin only routes, staff scoped to one bar (BOLA), session ownership | `backend/tests/api/test_authorization.py` | CI `test` |
| Simulator | Seeds fake bars and simulates a night. Checks snapshots, hour charts, accuracy (MAE), that liars lose reliability, and that no coordinates are stored | `backend/tests/sim` | CI `test` |
| Migrations | Upgrade, `alembic check` (models match), downgrade to base, upgrade again | CI step | CI `test` |
| Contract | `docs/openapi.json` must match the code | `scripts/export_openapi.py --check` | CI `test` |
| End to end | Real browser (iPhone 14 profile) against the real backend with seeded fake data: student flow, staff flow, role separation, mock mode, accessibility smoke | `e2e/` (Playwright) | CI `e2e`, `make e2e` |
| Smoke ("exit test") | Read only checks against any running server: health, headers, auth required, web served, no input echo, no path traversal | `backend/scripts/smoke_test.py` | CI `e2e` and `docker`, and after every deploy |
| Container | Image builds, refuses a prod boot with dev secrets, runs as uid 10001, boots and passes smoke | CI `docker` | CI |
| Security | bandit, pip-audit, gitleaks, CodeQL (Python and JS), Dependabot | CI `security`, `codeql.yml` | CI, weekly |

## Pipeline
- **Every PR and push to main** (`.github/workflows/ci.yml`): lint, test, security, e2e, docker.
  All must be green to merge once branch protection requires them.
- **Main and version tags** (`cd.yml`): builds and pushes `ghcr.io/<owner>/crowded` tagged with
  the commit sha. Deploy and the post deploy smoke test are stubbed until a host is chosen.
- All third party actions are pinned to commit SHAs. Dependabot proposes updates weekly.

## Release exit criteria (per phase or release tag)
1. CI green on the release commit, including e2e and docker.
2. Coverage gates met (overall 90, estimation 90).
3. Simulator MAE under 8 min on a full Thursday to Saturday run.
4. The phase security review has no open High or Critical findings.
5. Smoke test passes against staging with `--expect-hsts`.
6. Manual check on a real phone: sign in, report, timer, staff counter.

## Run locally
```bash
make all
```
```bash
make serve
```
```bash
make e2e
```
