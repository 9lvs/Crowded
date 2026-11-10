from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.deps import DB, CurrentUser
from app.schemas import MeOut, MeUpdate
from app.services import auth as svc

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=MeOut)
def read_me(user: CurrentUser, db: DB) -> MeOut:
    return svc.me_out(db, user)


@router.patch("", response_model=MeOut)
def update_me(body: MeUpdate, user: CurrentUser, db: DB) -> MeOut:
    user.wait_threshold_min = body.wait_threshold_min
    db.commit()
    return svc.me_out(db, user)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(user: CurrentUser, db: DB) -> Response:
    svc.delete_account(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
