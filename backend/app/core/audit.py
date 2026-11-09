"""Audit log for staff and admin actions."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, User


def audit(
    db: Session,
    actor: User,
    action: str,
    *,
    target_type: str = "",
    target_id: str | uuid.UUID = "",
    bar_id: uuid.UUID | None = None,
    ip_hash: str = "",
    details: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            actor_role=actor.role.value,
            action=action,
            target_type=target_type,
            target_id=str(target_id),
            bar_id=bar_id,
            ip_hash=ip_hash,
            details=details or {},
        )
    )
