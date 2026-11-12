from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.v1.staff import invite_hash
from app.core.audit import audit
from app.core.deps import DB, AdminUser, ip_key
from app.core.security import new_invite_code
from app.models import AuditLog, Bar, BarStaff, EstimateError, PassPrice, Role, StaffInvite, User
from app.schemas import (
    AccuracyOut,
    AuditOut,
    BarAdminOut,
    BarCreate,
    BarUpdate,
    InviteCreate,
    InviteOut,
    PassPriceIn,
    PassPriceOut,
    StaffMemberOut,
)

router = APIRouter(prefix="/admin", tags=["admin"])
INVITE_TTL = timedelta(days=3)


def _bar(db: DB, bar_id: uuid.UUID) -> Bar:
    bar = db.get(Bar, bar_id)
    if bar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    return bar


def _out(bar: Bar) -> BarAdminOut:
    return BarAdminOut.model_validate(bar, from_attributes=True)


@router.get("/bars", response_model=list[BarAdminOut])
def list_bars(admin: AdminUser, db: DB) -> list[BarAdminOut]:
    return [_out(b) for b in db.scalars(select(Bar).order_by(Bar.name)).all()]


@router.post("/bars", response_model=BarAdminOut, status_code=status.HTTP_201_CREATED)
def create_bar(body: BarCreate, admin: AdminUser, request: Request, db: DB) -> BarAdminOut:
    bar = Bar(**body.model_dump())
    db.add(bar)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="slug_taken") from None
    audit(
        db,
        admin,
        "bar.create",
        target_type="bar",
        target_id=bar.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details={"slug": bar.slug},
    )
    db.commit()
    return _out(bar)


@router.patch("/bars/{bar_id}", response_model=BarAdminOut)
def update_bar(
    bar_id: uuid.UUID, body: BarUpdate, admin: AdminUser, request: Request, db: DB
) -> BarAdminOut:
    bar = _bar(db, bar_id)
    changes = body.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(bar, k, v)
    audit(
        db,
        admin,
        "bar.update",
        target_type="bar",
        target_id=bar.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details=changes,
    )
    db.commit()
    return _out(bar)


@router.put("/bars/{bar_id}/pass-price", response_model=PassPriceOut)
def set_pass_price(
    bar_id: uuid.UUID, body: PassPriceIn, admin: AdminUser, request: Request, db: DB
) -> PassPriceOut:
    bar = _bar(db, bar_id)
    row = PassPrice(bar_id=bar.id, price_cents=body.price_cents, set_by=admin.id)
    db.add(row)
    audit(
        db,
        admin,
        "pass_price.set",
        target_type="bar",
        target_id=bar.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details={"price_cents": body.price_cents},
    )
    db.commit()
    return PassPriceOut(
        bar_id=bar.id, price_cents=row.price_cents, currency=row.currency, created_at=row.created_at
    )


@router.post(
    "/bars/{bar_id}/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED
)
def create_invite(
    bar_id: uuid.UUID,
    admin: AdminUser,
    request: Request,
    db: DB,
    body: InviteCreate | None = None,
) -> InviteOut:
    bar = _bar(db, bar_id)
    level = (body or InviteCreate()).level
    code = new_invite_code()
    inv = StaffInvite(
        bar_id=bar.id,
        level=level,
        code_hash=invite_hash(code),
        created_by=admin.id,
        expires_at=datetime.now(UTC) + INVITE_TTL,
    )
    db.add(inv)
    db.flush()
    audit(
        db,
        admin,
        "invite.create",
        target_type="invite",
        target_id=inv.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details={"level": level.value},
    )
    db.commit()
    return InviteOut(id=inv.id, bar_id=bar.id, level=level, code=code, expires_at=inv.expires_at)


@router.get("/bars/{bar_id}/staff", response_model=list[StaffMemberOut])
def list_staff(bar_id: uuid.UUID, admin: AdminUser, db: DB) -> list[StaffMemberOut]:
    bar = _bar(db, bar_id)
    rows = db.execute(
        select(BarStaff, User.phone_last2)
        .join(User, User.id == BarStaff.user_id)
        .where(BarStaff.bar_id == bar.id)
        .order_by(BarStaff.created_at)
    ).all()
    return [
        StaffMemberOut(
            user_id=m.user_id,
            bar_id=m.bar_id,
            level=m.level,
            phone_hint=f"ending in {last2}" if last2 else None,
            created_at=m.created_at,
        )
        for m, last2 in rows
    ]


@router.delete("/bars/{bar_id}/staff/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_staff(
    bar_id: uuid.UUID, user_id: uuid.UUID, admin: AdminUser, request: Request, db: DB
) -> Response:
    member = db.scalar(
        select(BarStaff).where(BarStaff.bar_id == bar_id, BarStaff.user_id == user_id)
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    user = db.get(User, user_id)
    db.delete(member)
    if user is not None and user.role == Role.staff:
        user.role = Role.user
    audit(
        db,
        admin,
        "staff.remove",
        target_type="user",
        target_id=user_id,
        bar_id=bar_id,
        ip_hash=ip_key(request),
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/invites/{invite_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(invite_id: uuid.UUID, admin: AdminUser, request: Request, db: DB) -> Response:
    inv = db.get(StaffInvite, invite_id)
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    if inv.revoked_at is None and inv.redeemed_at is None:
        inv.revoked_at = datetime.now(UTC)
    audit(
        db,
        admin,
        "invite.revoke",
        target_type="invite",
        target_id=inv.id,
        bar_id=inv.bar_id,
        ip_hash=ip_key(request),
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/metrics/accuracy", response_model=list[AccuracyOut])
def accuracy(
    admin: AdminUser, db: DB, days: Annotated[int, Query(ge=1, le=90)] = 30
) -> list[AccuracyOut]:
    since = datetime.now(UTC) - timedelta(days=days)
    rows = db.execute(
        select(
            Bar.id,
            Bar.name,
            func.count(EstimateError.id),
            func.avg(EstimateError.abs_error_min),
            func.avg(EstimateError.predicted_min - EstimateError.actual_min),
        )
        .select_from(Bar)
        .join(
            EstimateError,
            (EstimateError.bar_id == Bar.id) & (EstimateError.created_at >= since),
            isouter=True,
        )
        .group_by(Bar.id, Bar.name)
        .order_by(Bar.name)
    ).all()
    return [
        AccuracyOut(
            bar_id=bid,
            bar_name=name,
            samples=int(n),
            mean_abs_error_min=None if mae is None else round(float(mae), 2),
            mean_bias_min=None if bias is None else round(float(bias), 2),
        )
        for bid, name, n, mae, bias in rows
    ]


@router.get("/audit", response_model=list[AuditOut])
def audit_log(
    admin: AdminUser, db: DB, limit: Annotated[int, Query(ge=1, le=500)] = 100
) -> list[AuditOut]:
    rows = db.scalars(select(AuditLog).order_by(AuditLog.ts.desc()).limit(limit)).all()
    return [AuditOut.model_validate(r, from_attributes=True) for r in rows]
