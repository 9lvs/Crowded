"""Seed plus a one night simulation against the test DB. All data is FAKE."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import (
    Bar,
    BarSnapshot,
    EstimateError,
    LineSession,
    PassPrice,
    StaffInvite,
    User,
)
from app.services import live
from app.services.auth import phone_hash
from scripts import seed, simulate_night
from scripts._common import FAKE_BARS, LIAR_EVERY, all_sim_phones, user_phone

COORD_COLUMNS = {"latitude", "longitude", "lat", "lng", "lon", "coords", "coordinates"}


def test_seed_is_idempotent(db: Session) -> None:
    first = seed.run(db)
    second = seed.run(db)
    assert set(first) == set(second) == {b.slug for b in FAKE_BARS}
    assert all(set(c) == {"manager", "door"} for c in first.values())
    assert [b.counts_exits for b in db.scalars(select(Bar).order_by(Bar.capacity))] == [
        True,
        True,
        False,
    ]
    bars = db.scalars(select(Bar).order_by(Bar.capacity)).all()
    assert [b.name for b in bars] == [
        "FAKE The Tipsy Owl",
        "FAKE Copper Fox",
        "FAKE Neon Moose",
    ]
    assert [b.capacity for b in bars] == [120, 180, 250]
    assert [live.current_pass_price(db, b.id) for b in bars] == [1500, 2000, None]
    assert db.scalar(select(func.count()).select_from(PassPrice)) == 3
    # One live manager invite and one door invite per bar: the second run revoked the first batch.
    live_invites = db.scalar(
        select(func.count()).select_from(StaffInvite).where(StaffInvite.revoked_at.is_(None))
    )
    assert live_invites == 6


def test_one_night_simulation(db: Session) -> None:
    seed.run(db)
    stats = simulate_night.simulate(db, nights=["sat"], weeks_ago=[1], seed=7, estimate_every=5)
    bars = db.scalars(select(Bar)).all()
    assert len(bars) == 3

    # Snapshots exist for every bar and the hour chart has values at the peak.
    now = datetime.now(UTC)
    for bar in bars:
        n = db.scalar(
            select(func.count()).select_from(BarSnapshot).where(BarSnapshot.bar_id == bar.id)
        )
        assert n and n > 50
        by_hour = {h.hour: h for h in live.wait_by_hour(db, bar, now)}
        for hour in (23, 0):
            assert by_hour[hour].typical_wait_min is not None, (bar.slug, hour)

    # Timers produced estimate errors, and the estimate is reasonable.
    errors = db.scalars(select(EstimateError)).all()
    assert len(errors) > 30
    assert {e.bar_id for e in errors} == {b.id for b in bars}
    mae = sum(e.abs_error_min for e in errors) / len(errors)
    assert mae < 15, mae
    assert all(st.mae is not None and st.peak_headcount > 0 for st in stats)
    done = db.scalar(
        select(func.count()).select_from(LineSession).where(LineSession.status == "completed")
    )
    assert done is not None and done >= len(errors)

    # Liars end up with lower reliability than honest users.
    users = {u.phone_hash: u for u in db.scalars(select(User))}
    liars = [users[phone_hash(user_phone(i))] for i in range(0, 160, LIAR_EVERY)]
    honest = [users[phone_hash(user_phone(i))] for i in range(1, 160) if i % LIAR_EVERY]
    assert sum(u.reliability for u in liars) / len(liars) < sum(
        u.reliability for u in honest
    ) / len(honest)


def test_no_coordinates_and_only_fake_phones(db: Session) -> None:
    seed.run(db)
    simulate_night.simulate(db, nights=["fri"], weeks_ago=[1], seed=3, estimate_every=5)

    # Only bars carry coordinates. No other table has a coordinate column, JSON included.
    for table in Base.metadata.sorted_tables:
        names = {c.name.lower() for c in table.columns}
        if table.name == "bars":
            continue
        assert not names & COORD_COLUMNS, table.name
        for col in table.columns:
            if col.type.__class__.__name__ != "JSON":
                continue
            rows: list[Any] = db.execute(select(col)).scalars().all()
            for value in rows:
                text = str(value).lower()
                assert "latitude" not in text
                assert "longitude" not in text

    valid = {phone_hash(p) for p in all_sim_phones()}
    users = db.scalars(select(User)).all()
    assert users
    for u in users:
        assert u.phone_hash in valid
        assert u.apple_sub_hash is None
        assert u.phone_last2 is not None


def test_inflating_staff_loses_reliability_and_timers_referee(db: Session) -> None:
    seed.run(db)
    stats = simulate_night.simulate(
        db, nights=["fri", "sat"], weeks_ago=[1], seed=7, staff_bias="inflate", estimate_every=5
    )
    by_slug = dict(zip((b.slug for b in FAKE_BARS), stats, strict=True))
    biased = by_slug[simulate_night.BIASED_SLUG]
    honest = [st for slug, st in by_slug.items() if slug != simulate_night.BIASED_SLUG]
    assert biased.staff_reliability is not None
    honest_rel = [st.staff_reliability for st in honest if st.staff_reliability is not None]
    assert biased.staff_reliability < sum(honest_rel) / len(honest_rel) - 0.2
    # Timers referee: the estimate stays close to the real waits despite the hyped line.
    assert biased.mae is not None and biased.mae < 10
    # The estimator flags staff and students disagreeing. Snapshots do not store flags, so we
    # count the flag on the live estimate during the run.
    assert biased.disagree_samples > 0


def test_rare_reports_still_give_fresh_data(db: Session) -> None:
    seed.run(db)
    stats = simulate_night.simulate(
        db, nights=["sat"], weeks_ago=[1], seed=7, report_rate=0.2, estimate_every=5
    )
    for st in stats:
        assert st.freshness is not None and st.freshness >= 0.8, st.name
        assert st.timers_done > 20
        assert st.mae is not None and st.mae < 10
