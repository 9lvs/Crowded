"""Shared builders for estimation tests. Pure data, no database."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.estimation import (
    DoorEventIn,
    Estimate,
    EstimateInput,
    InsideStatusIn,
    LineStatusIn,
    Params,
    ReportIn,
    TimerIn,
    estimate,
)

NOW = datetime(2026, 11, 13, 23, 0, tzinfo=UTC)
CAPACITY = 100


def ago(minutes: float) -> datetime:
    return NOW - timedelta(minutes=minutes)


def ahead(minutes: float) -> datetime:
    return NOW + timedelta(minutes=minutes)


def door(direction: str, count: int, minutes_ago: float) -> DoorEventIn:
    return DoorEventIn(ts=ago(minutes_ago), direction=direction, count=count)


def line(size: str, minutes_ago: float = 2) -> LineStatusIn:
    return LineStatusIn(ts=ago(minutes_ago), line_size=size)


def done_timer(
    duration: float, ended_minutes_ago: float = 5, user: str = "u1", near_bar: bool = True
) -> TimerIn:
    ended = ago(ended_minutes_ago)
    return TimerIn(
        user_id=user,
        started_at=ended - timedelta(minutes=duration),
        ended_at=ended,
        near_bar=near_bar,
    )


def active_timer(started_minutes_ago: float = 10, user: str = "u1") -> TimerIn:
    return TimerIn(user_id=user, started_at=ago(started_minutes_ago))


def report(
    user: str = "u1",
    minutes_ago: float = 3,
    crowd: str | None = None,
    size: str | None = None,
    near: bool = True,
    drink: str | None = None,
) -> ReportIn:
    return ReportIn(
        user_id=user,
        ts=ago(minutes_ago),
        crowd_level=crowd,
        line_size=size,
        near_bar=near,
        drink_wait=drink,
    )


def inside(
    crowd: str | None = None,
    drink: str | None = None,
    minutes_ago: float = 3,
    reporter: str | None = None,
) -> InsideStatusIn:
    return InsideStatusIn(
        ts=ago(minutes_ago), crowd_level=crowd, drink_wait=drink, reporter_id=reporter
    )


def run(
    *,
    capacity: int = CAPACITY,
    doors: list[DoorEventIn] | None = None,
    lines: list[LineStatusIn] | None = None,
    timers: list[TimerIn] | None = None,
    reports: list[ReportIn] | None = None,
    insides: list[InsideStatusIn] | None = None,
    counts_exits: bool = True,
    reliability: dict[str, float] | None = None,
    calibration: float = 1.0,
    params: Params | None = None,
) -> Estimate:
    return estimate(
        EstimateInput(
            now=NOW,
            capacity=capacity,
            door_events=doors or [],
            line_statuses=lines or [],
            timers=timers or [],
            reports=reports or [],
            inside_statuses=insides or [],
            counts_exits=counts_exits,
            reliability=reliability or {},
            calibration=calibration,
            params=params or Params(),
        )
    )
