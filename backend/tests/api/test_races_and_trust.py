"""Fixes from docs/security-review-phase1_5.md: races (H-1), samples (M-1), door code (M-2),
calibration (M-3) and the Low items. Uses real parallel requests. All data is FAKE."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.ratelimit import RateLimiter
from app.db import get_engine
from app.main import create_app
from app.models import (
    AuditLog,
    Bar,
    EstimateError,
    LineSample,
    LineSession,
    RewardLedger,
    SessionStatus,
    User,
)
from app.services import door as door_svc
from app.services import live
from scripts.retention import purge
from tests.api.conftest import Auth, login, make_staff

N = 10


pytestmark = pytest.mark.usefixtures("door_code_on")


@pytest.fixture
def staff(client: TestClient, admin: Auth, bar: Bar) -> Auth:
    return make_staff(client, admin, str(bar.id))


def _prime(client: TestClient, staff: Auth, bar: Bar) -> None:
    """A rate and a line, so timers and samples record a prediction."""
    for _ in range(6):
        client.post(
            f"/v1/staff/bars/{bar.id}/door", json={"direction": "in", "count": 5}, headers=staff.h
        )
    client.post(f"/v1/staff/bars/{bar.id}/line", json={"line_size": "medium"}, headers=staff.h)


def _parallel(n: int, call: Callable[[TestClient], httpx.Response]) -> list[int]:
    """Run `call` n times at once, each with its own client, released by a barrier."""
    barrier = threading.Barrier(n)

    def run(_: int) -> int:
        c = TestClient(create_app())
        barrier.wait()
        return call(c).status_code

    with ThreadPoolExecutor(max_workers=n) as ex:
        return list(ex.map(run, range(n)))


def _near(bar: Bar) -> dict[str, float]:
    return {"latitude": bar.latitude, "longitude": bar.longitude}


def _start(
    client: TestClient, user: Auth, bar: Bar, loc: dict[str, float] | None
) -> dict[str, object]:
    body: dict[str, object] = {"bar_id": str(bar.id)}
    if loc is not None:
        body["location"] = loc
    r = client.post("/v1/line-sessions", json=body, headers=user.h)
    assert r.status_code == 201, r.text
    out: dict[str, object] = r.json()
    return out


def _age_session(db: Session, sid: object, minutes: float) -> None:
    row = db.get(LineSession, uuid.UUID(str(sid)))
    assert row is not None
    row.started_at = row.started_at - timedelta(minutes=minutes)
    db.commit()


def _end(client: TestClient, user: Auth, sid: object, code: str | None = None) -> dict[str, object]:
    body: dict[str, object] = {"outcome": "inside"}
    if code is not None:
        body["door_code"] = code
    r = client.post(f"/v1/line-sessions/{sid}/end", json=body, headers=user.h)
    assert r.status_code == 200, r.text
    out: dict[str, object] = r.json()
    return out


def _count(db: Session, model: type[object]) -> int:
    return int(db.scalar(select(func.count()).select_from(model)) or 0)


# ---------- H-1: parallel ends and starts ----------


def test_parallel_ends_of_one_timer_have_one_winner(
    client: TestClient, db: Session, user: Auth, staff: Auth, bar: Bar
) -> None:
    _prime(client, staff, bar)
    s = _start(client, user, bar, _near(bar))
    _age_session(db, s["id"], 5)
    url = f"/v1/line-sessions/{s['id']}/end"
    codes = _parallel(N, lambda c: c.post(url, json={"outcome": "inside"}, headers=user.h))
    assert sorted(codes) == [200] + [409] * (N - 1), codes
    db.expire_all()
    assert _count(db, RewardLedger) == 1
    assert _count(db, EstimateError) == 1
    row = db.get(LineSession, uuid.UUID(str(s["id"])))
    assert row is not None and row.status == SessionStatus.completed


def test_parallel_starts_give_one_active_timer(
    client: TestClient, db: Session, user: Auth, bar: Bar
) -> None:
    body = {"bar_id": str(bar.id), "location": _near(bar)}
    codes = _parallel(N, lambda c: c.post("/v1/line-sessions", json=body, headers=user.h))
    assert sorted(codes) == [201] + [409] * (N - 1), codes
    db.expire_all()
    active = db.scalar(
        select(func.count())
        .select_from(LineSession)
        .where(LineSession.status == SessionStatus.active)
    )
    assert active == 1


def test_parallel_sample_ends_have_one_winner(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    _prime(client, staff, bar)
    r = client.post(f"/v1/staff/bars/{bar.id}/line-samples", headers=staff.h)
    assert r.status_code == 201
    sid = r.json()["id"]
    row = db.get(LineSample, uuid.UUID(sid))
    assert row is not None
    row.started_at = row.started_at - timedelta(minutes=8)
    db.commit()
    url = f"/v1/staff/bars/{bar.id}/line-samples/{sid}/end"
    codes = _parallel(N, lambda c: c.post(url, json={"outcome": "inside"}, headers=staff.h))
    assert sorted(codes) == [200] + [409] * (N - 1), codes
    db.expire_all()
    assert _count(db, EstimateError) == 1
    ends = db.scalars(select(AuditLog).where(AuditLog.action == "line_sample.end")).all()
    assert len(ends) == 1


def test_parallel_sample_starts_respect_the_active_cap(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    url = f"/v1/staff/bars/{bar.id}/line-samples"
    codes = _parallel(N, lambda c: c.post(url, headers=staff.h))
    assert sorted(codes) == [201] * 2 + [409] * (N - 2), codes
    db.expire_all()
    assert _count(db, LineSample) == 2


def test_one_active_timer_per_user_is_a_db_constraint(db: Session, bar: Bar) -> None:
    u = User(age_attested_at=datetime.now(UTC))
    db.add(u)
    db.commit()
    db.add(LineSession(user_id=u.id, bar_id=bar.id))
    db.add(LineSession(user_id=u.id, bar_id=bar.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    # Finished timers do not count.
    db.add(LineSession(user_id=u.id, bar_id=bar.id, status=SessionStatus.completed))
    db.add(LineSession(user_id=u.id, bar_id=bar.id, status=SessionStatus.completed))
    db.add(LineSession(user_id=u.id, bar_id=bar.id))
    db.commit()


def test_one_reward_per_reason_and_ref(db: Session) -> None:
    u = User(age_attested_at=datetime.now(UTC))
    db.add(u)
    db.commit()
    ref = uuid.uuid4()
    db.add(RewardLedger(user_id=u.id, points=10, reason="timer", ref_id=ref))
    db.add(RewardLedger(user_id=u.id, points=10, reason="timer", ref_id=ref))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.add(RewardLedger(user_id=u.id, points=1, reason="bonus", ref_id=None))
    db.add(RewardLedger(user_id=u.id, points=1, reason="bonus", ref_id=None))
    db.add(RewardLedger(user_id=u.id, points=10, reason="report", ref_id=ref))
    db.commit()


def test_end_route_is_rate_limited(client: TestClient, user: Auth) -> None:
    for _ in range(20):
        r = client.post(
            f"/v1/line-sessions/{uuid.uuid4()}/end", json={"outcome": "inside"}, headers=user.h
        )
        assert r.status_code == 404
    r = client.post(
        f"/v1/line-sessions/{uuid.uuid4()}/end", json={"outcome": "inside"}, headers=user.h
    )
    assert r.status_code == 429


# ---------- M-1: samples ----------


def test_samples_are_capped_per_staff_per_hour(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    url = f"/v1/staff/bars/{bar.id}/line-samples"
    for _ in range(4):
        r = client.post(url, headers=staff.h)
        assert r.status_code == 201
        client.post(f"{url}/{r.json()['id']}/end", json={"outcome": "cancel"}, headers=staff.h)
    r = client.post(url, headers=staff.h)
    assert r.status_code == 409 and r.json()["detail"] == "sample_rate_limited"
    # An hour later the window has moved on.
    for row in db.scalars(select(LineSample)):
        row.started_at = row.started_at - timedelta(minutes=61)
    db.commit()
    assert client.post(url, headers=staff.h).status_code == 201


def test_samples_never_move_calibration(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    db.add_all(
        EstimateError(
            bar_id=bar.id,
            predicted_min=5,
            formula_min=5,
            actual_min=20,
            abs_error_min=15,
            source="sample",
            eligible=False,
        )
        for _ in range(10)
    )
    db.commit()
    assert live._calibration(db, bar.id, live.utcnow()) == 1.0


# ---------- M-2: the door code only upgrades a timer that started near the bar ----------


def _freeze(monkeypatch: pytest.MonkeyPatch, now: float) -> None:
    monkeypatch.setattr(door_svc, "time", SimpleNamespace(time=lambda: now))


def test_door_code_does_not_verify_a_timer_started_away(
    client: TestClient,
    db: Session,
    user: Auth,
    staff: Auth,
    bar: Bar,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _freeze(monkeypatch, 1_000_000.0)
    code = client.get(f"/v1/staff/bars/{bar.id}/door-code", headers=staff.h).json()["code"]
    for loc in (None, {"latitude": bar.latitude + 0.05, "longitude": bar.longitude}):
        u = login(client)
        s = _start(client, u, bar, loc)
        _age_session(db, s["id"], 30)
        out = _end(client, u, s["id"], code)
        assert out["status"] == "completed"
        assert out["verified"] is False and out["points_awarded"] == 0
    assert _count(db, RewardLedger) == 0
    # Near at the start plus the code is verified.
    s = _start(client, user, bar, _near(bar))
    _age_session(db, s["id"], 5)
    out = _end(client, user, s["id"], code)
    assert out["verified"] is True and out["points_awarded"] == 20


# ---------- M-3: calibration ----------


def _eligible_points(db: Session, bar: Bar, users: int, points: int) -> None:
    now = live.utcnow()
    people = [User(age_attested_at=now) for _ in range(users)]
    db.add_all(people)
    db.flush()
    for i in range(points):
        db.add(
            LineSession(
                user_id=people[i % users].id,
                bar_id=bar.id,
                status=SessionStatus.completed,
                started_at=now - timedelta(minutes=30 + i),
                ended_at=now - timedelta(minutes=10 + i),
                near_bar=True,
                calibration_eligible=True,
            )
        )
        db.add(
            EstimateError(
                bar_id=bar.id,
                created_at=now - timedelta(minutes=10 + i),
                predicted_min=10,
                formula_min=10,
                actual_min=20,
                abs_error_min=10,
                source="timer",
                eligible=True,
            )
        )
    db.commit()


@pytest.mark.parametrize(
    ("users", "points", "calibrated"),
    [(3, 4, False), (2, 5, False), (5, 2, False), (3, 5, True), (6, 6, True)],
)
def test_calibration_needs_five_points_from_three_users(
    db: Session, bar: Bar, users: int, points: int, calibrated: bool
) -> None:
    _eligible_points(db, bar, users, points)
    factor = live._calibration(db, bar.id, live.utcnow())
    assert (factor == 2.0) if calibrated else (factor == 1.0)


def test_untrusted_and_ineligible_rows_do_not_calibrate(db: Session, bar: Bar) -> None:
    _eligible_points(db, bar, 3, 5)
    for row in db.scalars(select(EstimateError)):
        row.eligible = False
    db.commit()
    assert live._calibration(db, bar.id, live.utcnow()) == 1.0


def test_one_calibration_point_per_user_per_night(
    client: TestClient, db: Session, user: Auth, staff: Auth, bar: Bar
) -> None:
    _prime(client, staff, bar)
    for _ in range(2):
        s = _start(client, user, bar, _near(bar))
        _age_session(db, s["id"], 5)
        _end(client, user, s["id"])
    # An untrusted timer (no location) is recorded for accuracy only.
    other = login(client)
    s = _start(client, other, bar, None)
    _age_session(db, s["id"], 5)
    _end(client, other, s["id"])
    db.expire_all()
    rows = db.scalars(select(EstimateError).order_by(EstimateError.created_at)).all()
    assert [r.eligible for r in rows] == [True, False, False]
    assert all(r.source == "timer" for r in rows)
    flagged = db.scalars(select(LineSession).where(LineSession.calibration_eligible)).all()
    assert len(flagged) == 1 and flagged[0].user_id == uuid.UUID(user.user_id)


def test_estimate_errors_hold_no_user_columns() -> None:
    cols = {c.name for c in EstimateError.__table__.columns}
    assert not {c for c in cols if "user" in c}


# ---------- Lows ----------


def test_retention_purges_old_line_samples(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    for _ in range(2):
        r = client.post(f"/v1/staff/bars/{bar.id}/line-samples", headers=staff.h)
        assert r.status_code == 201
    old = db.scalars(select(LineSample)).first()
    assert old is not None
    old.started_at = datetime.now(UTC) - timedelta(days=31)
    db.commit()
    counts = purge(db, datetime.now(UTC), 30)
    assert counts["line_samples"] == 1
    assert _count(db, LineSample) == 1


def test_count_sync_too_large_is_422_not_500(
    client: TestClient, db: Session, staff: Auth, bar: Bar
) -> None:
    url = f"/v1/staff/bars/{bar.id}/count-sync"
    assert client.post(url, json={"inside_now": 5000}, headers=staff.h).status_code == 200
    client.post(
        f"/v1/staff/bars/{bar.id}/door", json={"direction": "in", "count": 1}, headers=staff.h
    )
    r = client.post(url, json={"inside_now": 0}, headers=staff.h)
    assert r.status_code == 422 and r.json()["detail"] == "sync_too_large"
    # A smaller step still works.
    r = client.post(url, json={"inside_now": 1}, headers=staff.h)
    assert r.status_code == 200 and r.json()["headcount"] == 1


def test_guarded_limiter_counts_misses_atomically() -> None:
    lim = RateLimiter()
    calls: list[int] = []
    lock = threading.Lock()

    def miss() -> bool:
        with lock:
            calls.append(1)
        return False

    barrier = threading.Barrier(40)

    def run(_: int) -> bool:
        barrier.wait()
        return lim.guarded("k", 5, 3600, miss)

    with ThreadPoolExecutor(max_workers=40) as ex:
        results = list(ex.map(run, range(40)))
    assert len(calls) == 5 and not any(results)
    # A match is not counted as a miss.
    lim2 = RateLimiter()
    assert all(lim2.guarded("k", 1, 3600, lambda: True) for _ in range(3))


def test_engine_hides_sql_parameters() -> None:
    assert get_engine().hide_parameters is True
