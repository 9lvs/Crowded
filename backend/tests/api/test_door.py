"""Staff line samples, the rotating door code and clicker count sync. All data is FAKE."""

from __future__ import annotations

import uuid
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    Bar,
    DoorDirection,
    DoorEvent,
    EstimateError,
    LineSample,
    LineSession,
    RewardLedger,
    SessionStatus,
    User,
)
from app.services import door as door_svc
from tests.api.conftest import Auth, login, make_staff

pytestmark = pytest.mark.usefixtures("door_code_on")


def _prime(client: TestClient, staff: Auth, bar: Bar) -> None:
    """Give the bar a rate and a line so a started sample records a prediction."""
    for _ in range(6):
        client.post(
            f"/v1/staff/bars/{bar.id}/door", json={"direction": "in", "count": 5}, headers=staff.h
        )
    client.post(f"/v1/staff/bars/{bar.id}/line", json={"line_size": "medium"}, headers=staff.h)


def _start_sample(client: TestClient, staff: Auth, bar: Bar) -> dict[str, object]:
    r = client.post(f"/v1/staff/bars/{bar.id}/line-samples", headers=staff.h)
    assert r.status_code == 201, r.text
    body: dict[str, object] = r.json()
    return body


def _age_sample(db: Session, sample_id: str, minutes: float) -> None:
    row = db.get(LineSample, uuid.UUID(sample_id))
    assert row is not None
    row.started_at = row.started_at - timedelta(minutes=minutes)
    db.commit()


@pytest.fixture
def staff(client: TestClient, admin: Auth, bar: Bar) -> Auth:
    return make_staff(client, admin, str(bar.id))


# ---------- line samples ----------


def test_sample_lifecycle_completes_and_logs_error(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    _prime(client, staff, bar)
    s = _start_sample(client, staff, bar)
    assert s["status"] == "active" and s["predicted_wait_min"] is not None
    active = client.get(f"/v1/staff/bars/{bar.id}/line-samples/active", headers=staff.h).json()
    assert [a["id"] for a in active] == [s["id"]]

    _age_sample(db, str(s["id"]), 8)
    r = client.post(
        f"/v1/staff/bars/{bar.id}/line-samples/{s['id']}/end",
        json={"outcome": "inside"},
        headers=staff.h,
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "completed" and 7.5 < out["actual_wait_min"] < 8.5
    err = db.scalars(select(EstimateError)).one()
    assert 7.5 < err.actual_min < 8.5 and err.formula_min is not None
    # Accuracy metrics only, never calibration (security review M-1).
    assert err.source == "sample" and err.eligible is False
    assert client.get(f"/v1/staff/bars/{bar.id}/line-samples/active", headers=staff.h).json() == []
    again = client.post(
        f"/v1/staff/bars/{bar.id}/line-samples/{s['id']}/end",
        json={"outcome": "inside"},
        headers=staff.h,
    )
    assert again.status_code == 409
    actions = {a.action for a in db.scalars(select(AuditLog))}
    assert {"line_sample.start", "line_sample.end"} <= actions


def test_at_most_two_active_samples(client: TestClient, staff: Auth, bar: Bar) -> None:
    _start_sample(client, staff, bar)
    _start_sample(client, staff, bar)
    r = client.post(f"/v1/staff/bars/{bar.id}/line-samples", headers=staff.h)
    assert r.status_code == 409 and r.json()["detail"] == "too_many_active_samples"


def test_short_and_cancelled_samples_are_abandoned(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    _prime(client, staff, bar)
    quick = _start_sample(client, staff, bar)
    r = client.post(
        f"/v1/staff/bars/{bar.id}/line-samples/{quick['id']}/end",
        json={"outcome": "inside"},
        headers=staff.h,
    )
    assert r.json()["status"] == "abandoned"
    cancelled = _start_sample(client, staff, bar)
    _age_sample(db, str(cancelled["id"]), 6)
    r = client.post(
        f"/v1/staff/bars/{bar.id}/line-samples/{cancelled['id']}/end",
        json={"outcome": "cancel"},
        headers=staff.h,
    )
    assert r.json()["status"] == "abandoned"
    assert db.scalars(select(EstimateError)).all() == []


def test_samples_older_than_three_hours_count_as_abandoned(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    s = _start_sample(client, staff, bar)
    _age_sample(db, str(s["id"]), 200)
    assert client.get(f"/v1/staff/bars/{bar.id}/line-samples/active", headers=staff.h).json() == []
    db.expire_all()
    row = db.get(LineSample, uuid.UUID(str(s["id"])))
    assert row is not None and row.status == SessionStatus.abandoned
    r = client.post(
        f"/v1/staff/bars/{bar.id}/line-samples/{s['id']}/end",
        json={"outcome": "inside"},
        headers=staff.h,
    )
    assert r.status_code == 409
    # And a stale sample no longer holds one of the two slots.
    _start_sample(client, staff, bar)
    _start_sample(client, staff, bar)


def test_completed_sample_feeds_the_estimate(
    client: TestClient, db: Session, user: Auth, staff: Auth, bar: Bar
) -> None:
    _prime(client, staff, bar)
    s = _start_sample(client, staff, bar)
    _age_sample(db, str(s["id"]), 25)
    client.post(
        f"/v1/staff/bars/{bar.id}/line-samples/{s['id']}/end",
        json={"outcome": "inside"},
        headers=staff.h,
    )
    live = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()["live"]
    assert live["basis"]["timers"] == 1
    assert "timer" in live["basis"]["text"]
    assert live["wait_min"] is not None and live["wait_min"] > 6  # pulled toward 25


def test_active_sample_counts_as_a_timer(
    client: TestClient, user: Auth, staff: Auth, bar: Bar
) -> None:
    _start_sample(client, staff, bar)
    live = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()["live"]
    assert live["basis"]["timers"] == 1


def _sample_after_claim(
    client: TestClient, db: Session, claimer: Auth, timer: Auth, bar: Bar
) -> tuple[float, float]:
    """`claimer` says "very long", `timer` runs a short sample. Reliability before and after."""
    for _ in range(6):
        client.post(
            f"/v1/staff/bars/{bar.id}/door", json={"direction": "in", "count": 5}, headers=claimer.h
        )
    client.post(f"/v1/staff/bars/{bar.id}/line", json={"line_size": "very_long"}, headers=claimer.h)
    me = db.get(User, uuid.UUID(claimer.user_id))
    assert me is not None
    before = me.reliability
    s = _start_sample(client, timer, bar)
    # The claim came before the sample started, and the real wait was short.
    row = db.get(LineSample, uuid.UUID(str(s["id"])))
    assert row is not None and row.entry_rate_at_start
    row.started_at = row.started_at - timedelta(minutes=3)
    from app.models import OutsideLineStatus

    for ls in db.scalars(select(OutsideLineStatus)):
        ls.ts = ls.ts - timedelta(minutes=4)
    db.commit()
    r = client.post(
        f"/v1/staff/bars/{bar.id}/line-samples/{s['id']}/end",
        json={"outcome": "inside"},
        headers=timer.h,
    )
    assert r.status_code == 200 and r.json()["status"] == "completed"
    db.expire_all()
    me = db.get(User, uuid.UUID(claimer.user_id))
    assert me is not None
    return before, me.reliability


def test_sample_referees_other_staff_line_claims(
    client: TestClient, db: Session, admin: Auth, staff: Auth, bar: Bar
) -> None:
    colleague = make_staff(client, admin, str(bar.id))
    before, after = _sample_after_claim(client, db, staff, colleague, bar)
    assert after < before


def test_sample_never_scores_its_own_author(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    # Security review M-1: a staffer cannot referee their own line readings.
    before, after = _sample_after_claim(client, db, staff, staff, bar)
    assert after == before


def test_sample_bola(
    client: TestClient, db: Session, admin: Auth, staff: Auth, bar: Bar, other_bar: Bar
) -> None:
    mine = _start_sample(client, staff, bar)
    other_staff = make_staff(client, admin, str(other_bar.id))
    theirs = _start_sample(client, other_staff, other_bar)
    body = {"outcome": "inside"}
    # Staff of bar A against bar B's url.
    r = client.post(
        f"/v1/staff/bars/{other_bar.id}/line-samples/{mine['id']}/end", json=body, headers=staff.h
    )
    assert r.status_code == 404
    r = client.post(f"/v1/staff/bars/{other_bar.id}/line-samples", headers=staff.h)
    assert r.status_code == 404
    r = client.get(f"/v1/staff/bars/{other_bar.id}/line-samples/active", headers=staff.h)
    assert r.status_code == 404
    # A sample id from another bar through my own bar url.
    r = client.post(
        f"/v1/staff/bars/{bar.id}/line-samples/{theirs['id']}/end", json=body, headers=staff.h
    )
    assert r.status_code == 404
    db.expire_all()
    row = db.get(LineSample, uuid.UUID(str(theirs["id"])))
    assert row is not None and row.status == SessionStatus.active
    # Unknown id.
    r = client.post(
        f"/v1/staff/bars/{bar.id}/line-samples/{uuid.uuid4()}/end", json=body, headers=staff.h
    )
    assert r.status_code == 404


def test_plain_user_cannot_touch_staff_door_routes(
    client: TestClient, user: Auth, bar: Bar
) -> None:
    sid = uuid.uuid4()
    calls = [
        ("POST", f"/v1/staff/bars/{bar.id}/line-samples", None),
        ("GET", f"/v1/staff/bars/{bar.id}/line-samples/active", None),
        ("POST", f"/v1/staff/bars/{bar.id}/line-samples/{sid}/end", {"outcome": "inside"}),
        ("GET", f"/v1/staff/bars/{bar.id}/door-code", None),
        ("POST", f"/v1/staff/bars/{bar.id}/count-sync", {"inside_now": 5}),
    ]
    for method, url, body in calls:
        assert client.request(method, url, json=body, headers=user.h).status_code == 404, url
        assert client.request(method, url, json=body).status_code == 401, url


# ---------- door code ----------


def _freeze(monkeypatch: pytest.MonkeyPatch, now: float) -> None:
    monkeypatch.setattr(door_svc, "time", SimpleNamespace(time=lambda: now))


def _timed_session(
    client: TestClient, db: Session, user: Auth, bar: Bar, code: str | None
) -> dict[str, object]:
    loc = {"latitude": bar.latitude, "longitude": bar.longitude}
    s = client.post(
        "/v1/line-sessions", json={"bar_id": str(bar.id), "location": loc}, headers=user.h
    ).json()
    row = db.get(LineSession, uuid.UUID(s["id"]))
    assert row is not None
    row.started_at = row.started_at - timedelta(minutes=5)
    db.commit()
    body: dict[str, object] = {"outcome": "inside"}
    if code is not None:
        body["door_code"] = code
    r = client.post(f"/v1/line-sessions/{s['id']}/end", json=body, headers=user.h)
    assert r.status_code == 200, r.text
    out: dict[str, object] = r.json()
    return out


def test_door_code_shape_and_expiry(client: TestClient, staff: Auth, bar: Bar) -> None:
    r = client.get(f"/v1/staff/bars/{bar.id}/door-code", headers=staff.h)
    assert r.status_code == 200
    body = r.json()
    assert len(body["code"]) == 4 and body["code"].isdigit()
    assert 1 <= body["expires_in"] <= 120


def test_door_code_not_audited(client: TestClient, db: Session, staff: Auth, bar: Bar) -> None:
    client.get(f"/v1/staff/bars/{bar.id}/door-code", headers=staff.h)
    assert not any(a.action.startswith("door_code") for a in db.scalars(select(AuditLog)))


def test_door_code_differs_per_bar_and_bucket() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    codes = {door_svc.current_code(x, t)[0] for x in (a, b) for t in (0.0, 120.0, 240.0, 360.0)}
    assert len(codes) > 3  # 8 draws from 10000 values, a collision here is very unlikely
    assert door_svc.current_code(a, 125.0)[1] == 115


def test_current_code_verifies_and_pays_double(
    client: TestClient,
    db: Session,
    user: Auth,
    staff: Auth,
    bar: Bar,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _freeze(monkeypatch, 1_000_000.0)
    code = client.get(f"/v1/staff/bars/{bar.id}/door-code", headers=staff.h).json()["code"]
    out = _timed_session(client, db, user, bar, code)
    assert out["verified"] is True and out["points_awarded"] == 20
    ledger = db.scalars(select(RewardLedger)).one()
    assert ledger.points == 20
    db.expire_all()
    row = db.scalars(select(LineSession)).one()
    assert row.verified is True


def test_previous_bucket_accepted_two_buckets_back_rejected(
    client: TestClient,
    db: Session,
    user: Auth,
    staff: Auth,
    bar: Bar,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    t0 = 1_000_000.0
    _freeze(monkeypatch, t0)
    code = client.get(f"/v1/staff/bars/{bar.id}/door-code", headers=staff.h).json()["code"]
    _freeze(monkeypatch, t0 + 120)  # next bucket, the old code is now "previous"
    assert _timed_session(client, db, user, bar, code)["verified"] is True
    other = login(client)
    _freeze(monkeypatch, t0 + 240)  # two buckets later
    out = _timed_session(client, db, other, bar, code)
    assert out["verified"] is False and out["points_awarded"] == 10


def test_wrong_code_and_other_bars_code_do_not_fail_the_request(
    client: TestClient,
    db: Session,
    user: Auth,
    bar: Bar,
    other_bar: Bar,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 1_000_000.0
    _freeze(monkeypatch, now)
    real = door_svc.current_code(bar.id, now)[0]
    wrong = "0000" if real != "0000" else "0001"
    out = _timed_session(client, db, user, bar, wrong)
    assert out["status"] == "completed" and out["verified"] is False
    assert out["points_awarded"] == 10
    elsewhere = door_svc.current_code(other_bar.id, now)[0]
    assert elsewhere != real  # a fixed time and fixed ids, so this is stable
    out2 = _timed_session(client, db, user, bar, elsewhere)
    assert out2["verified"] is False


def test_unknown_door_code_format_is_rejected(client: TestClient, user: Auth, bar: Bar) -> None:
    s = client.post("/v1/line-sessions", json={"bar_id": str(bar.id)}, headers=user.h).json()
    r = client.post(
        f"/v1/line-sessions/{s['id']}/end",
        json={"outcome": "inside", "door_code": "12a4"},
        headers=user.h,
    )
    assert r.status_code == 422


def test_wrong_code_limiter_ignores_codes_without_429(
    client: TestClient, db: Session, user: Auth, bar: Bar, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = 1_000_000.0
    _freeze(monkeypatch, now)
    real = door_svc.current_code(bar.id, now)[0]
    wrong = "0000" if real != "0000" else "0001"
    for _ in range(5):
        assert _timed_session(client, db, user, bar, wrong)["verified"] is False
    # Sixth try with the right code is over the limit, so it is ignored. Still a 200.
    out = _timed_session(client, db, user, bar, real)
    assert out["verified"] is False and out["status"] == "completed"
    # A different user is not affected.
    fresh = login(client)
    assert _timed_session(client, db, fresh, bar, real)["verified"] is True


# ---------- count sync ----------


def _events(db: Session, bar: Bar, source: str) -> list[DoorEvent]:
    return list(
        db.scalars(
            select(DoorEvent).where(DoorEvent.bar_id == bar.id, DoorEvent.source == source)
        ).all()
    )


def test_count_sync_up_down_and_noop(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    url = f"/v1/staff/bars/{bar.id}/count-sync"
    client.post(
        f"/v1/staff/bars/{bar.id}/door", json={"direction": "in", "count": 10}, headers=staff.h
    )
    r = client.post(url, json={"inside_now": 50}, headers=staff.h)
    assert r.status_code == 200 and r.json()["headcount"] == 50
    [up] = _events(db, bar, "sync")
    assert up.direction == DoorDirection.in_ and up.count == 40
    r = client.post(url, json={"inside_now": 20}, headers=staff.h)
    assert r.json()["headcount"] == 20
    assert sorted((e.direction.value, e.count) for e in _events(db, bar, "sync")) == [
        ("in", 40),
        ("out", 30),
    ]
    r = client.post(url, json={"inside_now": 20}, headers=staff.h)
    assert r.json()["headcount"] == 20
    assert len(_events(db, bar, "sync")) == 2  # a zero difference inserts nothing
    assert len(_events(db, bar, "tap")) == 1
    audits = db.scalars(select(AuditLog).where(AuditLog.action == "door.count_sync")).all()
    assert len(audits) == 3 and audits[0].bar_id == bar.id
    assert all(a.actor_user_id == uuid.UUID(staff.user_id) for a in audits)


def test_count_sync_bounds(client: TestClient, staff: Auth, bar: Bar) -> None:
    url = f"/v1/staff/bars/{bar.id}/count-sync"
    assert client.post(url, json={"inside_now": -1}, headers=staff.h).status_code == 422
    assert client.post(url, json={"inside_now": 5001}, headers=staff.h).status_code == 422
    assert client.post(url, json={"inside_now": 5, "x": 1}, headers=staff.h).status_code == 422
    assert client.post(url, json={"inside_now": 5000}, headers=staff.h).status_code == 200


def test_sync_does_not_create_a_fake_rate(
    client: TestClient, db: Session, user: Auth, staff: Auth, bar: Bar
) -> None:
    client.post(f"/v1/staff/bars/{bar.id}/line", json={"line_size": "medium"}, headers=staff.h)
    # With only a sync jump and no taps there is no entry rate, so the default rate is used.
    client.post(f"/v1/staff/bars/{bar.id}/count-sync", json={"inside_now": 300}, headers=staff.h)
    live = client.get(f"/v1/bars/{bar.id}", headers=user.h).json()["live"]
    assert live["headcount"] == 300
    assert "line_not_moving" not in live["flags"]
    assert live["wait_min"] == 9  # 18 people at the default 2 per min


def test_door_event_check_constraint(db: Session, bar: Bar) -> None:
    db.add(DoorEvent(bar_id=bar.id, direction=DoorDirection.in_, count=21, source="tap"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.add(DoorEvent(bar_id=bar.id, direction=DoorDirection.in_, count=5001, source="sync"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.add(DoorEvent(bar_id=bar.id, direction=DoorDirection.in_, count=5000, source="sync"))
    db.commit()
