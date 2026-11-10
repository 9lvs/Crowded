"""Rotating door code. Staff read it off their screen, a student types it to verify a timer.

code = HMAC(pepper, "door:{bar_id}:{bucket}") mod 10000, with a new bucket every 2 minutes.
The current and the previous bucket are accepted. Nothing is stored.
"""

from __future__ import annotations

import time
import uuid

from app.core.security import constant_time_equals, pepper_hash

BUCKET_SECONDS = 120


def _bucket(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // BUCKET_SECONDS)


def _code_for(bar_id: uuid.UUID, bucket: int) -> str:
    digest = pepper_hash(f"{bar_id}:{bucket}", "door")
    return f"{int(digest, 16) % 10000:04d}"


def current_code(bar_id: uuid.UUID, now: float | None = None) -> tuple[str, int]:
    """The code to show and the seconds until it changes."""
    t = time.time() if now is None else now
    bucket = _bucket(t)
    expires_in = max(1, int((bucket + 1) * BUCKET_SECONDS - t))
    return _code_for(bar_id, bucket), expires_in


def code_matches(bar_id: uuid.UUID, code: str, now: float | None = None) -> bool:
    bucket = _bucket(now)
    ok = False
    for b in (bucket, bucket - 1):  # check both so timing does not leak which one matched
        ok |= constant_time_equals(code, _code_for(bar_id, b))
    return ok
