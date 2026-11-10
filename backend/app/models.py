"""ORM models. Privacy rule: no raw phone numbers, no coordinates, no birth dates are stored."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy import false as sa_false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(
        cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        values_callable=lambda e: [m.value for m in e],
        length=32,
    )


class Role(enum.StrEnum):
    user = "user"
    staff = "staff"
    admin = "admin"


class CrowdLevel(enum.StrEnum):
    easy = "easy"
    busy = "busy"
    packed = "packed"


class LineSize(enum.StrEnum):
    """Outside line size buckets. Shared by the staff picker and user reports."""

    none = "none"  # 0
    short = "short"  # 1 to 10
    medium = "medium"  # 11 to 25
    long = "long"  # 26 to 50
    very_long = "very_long"  # 50+


class DistanceBucket(enum.StrEnum):
    at_door = "at_door"  # under 75 m
    nearby = "nearby"  # 75 m to 300 m
    far = "far"  # over 300 m
    unknown = "unknown"  # no location shared


class SessionStatus(enum.StrEnum):
    active = "active"
    completed = "completed"
    abandoned = "abandoned"


class DoorDirection(enum.StrEnum):
    in_ = "in"
    out = "out"


TS = DateTime(timezone=True)


class SpecialKind(enum.StrEnum):
    happy_hour = "happy_hour"
    drink = "drink"
    food = "food"
    cover = "cover"
    event = "event"


class DealCategory(enum.StrEnum):
    beer = "beer"
    pitchers = "pitchers"
    shots = "shots"
    mixers = "mixers"
    wine = "wine"
    food = "food"
    other = "other"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    phone_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    phone_last2: Mapped[str | None] = mapped_column(String(2))
    apple_sub_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    role: Mapped[Role] = mapped_column(_enum(Role, "role"), default=Role.user)
    age_attested_at: Mapped[datetime] = mapped_column(TS)
    wait_threshold_min: Mapped[int] = mapped_column(Integer, default=20)
    reliability: Mapped[float] = mapped_column(Float, default=0.6)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)

    __table_args__ = (
        CheckConstraint("wait_threshold_min BETWEEN 1 AND 180", name="threshold_range"),
        CheckConstraint("reliability BETWEEN 0 AND 1", name="reliability_range"),
    )


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    platform: Mapped[str] = mapped_column(String(16), default="unknown")
    app_attest_key_id: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class RefreshToken(Base):
    """Opaque refresh tokens, stored as SHA-256 only. Rotated on every use."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(TS)
    used_at: Mapped[datetime | None] = mapped_column(TS)
    revoked_at: Mapped[datetime | None] = mapped_column(TS)


class LoginCode(Base):
    """One-time phone login codes. Code is stored as an HMAC, never in plain text."""

    __tablename__ = "login_codes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    phone_hash: Mapped[str] = mapped_column(String(64), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(TS)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    consumed_at: Mapped[datetime | None] = mapped_column(TS)
    locked_until: Mapped[datetime | None] = mapped_column(TS)


class Bar(Base):
    __tablename__ = "bars"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(String(200), default="")
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    capacity: Mapped[int] = mapped_column(Integer)
    timezone: Mapped[str] = mapped_column(String(64), default="America/New_York")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)

    __table_args__ = (CheckConstraint("capacity > 0", name="capacity_positive"),)


class BarStaff(Base):
    """A staff member belongs to exactly one bar (unique user_id)."""

    __tablename__ = "bar_staff"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    invite_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_invites.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)

    bar: Mapped[Bar] = relationship()


class StaffInvite(Base):
    __tablename__ = "staff_invites"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(TS)
    redeemed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    redeemed_at: Mapped[datetime | None] = mapped_column(TS)
    revoked_at: Mapped[datetime | None] = mapped_column(TS)


class LineSession(Base):
    """'I'm in line' to 'I'm inside' timer. Raw rows are deleted after the retention window."""

    __tablename__ = "line_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    status: Mapped[SessionStatus] = mapped_column(
        _enum(SessionStatus, "session_status"), default=SessionStatus.active
    )
    started_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(TS)
    predicted_wait_min: Mapped[float | None] = mapped_column(Float)
    formula_wait_min: Mapped[float | None] = mapped_column(Float)  # uncalibrated, for calibration
    # Entry rate when the timer started. actual wait x rate = how many people were really in
    # line, which scores staff and student line reports (docs/SOURCING.md).
    entry_rate_at_start: Mapped[float | None] = mapped_column(Float)
    actual_wait_min: Mapped[float | None] = mapped_column(Float)
    near_bar: Mapped[bool] = mapped_column(Boolean, default=False)
    # True when the student typed the rotating door code at the door (docs/SOURCING.md).
    verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    distance_bucket: Mapped[DistanceBucket] = mapped_column(
        _enum(DistanceBucket, "distance_bucket"), default=DistanceBucket.unknown
    )

    __table_args__ = (
        Index("ix_line_sessions_bar_started", "bar_id", "started_at"),
        Index("ix_line_sessions_user_status", "user_id", "status"),
    )


class CrowdReport(Base):
    __tablename__ = "crowd_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    crowd_level: Mapped[CrowdLevel | None] = mapped_column(_enum(CrowdLevel, "crowd_level"))
    line_size: Mapped[LineSize | None] = mapped_column(_enum(LineSize, "line_size"))
    near_bar: Mapped[bool] = mapped_column(Boolean, default=False)
    distance_bucket: Mapped[DistanceBucket] = mapped_column(
        _enum(DistanceBucket, "distance_bucket"), default=DistanceBucket.unknown
    )

    __table_args__ = (Index("ix_crowd_reports_bar_created", "bar_id", "created_at"),)


class DoorEvent(Base):
    __tablename__ = "door_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    staff_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    ts: Mapped[datetime] = mapped_column(TS, default=utcnow)
    direction: Mapped[DoorDirection] = mapped_column(_enum(DoorDirection, "door_direction"))
    count: Mapped[int] = mapped_column(Integer, default=1)
    # "tap" is one staff tap. "sync" is a clicker total entered as a difference.
    source: Mapped[str] = mapped_column(String(8), default="tap", server_default="tap")

    __table_args__ = (
        Index("ix_door_events_bar_ts", "bar_id", "ts"),
        CheckConstraint(
            "(source = 'tap' AND count BETWEEN 1 AND 20)"
            " OR (source = 'sync' AND count BETWEEN 1 AND 5000)",
            name="door_count_range",
        ),
    )


class LineSample(Base):
    """A door staff member times a real person from the back of the line to the door."""

    __tablename__ = "line_samples"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    staff_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    started_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(TS)
    status: Mapped[SessionStatus] = mapped_column(
        _enum(SessionStatus, "session_status"), default=SessionStatus.active
    )
    predicted_wait_min: Mapped[float | None] = mapped_column(Float)
    formula_wait_min: Mapped[float | None] = mapped_column(Float)
    entry_rate_at_start: Mapped[float | None] = mapped_column(Float)

    __table_args__ = (Index("ix_line_samples_bar_started", "bar_id", "started_at"),)


class OutsideLineStatus(Base):
    __tablename__ = "outside_line_status"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    staff_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    ts: Mapped[datetime] = mapped_column(TS, default=utcnow)
    line_size: Mapped[LineSize] = mapped_column(_enum(LineSize, "line_size"))

    __table_args__ = (Index("ix_outside_line_bar_ts", "bar_id", "ts"),)


class BarSnapshot(Base):
    """Computed estimate at a point in time. Aggregated, contains no user identifiers."""

    __tablename__ = "bar_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(TS, default=utcnow)
    has_recent_data: Mapped[bool] = mapped_column(Boolean)
    wait_minutes: Mapped[float | None] = mapped_column(Float)
    crowd_level: Mapped[CrowdLevel | None] = mapped_column(_enum(CrowdLevel, "crowd_level"))
    headcount: Mapped[int | None] = mapped_column(Integer)
    confidence: Mapped[str] = mapped_column(String(16))
    basis: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    __table_args__ = (Index("ix_bar_snapshots_bar_ts", "bar_id", "ts"),)


class PassPrice(Base):
    """Manually entered by an admin. Never scraped, never pulled from a third party."""

    __tablename__ = "pass_prices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    price_cents: Mapped[int | None] = mapped_column(Integer)  # None means no pass offered
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    set_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)

    __table_args__ = (
        Index("ix_pass_prices_bar_created", "bar_id", "created_at"),
        CheckConstraint("price_cents IS NULL OR price_cents BETWEEN 0 AND 100000", name="price"),
    )


class RewardLedger(Base):
    __tablename__ = "reward_ledger"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    points: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(32))
    ref_id: Mapped[uuid.UUID | None] = mapped_column()


class EstimateError(Base):
    """Estimate vs actual for completed timers. No user id so it survives account deletion."""

    __tablename__ = "estimate_errors"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    predicted_min: Mapped[float] = mapped_column(Float)
    formula_min: Mapped[float | None] = mapped_column(Float)
    actual_min: Mapped[float] = mapped_column(Float)
    abs_error_min: Mapped[float] = mapped_column(Float)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    ts: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    actor_role: Mapped[str] = mapped_column(String(16))
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str] = mapped_column(String(32), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    bar_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bars.id", ondelete="SET NULL"))
    ip_hash: Mapped[str] = mapped_column(String(64), default="")
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class BarSpecial(Base):
    """A special, happy hour, cover charge or event posted by the bar itself."""

    __tablename__ = "bar_specials"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=_uuid)
    bar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bars.id", ondelete="CASCADE"), index=True)
    kind: Mapped[SpecialKind] = mapped_column(_enum(SpecialKind, "special_kind"))
    title: Mapped[str] = mapped_column(String(80))
    details: Mapped[str] = mapped_column(String(200), default="")
    days: Mapped[list[int]] = mapped_column(JSON)  # weekday ints, Monday = 0
    start_local: Mapped[str] = mapped_column(String(5))
    end_local: Mapped[str] = mapped_column(String(5))
    price_cents: Mapped[int | None] = mapped_column(Integer)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    items: Mapped[list[dict[str, str]]] = mapped_column(
        JSON, default=list, server_default=text("'[]'")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    posted_by_role: Mapped[str] = mapped_column(String(16))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        CheckConstraint(
            "price_cents IS NULL OR (price_cents >= 0 AND price_cents <= 100000)",
            name="special_price_range",
        ),
    )
