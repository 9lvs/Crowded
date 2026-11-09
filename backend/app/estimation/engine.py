"""Pure estimation engine. Contract in types.py, math in docs/ESTIMATION.md."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime, timedelta

from app.estimation.stats import mad, median, weighted_median
from app.estimation.types import (
    LINE_SIZE_PEOPLE,
    Basis,
    CalibrationPoint,
    Confidence,
    Crowd,
    Estimate,
    EstimateInput,
    Params,
    Recommendation,
    ReportIn,
    TimerIn,
    Verdict,
)

DEFAULT_RATE_PER_MIN = 2.0
ACTIVE_TIMER_MAX_AGE_MIN = 180.0
LOW_RANGE = (0.6, 1.6)
NORMAL_RANGE = (0.75, 1.3)
_CROWD_ORDER = {Crowd.easy: 0, Crowd.busy: 1, Crowd.packed: 2}
_CONF_DOWN = {
    Confidence.high: Confidence.medium,
    Confidence.medium: Confidence.low,
    Confidence.low: Confidence.low,
    Confidence.none: Confidence.none,
}


def _age_min(now: datetime, ts: datetime) -> float:
    return (now - ts).total_seconds() / 60.0


def _recency(age_min: float, half_life_min: float) -> float:
    return float(0.5 ** (age_min / half_life_min))


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def crowd_from_ratio(ratio: float, params: Params | None = None) -> Crowd:
    p = params or Params()
    if ratio < p.easy_below:
        return Crowd.easy
    if ratio < p.packed_at:
        return Crowd.busy
    return Crowd.packed


def _join(parts: list[str]) -> str:
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def _basis_text(reports: int, timers: int, staff: bool, window: int) -> str:
    parts: list[str] = []
    if reports:
        parts.append(_plural(reports, "report"))
    if timers:
        parts.append(_plural(timers, "timer"))
    if staff:
        parts.append("staff counts")
    if not parts:  # pragma: no cover (callers only reach here with data)
        return "No recent data"
    return f"Based on {_join(parts)} in the last {window} min"


def _report_weight(r: ReportIn, inp: EstimateInput) -> float:
    p = inp.params
    w = _recency(_age_min(inp.now, r.ts), p.half_life_min)
    w *= inp.reliability.get(r.user_id, p.default_reliability)
    if not r.near_bar:
        w *= p.far_report_weight
    return w


def _vote(reports: Sequence[ReportIn], inp: EstimateInput) -> Crowd | None:
    totals: dict[Crowd, float] = defaultdict(float)
    for r in reports:
        if r.crowd_level is None:
            continue
        try:
            level = Crowd(r.crowd_level)
        except ValueError:
            continue
        totals[level] += _report_weight(r, inp)
    if not totals:
        return None
    # Highest weight wins. Ties go to the busier level.
    return max(totals, key=lambda lv: (totals[lv], _CROWD_ORDER[lv]))


def _timer_wait(timers: Sequence[TimerIn], inp: EstimateInput) -> tuple[float, int] | None:
    """Recency and reliability weighted median of trimmed durations, and how many were used."""
    p = inp.params
    rows: list[tuple[float, float]] = []  # (duration, weight)
    for t in timers:
        if t.ended_at is None:  # pragma: no cover (callers pass completed timers)
            continue
        duration = (t.ended_at - t.started_at).total_seconds() / 60.0
        if duration < 0:
            continue
        w = _recency(_age_min(inp.now, t.ended_at), p.half_life_min)
        w *= inp.reliability.get(t.user_id, p.default_reliability)
        rows.append((duration, w))
    if not rows:
        return None
    if len(rows) >= 4:
        values = [d for d, _ in rows]
        center = median(values)
        spread = 3 * mad(values)
        rows = [(d, w) for d, w in rows if abs(d - center) <= spread]
    result = weighted_median(rows)
    if result is None:  # pragma: no cover (rows is never empty here)
        return None
    return result, len(rows)


def _no_data(inp: EstimateInput) -> Estimate:
    return Estimate(
        has_recent_data=False,
        wait_min=None,
        wait_low_min=None,
        wait_high_min=None,
        crowd_level=None,
        headcount=None,
        capacity=inp.capacity,
        capacity_ratio=None,
        capacity_mode=False,
        people_in_line=None,
        entry_rate_per_min=None,
        confidence=Confidence.none,
        method="none",
        basis=Basis(
            window_min=int(inp.params.window_min),
            reports=0,
            timers=0,
            door_events=0,
            staff_line_updates=0,
            text="No recent data",
        ),
    )


def estimate(inp: EstimateInput) -> Estimate:
    p = inp.params
    now = inp.now

    def in_window(ts: datetime, span: float) -> bool:
        return 0 <= _age_min(now, ts) <= span

    reports = [r for r in inp.reports if in_window(r.ts, p.window_min)]
    lines = [s for s in inp.line_statuses if in_window(s.ts, p.window_min)]
    done = [t for t in inp.timers if t.ended_at and in_window(t.ended_at, p.window_min)]
    active = [
        t
        for t in inp.timers
        if t.ended_at is None and in_window(t.started_at, ACTIVE_TIMER_MAX_AGE_MIN)
    ]
    active_recent = [t for t in active if in_window(t.started_at, p.window_min)]
    doors_all = [e for e in inp.door_events if _age_min(now, e.ts) >= 0]
    doors_window = [e for e in doors_all if in_window(e.ts, p.window_min)]
    doors_rate = [e for e in doors_all if in_window(e.ts, p.rate_window_min)]

    if not (reports or lines or done or active_recent or doors_window):
        return _no_data(inp)

    window = int(p.window_min)
    n_timers = len(done) + len(active_recent)
    # Door events between the rate window and the full window still count as staff data.
    staff_counts = bool(doors_window or lines)
    basis = Basis(
        window_min=window,
        reports=len(reports),
        timers=n_timers,
        door_events=len(doors_rate),
        staff_line_updates=len(lines),
        text=_basis_text(len(reports), n_timers, staff_counts, window),
    )

    # Headcount and crowd level.
    headcount: int | None = None
    ratio: float | None = None
    door_crowd: Crowd | None = None
    if doors_all:
        ins = sum(e.count for e in doors_all if e.direction == "in")
        outs = sum(e.count for e in doors_all if e.direction == "out")
        headcount = max(0, ins - outs)
        if inp.capacity > 0:
            ratio = headcount / inp.capacity
            door_crowd = crowd_from_ratio(ratio, p)
    vote = _vote(reports, inp)
    crowd = door_crowd or vote
    flags: list[str] = []
    if door_crowd is not None and vote is not None:
        gap = abs(_CROWD_ORDER[door_crowd] - _CROWD_ORDER[vote])
        if gap >= p.mismatch_threshold:
            flags.append("staff_report_mismatch")

    # Rates.
    capacity_mode = ratio is not None and ratio >= p.capacity_mode_ratio
    entry_rate: float | None = None
    rate_known = bool(doors_all)
    if rate_known:
        direction = "out" if capacity_mode else "in"
        moved = sum(e.count for e in doors_rate if e.direction == direction)
        entry_rate = max(p.min_rate_per_min, moved / p.rate_window_min)

    # People in line. A staff status wins, then reports. Active timers set a floor.
    people: float | None = None
    people_from_staff = False
    if lines:
        latest = max(lines, key=lambda s: s.ts)
        if latest.line_size in LINE_SIZE_PEOPLE:
            people = float(LINE_SIZE_PEOPLE[latest.line_size])
            people_from_staff = True
    if people is None:
        sized = [
            (float(LINE_SIZE_PEOPLE[r.line_size]), _report_weight(r, inp))
            for r in reports
            if r.line_size is not None and r.line_size in LINE_SIZE_PEOPLE
        ]
        people = weighted_median(sized)
    if active:
        people = max(people or 0.0, float(len(active)))
    people_in_line = int(people) if people is not None else None

    # Waits.
    formula_wait: float | None = None
    method = "none"
    if people_in_line is not None:
        if rate_known or people_from_staff:
            entry_rate = entry_rate if entry_rate is not None else DEFAULT_RATE_PER_MIN
            formula_wait = people_in_line / entry_rate * inp.calibration
            method = "formula"
        else:
            entry_rate = DEFAULT_RATE_PER_MIN
            formula_wait = people_in_line / DEFAULT_RATE_PER_MIN
            method = "reports"

    timer_result = _timer_wait(done, inp)
    wait: float | None = formula_wait
    if timer_result is not None:
        if method == "formula":
            n = timer_result[1]
            weight = n / (n + 2)
            wait = weight * timer_result[0] + (1 - weight) * (formula_wait or 0.0)
            method = "blend"
        else:
            # Timers beat a report only guess.
            wait = timer_result[0]
            method = "timers"
    if wait is not None:
        wait = _clamp(wait, 0.0, p.max_wait_min)
        if people_in_line == 0:
            wait = 0.0

    # Confidence.
    score = 0.0
    if lines:
        score += 2
    if doors_rate:
        score += 2
    score += min(3, len(done))
    score += min(2.0, 0.5 * sum(1 for r in reports if r.near_bar))
    if score >= 4:
        conf = Confidence.high
    elif score >= 2:
        conf = Confidence.medium
    else:
        conf = Confidence.low
    if method == "reports":
        conf = Confidence.low
    if flags:
        conf = _CONF_DOWN[conf]

    low = high = None
    if wait is not None:
        lo_m, hi_m = LOW_RANGE if conf == Confidence.low else NORMAL_RANGE
        low = _clamp(wait * lo_m, 0.0, p.max_wait_min)
        high = _clamp(wait * hi_m, 0.0, p.max_wait_min)

    return Estimate(
        has_recent_data=True,
        wait_min=wait,
        wait_low_min=low,
        wait_high_min=high,
        crowd_level=crowd,
        headcount=headcount,
        capacity=inp.capacity,
        capacity_ratio=ratio,
        capacity_mode=capacity_mode,
        people_in_line=people_in_line,
        entry_rate_per_min=entry_rate,
        confidence=conf,
        method=method,
        basis=basis,
        flags=tuple(flags),
    )


def _price(cents: int) -> str:
    dollars, rem = divmod(cents, 100)
    return f"${dollars}" if rem == 0 else f"${dollars}.{rem:02d}"


def verdict(est: Estimate, threshold_min: int, pass_price_cents: int | None) -> Verdict:
    def make(rec: Recommendation, text: str, saved: float | None = None) -> Verdict:
        return Verdict(
            recommendation=rec,
            threshold_min=threshold_min,
            pass_price_cents=pass_price_cents,
            minutes_saved=saved,
            text=text,
        )

    if not est.has_recent_data:
        return make(Recommendation.no_data, "No recent data. No call yet.")
    if est.wait_min is None:
        return make(Recommendation.no_data, "Not enough line data. No call yet.")
    wait = est.wait_min
    shown = int(wait + 0.5)
    if shown > threshold_min:
        if pass_price_cents is not None:
            return make(
                Recommendation.buy_pass,
                f"Get the pass. Line is about {shown} min, over your {threshold_min} min "
                f"limit. Pass is {_price(pass_price_cents)}.",
                wait,
            )
        return make(
            Recommendation.no_pass_available,
            f"Long line. About {shown} min, over your {threshold_min} min limit. "
            "No pass sold here.",
        )
    return make(
        Recommendation.wait_it_out,
        f"Wait it out. About {shown} min, under your {threshold_min} min limit.",
    )


def calibration_factor(
    points: Sequence[CalibrationPoint], now: datetime, params: Params | None = None
) -> float:
    p = params or Params()
    cutoff = timedelta(minutes=p.calibration_window_min)
    pairs: list[tuple[float, float]] = []
    for pt in points:
        age = now - pt.ts
        if age < timedelta(0) or age > cutoff or pt.predicted_min < 2.0:
            continue
        w = _recency(_age_min(now, pt.ts), p.half_life_min)
        pairs.append((pt.actual_min / pt.predicted_min, w))
    result = weighted_median(pairs)
    if result is None:
        return 1.0
    return _clamp(result, p.calibration_min, p.calibration_max)


def update_reliability(current: float, predicted: float, observed: float) -> float:
    """Nudge a user's reliability toward how close their input was to the consensus."""
    error = abs(observed - predicted) / max(predicted, 5.0)
    target = max(0.0, 1.0 - error)
    return _clamp(current + 0.2 * (target - current), 0.05, 1.0)
