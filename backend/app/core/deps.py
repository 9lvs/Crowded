"""Request dependencies: current user, roles, staff bar scoping, client IP."""

from __future__ import annotations

import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.ratelimit import hit
from app.core.security import decode_access_token, pepper_hash
from app.db import get_db
from app.models import Bar, BarStaff, Role, StaffLevel, User

bearer = HTTPBearer(auto_error=False)

DB = Annotated[Session, Depends(get_db)]


def client_ip(request: Request) -> str:
    """Peer address as resolved by uvicorn.

    There is exactly one trust layer for X-Forwarded-For: uvicorn's --forwarded-allow-ips
    (env FORWARDED_ALLOW_IPS), set to the reverse proxy's address at deploy time. The app never
    parses the header itself, so clients cannot spoof their IP (finding M-3).
    """
    return request.client.host if request.client else "unknown"


def ip_key(request: Request) -> str:
    return pepper_hash(client_ip(request), "ip")[:32]


def _unauthorized() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail="not_authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def current_user(
    db: DB,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise _unauthorized()
    try:
        claims = decode_access_token(creds.credentials)
        user_id = uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise _unauthorized() from None
    user = db.get(User, user_id)
    if user is None:
        raise _unauthorized()
    hit("read_user", str(user.id))
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="forbidden")
    hit("admin_user", str(user.id))
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def _resolve_bar(bar_id: uuid.UUID, user: User, db: Session) -> tuple[Bar, StaffLevel | None]:
    """The bar and the caller's staff level there. Admins may act on any bar (level None).

    Returns 404 for both "no such bar" and "not your bar" so ids cannot be probed.
    """
    level: StaffLevel | None = None
    if user.role == Role.admin:
        bar = db.get(Bar, bar_id)
    elif user.role == Role.staff:
        row = db.execute(
            select(Bar, BarStaff.level)
            .join(BarStaff, BarStaff.bar_id == Bar.id)
            .where(BarStaff.user_id == user.id, Bar.id == bar_id)
        ).first()
        bar, level = (row[0], row[1]) if row else (None, None)
    else:
        bar = None
    if bar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    hit("staff_user", str(user.id))
    return bar, level


def staff_bar(bar_id: uuid.UUID, user: CurrentUser, db: DB) -> Bar:
    """Resolve a bar the caller is staff at (any level). Admins may act on any bar."""
    return _resolve_bar(bar_id, user, db)[0]


StaffBar = Annotated[Bar, Depends(staff_bar)]


def manager_bar(bar_id: uuid.UUID, user: CurrentUser, db: DB) -> Bar:
    """Like staff_bar, but door level staff get 403 manager_only. Admins pass."""
    bar, level = _resolve_bar(bar_id, user, db)
    if user.role == Role.staff and level != StaffLevel.manager:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="manager_only")
    return bar


ManagerBar = Annotated[Bar, Depends(manager_bar)]
