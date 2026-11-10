from __future__ import annotations

import uuid

from fastapi import APIRouter, status

from app.api.v1.bars import _active_bar
from app.core.deps import DB, CurrentUser
from app.core.ratelimit import hit
from app.schemas import (
    LineSessionEndIn,
    LineSessionOut,
    LineSessionStartIn,
    ReportCreate,
    ReportOut,
)
from app.services import activity as svc

router = APIRouter(tags=["activity"])


@router.post("/line-sessions", response_model=LineSessionOut, status_code=status.HTTP_201_CREATED)
def start_line_session(body: LineSessionStartIn, user: CurrentUser, db: DB) -> LineSessionOut:
    hit("line_user", str(user.id))
    bar = _active_bar(db, body.bar_id)
    return svc.start_session(db, user, bar, body.location)


@router.get("/line-sessions/active", response_model=LineSessionOut | None)
def get_active_session(user: CurrentUser, db: DB) -> LineSessionOut | None:
    s = svc.active_session(db, user)
    return svc.session_out(s) if s else None


@router.post("/line-sessions/{session_id}/end", response_model=LineSessionOut)
def end_line_session(
    session_id: uuid.UUID, body: LineSessionEndIn, user: CurrentUser, db: DB
) -> LineSessionOut:
    hit("line_end_user", str(user.id))
    return svc.end_session(db, user, session_id, body.outcome, body.door_code)


@router.post("/reports", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
def submit_report(body: ReportCreate, user: CurrentUser, db: DB) -> ReportOut:
    hit("report_user", str(user.id))
    hit("report_user_bar", f"{user.id}:{body.bar_id}")
    hit("report_bar", str(body.bar_id))
    bar = _active_bar(db, body.bar_id)
    return svc.submit_report(db, user, bar, body)
