from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.audit import audit
from app.core.deps import DB, CurrentUser, StaffBar, ip_key
from app.core.ratelimit import hit
from app.core.security import normalize_invite_code, pepper_hash
from app.models import Bar, BarStaff, DoorDirection, DoorEvent, OutsideLineStatus, Role, StaffInvite
from app.schemas import (
    CountSyncIn,
    DoorCodeOut,
    DoorIn,
    LineSampleEndIn,
    LineSampleOut,
    LineSizeIn,
    MeOut,
    RedeemInviteIn,
    StaffState,
)
from app.services import auth as auth_svc
from app.services import door as door_svc
from app.services import live
from app.services import samples as samples_svc

router = APIRouter(prefix="/staff", tags=["staff"])

MAX_SYNC_DELTA = 5000  # matches the door_count_range CHECK for sync events


def invite_hash(code: str) -> str:
    return pepper_hash(normalize_invite_code(code), "staff_invite")


def staff_state(db: DB, bar: Bar) -> StaffState:
    now = live.utcnow()
    ins, outs = live.door_totals(db, bar, now)
    latest = db.execute(
        select(OutsideLineStatus.line_size, OutsideLineStatus.ts)
        .where(
            OutsideLineStatus.bar_id == bar.id, OutsideLineStatus.ts >= live.tonight_start(bar, now)
        )
        .order_by(OutsideLineStatus.ts.desc())
        .limit(1)
    ).first()
    return StaffState(
        bar_id=bar.id,
        bar_name=bar.name,
        capacity=bar.capacity,
        headcount=max(0, ins - outs),
        entries_tonight=ins,
        exits_tonight=outs,
        line_size=latest[0] if latest else None,
        line_updated_at=latest[1] if latest else None,
        live=live.live_out(live.compute(db, bar, now)),
    )


@router.post("/invites/redeem", response_model=MeOut)
def redeem_invite(body: RedeemInviteIn, request: Request, user: CurrentUser, db: DB) -> MeOut:
    hit("invite_redeem_user", str(user.id))
    if user.role == Role.admin:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="admins_cannot_be_staff")
    now = datetime.now(UTC)
    invite = db.scalar(
        select(StaffInvite).where(StaffInvite.code_hash == invite_hash(body.code)).with_for_update()
    )
    if (
        invite is None
        or invite.redeemed_at is not None
        or invite.revoked_at is not None
        or invite.expires_at <= now
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="invalid_invite")
    existing = db.scalar(select(BarStaff).where(BarStaff.user_id == user.id))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="already_staff")
    invite.redeemed_at = now
    invite.redeemed_by = user.id
    db.add(BarStaff(bar_id=invite.bar_id, user_id=user.id, invite_id=invite.id))
    user.role = Role.staff
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="already_staff") from None
    audit(
        db,
        user,
        "staff.invite_redeemed",
        target_type="invite",
        target_id=invite.id,
        bar_id=invite.bar_id,
        ip_hash=ip_key(request),
    )
    db.commit()
    return auth_svc.me_out(db, user)


@router.get("/bars/{bar_id}", response_model=StaffState)
def get_staff_state(bar: StaffBar, db: DB) -> StaffState:
    return staff_state(db, bar)


@router.post("/bars/{bar_id}/door", response_model=StaffState)
def door(body: DoorIn, bar: StaffBar, user: CurrentUser, request: Request, db: DB) -> StaffState:
    if body.direction.value == "out":
        ins, outs = live.door_totals(db, bar, live.utcnow())
        if ins - outs - body.count < 0:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="headcount_below_zero")
    db.add(
        DoorEvent(bar_id=bar.id, staff_user_id=user.id, direction=body.direction, count=body.count)
    )
    audit(
        db,
        user,
        f"door.{body.direction.value}",
        target_type="bar",
        target_id=bar.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details={"count": body.count},
    )
    db.commit()
    return staff_state(db, bar)


@router.post("/bars/{bar_id}/line", response_model=StaffState)
def line(
    body: LineSizeIn, bar: StaffBar, user: CurrentUser, request: Request, db: DB
) -> StaffState:
    db.add(OutsideLineStatus(bar_id=bar.id, staff_user_id=user.id, line_size=body.line_size))
    audit(
        db,
        user,
        "line.set",
        target_type="bar",
        target_id=bar.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details={"line_size": body.line_size.value},
    )
    db.commit()
    return staff_state(db, bar)


@router.post("/bars/{bar_id}/count-sync", response_model=StaffState)
def count_sync(
    body: CountSyncIn, bar: StaffBar, user: CurrentUser, request: Request, db: DB
) -> StaffState:
    """Set tonight's headcount from a clicker total. One event holds the difference."""
    # Lock the bar row so parallel syncs compute their difference one at a time.
    db.execute(select(Bar.id).where(Bar.id == bar.id).with_for_update())
    ins, outs = live.door_totals(db, bar, live.utcnow())
    delta = body.inside_now - (ins - outs)
    if abs(delta) > MAX_SYNC_DELTA:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="sync_too_large")
    if delta != 0:
        db.add(
            DoorEvent(
                bar_id=bar.id,
                staff_user_id=user.id,
                direction=DoorDirection.in_ if delta > 0 else DoorDirection.out,
                count=abs(delta),
                source="sync",
            )
        )
    audit(
        db,
        user,
        "door.count_sync",
        target_type="bar",
        target_id=bar.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details={"inside_now": body.inside_now, "delta": delta},
    )
    db.commit()
    return staff_state(db, bar)


@router.get("/bars/{bar_id}/door-code", response_model=DoorCodeOut)
def get_door_code(bar: StaffBar) -> DoorCodeOut:
    # Not audited on purpose. The staff screen reads this every few seconds.
    code, expires_in = door_svc.current_code(bar.id)
    return DoorCodeOut(code=code, expires_in=expires_in)


@router.post(
    "/bars/{bar_id}/line-samples",
    response_model=LineSampleOut,
    status_code=status.HTTP_201_CREATED,
)
def start_line_sample(bar: StaffBar, user: CurrentUser, request: Request, db: DB) -> LineSampleOut:
    sample = samples_svc.start_sample(db, user, bar)
    audit(
        db,
        user,
        "line_sample.start",
        target_type="line_sample",
        target_id=sample.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
    )
    db.commit()
    return samples_svc.sample_out(sample)


@router.get("/bars/{bar_id}/line-samples/active", response_model=list[LineSampleOut])
def list_active_line_samples(bar: StaffBar, db: DB) -> list[LineSampleOut]:
    return [samples_svc.sample_out(x) for x in samples_svc.active_samples(db, bar)]


@router.post("/bars/{bar_id}/line-samples/{sample_id}/end", response_model=LineSampleOut)
def end_line_sample(
    sample_id: uuid.UUID,
    body: LineSampleEndIn,
    bar: StaffBar,
    user: CurrentUser,
    request: Request,
    db: DB,
) -> LineSampleOut:
    sample = samples_svc.end_sample(db, bar, sample_id, body.outcome)
    audit(
        db,
        user,
        "line_sample.end",
        target_type="line_sample",
        target_id=sample.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details={"outcome": body.outcome, "status": sample.status.value},
    )
    db.commit()
    return samples_svc.sample_out(sample)
