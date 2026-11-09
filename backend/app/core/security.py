"""Hashing, codes and tokens."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.config import get_settings


def pepper_hash(value: str, purpose: str) -> str:
    """Keyed hash for identifiers we must look up but never store raw (phones, Apple subs)."""
    key = get_settings().hash_pepper.get_secret_value().encode()
    return hmac.new(key, f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def new_login_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def new_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def new_invite_code() -> str:
    # 10 chars from an unambiguous alphabet, grouped for reading at a door: ABCDE-FGHJK
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    raw = "".join(secrets.choice(alphabet) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


def normalize_invite_code(code: str) -> str:
    return code.strip().upper().replace(" ", "")


def create_access_token(user_id: uuid.UUID, role: str, now: datetime | None = None) -> str:
    s = get_settings()
    now = now or datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=s.access_token_ttl_seconds)).timestamp()),
        "iss": s.jwt_issuer,
        "aud": s.jwt_audience,
        "jti": uuid.uuid4().hex,
        "typ": "access",
    }
    return jwt.encode(payload, s.jwt_secret.get_secret_value(), algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    s = get_settings()
    claims: dict[str, Any] = jwt.decode(
        token,
        s.jwt_secret.get_secret_value(),
        algorithms=["HS256"],
        audience=s.jwt_audience,
        issuer=s.jwt_issuer,
        options={"require": ["exp", "iat", "nbf", "sub", "aud", "iss", "typ"]},
    )
    if claims.get("typ") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return claims


def mask_phone(phone: str) -> str:
    """For logs only. Never log the full number."""
    return f"***{phone[-2:]}" if len(phone) >= 2 else "***"
