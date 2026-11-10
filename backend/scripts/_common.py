"""Shared helpers for the dev seed and the night simulator. Everything here is FAKE data."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Bar, Role, User, utcnow
from app.services.auth import phone_hash

ADMIN_PHONE = "+15550000001"
STAFF_PHONE_BASE = 5550001000  # +1 555 000 1000 + bar index
USER_PHONE_BASE = 5551000000  # +1 555 100 0000 + user index
USER_POOL_SIZE = 160
LIAR_EVERY = 10  # every 10th pool user lies in crowd reports


@dataclass(frozen=True)
class FakeBarSpec:
    slug: str
    name: str
    address: str
    latitude: float
    longitude: float
    capacity: int
    pass_price_cents: int | None
    # Simulator knobs: relative demand and door speed (people per minute).
    popularity: float
    service_rate: float


# A made up spot in the open ocean (near 0.5 N, 0.5 E), far from any real town, so the public
# repo hints at no pilot location. A few hundred meters between bars.
FAKE_BARS: tuple[FakeBarSpec, ...] = (
    FakeBarSpec(
        "fake-tipsy-owl",
        "FAKE The Tipsy Owl",
        "FAKE 100 Example Ave",
        0.5000,
        0.5000,
        120,
        1500,
        1.15,
        3.2,
    ),
    FakeBarSpec(
        "fake-copper-fox",
        "FAKE Copper Fox",
        "FAKE 200 Example Ave",
        0.5028,
        0.5022,
        180,
        2000,
        1.0,
        4.0,
    ),
    FakeBarSpec(
        "fake-neon-moose",
        "FAKE Neon Moose",
        "FAKE 300 Example Ave",
        0.4985,
        0.5055,
        250,
        None,
        0.9,
        5.0,
    ),
)
FAKE_SLUGS = tuple(b.slug for b in FAKE_BARS)


def require_dev_env() -> None:
    env = get_settings().env
    if env not in ("dev", "test"):
        raise SystemExit(f"Refusing to run: CROWDED_ENV is {env!r}. Use dev or test.")


def staff_phone(bar_index: int) -> str:
    return f"+1{STAFF_PHONE_BASE + bar_index}"


def user_phone(index: int) -> str:
    return f"+1{USER_PHONE_BASE + index}"


def all_sim_phones() -> list[str]:
    """Every phone number the seed and simulator can create. All are +1555 numbers."""
    phones = [ADMIN_PHONE]
    phones += [staff_phone(i) for i in range(len(FAKE_BARS))]
    phones += [user_phone(i) for i in range(USER_POOL_SIZE)]
    return phones


def get_or_create_user(db: Session, phone: str, role: Role) -> User:
    if not phone.startswith("+1555"):
        raise ValueError("fake users only")
    h = phone_hash(phone)
    user = db.scalar(select(User).where(User.phone_hash == h))
    if user is None:
        user = User(
            phone_hash=h,
            phone_last2=phone[-2:],
            role=role,
            age_attested_at=utcnow(),
        )
        db.add(user)
        db.flush()
    return user


def fake_bars(db: Session) -> list[Bar]:
    """The seeded FAKE bars, in seed order. Raises SystemExit when the seed has not run."""
    by_slug = {b.slug: b for b in db.scalars(select(Bar).where(Bar.slug.in_(FAKE_SLUGS)))}
    missing = [s for s in FAKE_SLUGS if s not in by_slug]
    if missing:
        raise SystemExit("FAKE bars not found. Run scripts/seed.py first.")
    return [by_slug[s] for s in FAKE_SLUGS]
