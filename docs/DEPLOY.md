# Deploy (draft, no host chosen yet)

No hosting account exists. Picking one is an owner decision because it costs money.

## Options for the pilot (one small container plus Postgres)
| Host | Rough monthly cost | Notes |
|---|---|---|
| Fly.io | $5 to 15 | Container plus managed Postgres. Simple TLS |
| Render | $7 to 25 | Container web service plus managed Postgres. Easy GitHub deploys |
| Railway | $5 to 20 | Fast setup. Usage based billing |
| AWS (App Runner + RDS) | $25+ | Most control, most setup |

Recommendation: Render or Fly.io. Both run the image that CD already builds
(`ghcr.io/<owner>/crowded`).

## Required environment
| Variable | Value |
|---|---|
| `CROWDED_ENV` | `staging` or `prod` |
| `CROWDED_DATABASE_URL` | managed Postgres URL (TLS) |
| `CROWDED_JWT_SECRET` | 48+ random bytes, from the host's secret store |
| `CROWDED_HASH_PEPPER` | 48+ random bytes. Never rotate casually, because phone lookups depend on it |
| `CROWDED_APPLE_CLIENT_ID` | iOS bundle ID |
| `CROWDED_REVIEW_PHONE`, `CROWDED_REVIEW_CODE` | only while an App Review is open |
| `FORWARDED_ALLOW_IPS` | the host's proxy address range, so uvicorn trusts only it for client IPs |

Prod refuses to boot with dev secrets or the stub SMS provider. A real SMS provider is required
first (owner approval, for example Twilio Verify).

## Steps
1. Create Postgres and set the env vars as secrets.
2. Run migrations as a release command: `alembic upgrade head`.
3. Deploy the sha tagged image. One instance (the rate limiter is in memory, see D-008).
4. Schedule a daily retention job: `python scripts/retention.py`.
5. Run the smoke test: `python scripts/smoke_test.py https://<host> --expect-hsts`.
6. Point the domain at the host and enable HTTPS (HSTS is already sent).

## Staging checklist
- [ ] Separate database and secrets from prod
- [ ] Smoke test green
- [ ] e2e suite green against staging (`BASE_URL=https://staging... make e2e`) with a review phone set
- [ ] Retention job ran once
- [ ] Backups enabled on Postgres
- [ ] Error logs reviewed: no phones, tokens or coordinates
