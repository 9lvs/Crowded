"""Staff levels, inside reports, drink wait, count-in-only bars, door code off. All FAKE."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    Bar,
    BarSnapshot,
    BarStaff,
    InsideStatus,
    LineSession,
    StaffInvite,
    StaffLevel,
)
from app.services import door as door_svc
from tests.api.conftest import Auth, login, make_bar, make_staff

SPECIAL = {
    "kind": "cover",
    "title": "FAKE Cover",
    "days": [4],
    "start_local": "21:00",
    "end_local": "23:00",
}


# ---------- levels and roles ----------


def test_invite_level_defaults_to_door_and_is_stored(
    client: TestClient, admin: Auth, bar: Bar, db: Session
) -> None:
    r = client.post(f"/v1/admin/bars/{bar.id}/invites", headers=admin.h)
    assert r.status_code == 201 and r.json()["level"] == "door"
    r = client.post(f"/v1/admin/bars/{bar.id}/invites", json={"level": "manager"}, headers=admin.h)
    assert r.json()["level"] == "manager"
    levels = sorted(x.level.value for x in db.scalars(select(StaffInvite)))
    assert levels == ["door", "manager"]
    bad = client.post(f"/v1/admin/bars/{bar.id}/invites", json={"level": "boss"}, headers=admin.h)
    assert bad.status_code == 422


def test_me_and_staff_list_show_level(
    client: TestClient, admin: Auth, bar: Bar, db: Session
) -> None:
    door = make_staff(client, admin, str(bar.id), "door")
    mgr = make_staff(client, admin, str(bar.id), "manager")
    assert client.get("/v1/me", headers=door.h).json()["staff_level"] == "door"
    assert client.get("/v1/me", headers=mgr.h).json()["staff_level"] == "manager"
    assert client.get("/v1/me", headers=login(client).h).json()["staff_level"] is None
    rows = client.get(f"/v1/admin/bars/{bar.id}/staff", headers=admin.h).json()
    assert sorted(x["level"] for x in rows) == ["door", "manager"]
    assert {b.level for b in db.scalars(select(BarStaff))} == {StaffLevel.door, StaffLevel.manager}


def test_specials_role_matrix(
    client: TestClient, admin: Auth, bar: Bar, other_bar: Bar, db: Session
) -> None:
    door = make_staff(client, admin, str(bar.id), "door")
    mgr = make_staff(client, admin, str(bar.id), "manager")
    base = f"/v1/staff/bars/{bar.id}/specials"
    for call in (
        client.get(base, headers=door.h),
        client.post(base, json=SPECIAL, headers=door.h),
        client.patch(f"{base}/{uuid.uuid4()}", json={"title": "FAKE"}, headers=door.h),
        client.delete(f"{base}/{uuid.uuid4()}", headers=door.h),
    ):
        assert call.status_code == 403
        assert call.json()["detail"] == "manager_only"
    made = client.post(base, json=SPECIAL, headers=mgr.h)
    assert made.status_code == 201
    sid = made.json()["id"]
    assert (
        client.patch(f"{base}/{sid}", json={"title": "FAKE Two"}, headers=mgr.h).status_code == 200
    )
    assert client.get(base, headers=door.h).status_code == 403
    assert client.post(base, json=SPECIAL, headers=admin.h).status_code == 201
    assert client.delete(f"{base}/{sid}", headers=mgr.h).status_code == 204
    # Other bars stay 404 for both levels.
    other = f"/v1/staff/bars/{other_bar.id}/specials"
    for who in (door, mgr):
        assert client.get(other, headers=who.h).status_code == 404
        assert client.post(other, json=SPECIAL, headers=who.h).status_code == 404


def test_managers_can_use_door_routes(client: TestClient, admin: Auth, bar: Bar) -> None:
    mgr = make_staff(client, admin, str(bar.id), "manager")
    base = f"/v1/staff/bars/{bar.id}"
    assert client.post(f"{base}/door", json={"direction": "in"}, headers=mgr.h).status_code == 200
    assert (
        client.post(f"{base}/line", json={"line_size": "short"}, headers=mgr.h).status_code == 200
    )
    assert (
        client.post(f"{base}/inside", json={"drink_wait": "under_5"}, headers=mgr.h).status_code
        == 200
    )


# ---------- counts_exits ----------


def test_manager_updates_counts_exits_and_it_is_audited(
    client: TestClient, admin: Auth, bar: Bar, db: Session
) -> None:
    mgr = make_staff(client, admin, str(bar.id), "manager")
    door = make_staff(client, admin, str(bar.id), "door")
    url = f"/v1/staff/bars/{bar.id}/settings"
    assert client.get(f"/v1/staff/bars/{bar.id}", headers=door.h).json()["counts_exits"] is True
    assert client.patch(url, json={"counts_exits": False}, headers=door.h).status_code == 403
    r = client.patch(url, json={"counts_exits": False}, headers=mgr.h)
    assert r.status_code == 200 and r.json()["counts_exits"] is False
    assert client.patch(url, json={"nope": 1}, headers=mgr.h).status_code == 422
    db.expire_all()
    row = db.scalar(select(AuditLog).where(AuditLog.action == "bar.settings"))
    assert row is not None and row.details == {"counts_exits": False}


def test_admin_bar_update_counts_exits(
    client: TestClient, admin: Auth, bar: Bar, db: Session
) -> None:
    r = client.patch(f"/v1/admin/bars/{bar.id}", json={"counts_exits": False}, headers=admin.h)
    assert r.status_code == 200 and r.json()["counts_exits"] is False
    db.expire_all()
    row = db.scalar(select(AuditLog).where(AuditLog.action == "bar.update"))
    assert row is not None and row.details == {"counts_exits": False}


def test_count_in_only_bar_has_no_headcount_but_a_rate_and_inside_crowd(
    client: TestClient, admin: Auth, user: Auth, db: Session
) -> None:
    bar = make_bar(db, slug="fake-in-only", name="FAKE In Only", counts_exits=False)
    staff = make_staff(client, admin, str(bar.id))
    base = f"/v1/staff/bars/{bar.id}"
    for _ in range(4):
        client.post(f"{base}/door", json={"direction": "in", "count": 10}, headers=staff.h)
    client.post(f"{base}/line", json={"line_size": "medium"}, headers=staff.h)
    r = client.post(f"{base}/inside", json={"crowd_level": "packed"}, headers=staff.h)
    live = r.json()["live"]
    assert live["headcount"] is None
    assert live["capacity_ratio"] is None
    assert live["crowd_level"] == "packed"
    assert live["wait_min"] is not None  # entry rate from IN events still drives the wait
    assert "staff counts" in live["basis"]["text"]
    seen = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()["live"]
    assert seen["headcount"] is None and seen["crowd_level"] == "packed"


# ---------- inside route ----------


def test_inside_route_validates_and_returns_state(
    client: TestClient, admin: Auth, bar: Bar, db: Session
) -> None:
    staff = make_staff(client, admin, str(bar.id))
    url = f"/v1/staff/bars/{bar.id}/inside"
    assert client.post(url, json={}, headers=staff.h).status_code == 422
    assert client.post(url, json={"drink_wait": "forever"}, headers=staff.h).status_code == 422
    assert (
        client.post(url, json={"crowd_level": "busy", "x": 1}, headers=staff.h).status_code == 422
    )
    r = client.post(url, json={"crowd_level": "busy", "drink_wait": "10_to_20"}, headers=staff.h)
    assert r.status_code == 200
    body = r.json()
    assert body["inside"]["crowd_level"] == "busy"
    assert body["inside"]["drink_wait"] == "10_to_20"
    assert body["live"]["drink_wait"] == "10_to_20"
    assert body["live"]["drink_wait_label"] == "10 to 20 min"
    assert body["live"]["basis"]["inside_updates"] == 1
    db.expire_all()
    assert db.scalar(select(InsideStatus)) is not None
    audit_row = db.scalar(select(AuditLog).where(AuditLog.action == "inside.set"))
    assert audit_row is not None and audit_row.bar_id == bar.id
    assert audit_row.details == {"crowd_level": "busy", "drink_wait": "10_to_20"}


def test_state_has_no_inside_before_any_report(client: TestClient, admin: Auth, bar: Bar) -> None:
    staff = make_staff(client, admin, str(bar.id))
    body = client.get(f"/v1/staff/bars/{bar.id}", headers=staff.h).json()
    assert body["inside"] is None
    assert body["live"]["drink_wait"] is None and body["live"]["drink_wait_label"] is None


# ---------- drink wait fusion, labels, students ----------


@pytest.mark.parametrize(
    ("bucket", "label"),
    [
        ("under_5", "Under 5 min"),
        ("5_to_10", "5 to 10 min"),
        ("10_to_20", "10 to 20 min"),
        ("over_20", "Over 20 min"),
    ],
)
def test_drink_wait_labels(
    client: TestClient, admin: Auth, bar: Bar, bucket: str, label: str
) -> None:
    staff = make_staff(client, admin, str(bar.id))
    r = client.post(f"/v1/staff/bars/{bar.id}/inside", json={"drink_wait": bucket}, headers=staff.h)
    assert r.json()["live"]["drink_wait_label"] == label


def test_student_drink_wait_reports_and_fusion(
    client: TestClient, admin: Auth, user: Auth, bar: Bar, db: Session
) -> None:
    only_drink = client.post(
        "/v1/reports", json={"bar_id": str(bar.id), "drink_wait": "over_20"}, headers=user.h
    )
    assert only_drink.status_code in (200, 201)
    empty = client.post("/v1/reports", json={"bar_id": str(bar.id)}, headers=user.h)
    assert empty.status_code == 422
    live = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()["live"]
    assert live["drink_wait"] == "over_20"
    assert live["has_recent_data"] is True
    # A fresh staff reading outweighs one student.
    staff = make_staff(client, admin, str(bar.id))
    client.post(f"/v1/staff/bars/{bar.id}/inside", json={"drink_wait": "under_5"}, headers=staff.h)
    live = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()["live"]
    assert live["drink_wait"] == "under_5"
    assert live["drink_wait_label"] == "Under 5 min"
    snap = db.scalars(select(BarSnapshot).where(BarSnapshot.bar_id == bar.id)).all()
    assert snap and all("drink_wait" in s.basis for s in snap)


def test_no_recent_drink_wait_is_null(client: TestClient, user: Auth, bar: Bar) -> None:
    live = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()["live"]
    assert live["drink_wait"] is None and live["drink_wait_label"] is None
    assert live["has_recent_data"] is False


# ---------- door code off by default ----------


def test_door_code_disabled_by_default(
    client: TestClient, admin: Auth, user: Auth, bar: Bar, db: Session
) -> None:
    staff = make_staff(client, admin, str(bar.id))
    r = client.get(f"/v1/staff/bars/{bar.id}/door-code", headers=staff.h)
    assert (r.status_code, r.json()["detail"]) == (404, "door_code_disabled")
    # A student's door code is never verified, whatever they send, and the request still works.
    started = client.post(
        "/v1/line-sessions",
        json={"bar_id": str(bar.id), "location": {"latitude": 0.5, "longitude": 0.5}},
        headers=user.h,
    ).json()
    assert started["near_bar"] is True
    row = db.get(LineSession, uuid.UUID(started["id"]))
    assert row is not None
    row.started_at = row.started_at - timedelta(minutes=5)
    db.commit()
    real_code = door_svc.current_code(bar.id)[0]
    ended = client.post(
        f"/v1/line-sessions/{started['id']}/end",
        json={"outcome": "inside", "door_code": real_code},
        headers=user.h,
    )
    assert ended.status_code == 200, ended.text
    assert ended.json()["verified"] is False
