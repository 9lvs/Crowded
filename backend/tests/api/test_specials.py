"""Specials: CRUD, scoping, validation, tonight/now logic. All data is FAKE."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, Bar
from app.services import specials as svc
from tests.api.conftest import Auth, make_staff

NY = ZoneInfo("America/New_York")
ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]


def body(**kw: Any) -> dict[str, Any]:
    d: dict[str, Any] = {
        "kind": "happy_hour",
        "title": "FAKE Happy Hour",
        "days": [0, 1, 2],
        "start_local": "17:00",
        "end_local": "20:00",
    }
    d.update(kw)
    return d


def local(y: int, m: int, d: int, hh: int, mm: int = 0) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=NY)


# 2026-11-06 is a Friday.


def test_evening_window() -> None:
    fri = local(2026, 11, 6, 18)
    assert svc.belongs_tonight([4], fri)
    assert svc.is_now([4], "17:00", "20:00", fri)
    assert not svc.is_now([4], "17:00", "20:00", local(2026, 11, 6, 20))
    assert not svc.is_now([4], "19:00", "20:00", local(2026, 11, 6, 18))


def test_past_midnight_window_at_1am() -> None:
    sat_1am = local(2026, 11, 7, 1)
    assert svc.night_start_weekday(sat_1am) == 4
    assert svc.belongs_tonight([4], sat_1am)
    assert not svc.belongs_tonight([5], sat_1am)
    assert svc.is_now([4], "22:00", "02:00", sat_1am)
    assert not svc.is_now([5], "22:00", "02:00", sat_1am)
    assert not svc.is_now([4], "22:00", "02:00", local(2026, 11, 7, 2))


def test_weekday_not_in_days() -> None:
    fri = local(2026, 11, 6, 18)
    assert not svc.belongs_tonight([0, 1, 2, 3], fri)
    assert not svc.is_now([0, 1, 2, 3], "17:00", "20:00", fri)


def test_friday_night_viewed_at_0030_saturday() -> None:
    t = local(2026, 11, 7, 0, 30)
    assert svc.belongs_tonight([4], t)
    assert svc.is_now([4], "21:00", "01:00", t)
    assert not svc.belongs_tonight([5], t)
    assert not svc.is_now([5], "21:00", "01:00", t)


def test_lunch_belongs_to_that_days_night_start_date() -> None:
    fri_lunch = local(2026, 11, 6, 11, 30)
    assert svc.is_now([4], "11:00", "14:00", fri_lunch)
    # At 11:30 Friday the current night started Thursday.
    assert svc.belongs_tonight([3], fri_lunch)
    assert svc.belongs_tonight([4], local(2026, 11, 6, 13))


def test_staff_crud(client: TestClient, admin: Auth, bar: Bar, db: Session) -> None:
    staff = make_staff(client, admin, str(bar.id))
    base = f"/v1/staff/bars/{bar.id}/specials"
    r = client.post(base, json=body(price_cents=500), headers=staff.h)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["posted_by"] == "staff"
    assert s["price_cents"] == 500
    assert s["days"] == [0, 1, 2]
    r = client.patch(
        f"{base}/{s['id']}", json={"title": "FAKE Late", "is_active": False}, headers=staff.h
    )
    assert r.status_code == 200
    assert r.json()["title"] == "FAKE Late"
    assert r.json()["is_active"] is False
    listed = client.get(base, headers=staff.h).json()
    assert [x["id"] for x in listed] == [s["id"]]
    assert client.delete(f"{base}/{s['id']}", headers=staff.h).status_code == 204
    assert client.get(base, headers=staff.h).json() == []
    actions = [a.action for a in db.scalars(select(AuditLog).order_by(AuditLog.ts))]
    for a in ("specials.create", "specials.update", "specials.delete"):
        assert a in actions


def test_admin_crud(client: TestClient, admin: Auth, bar: Bar, db: Session) -> None:
    base = f"/v1/admin/bars/{bar.id}/specials"
    r = client.post(base, json=body(kind="cover", price_cents=500), headers=admin.h)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["posted_by"] == "admin"
    r = client.patch(f"{base}/{s['id']}", json={"price_cents": 700}, headers=admin.h)
    assert r.json()["price_cents"] == 700
    assert len(client.get(base, headers=admin.h).json()) == 1
    assert client.delete(f"{base}/{s['id']}", headers=admin.h).status_code == 204
    assert client.get(f"/v1/admin/bars/{uuid.uuid4()}/specials", headers=admin.h).status_code == 404
    rows = db.scalars(select(AuditLog).where(AuditLog.action.like("specials.%"))).all()
    assert len(rows) == 3
    assert all(r.bar_id == bar.id and r.actor_role == "admin" for r in rows)


def test_students_cannot_write(client: TestClient, user: Auth, bar: Bar) -> None:
    base = f"/v1/staff/bars/{bar.id}/specials"
    assert client.post(base, json=body(), headers=user.h).status_code == 404
    assert client.get(base, headers=user.h).status_code == 404
    abase = f"/v1/admin/bars/{bar.id}/specials"
    assert client.post(abase, json=body(), headers=user.h).status_code == 403


def test_bola(client: TestClient, admin: Auth, bar: Bar, other_bar: Bar) -> None:
    staff_a = make_staff(client, admin, str(bar.id))
    staff_b = make_staff(client, admin, str(other_bar.id))
    sb = client.post(
        f"/v1/staff/bars/{other_bar.id}/specials", json=body(), headers=staff_b.h
    ).json()
    own = f"/v1/staff/bars/{other_bar.id}/specials"
    assert client.get(own, headers=staff_a.h).status_code == 404
    assert client.post(own, json=body(), headers=staff_a.h).status_code == 404
    via_a = f"/v1/staff/bars/{bar.id}/specials/{sb['id']}"
    assert client.patch(via_a, json={"title": "x"}, headers=staff_a.h).status_code == 404
    assert client.delete(via_a, headers=staff_a.h).status_code == 404
    r = client.patch(f"{own}/{sb['id']}", json={"title": "FAKE Ok"}, headers=staff_b.h)
    assert r.status_code == 200
    via_admin = f"/v1/admin/bars/{bar.id}/specials/{sb['id']}"
    assert client.delete(via_admin, headers=admin.h).status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        {"start_local": "25:00"},
        {"end_local": "7:00"},
        {"start_local": "18:00", "end_local": "18:00"},
        {"days": []},
        {"days": [1, 1]},
        {"days": [7]},
        {"title": "x" * 81},
        {"title": "   "},
        {"title": "bad\x07title"},
        {"details": "y" * 201},
        {"price_cents": -1},
        {"price_cents": 100001},
        {"kind": "bogus"},
        {"extra": 1},
    ],
)
def test_validation(client: TestClient, admin: Auth, bar: Bar, bad: dict[str, Any]) -> None:
    r = client.post(f"/v1/admin/bars/{bar.id}/specials", json=body(**bad), headers=admin.h)
    assert r.status_code == 422, (bad, r.text)


def test_update_validation(client: TestClient, admin: Auth, bar: Bar) -> None:
    base = f"/v1/admin/bars/{bar.id}/specials"
    s = client.post(base, json=body(), headers=admin.h).json()
    url = f"{base}/{s['id']}"
    assert client.patch(url, json={"start_local": "20:00"}, headers=admin.h).status_code == 422
    assert client.patch(url, json={"title": None}, headers=admin.h).status_code == 422
    assert client.patch(url, json={"days": []}, headers=admin.h).status_code == 422


def test_31st_special_rejected(client: TestClient, admin: Auth, bar: Bar) -> None:
    base = f"/v1/admin/bars/{bar.id}/specials"
    for i in range(30):
        assert client.post(base, json=body(title=f"FAKE {i}"), headers=admin.h).status_code == 201
    r = client.post(base, json=body(title="FAKE 31"), headers=admin.h)
    assert r.status_code == 409
    assert r.json()["detail"] == "too_many_specials"


def test_summary_and_detail(
    client: TestClient, admin: Auth, user: Auth, bar: Bar, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import UTC, datetime

    from app.services import live

    # Freeze the clock at 22:00 New York time on a Thursday so "now" is deterministic.
    monkeypatch.setattr(live, "utcnow", lambda: datetime(2026, 11, 13, 3, 0, tzinfo=UTC))
    base = f"/v1/admin/bars/{bar.id}/specials"
    # Every day, so always tonight. 12:00 to 11:59 covers 22:00.
    now_sp = client.post(
        base,
        json=body(title="FAKE Always", days=ALL_DAYS, start_local="12:00", end_local="11:59"),
        headers=admin.h,
    ).json()
    cover = client.post(
        base,
        json=body(
            kind="cover",
            title="FAKE Cover",
            days=ALL_DAYS,
            start_local="12:01",
            end_local="11:58",
            price_cents=500,
        ),
        headers=admin.h,
    ).json()
    later = client.post(
        base,
        json=body(
            kind="cover",
            title="FAKE Later Cover",
            days=ALL_DAYS,
            start_local="23:00",
            end_local="23:30",
        ),
        headers=admin.h,
    ).json()
    off = client.post(base, json=body(title="FAKE Off", days=ALL_DAYS), headers=admin.h).json()
    client.patch(f"{base}/{off['id']}", json={"is_active": False}, headers=admin.h)

    r = client.get("/v1/bars", headers=user.h).json()
    mine = next(b for b in r if b["id"] == str(bar.id))
    ids = [s["id"] for s in mine["specials_tonight"]]
    assert off["id"] not in ids
    assert set(ids) == {now_sp["id"], cover["id"], later["id"]}
    assert mine["cover_tonight"]["id"] == cover["id"]
    assert mine["cover_tonight"]["posted_by"] == "admin"
    assert mine["specials_tonight"][0]["is_now"] is True

    d = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()
    assert off["id"] not in [s["id"] for s in d["specials_week"]]
    assert len(d["specials_week"]) == 3
    assert "is_now" not in d["specials_week"][0]


def test_empty_summary(client: TestClient, user: Auth, bar: Bar) -> None:
    d = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()
    assert d["specials_tonight"] == []
    assert d["cover_tonight"] is None
    assert d["specials_week"] == []


def test_patch_null_price_clears_it(client: TestClient, admin: Auth, bar: Bar) -> None:
    base = f"/v1/admin/bars/{bar.id}/specials"
    sp = client.post(base, json=body(kind="cover", price_cents=500), headers=admin.h).json()
    r = client.patch(f"{base}/{sp['id']}", json={"price_cents": None}, headers=admin.h)
    assert r.status_code == 200
    assert r.json()["price_cents"] is None
