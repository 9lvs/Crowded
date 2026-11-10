# One command entry points. Run from the repo root.
.PHONY: help setup check test e2e smoke all serve

BASE_URL ?= http://localhost:8000

help:
	@echo "make setup    install backend deps and migrate the dev DB"
	@echo "make check    lint, format check, types, security scan, web syntax"
	@echo "make test     full backend suite with coverage gates and contract check"
	@echo "make e2e      browser tests against a running server (BASE_URL)"
	@echo "make smoke    post deploy smoke test (BASE_URL)"
	@echo "make all      check + test (what CI runs, minus e2e and docker)"
	@echo "make serve    run the dev server with seeded fake data"

setup:
	cd backend && uv sync && uv run alembic upgrade head

check:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts
	cd backend && uv run bandit -q -r app scripts -c pyproject.toml
	for f in web/js/*.js; do node --check "$$f"; done

test:
	cd backend && uv run pytest --cov=app --cov-fail-under=90
	cd backend && uv run pytest tests/estimation --cov=app.estimation --cov-fail-under=90 -q
	cd backend && uv run python scripts/export_openapi.py --check

e2e:
	cd e2e && npm ci && BASE_URL=$(BASE_URL) npx playwright test --trace off

smoke:
	cd backend && uv run python scripts/smoke_test.py $(BASE_URL)

all: check test

serve:
	cd backend && uv run python scripts/seed.py && uv run python scripts/simulate_night.py --live && uv run uvicorn app.main:app --reload
