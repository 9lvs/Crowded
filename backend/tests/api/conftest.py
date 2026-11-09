"""API test fixtures. Needs Postgres at CROWDED_TEST_DATABASE_URL. All data here is FAKE."""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest

TEST_DB = os.environ.get(
    "CROWDED_TEST_DATABASE_URL",
    "postgresql+psycopg://crowded:crowded@localhost:5432/crowded_test",
)
os.environ["CROWDED_DATABASE_URL"] = TEST_DB
os.environ["CROWDED_ENV"] = "test"

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from alembic import command  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.db import Base, get_engine, get_sessionmaker  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Bar, Role, User  # noqa: E402

get_settings.cache_clear()


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config("alembic.ini")
    cfg.attributes["url"] = TEST_DB
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def _clean() -> Iterator[None]:
    limiter.reset()
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with get_engine().begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} CASCADE"))


@pytest.fixture
def db() -> Iterator[Session]:
    s = get_sessionmaker()()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


@dataclass
class Auth:
    user_id: str
    access: str
    refresh: str
    phone: str

    @property
    def h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access}"}


_counter = {"n": 0}


def fake_phone() -> str:
    _counter["n"] += 1
    return f"+1555{_counter['n']:07d}"


def login(client: TestClient, phone: str | None = None, attest: bool = True) -> Auth:
    phone = phone or fake_phone()
    r = client.post("/v1/auth/request-code", json={"phone": phone})
    assert r.status_code == 200, r.text
    code = r.json()["dev_code"]
    r = client.post(
        "/v1/auth/verify-code",
        json={"phone": phone, "code": code, "age_attested": attest, "platform": "web"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return Auth(body["user"]["id"], body["access_token"], body["refresh_token"], phone)


def relogin(client: TestClient, auth: Auth) -> Auth:
    """Fresh tokens after a role change."""
    return login(client, auth.phone)


@pytest.fixture
def user(client: TestClient) -> Auth:
    return login(client)


@pytest.fixture
def admin(client: TestClient, db: Session) -> Auth:
    a = login(client)
    u = db.get(User, __import__("uuid").UUID(a.user_id))
    assert u is not None
    u.role = Role.admin
    db.commit()
    return a


def make_bar(db: Session, **kw: Any) -> Bar:
    defaults: dict[str, Any] = {
        "slug": f"fake-bar-{_counter['n']}-{len(kw)}",
        "name": "FAKE Test Bar",
        "latitude": 40.0,
        "longitude": -75.0,
        "capacity": 100,
    }
    defaults.update(kw)
    _counter["n"] += 1
    bar = Bar(**defaults)
    db.add(bar)
    db.commit()
    return bar


@pytest.fixture
def bar(db: Session) -> Bar:
    return make_bar(db, slug="fake-owl", name="FAKE Owl")


@pytest.fixture
def other_bar(db: Session) -> Bar:
    return make_bar(db, slug="fake-fox", name="FAKE Fox")


def make_staff(client: TestClient, admin: Auth, bar_id: str) -> Auth:
    r = client.post(f"/v1/admin/bars/{bar_id}/invites", headers=admin.h)
    assert r.status_code == 201, r.text
    s = login(client)
    r = client.post("/v1/staff/invites/redeem", json={"code": r.json()["code"]}, headers=s.h)
    assert r.status_code == 200, r.text
    return relogin(client, s)
