"""Glue between the database and the pure estimation module."""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import estimation as est
from app.models import (
    Bar,
    BarSnapshot,
    CrowdLevel,
    CrowdReport,
    DoorDirection,
    DoorEvent,
    EstimateError,
    LineSession,
    OutsideLineStatus,
    PassPrice,
    SessionStatus,
    User,
)
from app.schemas import (
    BarDetail,
    BarSummary,
    BasisOut,
    HourPoint,
    LiveOut,
    SnapshotOut,
    VerdictOut,
)

PARAMS = est.Params()
NIGHT_START_HOUR = 12  # "tonight" runs from local noon to local noon
CHART_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3]
SNAPSHOT_EVERY = timedelta(minutes=2)
HISTORY_DAYS = 28
ACTIVE_SESSION_MAX = timedelta(hours=4)


def utcnow() -> datetime:
    return datetime.now(UTC)


def tonight_start(bar: Bar, now: datetime) -> datetime:
    tz = ZoneInfo(bar.timezone)
    local = now.astimezone(tz)
    start = local.replace(hour=NIGHT_START_HOUR, minute=0, second=0, microsecond=0)
    if local < start:
        start -= timedelta(days=1)
    return start.astimezone(UTC)


@dataclass
class Live:
    bar: Bar
    estimate: est.Estimate
    now: datetime


def current_pass_price(db: Session, bar_id: uuid.UUID) -> int | None:
    return db.scalar(
        select(PassPrice.price_cents)
        .where(PassPrice.bar_id == bar_id)
        .order_by(PassPrice.created_at.desc())
        .limit(1)
    )


def _calibration(db: Session, bar_id: uuid.UUID, now: datetime) -> float:
    since = now - timedelta(minutes=PARAMS.calibration_window_min)
    rows = db.execute(
        select(EstimateError.created_at, EstimateError.formula_min, EstimateError.actual_min).where(
            EstimateError.bar_id == bar_id,
            EstimateError.created_at >= since,
            EstimateError.formula_min.is_not(None),
        )
    ).all()
    points = [
        est.CalibrationPoint(ts=ts, predicted_min=float(f), actual_min=float(a))
        for ts, f, a in rows
        if f is not None
    ]
    return est.calibration_factor(points, now, PARAMS)


def build_input(db: Session, bar: Bar, now: datetime) -> est.EstimateInput:
    window = now - timedelta(minutes=PARAMS.window_min)
    night = tonight_start(bar, now)

    doors = db.execute(
        select(DoorEvent.ts, DoorEvent.direction, DoorEvent.count).where(
            DoorEvent.bar_id == bar.id, DoorEvent.ts >= night, DoorEvent.ts <= now
        )
    ).all()
    lines = db.execute(
        select(
            OutsideLineStatus.ts, OutsideLineStatus.line_size, OutsideLineStatus.staff_user_id
        ).where(OutsideLineStatus.bar_id == bar.id, OutsideLineStatus.ts >= window)
    ).all()
    sessions = db.execute(
        select(
            LineSession.user_id,
            LineSession.started_at,
            LineSession.ended_at,
            LineSession.near_bar,
            LineSession.status,
        ).where(
            LineSession.bar_id == bar.id,
            LineSession.status != SessionStatus.abandoned,
            LineSession.started_at >= now - ACTIVE_SESSION_MAX,
        )
    ).all()
    reports = db.execute(
        select(
            CrowdReport.user_id,
            CrowdReport.created_at,
            CrowdReport.crowd_level,
            CrowdReport.line_size,
            CrowdReport.near_bar,
        ).where(CrowdReport.bar_id == bar.id, CrowdReport.created_at >= window)
    ).all()

    user_ids = (
        {r.user_id for r in sessions}
        | {r.user_id for r in reports}
        | {ln.staff_user_id for ln in lines if ln.staff_user_id is not None}
    )
    reliability: dict[str, float] = {}
    if user_ids:
        for uid, rel in db.execute(select(User.id, User.reliability).where(User.id.in_(user_ids))):
            reliability[str(uid)] = rel

    timers = [
        est.TimerIn(
            user_id=str(s.user_id),
            started_at=s.started_at,
            ended_at=s.ended_at if s.status == SessionStatus.completed else None,
            near_bar=s.near_bar,
        )
        for s in sessions
    ]
    return est.EstimateInput(
        now=now,
        capacity=bar.capacity,
        door_events=[
            est.DoorEventIn(ts=ts, direction=direction.value, count=n) for ts, direction, n in doors
        ],
        line_statuses=[
            est.LineStatusIn(
                ts=ln.ts,
                line_size=ln.line_size.value,
                reporter_id=str(ln.staff_user_id) if ln.staff_user_id else None,
            )
            for ln in lines
        ],
        timers=timers,
        reports=[
            est.ReportIn(
                user_id=str(r.user_id),
                ts=r.created_at,
                crowd_level=r.crowd_level.value if r.crowd_level else None,
                line_size=r.line_size.value if r.line_size else None,
                near_bar=r.near_bar,
            )
            for r in reports
        ],
        reliability=reliability,
        calibration=_calibration(db, bar.id, now),
        params=PARAMS,
    )


def compute(db: Session, bar: Bar, now: datetime | None = None, persist: bool = True) -> Live:
    now = now or utcnow()
    result = est.estimate(build_input(db, bar, now))
    if persist:
        _maybe_snapshot(db, bar, result, now)
    return Live(bar=bar, estimate=result, now=now)


def raw_formula_wait(e: est.Estimate) -> float | None:
    if e.people_in_line is None or not e.entry_rate_per_min:
        return None
    return min(e.people_in_line / e.entry_rate_per_min, PARAMS.max_wait_min)


def _maybe_snapshot(db: Session, bar: Bar, e: est.Estimate, now: datetime) -> None:
    last = db.scalar(select(func.max(BarSnapshot.ts)).where(BarSnapshot.bar_id == bar.id))
    if last is not None and now - last < SNAPSHOT_EVERY:
        return
    db.add(
        BarSnapshot(
            bar_id=bar.id,
            ts=now,
            has_recent_data=e.has_recent_data,
            wait_minutes=e.wait_min,
            crowd_level=CrowdLevel(e.crowd_level.value) if e.crowd_level else None,
            headcount=e.headcount,
            confidence=e.confidence.value,
            basis={
                "reports": e.basis.reports,
                "timers": e.basis.timers,
                "door_events": e.basis.door_events,
                "staff_line_updates": e.basis.staff_line_updates,
                "method": e.method,
            },
        )
    )
    db.commit()


def _r(x: float | None) -> int | None:
    return None if x is None else round(x)


def live_out(live: Live) -> LiveOut:
    e = live.estimate
    return LiveOut(
        has_recent_data=e.has_recent_data,
        wait_min=_r(e.wait_min),
        wait_low_min=_r(e.wait_low_min),
        wait_high_min=_r(e.wait_high_min),
        crowd_level=CrowdLevel(e.crowd_level.value) if e.crowd_level else None,
        headcount=e.headcount,
        capacity_ratio=None if e.capacity_ratio is None else round(e.capacity_ratio, 3),
        confidence=e.confidence.value,
        basis=BasisOut(
            text=e.basis.text,
            window_min=e.basis.window_min,
            reports=e.basis.reports,
            timers=e.basis.timers,
            door_events=e.basis.door_events,
            staff_line_updates=e.basis.staff_line_updates,
        ),
        flags=list(e.flags),
        updated_at=live.now,
    )


def verdict_out(live: Live, threshold: int, price: int | None) -> VerdictOut:
    v = est.verdict(live.estimate, threshold, price)
    return VerdictOut(
        recommendation=v.recommendation.value,
        text=v.text,
        threshold_min=v.threshold_min,
        pass_price_cents=v.pass_price_cents,
        minutes_saved=_r(v.minutes_saved),
    )


def bar_summary(db: Session, bar: Bar, user: User, now: datetime | None = None) -> BarSummary:
    live = compute(db, bar, now)
    price = current_pass_price(db, bar.id)
    return BarSummary(
        id=bar.id,
        slug=bar.slug,
        name=bar.name,
        address=bar.address,
        capacity=bar.capacity,
        pass_price_cents=price,
        live=live_out(live),
        verdict=verdict_out(live, user.wait_threshold_min, price),
    )


def wait_by_hour(db: Session, bar: Bar, now: datetime) -> list[HourPoint]:
    tz = ZoneInfo(bar.timezone)
    night = tonight_start(bar, now)
    rows = db.execute(
        select(BarSnapshot.ts, BarSnapshot.wait_minutes).where(
            BarSnapshot.bar_id == bar.id,
            BarSnapshot.ts >= now - timedelta(days=HISTORY_DAYS),
            BarSnapshot.has_recent_data.is_(True),
            BarSnapshot.wait_minutes.is_not(None),
        )
    ).all()
    typical: dict[int, list[float]] = defaultdict(list)
    tonight: dict[int, list[float]] = defaultdict(list)
    for ts, wait in rows:
        if wait is None:
            continue
        hour = ts.astimezone(tz).hour
        (tonight if ts >= night else typical)[hour].append(float(wait))

    def avg(xs: list[float]) -> int | None:
        return round(sum(xs) / len(xs)) if xs else None

    return [
        HourPoint(hour=h, typical_wait_min=avg(typical[h]), tonight_wait_min=avg(tonight[h]))
        for h in CHART_HOURS
    ]


def bar_detail(db: Session, bar: Bar, user: User) -> BarDetail:
    now = utcnow()
    summary = bar_summary(db, bar, user, now)
    hours = wait_by_hour(db, bar, now)
    local_hour = now.astimezone(ZoneInfo(bar.timezone)).hour
    normal = next((h.typical_wait_min for h in hours if h.hour == local_hour), None)
    return BarDetail(
        **summary.model_dump(),
        latitude=bar.latitude,
        longitude=bar.longitude,
        normal_wait_min=normal,
        wait_by_hour=hours,
    )


def snapshots(db: Session, bar: Bar, hours: int) -> list[SnapshotOut]:
    since = utcnow() - timedelta(hours=hours)
    rows = db.scalars(
        select(BarSnapshot)
        .where(BarSnapshot.bar_id == bar.id, BarSnapshot.ts >= since)
        .order_by(BarSnapshot.ts.asc())
        .limit(1000)
    ).all()
    return [
        SnapshotOut(
            bar_id=s.bar_id,
            ts=s.ts,
            has_recent_data=s.has_recent_data,
            wait_min=_r(s.wait_minutes),
            crowd_level=s.crowd_level,
            headcount=s.headcount,
            confidence=s.confidence,
        )
        for s in rows
    ]


def door_totals(db: Session, bar: Bar, now: datetime) -> tuple[int, int]:
    night = tonight_start(bar, now)
    rows = db.execute(
        select(DoorEvent.direction, func.coalesce(func.sum(DoorEvent.count), 0))
        .where(DoorEvent.bar_id == bar.id, DoorEvent.ts >= night)
        .group_by(DoorEvent.direction)
    ).all()
    totals = {d: int(n) for d, n in rows}
    return totals.get(DoorDirection.in_, 0), totals.get(DoorDirection.out, 0)
