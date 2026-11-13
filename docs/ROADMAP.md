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
- [x] Bar specials, happy hours, cover and events: backend, web, staff editing, iOS (green CI)
- [x] Team briefing deck, business model options (docs/BUSINESS.md)
- [x] Door mode for staff (tap zones, clicker keys, undo, offline queue, count sync), staff line
      checks, rotating door code that verifies student timers (web and iOS, green CI)
- [x] Deals: deal line on Tonight (A), price list menu on the bar page (C), structured items,
      all night specials, staff menu editor (web and iOS)
- [x] Phase 1.5 security review: H-1 race and all Mediums fixed (docs/security-review-phase1_5.md)
- [x] Staff side rework (owner feedback): door staff count IN, line and inside conditions only,
      manager role edits specials, drink wait estimate, count-entries-only bars, door code off

## Owner notes (2026-11-12)
- [ ] Improve the one page roadmap for the team (owner wants a clearer, shareable version)
- [x] Theme stays black and white for now (owner decision, D-033)
- [ ] App motion pass: tactile buttons, consistent transitions, iOS style edge swipe back
- [ ] Social media playbook and campus creator program
- [ ] Logo explorations, then pick one

## Launch plan (2026-11-11)

### Before TestFlight (team only)
- [ ] Owner: Apple Developer Program, bundle id, signing team
- [ ] Owner approves a host (Render or Fly, about $10 to $25 a month) and an SMS provider
      (for example Twilio Verify, a few cents per code). Without these nobody outside can sign in
- [ ] Deploy staging: Postgres, secrets, migrations, daily retention job, smoke test (docs/DEPLOY.md)
- [ ] Privacy and Support pages live on GitHub Pages (site/), URLs into App Store Connect
- [ ] App icon, launch screen, App Store screenshots from demo data
- [ ] TestFlight upload from CI (GitHub Actions or Xcode Cloud), internal testers
- [x] Admin console to set up bars and invites without code (web/admin.html)

### Before pitching bars
- [x] Bar pitch deck and updated one pager
- [ ] A sample weekly bar summary (entries by hour, busiest hour, average wait, drink wait)
- [ ] Pilot letter from counsel. Founding partner offer decided
- [ ] Dry run night with a friend at the door, using the staging server

### Before external TestFlight and the pilot
- [ ] Phase 2 security review of the deployed setup (hosting, secrets, SMS fraud limits)
- [ ] Real bar entered through the admin console with its permission
- [ ] Ambassadors lined up for pilot nights. Instagram handle and "Coming soon" grid

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
- [x] First green macOS CI build (2026-11-09, run 2)
- [ ] Live Activity for the line timer (lock screen "I'm inside")
- [ ] Signing, Xcode Cloud, TestFlight internal, then external public link
