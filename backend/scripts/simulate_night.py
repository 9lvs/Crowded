"""Simulate FAKE bar nights straight into the database, with backdated timestamps.

Writes through the ORM (not HTTP) so wait-by-hour charts, snapshots, estimate_errors and
calibration all get real looking history. Estimates come from the production code path
(`app.services.live.compute`). Run scripts/seed.py first. All data is FAKE.

Examples (from backend/):
  uv run python scripts/simulate_night.py --reset --nights thu,fri,sat --weeks-ago 1
  uv run python scripts/simulate_night.py --nights thu,fri,sat --weeks-ago 0
  uv run python scripts/simulate_night.py --live        # current night, up to now

Run older weeks first (or pass --weeks-ago more than once, we sort oldest first). Running the
same night twice stacks duplicate data, so use --reset to start over.
"""

from __future__ import annotations

import argparse
import itertools
import math
import random
import sys
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import estimation as est
from app.db import get_sessionmaker
from app.estimation import types as est_types
from app.models import (
    Bar,
    BarSnapshot,
    BarStaff,
    CrowdLevel,
    CrowdReport,
    DistanceBucket,
    DoorDirection,
    DoorEvent,
    EstimateError,
    LineSession,
    LineSize,
    OutsideLineStatus,
    Role,
    SessionStatus,
    User,
)
from app.services import activity, live
from app.services.auth import phone_hash
from scripts._common import (
    FAKE_BARS,
    LIAR_EVERY,
    USER_POOL_SIZE,
    FakeBarSpec,
    all_sim_phones,
    fake_bars,
    get_or_create_user,
    require_dev_env,
    staff_phone,
    user_phone,
)

MINUTE = timedelta(minutes=1)
NIGHT_MINUTES = 360  # 8pm to 2am
PEAK_MINUTE = 210  # 11:30pm
LAST_ADMIT_MINUTE = 330  # door closes at 1:30am
ESTIMATE_EVERY = 3  # simulated minutes between production estimate calls
STAFF_LINE_EVERY = 10
TIMER_SHARE = 0.07  # share of arrivals who run a timer
FAR_TIMER_SHARE = 0.10
GIVE_UP_SHARE = 0.07  # of timer users
BALK_QUEUE = 45.0  # arrivals are scaled by 1 / (1 + queue / BALK_QUEUE)
BIASED_SLUG = "fake-copper-fox"  # the bar whose staff member is biased
TZ = ZoneInfo("America/New_York")

# (minutes after 8pm, relative arrival intensity)
CURVE: tuple[tuple[float, float], ...] = (
    (0, 0.05),
    (60, 0.15),
    (120, 0.35),
    (180, 0.75),
    (210, 1.0),
    (270, 1.0),
    (315, 0.55),
    (345, 0.2),
    (360, 0.1),
)
NIGHT_NAMES = {"thu": 3, "fri": 4, "sat": 5}
WEEKDAY_FACTOR = {0: 0.3, 1: 0.35, 2: 0.45, 3: 0.55, 4: 0.85, 5: 1.0, 6: 0.35}
LINE_ORDER = [LineSize.none, LineSize.short, LineSize.medium, LineSize.long, LineSize.very_long]
CROWD_ORDER = [CrowdLevel.easy, CrowdLevel.busy, CrowdLevel.packed]


def intensity(minute: float) -> float:
    if minute <= CURVE[0][0]:
        return CURVE[0][1]
    for (m0, v0), (m1, v1) in itertools.pairwise(CURVE):
        if minute <= m1:
            return v0 + (v1 - v0) * (minute - m0) / (m1 - m0)
    return CURVE[-1][1]


def poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    limit = math.exp(-lam)
    k = 0
    p = rng.random()
    while p > limit:
        k += 1
        p *= rng.random()
    return k


def line_bucket(people: float) -> LineSize:
    """Same buckets the models document: 0, 1 to 10, 11 to 25, 26 to 50, 50+."""
    n = round(people)
    if n <= 0:
        return LineSize.none
    if n <= 10:
        return LineSize.short
    if n <= 25:
        return LineSize.medium
    if n <= 50:
        return LineSize.long
    return LineSize.very_long


def crowd_for(ratio: float) -> CrowdLevel:
    if ratio < 0.60:
        return CrowdLevel.easy
    if ratio < 0.90:
        return CrowdLevel.busy
    return CrowdLevel.packed


@dataclass
class NightPlan:
    label: str
    start: datetime  # UTC instant of virtual 8pm
    first_minute: int
    end_minute: int  # exclusive
    factor: float
    is_live: bool = False


@dataclass
class Person:
    arrival: datetime
    session: LineSession | None = None
    user: User | None = None
    give_up_at: datetime | None = None
    extra_min: float = 0.0


@dataclass
class Pending:
    finish: datetime
    actual: float
    person: Person


@dataclass
class BarStats:
    name: str
    peak_headcount: int = 0
    peak_est_wait: float = 0.0
    peak_actual_wait: float = 0.0
    timers_done: int = 0
    timers_abandoned: int = 0
    reports: int = 0
    snapshots: int = 0
    fresh_intervals: int = 0
    peak_intervals: int = 0
    disagree_samples: int = 0
    staff_reliability: float | None = None
    errors: list[float] = field(default_factory=list)  # predicted - actual

    @property
    def freshness(self) -> float | None:
        return self.fresh_intervals / self.peak_intervals if self.peak_intervals else None

    @property
    def mae(self) -> float | None:
        return sum(abs(e) for e in self.errors) / len(self.errors) if self.errors else None

    @property
    def bias(self) -> float | None:
        return sum(self.errors) / len(self.errors) if self.errors else None


@dataclass
class BarState:
    bar: Bar
    spec: FakeBarSpec
    staff: User
    stats: BarStats
    queue: deque[Person] = field(default_factory=deque)
    pending: list[Pending] = field(default_factory=list)
    inside: int = 0
    last_staff: tuple[datetime, LineSize] | None = None
    lazy_done: bool = False


def shift(order: list[LineSize] | list[CrowdLevel], value: LineSize | CrowdLevel, by: int) -> int:
    idx = order.index(value)  # type: ignore[arg-type]
    return max(0, min(len(order) - 1, idx + by))


class Simulator:
    def __init__(
        self,
        db: Session,
        seed: int,
        staff_bias: str = "none",
        report_rate: float = 1.0,
        estimate_every: int = ESTIMATE_EVERY,
    ) -> None:
        self.db = db
        self.staff_bias = staff_bias
        self.report_rate = report_rate
        self.estimate_every = estimate_every
        self.seed = seed
        # Reproducible fake data, not security.
        self.rng = random.Random(seed)  # nosec B311
        self.bars = fake_bars(db)
        self.users = [
            get_or_create_user(db, user_phone(i), Role.user) for i in range(USER_POOL_SIZE)
        ]
        self.liars = {u.id for i, u in enumerate(self.users) if i % LIAR_EVERY == 0}
        self.busy: set[uuid.UUID] = set()
        # (user, bar) pairs that already wrote tonight's calibration point (one per night).
        self.calibrated: set[tuple[uuid.UUID, uuid.UUID]] = set()
        self.states: list[BarState] = []
        for i, (bar, spec) in enumerate(zip(self.bars, FAKE_BARS, strict=True)):
            staff = get_or_create_user(db, staff_phone(i), Role.staff)
            if db.scalar(select(BarStaff).where(BarStaff.user_id == staff.id)) is None:
                db.add(BarStaff(bar_id=bar.id, user_id=staff.id))
            self.states.append(BarState(bar, spec, staff, BarStats(bar.name)))
        db.commit()

    # ---- production estimate -------------------------------------------------------------
    def compute(self, bar: Bar, now: datetime) -> live.Live:
        self.db.flush()  # the session does not autoflush
        return live.compute(self.db, bar, now=now)

    def free_user(self) -> User | None:
        for _ in range(12):
            u = self.rng.choice(self.users)
            if u.id not in self.busy:
                return u
        return None

    # ---- one night ------------------------------------------------------------------------
    def run_night(self, plan: NightPlan) -> None:
        # Same seed and night give the same data. nosec B311: fake data, not security.
        self.rng = random.Random(f"{self.seed}:{plan.label}")  # nosec B311
        self.calibrated.clear()
        for s in self.states:
            s.queue.clear()
            s.pending.clear()
            s.inside = 0
            s.last_staff = None
            s.lazy_done = False
        for m in range(plan.first_minute, plan.end_minute):
            t = plan.start + m * MINUTE
            for s in self.states:
                self.step_bar(s, plan, m, t)
            self.db.commit()
            if (m - plan.first_minute) % self.estimate_every == self.estimate_every - 1:
                for s in self.states:
                    result = self.compute(s.bar, t + MINUTE)
                    s.stats.snapshots += 1
                    wait = result.estimate.wait_min
                    if "sources_disagree" in result.estimate.flags:
                        s.stats.disagree_samples += 1
                    mm = m + 1
                    if 120 < mm <= 300 and mm % 15 == 0:  # 10pm to 1am, 15 minute intervals
                        s.stats.peak_intervals += 1
                        s.stats.fresh_intervals += int(result.estimate.has_recent_data)
                    if wait is not None:
                        s.stats.peak_est_wait = max(s.stats.peak_est_wait, wait)
        end = plan.start + plan.end_minute * MINUTE
        if not plan.is_live:
            for s in self.states:
                self.close_night(s, end)
        self.db.commit()

    def close_night(self, s: BarState, end: datetime) -> None:
        for p in sorted(s.pending, key=lambda x: x.finish):
            self.complete(s, p)
        s.pending.clear()
        for person in s.queue:
            if person.session is not None and person.user is not None:
                self.abandon(s, person, end)
        s.queue.clear()

    def step_bar(self, s: BarState, plan: NightPlan, m: int, t: datetime) -> None:
        rng, db = self.rng, self.db
        cap = s.spec.capacity
        level = intensity(m) * plan.factor * s.spec.popularity

        # Arrivals join the outside line. Long lines scare people off.
        lam = level * cap / 36.0 / (1 + len(s.queue) / BALK_QUEUE)
        if m >= LAST_ADMIT_MINUTE:  # door is closed, nobody joins a dead line
            lam = 0.0
        times = sorted(t + timedelta(seconds=rng.random() * 60) for _ in range(poisson(rng, lam)))
        for at in times:
            person = Person(arrival=at)
            user = self.free_user() if rng.random() < TIMER_SHARE else None
            if user is not None:
                self.start_timer(s, person, user, at)
            s.queue.append(person)

        # People who give up leave the line.
        for person in list(s.queue):
            if person.give_up_at is not None and person.give_up_at <= t:
                s.queue.remove(person)
                self.abandon(s, person, person.give_up_at)

        if m == LAST_ADMIT_MINUTE:  # last call: whoever is still outside goes home
            for person in s.queue:
                self.abandon(s, person, t)
            s.queue.clear()

        # Exits first, then the door admits into whatever room is left.
        if m < 270:
            leave_p = 1 / 75
        elif m < 300:
            leave_p = 1 / 40
        elif m < 330:
            leave_p = 1 / 18
        else:
            leave_p = 1 / 8
        exits = min(s.inside, poisson(rng, s.inside * leave_p))
        s.inside -= exits
        admitted: list[Person] = []
        if m < LAST_ADMIT_MINUTE:
            rate = s.spec.service_rate * (0.85 + 0.3 * rng.random())
            n = int(rate) + (1 if rng.random() < rate - int(rate) else 0)
            n = min(n, len(s.queue), cap - s.inside)
            admitted = [s.queue.popleft() for _ in range(max(0, n))]
        s.inside += len(admitted)
        s.stats.peak_headcount = max(s.stats.peak_headcount, s.inside)

        # Timer users get through the door. They tap "inside" a little later.
        admit_times = sorted(t + timedelta(seconds=rng.random() * 60) for _ in admitted)
        for person, at in zip(admitted, admit_times, strict=True):
            if person.session is None:
                continue
            wait = (at - person.arrival).total_seconds() / 60
            actual = wait + 0.4 + 0.8 * rng.random() + rng.gauss(0, 0.06 * wait + 0.3)
            actual = max(0.6, actual + person.extra_min)
            finish = max(person.arrival + timedelta(minutes=actual), at + timedelta(seconds=20))
            s.pending.append(
                Pending(finish, (finish - person.arrival).total_seconds() / 60, person)
            )

        # Staff tap the door counter in small groups.
        self.door_events(s, DoorDirection.in_, len(admitted), t)
        self.door_events(s, DoorDirection.out, exits, t)
        biased = self.staff_bias != "none" and s.spec.slug == BIASED_SLUG
        lazy_skip = biased and self.staff_bias == "lazy" and s.lazy_done
        if m % STAFF_LINE_EVERY == 0 and not lazy_skip:
            size = line_bucket(len(s.queue) * rng.gauss(1.0, 0.12))
            if biased and self.staff_bias == "inflate":  # hyping the line to sell passes
                size = LINE_ORDER[min(4, LINE_ORDER.index(size) + 2)]
            s.lazy_done = True
            ts = t + timedelta(seconds=55)
            db.add(
                OutsideLineStatus(bar_id=s.bar.id, staff_user_id=s.staff.id, ts=ts, line_size=size)
            )
            s.last_staff = (ts, size)

        # Crowd reports.
        for _ in range(poisson(rng, (0.04 + 0.2 * level) * self.report_rate)):
            self.report(s, t + timedelta(seconds=rng.random() * 60))

        # Users who tapped "inside" by the end of this minute.
        due = [p for p in s.pending if p.finish <= t + MINUTE]
        for p in sorted(due, key=lambda x: x.finish):
            self.complete(s, p)
        s.pending = [p for p in s.pending if p.finish > t + MINUTE]

    def door_events(self, s: BarState, direction: DoorDirection, total: int, t: datetime) -> None:
        left = total
        while left > 0:
            c = min(left, self.rng.randint(1, 5))
            left -= c
            ts = t + timedelta(seconds=self.rng.random() * 60)
            self.db.add(
                DoorEvent(
                    bar_id=s.bar.id, staff_user_id=s.staff.id, ts=ts, direction=direction, count=c
                )
            )

    # ---- timers ----------------------------------------------------------------------------
    def start_timer(self, s: BarState, person: Person, user: User, at: datetime) -> None:
        rng = self.rng
        current = self.compute(s.bar, at)
        far = rng.random() < FAR_TIMER_SHARE
        bucket = (
            DistanceBucket.far
            if far
            else rng.choice([DistanceBucket.at_door, DistanceBucket.nearby])
        )
        session = LineSession(
            user_id=user.id,
            bar_id=s.bar.id,
            status=SessionStatus.active,
            started_at=at,
            predicted_wait_min=current.estimate.wait_min,
            entry_rate_at_start=current.estimate.entry_rate_per_min,
            formula_wait_min=live.raw_formula_wait(current.estimate),
            near_bar=not far,
            distance_bucket=bucket,
        )
        self.db.add(session)
        person.session = session
        person.user = user
        if far:  # tapped from down the street, so the timer runs long
            person.extra_min = 3 + 5 * rng.random()
        if rng.random() < GIVE_UP_SHARE:
            person.give_up_at = at + timedelta(minutes=6 + 19 * rng.random())
        self.busy.add(user.id)

    def abandon(self, s: BarState, person: Person, at: datetime) -> None:
        if person.session is None or person.user is None:
            return
        person.session.status = SessionStatus.abandoned
        person.session.ended_at = at
        self.busy.discard(person.user.id)
        s.stats.timers_abandoned += 1

    def complete(self, s: BarState, p: Pending) -> None:
        """Mirror app.services.activity.end_session for outcome 'inside'."""
        session, user = p.person.session, p.person.user
        if session is None or user is None:
            raise RuntimeError("finished timer without a session")
        session.ended_at = p.finish
        self.busy.discard(user.id)
        if not (0.5 <= p.actual <= 240.0):
            session.status = SessionStatus.abandoned
            return
        session.status = SessionStatus.completed
        session.actual_wait_min = p.actual
        s.stats.timers_done += 1
        s.stats.peak_actual_wait = max(s.stats.peak_actual_wait, p.actual)
        predicted = session.predicted_wait_min
        if predicted is not None:
            self.record_error(s, session, user, predicted, p)
        if session.near_bar:
            # Same call production makes: the timer referees the staff and student line claims.
            self.db.flush()
            activity._score_line_sources(self.db, session, p.actual)

    def record_error(
        self, s: BarState, session: LineSession, user: User, predicted: float, p: Pending
    ) -> None:
        # Same rule as production: trusted timers only, one point per user per bar per night.
        key = (user.id, s.bar.id)
        eligible = session.near_bar and key not in self.calibrated
        if eligible:
            self.calibrated.add(key)
            session.calibration_eligible = True
        self.db.add(
            EstimateError(
                bar_id=s.bar.id,
                created_at=p.finish,
                predicted_min=predicted,
                formula_min=session.formula_wait_min,
                actual_min=p.actual,
                abs_error_min=abs(predicted - p.actual),
                source="timer",
                eligible=eligible,
            )
        )
        s.stats.errors.append(predicted - p.actual)
        if session.near_bar:
            user.reliability = est.update_reliability(user.reliability, predicted, p.actual)

    # ---- crowd reports -----------------------------------------------------------------------
    def report(self, s: BarState, at: datetime) -> None:
        rng = self.rng
        user = self.free_user()
        if user is None:
            return
        near = rng.random() < 0.6
        bucket = (
            rng.choice([DistanceBucket.at_door, DistanceBucket.nearby])
            if near
            else DistanceBucket.far
        )
        liar = user.id in self.liars
        noise_p = 0.15 if near else 0.35
        crowd = CROWD_ORDER[
            shift(
                CROWD_ORDER,
                crowd_for(s.inside / s.spec.capacity),
                rng.choice([-1, 1]) if rng.random() < noise_p else 0,
            )
        ]
        line = LINE_ORDER[
            shift(
                LINE_ORDER,
                line_bucket(len(s.queue)),
                rng.choice([-1, 1]) if rng.random() < noise_p else 0,
            )
        ]
        if liar:
            if crowd == CrowdLevel.busy:
                crowd = rng.choice([CrowdLevel.easy, CrowdLevel.packed])
            else:
                crowd = CROWD_ORDER[2 - CROWD_ORDER.index(crowd)]
            line = LINE_ORDER[4 - LINE_ORDER.index(line)]
        kind = rng.random()
        report_crowd: CrowdLevel | None = crowd if kind < 0.85 else None
        report_line: LineSize | None = line if kind > 0.15 else None
        self.db.add(
            CrowdReport(
                user_id=user.id,
                bar_id=s.bar.id,
                created_at=at,
                crowd_level=report_crowd,
                line_size=report_line,
                near_bar=near,
                distance_bucket=bucket,
            )
        )
        s.stats.reports += 1
        # Same reliability rule as app.services.activity.submit_report.
        if (
            report_line is not None
            and s.last_staff
            and at - s.last_staff[0] <= timedelta(minutes=10)
        ):
            user.reliability = est.update_reliability(
                user.reliability,
                float(est_types.LINE_SIZE_PEOPLE[s.last_staff[1].value]),
                float(est_types.LINE_SIZE_PEOPLE[report_line.value]),
            )


# ---- planning ----------------------------------------------------------------------------------
def local_start(day: datetime) -> datetime:
    return datetime.combine(day.date(), time(20, 0), tzinfo=TZ)


def backdated_plans(nights: list[str], weeks_ago: list[int], now: datetime) -> list[NightPlan]:
    today = now.astimezone(TZ)
    plans: list[NightPlan] = []
    for w in weeks_ago:
        for name in nights:
            weekday = NIGHT_NAMES[name]
            day = today - timedelta(days=(today.weekday() - weekday) % 7)
            if local_start(day) + timedelta(minutes=NIGHT_MINUTES) > now:
                day -= timedelta(days=7)
            day -= timedelta(days=7 * w)
            start = local_start(day)
            plans.append(
                NightPlan(
                    label=f"{name} {start:%Y-%m-%d}",
                    start=start.astimezone(UTC),
                    first_minute=0,
                    end_minute=NIGHT_MINUTES,
                    factor=WEEKDAY_FACTOR[weekday],
                )
            )
    return sorted(plans, key=lambda p: p.start)


def live_plan(bar: Bar, now: datetime) -> NightPlan:
    """The current night up to now. Outside 8pm to 2am the curve is shifted so now is 11:30pm."""
    local = now.astimezone(TZ)
    if local.hour >= 20 or local.hour < 2:
        day = local if local.hour >= 20 else local - timedelta(days=1)
        start = local_start(day).astimezone(UTC)
        end = min(NIGHT_MINUTES, int((now - start) / MINUTE))
        return NightPlan(
            "tonight (live)", start, 0, end, WEEKDAY_FACTOR[day.weekday()], is_live=True
        )
    start = now - PEAK_MINUTE * MINUTE
    available = int((now - live.tonight_start(bar, now)) / MINUTE)
    first = max(0, PEAK_MINUTE - available)
    return NightPlan(
        "tonight (live, shifted to peak)",
        start,
        first,
        PEAK_MINUTE,
        WEEKDAY_FACTOR[4],
        is_live=True,
    )


# ---- reset and reporting -----------------------------------------------------------------------
def reset(db: Session) -> None:
    """Delete simulated rows. Only rows linked to the FAKE bars and the FAKE sim users."""
    ids = [b.id for b in fake_bars(db)]
    for model in (
        DoorEvent,
        OutsideLineStatus,
        LineSession,
        CrowdReport,
        BarSnapshot,
        EstimateError,
    ):
        db.execute(delete(model).where(model.bar_id.in_(ids)))
    hashes = [phone_hash(p) for p in all_sim_phones()[1:]]  # keep the seed admin
    db.execute(delete(User).where(User.phone_hash.in_(hashes)))
    db.commit()


def simulate(
    db: Session,
    plans: list[NightPlan] | None = None,
    *,
    nights: list[str] | None = None,
    weeks_ago: list[int] | None = None,
    seed: int = 42,
    staff_bias: str = "none",
    report_rate: float = 1.0,
    estimate_every: int = ESTIMATE_EVERY,
) -> list[BarStats]:
    sim = Simulator(db, seed, staff_bias, report_rate, estimate_every)
    now = datetime.now(UTC)
    if plans is None:
        plans = backdated_plans(nights or ["thu", "fri", "sat"], weeks_ago or [0], now)
    for plan in plans:
        sim.run_night(plan)
    for st in sim.states:
        st.stats.staff_reliability = st.staff.reliability
    return [st.stats for st in sim.states]


def fmt(x: float | None, digits: int = 1) -> str:
    return "n/a" if x is None else f"{x:.{digits}f}"


def fmt_pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.0f}%"


def print_summary(stats: list[BarStats]) -> None:
    print("FAKE simulation summary (waits in minutes)")
    print(
        f"  {'bar':22} {'peak in':>7} {'peak est':>8} {'peak act':>8} "
        f"{'timers':>6} {'giveups':>7} {'reports':>7} {'MAE':>5} {'bias':>5} "
        f"{'fresh':>6} {'staff rel':>9}"
    )
    for st in stats:
        print(
            f"  {st.name:22} {st.peak_headcount:7} {st.peak_est_wait:8.1f} "
            f"{st.peak_actual_wait:8.1f} {st.timers_done:6} {st.timers_abandoned:7} "
            f"{st.reports:7} {fmt(st.mae):>5} {fmt(st.bias):>5} {fmt_pct(st.freshness):>6} "
            f"{fmt(st.staff_reliability, 2):>9}"
        )
    print("  bias = mean(predicted - actual). Positive means the estimate ran long.")
    print("  fresh = share of 15 min intervals from 10pm to 1am with recent data.")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--nights", default="thu,fri,sat", help="comma list of thu,fri,sat")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--weeks-ago",
        type=int,
        action="append",
        help="0 = most recent finished night, 1 = a week earlier. Repeatable.",
    )
    p.add_argument("--live", action="store_true", help="simulate the current night up to now")
    p.add_argument("--reset", action="store_true", help="delete earlier simulated data first")
    p.add_argument(
        "--staff-bias",
        choices=["none", "inflate", "lazy"],
        default="none",
        help="Copper Fox staff: inflate (line 2 steps too long) or lazy (set once, never update)",
    )
    p.add_argument(
        "--report-rate", type=float, default=1.0, help="multiplier on student report volume"
    )
    args = p.parse_args()
    require_dev_env()
    nights = [n.strip() for n in args.nights.split(",") if n.strip()]
    bad = [n for n in nights if n not in NIGHT_NAMES]
    if bad:
        p.error(f"unknown night(s): {', '.join(bad)}")
    with get_sessionmaker()() as db:
        if args.reset:
            reset(db)
            print("Reset: removed earlier simulated data for the FAKE bars.")
        now = datetime.now(UTC)
        if args.live:
            plans = [live_plan(fake_bars(db)[0], now)]
        else:
            plans = backdated_plans(nights, sorted(set(args.weeks_ago or [0])), now)
        for plan in plans:
            print(f"Night: {plan.label}")
        print_summary(
            simulate(
                db,
                plans,
                seed=args.seed,
                staff_bias=args.staff_bias,
                report_rate=args.report_rate,
            )
        )


if __name__ == "__main__":
    main()
