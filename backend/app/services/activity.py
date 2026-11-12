"""Line timers, crowd reports, rewards and reliability updates."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import estimation as est
from app.config import get_settings
from app.core.location import bucket_for, haversine_m
from app.core.ratelimit import door_code_try
from app.models import (
    Bar,
    CrowdReport,
    DistanceBucket,
    EstimateError,
    LineSession,
    OutsideLineStatus,
    RewardLedger,
    SessionStatus,
    User,
)
from app.schemas import LineSessionOut, LocationIn, ReportCreate, ReportOut
from app.services import door as door_svc
from app.services import live

POINTS_TIMER = 10
POINTS_TIMER_VERIFIED = 20
POINTS_REPORT = 2
MIN_VALID_WAIT_MIN = 0.5
MAX_VALID_WAIT_MIN = 240.0


def _distance(bar: Bar, loc: LocationIn | None) -> tuple[bool, DistanceBucket]:
    """Compute and immediately discard coordinates. Only the bucket leaves this function."""
    if loc is None:
        return bucket_for(None)
    return bucket_for(haversine_m(loc.latitude, loc.longitude, bar.latitude, bar.longitude))


def session_out(s: LineSession, points: int = 0) -> LineSessionOut:
    return LineSessionOut(
        id=s.id,
        bar_id=s.bar_id,
        status=s.status,
        started_at=s.started_at,
        ended_at=s.ended_at,
        predicted_wait_min=None if s.predicted_wait_min is None else round(s.predicted_wait_min),
        actual_wait_min=None if s.actual_wait_min is None else round(s.actual_wait_min, 1),
        near_bar=s.near_bar,
        verified=s.verified,
        points_awarded=points,
    )


def expire_stale(db: Session, user: User, now: datetime) -> None:
    stale = db.scalars(
        select(LineSession).where(
            LineSession.user_id == user.id,
            LineSession.status == SessionStatus.active,
            LineSession.started_at < now - live.ACTIVE_SESSION_MAX,
        )
    ).all()
    for s in stale:
        s.status = SessionStatus.abandoned
        s.ended_at = now
    if stale:
        db.commit()


def active_session(db: Session, user: User) -> LineSession | None:
    expire_stale(db, user, live.utcnow())
    return db.scalar(
        select(LineSession).where(
            LineSession.user_id == user.id, LineSession.status == SessionStatus.active
        )
    )


def start_session(db: Session, user: User, bar: Bar, loc: LocationIn | None) -> LineSessionOut:
    if active_session(db, user) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="session_already_active")
    now = live.utcnow()
    current = live.compute(db, bar, now)
    near, bucket = _distance(bar, loc)
    s = LineSession(
        user_id=user.id,
        bar_id=bar.id,
        started_at=now,
        predicted_wait_min=current.estimate.wait_min,
        formula_wait_min=live.raw_formula_wait(current.estimate),
        entry_rate_at_start=current.estimate.entry_rate_per_min,
        near_bar=near,
        distance_bucket=bucket,
    )
    db.add(s)
    try:
        db.commit()
    except IntegrityError:
        # uq_line_sessions_one_active: a parallel start won the race.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="session_already_active") from None
    return session_out(s)


def _door_code_ok(user: User, bar_id: uuid.UUID, code: str | None) -> bool:
    """Check a typed door code. Wrong codes are counted. Over the limit, codes are ignored."""
    if code is None or not get_settings().door_code_enabled:
        return False
    return door_code_try(str(user.id), lambda: door_svc.code_matches(bar_id, code))


def _already_calibrated_tonight(db: Session, s: LineSession, night: datetime) -> bool:
    return bool(
        db.scalar(
            select(
                exists().where(
                    LineSession.user_id == s.user_id,
                    LineSession.bar_id == s.bar_id,
                    LineSession.calibration_eligible.is_(True),
                    LineSession.started_at >= night,
                    LineSession.id != s.id,
                )
            )
        )
    )


def end_session(
    db: Session,
    user: User,
    session_id: uuid.UUID,
    outcome: str,
    door_code: str | None = None,
) -> LineSessionOut:
    # Lock the row, then check the status. Parallel ends of one timer queue on the lock and
    # every one after the first sees a finished timer (security review H-1).
    s = db.scalar(
        select(LineSession)
        .where(LineSession.id == session_id, LineSession.user_id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    # Same 404 for "missing" and "not yours" (no object enumeration).
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    if s.status != SessionStatus.active:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="session_not_active")
    now = live.utcnow()
    s.ended_at = now
    actual = (now - s.started_at).total_seconds() / 60
    points = 0
    if outcome == "inside" and MIN_VALID_WAIT_MIN <= actual <= MAX_VALID_WAIT_MIN:
        s.status = SessionStatus.completed
        s.actual_wait_min = actual
        # A door code only upgrades a timer that started near the bar (security review M-2).
        # It proves where the student was at the end, so alone it proves nothing about the
        # start. Away from the bar the code is not even checked.
        s.verified = s.near_bar and _door_code_ok(user, s.bar_id, door_code)
        trusted = s.near_bar
        if s.predicted_wait_min is not None:
            eligible = False
            bar = db.get(Bar, s.bar_id)
            if trusted and bar is not None:
                night = live.tonight_start(bar, now)
                eligible = not _already_calibrated_tonight(db, s, night)
                s.calibration_eligible = eligible
            record_error(
                db,
                s.bar_id,
                now,
                s.predicted_wait_min,
                s.formula_wait_min,
                actual,
                source="timer",
                eligible=eligible,
            )
            if trusted:
                user.reliability = est.update_reliability(
                    user.reliability, s.predicted_wait_min, actual
                )
        if trusted:
            points = POINTS_TIMER_VERIFIED if s.verified else POINTS_TIMER
            score_line_sources(
                db, s.bar_id, s.started_at, s.entry_rate_at_start, actual, exclude_user=s.user_id
            )
    else:
        s.status = SessionStatus.abandoned
    if points:
        db.add(RewardLedger(user_id=user.id, points=points, reason="timer", ref_id=s.id))
    db.commit()
    return session_out(s, points)


LINE_SCORE_LOOKBACK = timedelta(minutes=10)


def record_error(
    db: Session,
    bar_id: uuid.UUID,
    now: datetime,
    predicted: float,
    formula: float | None,
    actual: float,
    *,
    source: str,
    eligible: bool,
) -> None:
    """Estimate vs actual for a finished timer or staff sample.

    Every row feeds the accuracy metrics. Only `eligible` rows feed calibration: trusted
    student timers, one per user per bar per night. Samples are never eligible.
    """
    db.add(
        EstimateError(
            bar_id=bar_id,
            created_at=now,
            predicted_min=predicted,
            formula_min=formula,
            actual_min=actual,
            abs_error_min=abs(predicted - actual),
            source=source,
            eligible=eligible and source == "timer",
        )
    )


def score_line_sources(
    db: Session,
    bar_id: uuid.UUID,
    started_at: datetime,
    entry_rate_at_start: float | None,
    actual_min: float,
    exclude_user: uuid.UUID | None = None,
) -> None:
    """Use a finished timer as ground truth for the line reports made when it started.

    people really in line ~= actual wait x entry rate at the start. Every staff line reading and
    student line report made just before the timer started is scored against that, and the
    reporter's reliability moves toward how close they were. One honest timer referees both.
    `exclude_user` (the timer owner or the sample's staff author) is never scored, so nobody
    referees their own claims (security review M-1).
    """
    if not entry_rate_at_start:
        return
    implied = actual_min * entry_rate_at_start
    since = started_at - LINE_SCORE_LOOKBACK
    people = est.types.LINE_SIZE_PEOPLE
    staff_rows = db.execute(
        select(OutsideLineStatus.staff_user_id, OutsideLineStatus.line_size).where(
            OutsideLineStatus.bar_id == bar_id,
            OutsideLineStatus.ts >= since,
            OutsideLineStatus.ts <= started_at,
            OutsideLineStatus.staff_user_id.is_not(None),
            *(
                [OutsideLineStatus.staff_user_id != exclude_user]
                if exclude_user is not None
                else []
            ),
        )
    ).all()
    report_rows = db.execute(
        select(CrowdReport.user_id, CrowdReport.line_size).where(
            CrowdReport.bar_id == bar_id,
            CrowdReport.created_at >= since,
            CrowdReport.created_at <= started_at,
            CrowdReport.line_size.is_not(None),
            CrowdReport.near_bar.is_(True),
            *([CrowdReport.user_id != exclude_user] if exclude_user is not None else []),
        )
    ).all()
    claims: dict[uuid.UUID, float] = {}
    for uid, size in [*staff_rows, *report_rows]:
        if uid is not None and size is not None:
            claims[uid] = float(people[size.value])  # latest claim per person is enough
    for uid, claimed in claims.items():
        reporter = db.get(User, uid)
        if reporter is not None:
            reporter.reliability = est.update_reliability(reporter.reliability, claimed, implied)


def submit_report(db: Session, user: User, bar: Bar, body: ReportCreate) -> ReportOut:
    now = live.utcnow()
    near, bucket = _distance(bar, body.location)
    r = CrowdReport(
        user_id=user.id,
        bar_id=bar.id,
        created_at=now,
        crowd_level=body.crowd_level,
        line_size=body.line_size,
        drink_wait=body.drink_wait,
        near_bar=near,
        distance_bucket=bucket,
    )
    db.add(r)
    # Reliability: compare a reported line size with a fresh staff reading, when there is one.
    if body.line_size is not None:
        staff = db.scalar(
            select(OutsideLineStatus.line_size)
            .where(
                OutsideLineStatus.bar_id == bar.id,
                OutsideLineStatus.ts >= now - timedelta(minutes=10),
            )
            .order_by(OutsideLineStatus.ts.desc())
            .limit(1)
        )
        if staff is not None:
            user.reliability = est.update_reliability(
                user.reliability,
                float(est.types.LINE_SIZE_PEOPLE[staff.value]),
                float(est.types.LINE_SIZE_PEOPLE[body.line_size.value]),
            )
    points = POINTS_REPORT if near else 0
    db.flush()
    if points:
        db.add(RewardLedger(user_id=user.id, points=points, reason="report", ref_id=r.id))
    db.commit()
    return ReportOut(
        id=r.id, bar_id=bar.id, near_bar=near, distance_bucket=bucket, points_awarded=points
    )


def _score_line_sources(db: Session, s: LineSession, actual_min: float) -> None:
    """Kept for the simulator. Production code calls score_line_sources."""
    score_line_sources(
        db, s.bar_id, s.started_at, s.entry_rate_at_start, actual_min, exclude_user=s.user_id
    )
