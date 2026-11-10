"""Staff line samples. A door staff member times one real person from the back to the door."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Bar, LineSample, SessionStatus, User
from app.schemas import LineSampleOut
from app.services import activity, live

MAX_ACTIVE_SAMPLES = 2


def sample_out(s: LineSample) -> LineSampleOut:
    actual = None
    if s.status == SessionStatus.completed and s.ended_at is not None:
        actual = round((s.ended_at - s.started_at).total_seconds() / 60, 1)
    return LineSampleOut(
        id=s.id,
        bar_id=s.bar_id,
        status=s.status,
        started_at=s.started_at,
        ended_at=s.ended_at,
        predicted_wait_min=None if s.predicted_wait_min is None else round(s.predicted_wait_min),
        actual_wait_min=actual,
    )


def expire_stale(db: Session, bar_id: uuid.UUID, now: datetime) -> None:
    """Samples older than 3 h count as abandoned when read."""
    stale = db.scalars(
        select(LineSample).where(
            LineSample.bar_id == bar_id,
            LineSample.status == SessionStatus.active,
            LineSample.started_at < now - live.SAMPLE_ACTIVE_MAX,
        )
    ).all()
    for s in stale:
        s.status = SessionStatus.abandoned
        s.ended_at = now
    if stale:
        db.commit()


def active_samples(db: Session, bar: Bar) -> list[LineSample]:
    expire_stale(db, bar.id, live.utcnow())
    return list(
        db.scalars(
            select(LineSample)
            .where(LineSample.bar_id == bar.id, LineSample.status == SessionStatus.active)
            .order_by(LineSample.started_at.asc())
        ).all()
    )


def start_sample(db: Session, user: User, bar: Bar) -> LineSample:
    now = live.utcnow()
    # Lock the bar row so two taps at once cannot both slip under the limit.
    db.execute(select(Bar.id).where(Bar.id == bar.id).with_for_update())
    if len(active_samples(db, bar)) >= MAX_ACTIVE_SAMPLES:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="too_many_active_samples")
    current = live.compute(db, bar, now)
    s = LineSample(
        bar_id=bar.id,
        staff_user_id=user.id,
        started_at=now,
        predicted_wait_min=current.estimate.wait_min,
        formula_wait_min=live.raw_formula_wait(current.estimate),
        entry_rate_at_start=current.estimate.entry_rate_per_min,
    )
    db.add(s)
    db.commit()
    return s


def end_sample(db: Session, bar: Bar, sample_id: uuid.UUID, outcome: str) -> LineSample:
    s = db.get(LineSample, sample_id)
    # Same 404 for "missing" and "another bar's sample".
    if s is None or s.bar_id != bar.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    now = live.utcnow()
    expire_stale(db, bar.id, now)
    db.refresh(s)
    if s.status != SessionStatus.active:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="sample_not_active")
    s.ended_at = now
    actual = (now - s.started_at).total_seconds() / 60
    if outcome == "inside" and activity.MIN_VALID_WAIT_MIN <= actual <= activity.MAX_VALID_WAIT_MIN:
        s.status = SessionStatus.completed
        if s.predicted_wait_min is not None:
            activity.record_error(
                db, s.bar_id, now, s.predicted_wait_min, s.formula_wait_min, actual
            )
        activity.score_line_sources(db, s.bar_id, s.started_at, s.entry_rate_at_start, actual)
    else:
        s.status = SessionStatus.abandoned
    db.commit()
    return s
