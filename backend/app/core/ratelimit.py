"""In-process sliding window rate limiter.

Good enough for a single instance pilot. Swap for Redis before running more than one replica
(see docs/DECISIONS.md D-008). Keys are already hashed or ids, never raw phones or IPs.
"""

from __future__ import annotations

import contextlib
import math
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_s: float, now: float | None = None) -> None:
        """Record a hit for key. Raise 429 if more than `limit` hits fall in the window."""
        now = time.monotonic() if now is None else now
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_s:
                q.popleft()
            if len(q) >= limit:
                retry = max(1, math.ceil(q[0] + window_s - now))
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="rate_limited",
                    headers={"Retry-After": str(retry)},
                )
            q.append(now)

    def count(self, key: str, window_s: float, now: float | None = None) -> int:
        """Hits in the window, without recording one."""
        now = time.monotonic() if now is None else now
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_s:
                q.popleft()
            return len(q)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()

# name: (limit, window seconds)
LIMITS: dict[str, tuple[int, float]] = {
    "code_request_phone": (3, 600),
    "code_request_ip": (60, 3600),  # campus wifi puts many students behind one IP
    "code_verify_ip": (30, 600),
    "apple_ip": (30, 600),
    "refresh_ip": (30, 600),
    "report_user": (6, 600),
    "report_user_bar": (2, 600),
    "report_bar": (300, 600),
    "line_user": (10, 3600),
    "staff_user": (240, 60),
    "admin_user": (120, 60),
    "read_user": (240, 60),
    "invite_redeem_user": (10, 3600),
    "door_code_user": (5, 3600),  # wrong door codes only, never raises to the caller
}


def hit(name: str, key: str) -> None:
    limit, window = LIMITS[name]
    limiter.check(f"{name}:{key}", limit, window)


def door_code_allowed(user_key: str) -> bool:
    """True while the user is under the wrong-code limit. Does not record a hit."""
    limit, window = LIMITS["door_code_user"]
    return limiter.count(f"door_code_user:{user_key}", window) < limit


def door_code_miss(user_key: str) -> None:
    """Record one wrong code. Over the limit is fine here, the caller just ignores codes."""
    limit, window = LIMITS["door_code_user"]
    with contextlib.suppress(HTTPException):
        limiter.check(f"door_code_user:{user_key}", limit, window)
