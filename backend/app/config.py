"""Runtime settings. Everything comes from environment variables (see .env.example)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CROWDED_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "staging", "prod"] = "dev"
    database_url: str = "postgresql+psycopg://crowded:crowded@localhost:5432/crowded"

    # Secrets. Dev defaults are intentionally obvious and refused outside dev/test.
    jwt_secret: SecretStr = SecretStr("dev-only-jwt-secret-change-me-0123456789abcdef")
    hash_pepper: SecretStr = SecretStr("dev-only-pepper-change-me-0123456789abcdef")

    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_days: int = 30  # sliding idle lifetime
    refresh_token_max_days: int = 180  # absolute lifetime of a login
    refresh_reuse_grace_seconds: int = 10  # two tabs refreshing at once
    jwt_issuer: str = "crowded"
    jwt_audience: str = "crowded-app"

    login_code_ttl_seconds: int = 5 * 60
    login_code_max_attempts: int = 5
    login_code_lockout_seconds: int = 15 * 60

    sms_provider: Literal["stub"] = "stub"
    # App Review demo login: Apple reviewers cannot receive our SMS. One configured phone gets a
    # fixed code instead of an SMS. Rate limits and lockout still apply. Leave empty to disable.
    review_phone: str = ""
    review_code: SecretStr = SecretStr("")
    apple_client_id: str = "app.crowded.ios"
    apple_jwks_url: str = "https://appleid.apple.com/auth/keys"

    cors_origins: list[str] = Field(default_factory=list)
    max_request_bytes: int = 64 * 1024

    raw_retention_days: int = 30
    min_age_years: int = 21
    default_wait_threshold_min: int = 20

    serve_web: bool = True
    web_dir: str = ""  # defaults to ../web next to backend/

    @property
    def is_dev(self) -> bool:
        return self.env in ("dev", "test")

    @model_validator(mode="after")
    def _refuse_dev_secrets_in_prod(self) -> Settings:
        if not self.is_dev:
            for name in ("jwt_secret", "hash_pepper"):
                value: SecretStr = getattr(self, name)
                raw = value.get_secret_value()
                if raw.startswith("dev-only") or len(raw) < 32:
                    raise ValueError(f"CROWDED_{name.upper()} must be set to a strong value")
            code = self.review_code.get_secret_value()
            if self.review_phone and (
                len(code) != 6 or not code.isascii() or not code.isdigit() or len(set(code)) < 4
            ):
                raise ValueError("CROWDED_REVIEW_CODE must be 6 digits with at least 4 distinct")
            if self.sms_provider == "stub":
                raise ValueError("the stub SMS provider is dev only. Configure a real provider")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
