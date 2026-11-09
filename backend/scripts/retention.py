"""Delete raw per-user data past the retention window. Run daily (cron or a scheduler).

Aggregates (bar_snapshots, estimate_errors) carry no user ids and are kept for 365 days.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import (
    AuditLog,
    BarSnapshot,
    CrowdReport,
    DoorEvent,
    EstimateError,
    LineSession,
    LoginCode,
    OutsideLineStatus,
    RefreshToken,
    SessionStatus,
)

AGGREGATE_DAYS = 365
AUDIT_DAYS = 365


def purge(db: Session, now: datetime, raw_days: int) -> dict[str, int]:
    raw_cut = now - timedelta(days=raw_days)
    agg_cut = now - timedelta(days=AGGREGATE_DAYS)
    jobs = {
        "crowd_reports": delete(CrowdReport).where(CrowdReport.created_at < raw_cut),
        "line_sessions": delete(LineSession).where(
            LineSession.started_at < raw_cut, LineSession.status != SessionStatus.active
        ),
        "door_events": delete(DoorEvent).where(DoorEvent.ts < raw_cut),
        "outside_line_status": delete(OutsideLineStatus).where(OutsideLineStatus.ts < raw_cut),
        "login_codes": delete(LoginCode).where(LoginCode.created_at < now - timedelta(days=1)),
        "refresh_tokens": delete(RefreshToken).where(RefreshToken.expires_at < now),
        "bar_snapshots": delete(BarSnapshot).where(BarSnapshot.ts < agg_cut),
        "estimate_errors": delete(EstimateError).where(EstimateError.created_at < agg_cut),
        "audit_log": delete(AuditLog).where(AuditLog.ts < now - timedelta(days=AUDIT_DAYS)),
    }
    counts = {name: int(db.execute(stmt).rowcount or 0) for name, stmt in jobs.items()}  # type: ignore[attr-defined]
    db.commit()
    return counts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=get_settings().raw_retention_days)
    args = ap.parse_args()
    with get_sessionmaker()() as db:
        for name, n in purge(db, datetime.now(UTC), args.days).items():
            print(f"{name}: deleted {n}")


if __name__ == "__main__":
    main()
