from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, Bar, EstimateError, LineSession
from tests.api.conftest import Auth, login, make_staff


def test_tonight_no_recent_data(client: TestClient, user: Auth, bar: Bar) -> None:
    bars = client.get("/v1/bars", headers=user.h).json()
    assert len(bars) == 1
    live = bars[0]["live"]
    assert live["has_recent_data"] is False
    assert live["wait_min"] is None
    assert live["basis"]["text"] == "No recent data"
    assert bars[0]["verdict"]["recommendation"] == "no_data"


def test_staff_counts_drive_estimate_and_verdict(
    client: TestClient, admin: Auth, user: Auth, bar: Bar
) -> None:
    staff = make_staff(client, admin, str(bar.id))
    for _ in range(4):
        r = client.post(
            f"/v1/staff/bars/{bar.id}/door", json={"direction": "in", "count": 5}, headers=staff.h
        )
        assert r.status_code == 200
    r = client.post(f"/v1/staff/bars/{bar.id}/line", json={"line_size": "long"}, headers=staff.h)
    state = r.json()
    assert state["headcount"] == 20 and state["line_size"] == "long"
    client.put(f"/v1/admin/bars/{bar.id}/pass-price", json={"price_cents": 1500}, headers=admin.h)

    d = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()
    assert d["live"]["has_recent_data"] is True
    assert d["live"]["wait_min"] is not None and d["live"]["wait_min"] > 20
    assert "staff counts" in d["live"]["basis"]["text"]
    assert d["verdict"]["recommendation"] == "buy_pass"
    assert d["pass_price_cents"] == 1500
    assert len(d["wait_by_hour"]) == 10

    client.patch("/v1/me", json={"wait_threshold_min": 120}, headers=user.h)
    d = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()
    assert d["verdict"]["recommendation"] == "wait_it_out"

    snaps = client.get(f"/v1/bars/{bar.id}/snapshots", headers=user.h).json()
    assert len(snaps) >= 1


def test_headcount_cannot_go_negative(client: TestClient, admin: Auth, bar: Bar) -> None:
    staff = make_staff(client, admin, str(bar.id))
    r = client.post(f"/v1/staff/bars/{bar.id}/door", json={"direction": "out"}, headers=staff.h)
    assert r.status_code == 409


def test_line_session_flow_logs_error(
    client: TestClient, db: Session, admin: Auth, user: Auth, bar: Bar
) -> None:
    staff = make_staff(client, admin, str(bar.id))
    client.post(f"/v1/staff/bars/{bar.id}/line", json={"line_size": "medium"}, headers=staff.h)
    loc = {"latitude": bar.latitude, "longitude": bar.longitude}
    s = client.post(
        "/v1/line-sessions", json={"bar_id": str(bar.id), "location": loc}, headers=user.h
    ).json()
    assert s["status"] == "active" and s["predicted_wait_min"] is not None
    dup = client.post("/v1/line-sessions", json={"bar_id": str(bar.id)}, headers=user.h)
    assert dup.status_code == 409
    assert client.get("/v1/line-sessions/active", headers=user.h).json()["id"] == s["id"]

    row = db.get(LineSession, __import__("uuid").UUID(s["id"]))
    assert row is not None
    row.started_at = row.started_at - timedelta(minutes=12)
    db.commit()
    end = client.post(
        f"/v1/line-sessions/{s['id']}/end", json={"outcome": "inside"}, headers=user.h
    ).json()
    assert end["status"] == "completed" and 11 < end["actual_wait_min"] < 13
    assert end["points_awarded"] == 10
    err = db.scalars(select(EstimateError)).one()
    assert err.actual_min > 11 and err.formula_min is not None
    assert client.get("/v1/line-sessions/active", headers=user.h).json() is None
    acc = client.get("/v1/admin/metrics/accuracy", headers=admin.h).json()
    assert acc[0]["samples"] == 1


def test_gave_up_is_abandoned(client: TestClient, user: Auth, bar: Bar) -> None:
    s = client.post("/v1/line-sessions", json={"bar_id": str(bar.id)}, headers=user.h).json()
    end = client.post(
        f"/v1/line-sessions/{s['id']}/end", json={"outcome": "gave_up"}, headers=user.h
    ).json()
    assert end["status"] == "abandoned" and end["points_awarded"] == 0


def test_report_rate_limits(client: TestClient, user: Auth, bar: Bar) -> None:
    body = {"bar_id": str(bar.id), "crowd_level": "busy"}
    assert client.post("/v1/reports", json=body, headers=user.h).status_code == 201
    assert client.post("/v1/reports", json=body, headers=user.h).status_code == 201
    assert client.post("/v1/reports", json=body, headers=user.h).status_code == 429
    empty = client.post("/v1/reports", json={"bar_id": str(bar.id)}, headers=user.h)
    assert empty.status_code == 422


def test_staff_and_admin_actions_audited(
    client: TestClient, db: Session, admin: Auth, bar: Bar
) -> None:
    staff = make_staff(client, admin, str(bar.id))
    client.post(f"/v1/staff/bars/{bar.id}/door", json={"direction": "in"}, headers=staff.h)
    client.post(f"/v1/staff/bars/{bar.id}/line", json={"line_size": "short"}, headers=staff.h)
    client.put(f"/v1/admin/bars/{bar.id}/pass-price", json={"price_cents": None}, headers=admin.h)
    actions = {a.action for a in db.scalars(select(AuditLog))}
    assert {
        "invite.create",
        "staff.invite_redeemed",
        "door.in",
        "line.set",
        "pass_price.set",
    } <= actions
    log = client.get("/v1/admin/audit", headers=admin.h).json()
    assert len(log) >= 5


def test_invite_single_use(client: TestClient, admin: Auth, bar: Bar) -> None:
    code = client.post(f"/v1/admin/bars/{bar.id}/invites", headers=admin.h).json()["code"]
    a, b = login(client), login(client)
    assert (
        client.post("/v1/staff/invites/redeem", json={"code": code}, headers=a.h).status_code == 200
    )
    assert (
        client.post("/v1/staff/invites/redeem", json={"code": code}, headers=b.h).status_code == 400
    )


def test_admin_bar_crud(client: TestClient, admin: Auth) -> None:
    body = {
        "slug": "fake-new",
        "name": "FAKE New",
        "latitude": 1.0,
        "longitude": 2.0,
        "capacity": 80,
    }
    r = client.post("/v1/admin/bars", json=body, headers=admin.h)
    assert r.status_code == 201
    assert client.post("/v1/admin/bars", json=body, headers=admin.h).status_code == 409
    bid = r.json()["id"]
    r = client.patch(
        f"/v1/admin/bars/{bid}", json={"capacity": 90, "is_active": False}, headers=admin.h
    )
    assert r.json()["capacity"] == 90
    assert len(client.get("/v1/admin/bars", headers=admin.h).json()) == 1


def test_admin_can_remove_staff_and_revoke_invites(
    client: TestClient, db: Session, admin: Auth, bar: Bar
) -> None:
    staff = make_staff(client, admin, str(bar.id))
    members = client.get(f"/v1/admin/bars/{bar.id}/staff", headers=admin.h).json()
    assert len(members) == 1
    uid = members[0]["user_id"]
    r = client.delete(f"/v1/admin/bars/{bar.id}/staff/{uid}", headers=admin.h)
    assert r.status_code == 204
    assert client.get(f"/v1/staff/bars/{bar.id}", headers=staff.h).status_code == 404
    inv = client.post(f"/v1/admin/bars/{bar.id}/invites", headers=admin.h).json()
    assert client.post(f"/v1/admin/invites/{inv['id']}/revoke", headers=admin.h).status_code == 204
    other = login(client)
    r = client.post("/v1/staff/invites/redeem", json={"code": inv["code"]}, headers=other.h)
    assert r.status_code == 400


def test_bad_timezone_rejected(client: TestClient, admin: Auth) -> None:
    body = {
        "slug": "fake-tz",
        "name": "FAKE TZ",
        "latitude": 1.0,
        "longitude": 2.0,
        "capacity": 80,
        "timezone": "Mars/Olympus",
    }
    assert client.post("/v1/admin/bars", json=body, headers=admin.h).status_code == 422
