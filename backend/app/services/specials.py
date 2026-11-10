"""Bar specials: pure "tonight" and "now" logic plus DB helpers.

A night runs from local noon to the next local noon (same boundary as services/live.py).
A special belongs to the night whose start date has a weekday listed in its days. Windows that
run past midnight belong to the night they start in. Specials that start before noon (lunch)
count toward that calendar day's night start date.
"""

from __future__ import annotations

import uuid
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Bar, BarSpecial, SpecialKind
from app.schemas import SpecialOut, SpecialTonight

NIGHT_START_HOUR = 12
MAX_SPECIALS_PER_BAR = 30


def parse_hhmm(v: str) -> time:
    return time(int(v[:2]), int(v[3:]))


def night_start_weekday(local_now: datetime) -> int:
    """Weekday (Monday=0) of the local date on which the current night started."""
    d = local_now.date()
    if local_now.hour < NIGHT_START_HOUR:
        d -= timedelta(days=1)
    return d.weekday()


def belongs_tonight(days: list[int], local_now: datetime) -> bool:
    return night_start_weekday(local_now) in days


def is_now(days: list[int], start_local: str, end_local: str, local_now: datetime) -> bool:
    """True if local_now is inside the window, including windows begun yesterday."""
    start_t, end_t = parse_hhmm(start_local), parse_hhmm(end_local)
    overnight = end_t <= start_t
    for back in (0, 1):
        day = local_now.date() - timedelta(days=back)
        if day.weekday() not in days:
            continue
        begin = datetime.combine(day, start_t, tzinfo=local_now.tzinfo)
        end = datetime.combine(day, end_t, tzinfo=local_now.tzinfo)
        if overnight:
            end += timedelta(days=1)
        if begin <= local_now < end:
            return True
    return False


def to_out(s: BarSpecial) -> SpecialOut:
    return SpecialOut(
        id=s.id,
        kind=s.kind,
        title=s.title,
        details=s.details,
        days=sorted(s.days),
        start_local=s.start_local,
        end_local=s.end_local,
        price_cents=s.price_cents,
        is_active=s.is_active,
        posted_by="admin" if s.posted_by_role == "admin" else "staff",
        updated_at=s.updated_at,
    )


def list_for_bar(db: Session, bar_id: uuid.UUID, active_only: bool = False) -> list[BarSpecial]:
    q = select(BarSpecial).where(BarSpecial.bar_id == bar_id)
    if active_only:
        q = q.where(BarSpecial.is_active.is_(True))
    rows = list(db.scalars(q).all())
    rows.sort(key=lambda s: (min(s.days), s.start_local, s.title))
    return rows


def week(db: Session, bar: Bar) -> list[SpecialOut]:
    return [to_out(s) for s in list_for_bar(db, bar.id, active_only=True)]


def tonight(
    db: Session, bar: Bar, now: datetime
) -> tuple[list[SpecialTonight], SpecialTonight | None]:
    local_now = now.astimezone(ZoneInfo(bar.timezone))
    items: list[SpecialTonight] = []
    for s in list_for_bar(db, bar.id, active_only=True):
        if not belongs_tonight(s.days, local_now):
            continue
        items.append(
            SpecialTonight(
                **to_out(s).model_dump(),
                is_now=is_now(s.days, s.start_local, s.end_local, local_now),
            )
        )
    items.sort(key=lambda s: (not s.is_now, s.start_local))
    cover = min(
        (s for s in items if s.kind == SpecialKind.cover),
        key=lambda s: s.start_local,
        default=None,
    )
    return items, cover
