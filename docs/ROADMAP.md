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
- [ ] Phase 1 security review passes (docs/security-review-phase1.md)
- [ ] Owner sign off on retention (30 days proposed)

## Phase 2: hardening and deploy readiness
- [ ] Close Phase 1 review findings
- [ ] Redis rate limiter. Load and abuse tests
- [ ] App Attest spike
- [ ] SMS provider choice (owner approval) with fraud controls
- [ ] Deploy docs, staging checklist, scheduled retention job
- [ ] Staff counter polish for real door use

## Phase 3: iOS
- [ ] Confirm iOS 17 minimum and Xcode access with owner
- [ ] SwiftUI app, generated client, design system, gallery, tests
