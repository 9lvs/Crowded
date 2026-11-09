from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models import LoginCode, RefreshToken, User
from tests.api.conftest import fake_phone, login


def test_signup_requires_age_attestation(client: TestClient) -> None:
    phone = fake_phone()
    code = client.post("/v1/auth/request-code", json={"phone": phone}).json()["dev_code"]
    r = client.post("/v1/auth/verify-code", json={"phone": phone, "code": code})
    assert r.status_code == 403
    assert r.json()["detail"] == "age_gate"
    r = client.post(
        "/v1/auth/verify-code", json={"phone": phone, "code": code, "age_attested": True}
    )
    assert r.status_code == 200


def test_no_raw_phone_at_rest(client: TestClient, db: Session) -> None:
    a = login(client)
    u = db.scalars(select(User)).one()
    assert u.phone_hash and a.phone not in u.phone_hash
    assert u.phone_last2 == a.phone[-2:]
    assert u.age_attested_at is not None
    for code in db.scalars(select(LoginCode)):
        assert len(code.code_hash) == 64


def test_bad_phone_rejected_without_echo(client: TestClient) -> None:
    r = client.post("/v1/auth/request-code", json={"phone": "5551234"})
    assert r.status_code == 422
    assert "5551234" not in r.text


def test_wrong_code_locks_out(client: TestClient) -> None:
    phone = fake_phone()
    code = client.post("/v1/auth/request-code", json={"phone": phone}).json()["dev_code"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        r = client.post(
            "/v1/auth/verify-code", json={"phone": phone, "code": wrong, "age_attested": True}
        )
        assert r.status_code == 400
    r = client.post(
        "/v1/auth/verify-code", json={"phone": phone, "code": code, "age_attested": True}
    )
    assert r.status_code == 429
    assert client.post("/v1/auth/request-code", json={"phone": phone}).status_code == 429


def test_code_request_rate_limited(client: TestClient) -> None:
    phone = fake_phone()
    for _ in range(3):
        assert client.post("/v1/auth/request-code", json={"phone": phone}).status_code == 200
    r = client.post("/v1/auth/request-code", json={"phone": phone})
    assert r.status_code == 429
    assert "retry-after" in r.headers


def test_code_is_single_use_and_expires(client: TestClient, db: Session) -> None:
    phone = fake_phone()
    code = client.post("/v1/auth/request-code", json={"phone": phone}).json()["dev_code"]
    body = {"phone": phone, "code": code, "age_attested": True}
    assert client.post("/v1/auth/verify-code", json=body).status_code == 200
    assert client.post("/v1/auth/verify-code", json=body).status_code == 400

    code = client.post("/v1/auth/request-code", json={"phone": phone}).json()["dev_code"]
    for row in db.scalars(select(LoginCode)):
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    body["code"] = code
    assert client.post("/v1/auth/verify-code", json=body).status_code == 400


def test_refresh_rotates_and_detects_reuse(client: TestClient, db: Session) -> None:
    a = login(client)
    r1 = client.post("/v1/auth/refresh", json={"refresh_token": a.refresh})
    assert r1.status_code == 200
    new_rt = r1.json()["refresh_token"]
    assert new_rt != a.refresh
    # Replay the old token: whole family dies, including the new one.
    assert client.post("/v1/auth/refresh", json={"refresh_token": a.refresh}).status_code == 401
    assert client.post("/v1/auth/refresh", json={"refresh_token": new_rt}).status_code == 401
    assert all(t.revoked_at for t in db.scalars(select(RefreshToken)))


def test_refresh_tokens_stored_hashed(client: TestClient, db: Session) -> None:
    a = login(client)
    hashes = [t.token_hash for t in db.scalars(select(RefreshToken))]
    assert a.refresh not in hashes and len(hashes) == 1


def test_logout_revokes(client: TestClient) -> None:
    a = login(client)
    assert client.post("/v1/auth/logout", json={"refresh_token": a.refresh}).status_code == 204
    assert client.post("/v1/auth/refresh", json={"refresh_token": a.refresh}).status_code == 401


def test_expired_and_forged_access_tokens(client: TestClient) -> None:
    a = login(client)
    import uuid

    old = create_access_token(uuid.UUID(a.user_id), "user", datetime.now(UTC) - timedelta(hours=1))
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {old}"}).status_code == 401
    forged = a.access[:-4] + ("AAAA" if not a.access.endswith("AAAA") else "BBBB")
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    assert client.get("/v1/me").status_code == 401


def test_access_token_ttl_is_15_minutes(client: TestClient) -> None:
    phone = fake_phone()
    code = client.post("/v1/auth/request-code", json={"phone": phone}).json()["dev_code"]
    r = client.post(
        "/v1/auth/verify-code", json={"phone": phone, "code": code, "age_attested": True}
    )
    assert r.json()["expires_in"] == 900


def test_apple_sign_in(client: TestClient, monkeypatch) -> None:
    from app.api.v1 import auth as auth_api

    class Fake:
        def verify(self, token: str) -> str:
            if token.startswith("good"):
                return "apple-sub-FAKE-001"
            raise ValueError("bad")

    monkeypatch.setattr(auth_api, "get_apple_verifier", lambda: Fake())
    tok = "good-" + "x" * 30
    assert client.post("/v1/auth/apple", json={"identity_token": tok}).status_code == 403
    r = client.post("/v1/auth/apple", json={"identity_token": tok, "age_attested": True})
    assert r.status_code == 200
    again = client.post("/v1/auth/apple", json={"identity_token": tok})
    assert again.json()["user"]["id"] == r.json()["user"]["id"]
    bad = client.post("/v1/auth/apple", json={"identity_token": "bad-" + "x" * 30})
    assert bad.status_code == 401
