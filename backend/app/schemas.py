"""Request and response models. Strict: unknown fields are rejected everywhere."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import (
    CrowdLevel,
    DealCategory,
    DistanceBucket,
    DoorDirection,
    DrinkWait,
    LineSize,
    Role,
    SessionStatus,
    SpecialKind,
    StaffLevel,
)

E164 = re.compile(r"^\+[1-9][0-9]{7,14}$", re.ASCII)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]
Platform = Literal["ios", "web", "unknown"]


# ---------- auth ----------


class RequestCodeIn(Strict):
    phone: Annotated[str, Field(min_length=8, max_length=16)]

    @field_validator("phone")
    @classmethod
    def _e164(cls, v: str) -> str:
        v = re.sub(r"[ \-().]", "", v)
        if not E164.match(v):
            raise ValueError("phone must be E.164, for example +15551234567")
        return v


class RequestCodeOut(Strict):
    sent: bool
    expires_in: int
    dev_code: str | None = Field(default=None, description="Only present in dev builds")


class VerifyCodeIn(RequestCodeIn):
    code: Annotated[str, Field(pattern=r"^[0-9]{6}$")]
    age_attested: bool = Field(
        default=False, description="User confirmed they are 21 or older. Required to sign up."
    )
    platform: Platform = "unknown"


class AppleSignInIn(Strict):
    identity_token: Annotated[str, Field(min_length=20, max_length=4096)]
    age_attested: bool = False
    platform: Platform = "ios"


class RefreshIn(Strict):
    refresh_token: Annotated[str, Field(min_length=20, max_length=200)]


class MeOut(Strict):
    id: uuid.UUID
    role: Role
    wait_threshold_min: int
    staff_bar_id: uuid.UUID | None
    staff_level: StaffLevel | None = Field(
        default=None, description="door or manager. Null if the user is not staff"
    )
    phone_hint: str | None
    created_at: datetime


class TokenPair(Strict):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: MeOut


class MeUpdate(Strict):
    wait_threshold_min: Annotated[int, Field(ge=5, le=120)]


# ---------- bars ----------


class BasisOut(Strict):
    text: str
    window_min: int
    reports: int
    timers: int
    door_events: int
    staff_line_updates: int
    inside_updates: int = 0


class LiveOut(Strict):
    has_recent_data: bool
    wait_min: int | None
    wait_low_min: int | None
    wait_high_min: int | None
    crowd_level: CrowdLevel | None
    headcount: int | None
    capacity_ratio: float | None
    drink_wait: DrinkWait | None = None
    drink_wait_label: str | None = None
    confidence: Literal["none", "low", "medium", "high"]
    basis: BasisOut
    flags: list[str]
    updated_at: datetime


class VerdictOut(Strict):
    recommendation: Literal["buy_pass", "wait_it_out", "no_pass_available", "no_data"]
    text: str
    threshold_min: int
    pass_price_cents: int | None
    minutes_saved: int | None


# ---------- specials ----------

TIME_HHMM = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")


def _clean_text(v: str) -> str:
    if any(ord(c) < 32 or ord(c) == 127 for c in v):
        raise ValueError("control characters are not allowed")
    return v


MAX_DEAL_ITEMS = 20
ALL_DAY_START = "12:00"
ALL_DAY_END = "04:00"


class DealItem(Strict):
    name: Annotated[str, Field(min_length=1, max_length=60)]
    price_label: Annotated[str, Field(min_length=1, max_length=20)]
    category: DealCategory
    note: Annotated[str, Field(max_length=40)] = ""

    @field_validator("name", "price_label", "note")
    @classmethod
    def _text(cls, v: str) -> str:
        return _clean_text(v)


class DealItemOut(DealItem):
    pass


DealItems = Annotated[list[DealItem], Field(max_length=MAX_DEAL_ITEMS)]


class SpecialIn(Strict):
    kind: SpecialKind
    title: Annotated[str, Field(min_length=1, max_length=80)]
    details: Annotated[str, Field(max_length=200)] = ""
    days: Annotated[list[Annotated[int, Field(ge=0, le=6)]], Field(min_length=1, max_length=7)]
    start_local: str | None = None
    end_local: str | None = None
    price_cents: Annotated[int, Field(ge=0, le=100000)] | None = None
    all_day: bool = False
    items: DealItems = Field(default_factory=list)

    @field_validator("title", "details")
    @classmethod
    def _text(cls, v: str) -> str:
        return _clean_text(v)

    @field_validator("days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if len(set(v)) != len(v):
            raise ValueError("days must be unique")
        return sorted(v)

    @field_validator("start_local", "end_local")
    @classmethod
    def _hhmm(cls, v: str | None) -> str | None:
        if v is not None and not TIME_HHMM.match(v):
            raise ValueError("time must be HH:MM, 24 hour")
        return v

    @model_validator(mode="after")
    def _times(self) -> SpecialIn:
        if self.all_day:
            self.start_local = ALL_DAY_START
            self.end_local = ALL_DAY_END
        elif self.start_local is None or self.end_local is None:
            raise ValueError("times_required")
        elif self.start_local == self.end_local:
            raise ValueError("start and end must differ")
        return self


class SpecialUpdate(Strict):
    kind: SpecialKind | None = None
    title: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    details: Annotated[str, Field(max_length=200)] | None = None
    days: (
        Annotated[list[Annotated[int, Field(ge=0, le=6)]], Field(min_length=1, max_length=7)] | None
    ) = None
    start_local: str | None = None
    end_local: str | None = None
    price_cents: Annotated[int, Field(ge=0, le=100000)] | None = None
    is_active: bool | None = None
    all_day: bool | None = None
    items: DealItems | None = None

    @field_validator("title", "details")
    @classmethod
    def _text(cls, v: str | None) -> str | None:
        return None if v is None else _clean_text(v)

    @field_validator("days")
    @classmethod
    def _days(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return None
        if len(set(v)) != len(v):
            raise ValueError("days must be unique")
        return sorted(v)

    @field_validator("start_local", "end_local")
    @classmethod
    def _hhmm(cls, v: str | None) -> str | None:
        if v is not None and not TIME_HHMM.match(v):
            raise ValueError("time must be HH:MM, 24 hour")
        return v


class SpecialOut(Strict):
    id: uuid.UUID
    kind: SpecialKind
    title: str
    details: str
    days: list[int]
    start_local: str
    end_local: str
    price_cents: int | None
    all_day: bool
    items: list[DealItemOut]
    is_active: bool
    posted_by: Literal["staff", "admin"]
    updated_at: datetime


class SpecialTonight(SpecialOut):
    is_now: bool


class BarSummary(Strict):
    id: uuid.UUID
    slug: str
    name: str
    address: str
    capacity: int
    pass_price_cents: int | None
    live: LiveOut
    verdict: VerdictOut
    specials_tonight: list[SpecialTonight] = Field(
        default_factory=list, description="Posted by the bar. Now first, then by start time"
    )
    cover_tonight: SpecialTonight | None = None


class HourPoint(Strict):
    hour: Annotated[int, Field(ge=0, le=23)]
    typical_wait_min: int | None
    tonight_wait_min: int | None


class BarDetail(BarSummary):
    latitude: float
    longitude: float
    normal_wait_min: int | None = Field(description="Typical wait at this hour on past nights")
    wait_by_hour: list[HourPoint]
    specials_week: list[SpecialOut] = Field(default_factory=list)


class SnapshotOut(Strict):
    bar_id: uuid.UUID
    ts: datetime
    has_recent_data: bool
    wait_min: int | None
    crowd_level: CrowdLevel | None
    headcount: int | None
    confidence: str


# ---------- line sessions and reports ----------


class LocationIn(Strict):
    """Read once at action time. The server uses it to compute distance, then discards it."""

    latitude: Latitude
    longitude: Longitude


class LineSessionStartIn(Strict):
    bar_id: uuid.UUID
    location: LocationIn | None = None


class LineSessionEndIn(Strict):
    outcome: Literal["inside", "gave_up"] = "inside"
    # Rotating 4 digit code shown at the door. Optional. A wrong code never fails the request.
    door_code: Annotated[str, Field(pattern=r"^[0-9]{4}$")] | None = None


class LineSessionOut(Strict):
    id: uuid.UUID
    bar_id: uuid.UUID
    status: SessionStatus
    started_at: datetime
    ended_at: datetime | None
    predicted_wait_min: int | None
    actual_wait_min: float | None
    near_bar: bool
    verified: bool = False
    points_awarded: int = 0


class ReportCreate(Strict):
    bar_id: uuid.UUID
    crowd_level: CrowdLevel | None = None
    line_size: LineSize | None = None
    drink_wait: DrinkWait | None = None
    location: LocationIn | None = None

    @model_validator(mode="after")
    def _something(self) -> ReportCreate:
        if self.crowd_level is None and self.line_size is None and self.drink_wait is None:
            raise ValueError("report needs crowd_level, line_size or drink_wait")
        return self


class ReportOut(Strict):
    id: uuid.UUID
    bar_id: uuid.UUID
    near_bar: bool
    distance_bucket: DistanceBucket
    points_awarded: int


# ---------- staff ----------


class RedeemInviteIn(Strict):
    code: Annotated[str, Field(min_length=8, max_length=64)]


class DoorIn(Strict):
    direction: DoorDirection
    count: Annotated[int, Field(ge=1, le=20)] = 1


class CountSyncIn(Strict):
    inside_now: Annotated[int, Field(ge=0, le=5000)]


class DoorCodeOut(Strict):
    code: Annotated[str, Field(pattern=r"^[0-9]{4}$")]
    expires_in: int


class LineSampleEndIn(Strict):
    outcome: Literal["inside", "cancel"]


class LineSampleOut(Strict):
    id: uuid.UUID
    bar_id: uuid.UUID
    status: SessionStatus
    started_at: datetime
    ended_at: datetime | None
    predicted_wait_min: int | None
    actual_wait_min: float | None


class LineSizeIn(Strict):
    line_size: LineSize


class InsideIn(Strict):
    crowd_level: CrowdLevel | None = None
    drink_wait: DrinkWait | None = None

    @model_validator(mode="after")
    def _something(self) -> InsideIn:
        if self.crowd_level is None and self.drink_wait is None:
            raise ValueError("report needs crowd_level or drink_wait")
        return self


class BarSettingsIn(Strict):
    counts_exits: bool


class InsideStatusOut(Strict):
    crowd_level: CrowdLevel | None
    drink_wait: DrinkWait | None
    updated_at: datetime


class StaffState(Strict):
    bar_id: uuid.UUID
    bar_name: str
    capacity: int
    headcount: int
    entries_tonight: int
    exits_tonight: int
    line_size: LineSize | None
    line_updated_at: datetime | None
    counts_exits: bool = True
    inside: InsideStatusOut | None = None
    live: LiveOut


# ---------- admin ----------


class BarCreate(Strict):
    slug: Annotated[str, Field(pattern=r"^[a-z0-9-]{2,64}$")]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    address: Annotated[str, Field(max_length=200)] = ""
    latitude: Latitude
    longitude: Longitude
    capacity: Annotated[int, Field(ge=1, le=10000)]
    timezone: Annotated[str, Field(max_length=64)] = "America/New_York"

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("unknown IANA timezone") from None
        return v


class BarUpdate(Strict):
    name: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    address: Annotated[str, Field(max_length=200)] | None = None
    capacity: Annotated[int, Field(ge=1, le=10000)] | None = None
    is_active: bool | None = None
    counts_exits: bool | None = None


class BarAdminOut(Strict):
    id: uuid.UUID
    slug: str
    name: str
    address: str
    latitude: float
    longitude: float
    capacity: int
    timezone: str
    is_active: bool
    counts_exits: bool


class PassPriceIn(Strict):
    price_cents: Annotated[int, Field(ge=0, le=100000)] | None = Field(
        description="null means this bar sells no pass"
    )


class PassPriceOut(Strict):
    bar_id: uuid.UUID
    price_cents: int | None
    currency: str
    created_at: datetime


class InviteCreate(Strict):
    level: StaffLevel = StaffLevel.door


class StaffMemberOut(Strict):
    user_id: uuid.UUID
    bar_id: uuid.UUID
    level: StaffLevel = StaffLevel.door
    phone_hint: str | None
    created_at: datetime


class InviteOut(Strict):
    id: uuid.UUID
    bar_id: uuid.UUID
    level: StaffLevel = StaffLevel.door
    code: str = Field(description="Shown once. Only a hash is stored.")
    expires_at: datetime


class AccuracyOut(Strict):
    bar_id: uuid.UUID
    bar_name: str
    samples: int
    mean_abs_error_min: float | None
    mean_bias_min: float | None = Field(description="Positive means we over-estimate")


class AuditOut(Strict):
    ts: datetime
    actor_role: str
    action: str
    target_type: str
    target_id: str
    bar_id: uuid.UUID | None
    details: dict[str, object]


class ErrorOut(Strict):
    detail: str
