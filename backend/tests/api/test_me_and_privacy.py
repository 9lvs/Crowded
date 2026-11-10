from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session

from app.models import Bar, CrowdReport, Device, LineSession, RefreshToken, RewardLedger, User
from tests.api.conftest import login


def test_threshold_update_and_bounds(client: TestClient, user) -> None:
    assert client.get("/v1/me", headers=user.h).json()["wait_threshold_min"] == 20
    r = client.patch("/v1/me", json={"wait_threshold_min": 35}, headers=user.h)
    assert r.json()["wait_threshold_min"] == 35
    assert client.patch("/v1/me", json={"wait_threshold_min": 2}, headers=user.h).status_code == 422
    r = client.patch("/v1/me", json={"wait_threshold_min": 30, "role": "admin"}, headers=user.h)
    assert r.status_code == 422  # extra fields forbidden, no mass assignment


def test_delete_account_really_deletes(client: TestClient, db: Session, bar: Bar) -> None:
    a = login(client)
    loc = {"latitude": bar.latitude, "longitude": bar.longitude}
    client.post(
        "/v1/reports",
        json={"bar_id": str(bar.id), "crowd_level": "busy", "location": loc},
        headers=a.h,
    )
    s = client.post("/v1/line-sessions", json={"bar_id": str(bar.id), "location": loc}, headers=a.h)
    assert s.status_code == 201
    assert client.delete("/v1/me", headers=a.h).status_code == 204
    uid = uuid.UUID(a.user_id)
    for model in (User, Device, RefreshToken, LineSession, CrowdReport, RewardLedger):
        col = model.id if model is User else model.user_id
        assert db.scalar(select(func.count()).select_from(model).where(col == uid)) == 0
    assert client.get("/v1/me", headers=a.h).status_code == 401
    assert client.post("/v1/auth/refresh", json={"refresh_token": a.refresh}).status_code == 401


def test_no_coordinates_columns_on_user_data() -> None:
    for model in (CrowdReport, LineSession, User):
        cols = {c.key for c in inspect(model).columns}
        assert not cols & {"latitude", "longitude", "lat", "lng", "location"}, model
        assert not cols & {"phone", "phone_number", "dob", "birth_date", "date_of_birth"}


def test_report_location_reduced_to_bucket(client: TestClient, db: Session, user, bar: Bar) -> None:
    near = {"latitude": bar.latitude + 0.0003, "longitude": bar.longitude}  # about 33 m
    far = {"latitude": bar.latitude + 0.05, "longitude": bar.longitude}  # about 5.5 km
    r1 = client.post(
        "/v1/reports",
        json={"bar_id": str(bar.id), "crowd_level": "busy", "location": near},
        headers=user.h,
    )
    assert r1.json()["near_bar"] is True and r1.json()["distance_bucket"] == "at_door"
    assert r1.json()["points_awarded"] == 2
    r2 = client.post(
        "/v1/reports",
        json={"bar_id": str(bar.id), "line_size": "short", "location": far},
        headers=user.h,
    )
    assert r2.json()["near_bar"] is False and r2.json()["distance_bucket"] == "far"
    assert r2.json()["points_awarded"] == 0


def test_security_headers(client: TestClient, user) -> None:
    r = client.get("/v1/me", headers=user.h)
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"


def test_request_size_limit(client: TestClient) -> None:
    big = "x" * (70 * 1024)
    r = client.post(
        "/v1/auth/request-code", content=big, headers={"content-type": "application/json"}
    )
    assert r.status_code == 413
