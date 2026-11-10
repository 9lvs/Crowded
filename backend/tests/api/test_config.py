from __future__ import annotations

import pytest
from pydantic import SecretStr, ValidationError

from app.config import Settings


def test_prod_refuses_dev_secrets() -> None:
    with pytest.raises(ValidationError):
        Settings(env="prod")


def test_prod_refuses_stub_sms() -> None:
    strong = SecretStr("x" * 48)
    with pytest.raises(ValidationError, match="stub SMS"):
        Settings(env="prod", jwt_secret=strong, hash_pepper=strong)


def test_review_code_must_be_strong() -> None:
    strong = SecretStr("x" * 48)
    with pytest.raises(ValidationError, match="REVIEW_CODE"):
        Settings(
            env="prod",
            jwt_secret=strong,
            hash_pepper=strong,
            review_phone="+15550001234",
            review_code=SecretStr("111111"),
        )
