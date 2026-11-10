"""Deny by default and BOLA checks for every route."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Bar
from tests.api.conftest import Auth, login, make_staff

PUBLIC = {
    "/healthz",
    "/v1/auth/request-code",
    "/v1/auth/verify-code",
    "/v1/auth/apple",
    "/v1/auth/refresh",
    "/v1/auth/logout",
    "/openapi.json",
    "/docs",
    "/docs/oauth2-redirect",
    "/redoc",
}


def _routes() -> list[tuple[str, str]]:
    """Every operation in the OpenAPI contract (robust to router internals, finding M-4)."""
    out = []
    for path, ops in create_app().openapi()["paths"].items():
        for method in ops:
            if path in PUBLIC or not path.startswith("/v1"):
                continue
            out.append((method.upper(), path))
    return out


def test_route_enumeration_is_not_empty() -> None:
    assert len(_routes()) >= 20


@pytest.mark.parametrize(("method", "path"), _routes())
def test_every_route_requires_auth(client: TestClient, method: str, path: str) -> None:
    url = path
    for param in ("{bar_id}", "{session_id}", "{user_id}", "{invite_id}", "{special_id}"):
        url = url.replace(param, str(uuid.uuid4()))
    assert "{" not in url, f"add a placeholder for {path}"
    r = client.request(method, url, json={})
    assert r.status_code == 401, (method, path, r.status_code)


ADMIN_CALLS = [
    ("GET", "/v1/admin/bars", None),
    (
        "POST",
        "/v1/admin/bars",
        {"slug": "fake-x", "name": "FAKE X", "latitude": 0, "longitude": 0, "capacity": 10},
    ),
    ("PATCH", "/v1/admin/bars/{bar}", {"capacity": 5}),
    ("PUT", "/v1/admin/bars/{bar}/pass-price", {"price_cents": 100}),
    ("POST", "/v1/admin/bars/{bar}/invites", None),
    ("GET", "/v1/admin/metrics/accuracy", None),
    ("GET", "/v1/admin/audit", None),
    ("GET", "/v1/admin/bars/{bar}/specials", None),
    (
        "POST",
        "/v1/admin/bars/{bar}/specials",
        {
            "kind": "cover",
            "title": "FAKE",
            "days": [1],
            "start_local": "21:00",
            "end_local": "23:00",
        },
    ),
    ("PATCH", "/v1/admin/bars/{bar}/specials/{special}", {"title": "FAKE"}),
    ("DELETE", "/v1/admin/bars/{bar}/specials/{special}", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_CALLS)
def test_admin_routes_forbid_user_and_staff(
    client: TestClient, admin: Auth, bar: Bar, method: str, path: str, body: object
) -> None:
    staff = make_staff(client, admin, str(bar.id))
    for who in (login(client), staff):
        url = path.replace("{bar}", str(bar.id)).replace("{special}", str(uuid.uuid4()))
        r = client.request(method, url, json=body, headers=who.h)
        assert r.status_code == 403, (who, path)


STAFF_CALLS = [
    ("GET", "/v1/staff/bars/{bar}", None),
    ("POST", "/v1/staff/bars/{bar}/door", {"direction": "in"}),
    ("POST", "/v1/staff/bars/{bar}/line", {"line_size": "short"}),
    ("GET", "/v1/staff/bars/{bar}/specials", None),
]


@pytest.mark.parametrize(("method", "path", "body"), STAFF_CALLS)
def test_staff_scoped_to_their_bar(
    client: TestClient,
    admin: Auth,
    user: Auth,
    bar: Bar,
    other_bar: Bar,
    method: str,
    path: str,
    body: object,
) -> None:
    staff = make_staff(client, admin, str(bar.id))
    own = client.request(method, path.replace("{bar}", str(bar.id)), json=body, headers=staff.h)
    assert own.status_code == 200
    other = client.request(
        method, path.replace("{bar}", str(other_bar.id)), json=body, headers=staff.h
    )
    assert other.status_code == 404
    plain = client.request(method, path.replace("{bar}", str(bar.id)), json=body, headers=user.h)
    assert plain.status_code == 404
    as_admin = client.request(
        method, path.replace("{bar}", str(bar.id)), json=body, headers=admin.h
    )
    assert as_admin.status_code == 200


def test_cannot_end_someone_elses_session(client: TestClient, bar: Bar) -> None:
    a, b = login(client), login(client)
    s = client.post("/v1/line-sessions", json={"bar_id": str(bar.id)}, headers=a.h).json()
    r = client.post(f"/v1/line-sessions/{s['id']}/end", json={"outcome": "inside"}, headers=b.h)
    assert r.status_code == 404
    assert client.get("/v1/line-sessions/active", headers=b.h).json() is None


def test_inactive_and_missing_bars_hidden(
    client: TestClient, admin: Auth, user: Auth, bar: Bar
) -> None:
    client.patch(f"/v1/admin/bars/{bar.id}", json={"is_active": False}, headers=admin.h)
    assert client.get(f"/v1/bars/{bar.id}", headers=user.h).status_code == 404
    assert client.get(f"/v1/bars/{uuid.uuid4()}", headers=user.h).status_code == 404
    r = client.post(
        "/v1/reports", json={"bar_id": str(bar.id), "crowd_level": "easy"}, headers=user.h
    )
    assert r.status_code == 404


def test_one_bar_per_staff(client: TestClient, admin: Auth, bar: Bar, other_bar: Bar) -> None:
    staff = make_staff(client, admin, str(bar.id))
    code = client.post(f"/v1/admin/bars/{other_bar.id}/invites", headers=admin.h).json()["code"]
    r = client.post("/v1/staff/invites/redeem", json={"code": code}, headers=staff.h)
    assert r.status_code == 409
