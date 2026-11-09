# Roadmap

## Phase 0: foundation
- [x] Layout: backend, web, docs, .github (ios later)
- [x] CLAUDE.md, ROADMAP, DECISIONS, SECURITY, THREAT_MODEL
- [x] .gitignore, .env.example, pre-commit (ruff, gitleaks), CI (lint, mypy, pytest + Postgres,
      pip-audit, bandit, gitleaks), CodeQL, Dependabot
- [x] Subagent definitions in .claude/agents
- [ ] Owner: make repo private, enable branch protection on main, enable secret scanning

## Phase 1: backend core (v1)
- [x] Data model and Alembic migration
- [x] Auth: phone code (stub SMS), Sign in with Apple, refresh rotation, logout
- [x] Me: read, threshold, delete account (hard delete)
- [x] Bars: list, detail (normal wait, wait by hour, pass price), snapshots
- [x] Line sessions start and end, reports with distance buckets
- [x] Staff counter API scoped to one bar, invites
- [x] Admin: bars, pass price, invites, accuracy metrics, audit log
- [x] Estimation module, 100 percent coverage
- [x] Retention script, OpenAPI export
- [x] Night simulator and seed data (FAKE)
- [x] Web client v1 (student screens, staff counter, mock mode)
- [x] Phase 1 security review passes (docs/security-review-phase1.md), Mediums fixed
- [ ] Owner sign off on retention (30 days proposed)

## Phase 1.5: owner feedback round (2026-11-09)
- [x] Full CI/CD: lint, tests with coverage gates, migrations round trip, contract, security,
      e2e browser tests, container boot, smoke test, image publish (docs/TESTING.md)
- [x] App Review demo login, App Store checklist and listing copy (docs/APP_STORE.md)
- [x] Ideas backlog: bar chat, map heatmap, location usage (docs/IDEAS.md)
- [x] Web v2: monochrome, crowd first, separate staff experience, e2e suite (17 tests)
- [x] Launch site with privacy, terms and support drafts (site/)
- [x] Owner decisions: Mac (native SwiftUI, cloud CI), retention 30 days, iOS 17
- [ ] Owner: Apple Developer enrollment (this week), host, SMS provider
- [x] Sourcing v2: staff and student fusion by learned reliability, timers referee, disagreement
      flag, minimum evidence guard, simulator bias scenarios (docs/SOURCING.md)
- [x] Instagram launch kit and bar one pager (marketing/), pilot playbook (docs/PILOT.md)

## Phase 2: hardening and deploy readiness
- [ ] Close Phase 1 review findings
- [ ] Redis rate limiter. Load and abuse tests
- [ ] App Attest spike
- [ ] SMS provider choice (owner approval) with fraud controls
- [ ] Deploy docs, staging checklist, scheduled retention job
- [ ] Staff counter polish for real door use

## Phase 3: iOS
- [x] Confirm iOS 17 minimum and Xcode access with owner
- [x] SwiftUI app v1 written: generated client, design system, gallery, tests, macOS CI
- [ ] First green macOS CI build (fix compile errors from the first run)
- [ ] Live Activity for the line timer (lock screen "I'm inside")
- [ ] Signing, Xcode Cloud, TestFlight internal, then external public link
