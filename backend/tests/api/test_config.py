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
