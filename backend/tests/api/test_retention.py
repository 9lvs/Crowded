from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Bar, CrowdReport
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
