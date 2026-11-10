"""Verified timers and clicker sync events (docs/SOURCING.md)."""

from __future__ import annotations

from datetime import timedelta

from app.estimation import DoorEventIn, TimerIn
from tests.estimation.helpers import ago, door, line, run


def _timer(duration: float, ended_ago: float, user: str, verified: bool) -> TimerIn:
    ended = ago(ended_ago)
    return TimerIn(
        user_id=user,
        started_at=ended - timedelta(minutes=duration),
        ended_at=ended,
        verified=verified,
    )


def test_verified_timer_outweighs_unverified() -> None:
    # Equal age and trust. The verified one weighs double, so the weighted median lands on it.
    est = run(timers=[_timer(10, 5, "a", False), _timer(30, 5, "b", True)])
    assert est.wait_min == 30


def test_equal_weight_pair_lands_in_the_middle() -> None:
    est = run(timers=[_timer(10, 5, "a", False), _timer(30, 5, "b", False)])
    assert est.wait_min == 20


def test_sync_event_moves_headcount_but_not_rate() -> None:
    sync = DoorEventIn(ts=ago(1), direction="in", count=60, source="sync")
    est = run(doors=[sync])
    assert est.headcount == 60
    assert est.basis.door_events == 0  # not a rate event
    assert est.entry_rate_per_min is None


def test_taps_set_rate_and_sync_does_not_add_to_it() -> None:
    taps = [door("in", 15, 5)]
    base = run(doors=taps, capacity=1000)
    sync = DoorEventIn(ts=ago(1), direction="in", count=500, source="sync")
    with_sync = run(doors=[*taps, sync], capacity=1000)
    assert base.entry_rate_per_min == with_sync.entry_rate_per_min == 1.0
    assert with_sync.headcount == 515


def test_sync_only_with_a_line_is_not_line_not_moving() -> None:
    sync = DoorEventIn(ts=ago(1), direction="in", count=40, source="sync")
    est = run(doors=[sync], lines=[line("short")])
    assert "line_not_moving" not in est.flags
