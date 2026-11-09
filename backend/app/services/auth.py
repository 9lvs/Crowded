"""Passwordless auth: phone codes, Sign in with Apple, rotating refresh tokens."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import (
    constant_time_equals,
    create_access_token,
    new_login_code,
    new_opaque_token,
    pepper_hash,
    token_hash,
)
from app.core.sms import get_sms_sender
from app.models import BarStaff, Device, LoginCode, RefreshToken, User
from app.schemas import MeOut, RequestCodeOut, TokenPair

log = logging.getLogger("crowded.auth")

INVALID_CODE = HTTPException(status.HTTP_400_BAD_REQUEST, detail="invalid_code")
AGE_GATE = HTTPException(status.HTTP_403_FORBIDDEN, detail="age_gate")


def _now() -> datetime:
    return datetime.now(UTC)


def phone_hash(phone: str) -> str:
    return pepper_hash(phone, "phone")


def _code_hash(p_hash: str, code: str) -> str:
    return pepper_hash(f"{p_hash}:{code}", "login_code")


def me_out(db: Session, user: User) -> MeOut:
    staff_bar_id = db.scalar(select(BarStaff.bar_id).where(BarStaff.user_id == user.id))
    return MeOut(
        id=user.id,
        role=user.role,
        wait_threshold_min=user.wait_threshold_min,
        staff_bar_id=staff_bar_id,
        phone_hint=f"ending in {user.phone_last2}" if user.phone_last2 else None,
        created_at=user.created_at,
    )


def request_code(db: Session, phone: str) -> RequestCodeOut:
    s = get_settings()
    now = _now()
    p_hash = phone_hash(phone)
    locked = db.scalar(
        select(LoginCode.id).where(LoginCode.phone_hash == p_hash, LoginCode.locked_until > now)
    )
    if locked is not None:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="locked")
    # One live code per phone: invalidate older ones.
    db.execute(
        update(LoginCode)
        .where(LoginCode.phone_hash == p_hash, LoginCode.consumed_at.is_(None))
        .values(consumed_at=now)
    )
    code = new_login_code()
    db.add(
        LoginCode(
            phone_hash=p_hash,
            code_hash=_code_hash(p_hash, code),
            expires_at=now + timedelta(seconds=s.login_code_ttl_seconds),
        )
    )
    db.commit()
    get_sms_sender().send_code(phone, code)
    return RequestCodeOut(
        sent=True,
        expires_in=s.login_code_ttl_seconds,
        dev_code=code if s.is_dev else None,
    )


def verify_code(db: Session, phone: str, code: str, age_attested: bool, platform: str) -> TokenPair:
    s = get_settings()
    now = _now()
    p_hash = phone_hash(phone)
    row = db.scalar(
        select(LoginCode)
        .where(LoginCode.phone_hash == p_hash, LoginCode.consumed_at.is_(None))
        .order_by(LoginCode.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if row is None or row.expires_at <= now:
        raise INVALID_CODE
    if row.locked_until is not None and row.locked_until > now:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="locked")

    row.attempts += 1
    if not constant_time_equals(row.code_hash, _code_hash(p_hash, code)):
        if row.attempts >= s.login_code_max_attempts:
            row.locked_until = now + timedelta(seconds=s.login_code_lockout_seconds)
            log.warning("login code locked after max attempts")
        db.commit()
        raise INVALID_CODE

    user = db.scalar(select(User).where(User.phone_hash == p_hash))
    if user is None:
        if not age_attested:
            db.commit()  # keep the attempt count, leave the code usable
            raise AGE_GATE
        user = User(
            phone_hash=p_hash,
            phone_last2=phone[-2:],
            age_attested_at=now,
            wait_threshold_min=s.default_wait_threshold_min,
        )
        db.add(user)
        db.flush()
    row.consumed_at = now
    return issue_tokens(db, user, platform)


def apple_sign_in(db: Session, apple_sub: str, age_attested: bool, platform: str) -> TokenPair:
    s = get_settings()
    sub_hash = pepper_hash(apple_sub, "apple_sub")
    user = db.scalar(select(User).where(User.apple_sub_hash == sub_hash))
    if user is None:
        if not age_attested:
            raise AGE_GATE
        user = User(
            apple_sub_hash=sub_hash,
            age_attested_at=_now(),
            wait_threshold_min=s.default_wait_threshold_min,
        )
        db.add(user)
        db.flush()
    return issue_tokens(db, user, platform)


def _new_refresh(db: Session, user: User, device_id: uuid.UUID | None, family_id: uuid.UUID) -> str:
    s = get_settings()
    raw = new_opaque_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            device_id=device_id,
            family_id=family_id,
            token_hash=token_hash(raw),
            expires_at=_now() + timedelta(days=s.refresh_token_ttl_days),
        )
    )
    return raw


def _pair(db: Session, user: User, refresh: str) -> TokenPair:
    return TokenPair(
        access_token=create_access_token(user.id, user.role.value),
        refresh_token=refresh,
        expires_in=get_settings().access_token_ttl_seconds,
        user=me_out(db, user),
    )


def issue_tokens(db: Session, user: User, platform: str) -> TokenPair:
    device = Device(user_id=user.id, platform=platform)
    db.add(device)
    db.flush()
    refresh = _new_refresh(db, user, device.id, uuid.uuid4())
    db.commit()
    return _pair(db, user, refresh)


def _revoke_family(db: Session, family_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


def refresh(db: Session, raw: str) -> TokenPair:
    now = _now()
    row = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw)).with_for_update()
    )
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh")
    if row is None:
        raise unauthorized
    if row.revoked_at is not None or row.used_at is not None:
        # Reuse of a rotated token means it leaked. Kill the whole family.
        _revoke_family(db, row.family_id)
        db.commit()
        log.warning("refresh token reuse detected, family revoked")
        raise unauthorized
    if row.expires_at <= now:
        raise unauthorized
    user = db.get(User, row.user_id)
    if user is None:  # pragma: no cover - cascade delete removes tokens
        raise unauthorized
    row.used_at = now
    new_raw = _new_refresh(db, user, row.device_id, row.family_id)
    if row.device_id is not None:
        db.execute(update(Device).where(Device.id == row.device_id).values(last_seen_at=now))
    db.commit()
    return _pair(db, user, new_raw)


def logout(db: Session, raw: str) -> None:
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw)))
    if row is not None:
        _revoke_family(db, row.family_id)
        db.commit()


def delete_account(db: Session, user: User) -> None:
    """Hard delete. FK cascades remove devices, tokens, sessions, reports and rewards.

    Staff door events and audit rows keep the bar level facts but lose the user link.
    Estimate error rows never had a user link.
    """
    if user.phone_hash:
        db.execute(delete(LoginCode).where(LoginCode.phone_hash == user.phone_hash))
    db.execute(delete(User).where(User.id == user.id))
    db.commit()
