"""Sign in with Apple identity token verification."""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Protocol

import jwt

from app.config import get_settings

APPLE_ISSUER = "https://appleid.apple.com"


class AppleVerifier(Protocol):
    def verify(self, identity_token: str) -> str:
        """Return the stable Apple user id (sub) or raise ValueError."""
        ...


class JwksAppleVerifier:
    def __init__(self, jwks_url: str, client_id: str) -> None:
        self._client = jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
        self._client_id = client_id

    def verify(self, identity_token: str) -> str:
        try:
            key = self._client.get_signing_key_from_jwt(identity_token)
            claims: dict[str, Any] = jwt.decode(
                identity_token,
                key.key,
                algorithms=["RS256"],
                audience=self._client_id,
                issuer=APPLE_ISSUER,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
        except jwt.PyJWTError as exc:
            raise ValueError("invalid apple token") from exc
        sub = claims.get("sub")
        if not isinstance(sub, str) or not sub:
            raise ValueError("invalid apple token")
        return sub


@lru_cache
def get_apple_verifier() -> AppleVerifier:
    s = get_settings()
    return JwksAppleVerifier(s.apple_jwks_url, s.apple_client_id)
