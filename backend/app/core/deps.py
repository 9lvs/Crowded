"""Request dependencies: current user, roles, staff bar scoping, client IP."""

from __future__ import annotations

import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.ratelimit import hit
from app.core.security import decode_access_token, pepper_hash
from app.db import get_db
from app.models import Bar, BarStaff, Role, User

bearer = HTTPBearer(auto_error=False)

DB = Annotated[Session, Depends(get_db)]


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
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


def staff_bar(bar_id: uuid.UUID, user: CurrentUser, db: DB) -> Bar:
    """Resolve a bar the caller is staff at. Admins may act on any bar.

    Returns 404 for both "no such bar" and "not your bar" so ids cannot be probed.
    """
    if user.role == Role.admin:
        bar = db.get(Bar, bar_id)
    elif user.role == Role.staff:
        bar = db.scalar(
            select(Bar)
            .join(BarStaff, BarStaff.bar_id == Bar.id)
            .where(BarStaff.user_id == user.id, Bar.id == bar_id)
        )
    else:
        bar = None
    if bar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    hit("staff_user", str(user.id))
    return bar


StaffBar = Annotated[Bar, Depends(staff_bar)]
