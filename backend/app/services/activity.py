"""Line timers, crowd reports, rewards and reliability updates."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import estimation as est
from app.core.location import bucket_for, haversine_m
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
from app.services import live

POINTS_TIMER = 10
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
    db.commit()
    return session_out(s)


def end_session(db: Session, user: User, session_id: uuid.UUID, outcome: str) -> LineSessionOut:
    s = db.get(LineSession, session_id)
    # Same 404 for "missing" and "not yours" (no object enumeration).
    if s is None or s.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    if s.status != SessionStatus.active:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="session_not_active")
    now = live.utcnow()
    s.ended_at = now
    actual = (now - s.started_at).total_seconds() / 60
    points = 0
    if outcome == "inside" and MIN_VALID_WAIT_MIN <= actual <= MAX_VALID_WAIT_MIN:
        s.status = SessionStatus.completed
        s.actual_wait_min = actual
        if s.predicted_wait_min is not None:
            db.add(
                EstimateError(
                    bar_id=s.bar_id,
                    created_at=now,
                    predicted_min=s.predicted_wait_min,
                    formula_min=s.formula_wait_min,
                    actual_min=actual,
                    abs_error_min=abs(s.predicted_wait_min - actual),
                )
            )
            if s.near_bar:
                user.reliability = est.update_reliability(
                    user.reliability, s.predicted_wait_min, actual
                )
        if s.near_bar:
            points = POINTS_TIMER
            _score_line_sources(db, s, actual)
    else:
        s.status = SessionStatus.abandoned
    if points:
        db.add(RewardLedger(user_id=user.id, points=points, reason="timer", ref_id=s.id))
    db.commit()
    return session_out(s, points)


LINE_SCORE_LOOKBACK = timedelta(minutes=10)


def _score_line_sources(db: Session, s: LineSession, actual_min: float) -> None:
    """Use a finished timer as ground truth for the line reports made when it started.

    people really in line ~= actual wait x entry rate at the start. Every staff line reading and
    student line report made just before the timer started is scored against that, and the
    reporter's reliability moves toward how close they were. One honest timer referees both.
    """
    if not s.entry_rate_at_start:
        return
    implied = actual_min * s.entry_rate_at_start
    since = s.started_at - LINE_SCORE_LOOKBACK
    people = est.types.LINE_SIZE_PEOPLE
    staff_rows = db.execute(
        select(OutsideLineStatus.staff_user_id, OutsideLineStatus.line_size).where(
            OutsideLineStatus.bar_id == s.bar_id,
            OutsideLineStatus.ts >= since,
            OutsideLineStatus.ts <= s.started_at,
            OutsideLineStatus.staff_user_id.is_not(None),
        )
    ).all()
    report_rows = db.execute(
        select(CrowdReport.user_id, CrowdReport.line_size).where(
            CrowdReport.bar_id == s.bar_id,
            CrowdReport.created_at >= since,
            CrowdReport.created_at <= s.started_at,
            CrowdReport.line_size.is_not(None),
            CrowdReport.near_bar.is_(True),
            CrowdReport.user_id != s.user_id,
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
