"""Bar specials, happy hours, cover and events. Posted by the bar (staff or admin) only."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select

from app.core.audit import audit
from app.core.deps import DB, AdminUser, CurrentUser, StaffBar, ip_key
from app.models import Bar, BarSpecial, Role, User
from app.schemas import ALL_DAY_END, ALL_DAY_START, SpecialIn, SpecialOut, SpecialUpdate
from app.services import specials as svc

staff_router = APIRouter(prefix="/staff", tags=["staff"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])

UNPROCESSABLE = 422


def _get(db: DB, bar: Bar, special_id: uuid.UUID) -> BarSpecial:
    row = db.get(BarSpecial, special_id)
    if row is None or row.bar_id != bar.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    return row


def _list(db: DB, bar: Bar) -> list[SpecialOut]:
    return [svc.to_out(s) for s in svc.list_for_bar(db, bar.id)]


def _create(db: DB, bar: Bar, actor: User, request: Request, body: SpecialIn) -> SpecialOut:
    count = db.scalar(
        select(func.count()).select_from(BarSpecial).where(BarSpecial.bar_id == bar.id)
    )
    if (count or 0) >= svc.MAX_SPECIALS_PER_BAR:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="too_many_specials")
    row = BarSpecial(
        bar_id=bar.id,
        created_by=actor.id,
        posted_by_role="admin" if actor.role == Role.admin else "staff",
        **{
            **body.model_dump(exclude={"items"}),
            "items": body.model_dump(mode="json", include={"items"})["items"],
        },
    )
    db.add(row)
    db.flush()
    audit(
        db,
        actor,
        "specials.create",
        target_type="special",
        target_id=row.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details={"kind": row.kind.value},
    )
    db.commit()
    db.refresh(row)
    return svc.to_out(row)


def _update(
    db: DB, bar: Bar, actor: User, request: Request, special_id: uuid.UUID, body: SpecialUpdate
) -> SpecialOut:
    row = _get(db, bar, special_id)
    changes = body.model_dump(exclude_unset=True)
    for field in ("kind", "title", "days", "start_local", "end_local", "is_active"):
        if field in changes and changes[field] is None:
            raise HTTPException(UNPROCESSABLE, detail=f"{field}_required")
    if "details" in changes and changes["details"] is None:
        changes["details"] = ""
    for field in ("all_day", "items"):
        if field in changes and changes[field] is None:
            raise HTTPException(UNPROCESSABLE, detail=f"{field}_required")
    if "items" in changes:
        changes["items"] = body.model_dump(mode="json", include={"items"})["items"]
    all_day = changes.get("all_day", row.all_day)
    if all_day:
        changes["start_local"] = ALL_DAY_START
        changes["end_local"] = ALL_DAY_END
    elif changes.get("all_day") is False and not (
        changes.get("start_local") and changes.get("end_local")
    ):
        raise HTTPException(UNPROCESSABLE, detail="times_required")
    # An explicit null price clears it ("price_cents" stays in changes as None).
    if changes.get("start_local", row.start_local) == changes.get("end_local", row.end_local):
        raise HTTPException(UNPROCESSABLE, detail="start_equals_end")
    for k, v in changes.items():
        setattr(row, k, v)
    audit(
        db,
        actor,
        "specials.update",
        target_type="special",
        target_id=row.id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
        details={"fields": sorted(changes)},
    )
    db.commit()
    db.refresh(row)
    return svc.to_out(row)


def _delete(db: DB, bar: Bar, actor: User, request: Request, special_id: uuid.UUID) -> Response:
    row = _get(db, bar, special_id)
    db.delete(row)
    audit(
        db,
        actor,
        "specials.delete",
        target_type="special",
        target_id=special_id,
        bar_id=bar.id,
        ip_hash=ip_key(request),
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _admin_bar(db: DB, bar_id: uuid.UUID) -> Bar:
    bar = db.get(Bar, bar_id)
    if bar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    return bar


# ---------- staff ----------


@staff_router.get("/bars/{bar_id}/specials", response_model=list[SpecialOut])
def staff_list(bar: StaffBar, db: DB) -> list[SpecialOut]:
    return _list(db, bar)


@staff_router.post(
    "/bars/{bar_id}/specials", response_model=SpecialOut, status_code=status.HTTP_201_CREATED
)
def staff_create(
    body: SpecialIn, bar: StaffBar, user: CurrentUser, request: Request, db: DB
) -> SpecialOut:
    return _create(db, bar, user, request, body)


@staff_router.patch("/bars/{bar_id}/specials/{special_id}", response_model=SpecialOut)
def staff_update(
    special_id: uuid.UUID,
    body: SpecialUpdate,
    bar: StaffBar,
    user: CurrentUser,
    request: Request,
    db: DB,
) -> SpecialOut:
    return _update(db, bar, user, request, special_id, body)


@staff_router.delete("/bars/{bar_id}/specials/{special_id}", status_code=204)
def staff_delete(
    special_id: uuid.UUID, bar: StaffBar, user: CurrentUser, request: Request, db: DB
) -> Response:
    return _delete(db, bar, user, request, special_id)


# ---------- admin ----------


@admin_router.get("/bars/{bar_id}/specials", response_model=list[SpecialOut])
def admin_list(bar_id: uuid.UUID, admin: AdminUser, db: DB) -> list[SpecialOut]:
    return _list(db, _admin_bar(db, bar_id))


@admin_router.post(
    "/bars/{bar_id}/specials", response_model=SpecialOut, status_code=status.HTTP_201_CREATED
)
def admin_create(
    bar_id: uuid.UUID, body: SpecialIn, admin: AdminUser, request: Request, db: DB
) -> SpecialOut:
    return _create(db, _admin_bar(db, bar_id), admin, request, body)


@admin_router.patch("/bars/{bar_id}/specials/{special_id}", response_model=SpecialOut)
def admin_update(
    bar_id: uuid.UUID,
    special_id: uuid.UUID,
    body: SpecialUpdate,
    admin: AdminUser,
    request: Request,
    db: DB,
) -> SpecialOut:
    return _update(db, _admin_bar(db, bar_id), admin, request, special_id, body)


@admin_router.delete("/bars/{bar_id}/specials/{special_id}", status_code=204)
def admin_delete(
    bar_id: uuid.UUID, special_id: uuid.UUID, admin: AdminUser, request: Request, db: DB
) -> Response:
    return _delete(db, _admin_bar(db, bar_id), admin, request, special_id)
