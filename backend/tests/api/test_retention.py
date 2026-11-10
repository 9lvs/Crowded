from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Bar, CrowdLevel, CrowdReport, DrinkWait, InsideStatus
from scripts.retention import purge


def test_retention_deletes_old_raw_reports(client: TestClient, db: Session, user, bar: Bar) -> None:
    for _ in range(2):
        client.post(
            "/v1/reports", json={"bar_id": str(bar.id), "crowd_level": "busy"}, headers=user.h
        )
    old = db.scalars(select(CrowdReport)).first()
    assert old is not None
    old.created_at = datetime.now(UTC) - timedelta(days=31)
    db.commit()
    counts = purge(db, datetime.now(UTC), 30)
    assert counts["crowd_reports"] == 1
    assert db.scalar(select(func.count()).select_from(CrowdReport)) == 1


def test_retention_deletes_old_inside_status(db: Session, bar: Bar) -> None:
    now = datetime.now(UTC)
    db.add(InsideStatus(bar_id=bar.id, ts=now - timedelta(days=31), drink_wait=DrinkWait.under_5))
    db.add(InsideStatus(bar_id=bar.id, ts=now - timedelta(days=1), crowd_level=CrowdLevel.busy))
    db.commit()
    assert purge(db, now, 30)["inside_status"] == 1
    assert db.scalar(select(func.count()).select_from(InsideStatus)) == 1
