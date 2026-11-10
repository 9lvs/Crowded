"""SMS provider interface. Only a dev stub exists. Ask the owner before adding a real one."""

from __future__ import annotations

import logging
from typing import Protocol

from app.config import get_settings
from app.core.security import mask_phone

log = logging.getLogger("crowded.sms")


class SmsSender(Protocol):
    def send_code(self, phone: str, code: str) -> None: ...


class StubSmsSender:
    """Dev only. Does not send anything. The code is returned to the client in dev builds."""

    def send_code(self, phone: str, code: str) -> None:
        log.info("stub sms: login code issued for %s", mask_phone(phone))


def get_sms_sender() -> SmsSender:
    s = get_settings()
    if s.sms_provider == "stub":
        if not s.is_dev:
            raise RuntimeError("stub SMS provider is not allowed outside dev and test")
        return StubSmsSender()
    raise RuntimeError(f"unknown sms provider {s.sms_provider}")  # pragma: no cover
