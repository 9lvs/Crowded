"""Contract for the estimation module.

Everything in app.estimation is pure: no database, no clock, no I/O. Callers pass `now`
explicitly. All datetimes must be timezone aware (UTC). Minutes are floats.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum


class Crowd(StrEnum):
    easy = "easy"
    busy = "busy"
    packed = "packed"


class Confidence(StrEnum):
    none = "none"  # nothing recent: UI must show "no recent data"
    low = "low"
    medium = "medium"
    high = "high"


class Recommendation(StrEnum):
    # wait exceeds threshold and a pass is offered
    buy_pass = "buy_pass"  # nosec B105
    wait_it_out = "wait_it_out"  # wait is under threshold
    # wait exceeds threshold but no pass is sold
    no_pass_available = "no_pass_available"  # nosec B105
    no_data = "no_data"  # no recent data, no recommendation


# Representative headcount for each outside line bucket (people standing in line).
LINE_SIZE_PEOPLE: Mapping[str, int] = {
    "none": 0,
    "short": 6,
    "medium": 18,
    "long": 38,
    "very_long": 65,
}


# Representative minutes for each drink wait bucket. Also used to map back to a bucket.
DRINK_WAIT_MIN: Mapping[str, float] = {
    "under_5": 3.0,
    "5_to_10": 8.0,
    "10_to_20": 15.0,
    "over_20": 25.0,
}


@dataclass(frozen=True)
class DoorEventIn:
    ts: datetime
    direction: str  # "in" or "out"
    count: int = 1
    source: str = "tap"  # "tap" or "sync". Sync events move headcount but never the rates.


@dataclass(frozen=True)
class LineStatusIn:
    """Staff outside line picker value."""

    ts: datetime
    line_size: str  # key of LINE_SIZE_PEOPLE
    reporter_id: str | None = None  # staff user id, for per staff reliability


@dataclass(frozen=True)
class InsideStatusIn:
    """Staff report of conditions inside. Either field may be missing."""

    ts: datetime
    crowd_level: str | None = None  # Crowd value
    drink_wait: str | None = None  # key of DRINK_WAIT_MIN
    reporter_id: str | None = None  # staff user id, for per staff reliability


@dataclass(frozen=True)
class TimerIn:
    """A user line session. ended_at None means the user is still in line."""

    user_id: str
    started_at: datetime
    ended_at: datetime | None = None
    near_bar: bool = True
    verified: bool = False  # door code typed at the door, or a staff sample


@dataclass(frozen=True)
class ReportIn:
    user_id: str
    ts: datetime
    crowd_level: str | None = None  # Crowd value
    line_size: str | None = None  # key of LINE_SIZE_PEOPLE
    near_bar: bool = False
    drink_wait: str | None = None  # key of DRINK_WAIT_MIN


@dataclass(frozen=True)
class CalibrationPoint:
    """A completed timer paired with the formula estimate at the moment it started."""

    ts: datetime
    predicted_min: float
    actual_min: float


@dataclass(frozen=True)
class Params:
    window_min: float = 30.0  # "recent" window for reports, line status and timers
    rate_window_min: float = 15.0  # window for entry and exit rates
    half_life_min: float = 12.0  # recency weighting half life
    capacity_mode_ratio: float = 0.95  # headcount / capacity at or above this = capacity mode
    easy_below: float = 0.60  # headcount / capacity
    packed_at: float = 0.90
    default_reliability: float = 0.6
    far_report_weight: float = 0.3  # multiplier for reports not made near the bar
    min_rate_per_min: float = 0.5  # floor so a dead door does not produce infinite waits
    max_wait_min: float = 180.0
    calibration_min: float = 0.5
    calibration_max: float = 2.0
    calibration_window_min: float = 7 * 24 * 60.0
    calibration_half_life_min: float = 24 * 60.0  # one day
    mismatch_threshold: int = 2  # crowd level steps between staff count and reports
    # One staff line reading weighs as much as this many perfectly reliable user reports, before
    # the staff member's own reliability (learned from timers) is applied. See docs/SOURCING.md.
    staff_line_weight: float = 3.0
    # Staff and user line estimates "disagree" when they differ by at least this many people
    # and by at least this fraction of the larger one.
    disagree_min_people: float = 10.0
    disagree_ratio: float = 0.4
    # Without a staff reading, student line reports must add up to at least this much weight
    # (about one average, recent, near-bar report) before we turn them into a wait. Stops a
    # single far, stale or low-trust report from producing a big made up number.
    min_report_line_weight: float = 0.5
    # A verified timer (door code or staff sample) counts this many times as much.
    verified_timer_weight: float = 2.0


@dataclass(frozen=True)
class EstimateInput:
    now: datetime
    capacity: int
    door_events: Sequence[DoorEventIn] = ()  # tonight's events (since the counter reset)
    line_statuses: Sequence[LineStatusIn] = ()
    timers: Sequence[TimerIn] = ()
    reports: Sequence[ReportIn] = ()
    inside_statuses: Sequence[InsideStatusIn] = ()
    # False for bars that only count people in. Then headcount and capacity ratio are not
    # computed from door events and capacity mode is off. Entry rate still uses IN events.
    counts_exits: bool = True
    reliability: Mapping[str, float] = field(default_factory=dict)  # user_id -> [0, 1]
    calibration: float = 1.0  # from calibration_factor()
    params: Params = field(default_factory=Params)


@dataclass(frozen=True)
class Basis:
    """What the numbers are based on. Shown to users verbatim."""

    window_min: int
    reports: int
    timers: int
    door_events: int
    staff_line_updates: int
    text: str  # e.g. "Based on 6 reports and 2 timers in the last 30 min"
    inside_updates: int = 0  # staff inside statuses in the window


@dataclass(frozen=True)
class DrinkWaitBasis:
    """How many readings the drink wait comes from."""

    staff_updates: int = 0
    reports: int = 0


@dataclass(frozen=True)
class Estimate:
    has_recent_data: bool
    wait_min: float | None
    wait_low_min: float | None
    wait_high_min: float | None
    crowd_level: Crowd | None
    headcount: int | None
    capacity: int
    capacity_ratio: float | None
    capacity_mode: bool
    people_in_line: int | None
    entry_rate_per_min: float | None
    confidence: Confidence
    method: str  # "formula", "timers", "blend", "reports", "none"
    basis: Basis
    flags: tuple[str, ...] = ()  # e.g. ("staff_report_mismatch",)
    drink_wait: str | None = None  # key of DRINK_WAIT_MIN, None without recent data
    drink_wait_basis: DrinkWaitBasis = field(default_factory=DrinkWaitBasis)


@dataclass(frozen=True)
class Verdict:
    recommendation: Recommendation
    threshold_min: int
    pass_price_cents: int | None
    minutes_saved: float | None
    text: str  # e.g. "Skip it. Line is about 35 min, over your 20 min limit."
