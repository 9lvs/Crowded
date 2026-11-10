from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import DB, CurrentUser
from app.models import Bar
from app.schemas import BarDetail, BarSummary, SnapshotOut
from app.services import live

router = APIRouter(prefix="/bars", tags=["bars"])


def _active_bar(db: DB, bar_id: uuid.UUID) -> Bar:
    bar = db.get(Bar, bar_id)
    if bar is None or not bar.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    return bar


@router.get("", response_model=list[BarSummary])
def list_bars(user: CurrentUser, db: DB) -> list[BarSummary]:
    bars = db.scalars(select(Bar).where(Bar.is_active.is_(True)).order_by(Bar.name)).all()
    now = live.utcnow()
    return [live.bar_summary(db, b, user, now) for b in bars]


@router.get("/{bar_id}", response_model=BarDetail)
def get_bar(bar_id: uuid.UUID, user: CurrentUser, db: DB) -> BarDetail:
    return live.bar_detail(db, _active_bar(db, bar_id), user)


@router.get("/{bar_id}/snapshots", response_model=list[SnapshotOut])
def bar_snapshots(
    bar_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    hours: Annotated[int, Query(ge=1, le=24)] = 6,
) -> list[SnapshotOut]:
    return live.snapshots(db, _active_bar(db, bar_id), hours)
