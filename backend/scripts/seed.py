"""Idempotent dev seed: 3 FAKE bars, a FAKE admin, pass prices and staff invite codes.

Usage (from backend/): uv run python scripts/seed.py
Refuses to run unless CROWDED_ENV is dev or test. All data is FAKE.
"""

from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.v1.staff import invite_hash
from app.core.security import new_invite_code
from app.db import get_sessionmaker
from app.models import Bar, BarSpecial, PassPrice, Role, SpecialKind, StaffInvite, utcnow
from scripts._common import (
    ADMIN_PHONE,
    FAKE_BARS,
    get_or_create_user,
    require_dev_env,
)

# (kind, title, details, days, start, end, price_cents). All FAKE, no real brands.
FakeSpecial = tuple[SpecialKind, str, str, list[int], str, str, int | None]
WEEKDAYS = [0, 1, 2, 3, 4]
SPECIALS: dict[str, list[FakeSpecial]] = {
    "fake-tipsy-owl": [
        (
            SpecialKind.happy_hour,
            "FAKE Early Hour",
            "Half off wells",
            WEEKDAYS,
            "17:00",
            "20:00",
            None,
        ),
        (SpecialKind.cover, "FAKE Cover", "Cash or card", [3, 4, 5], "21:00", "02:00", 500),
        (SpecialKind.food, "FAKE Wing Night", "Ten wings", [2], "18:00", "22:00", 700),
        (SpecialKind.event, "FAKE Trivia", "Teams of up to six", [3], "20:00", "22:00", None),
    ],
    "fake-copper-fox": [
        (
            SpecialKind.cover,
            "FAKE Cover",
            "Every night",
            [0, 1, 2, 3, 4, 5, 6],
            "18:00",
            "02:00",
            300,
        ),
        (
            SpecialKind.happy_hour,
            "FAKE Fox Hour",
            "Two for one drafts",
            WEEKDAYS,
            "16:00",
            "19:00",
            None,
        ),
        (
            SpecialKind.drink,
            "FAKE Pitcher Deal",
            "Pitchers at a set price",
            [1, 3],
            "20:00",
            "00:00",
            1200,
        ),
        (SpecialKind.event, "FAKE Live Band", "Local act", [4, 5], "22:00", "01:00", None),
        (
            SpecialKind.food,
            "FAKE Lunch Special",
            "Burger and a soda",
            WEEKDAYS,
            "11:00",
            "14:00",
            900,
        ),
    ],
    "fake-neon-moose": [
        (
            SpecialKind.happy_hour,
            "FAKE Moose Hour",
            "Cheap rail drinks",
            WEEKDAYS,
            "17:00",
            "20:00",
            None,
        ),
        (SpecialKind.cover, "FAKE Cover", "After ten", [4, 5], "22:00", "03:00", 500),
        (SpecialKind.event, "FAKE Karaoke", "Sign up at the bar", [3], "21:00", "01:00", None),
    ],
}


def run(db: Session) -> dict[str, str]:
    """Create or update the seed data. Returns {bar slug: fresh invite code}."""
    admin = get_or_create_user(db, ADMIN_PHONE, Role.admin)
    admin.role = Role.admin
    now = utcnow()
    codes: dict[str, str] = {}
    for spec in FAKE_BARS:
        bar = db.scalar(select(Bar).where(Bar.slug == spec.slug))
        if bar is None:
            bar = Bar(slug=spec.slug, name=spec.name, latitude=0.0, longitude=0.0, capacity=1)
            db.add(bar)
        bar.name = spec.name
        bar.address = spec.address
        bar.latitude = spec.latitude
        bar.longitude = spec.longitude
        bar.capacity = spec.capacity
        bar.timezone = "America/New_York"
        bar.is_active = True
        db.flush()

        latest = db.scalars(
            select(PassPrice)
            .where(PassPrice.bar_id == bar.id)
            .order_by(PassPrice.created_at.desc())
            .limit(1)
        ).first()
        if latest is None or latest.price_cents != spec.pass_price_cents:
            db.add(
                PassPrice(
                    bar_id=bar.id,
                    price_cents=spec.pass_price_cents,
                    set_by=admin.id,
                    created_at=now,
                )
            )

        # Old unredeemed invites are revoked so each run leaves exactly one live code per bar.
        for old in db.scalars(
            select(StaffInvite).where(
                StaffInvite.bar_id == bar.id,
                StaffInvite.redeemed_at.is_(None),
                StaffInvite.revoked_at.is_(None),
            )
        ):
            old.revoked_at = now
        code = new_invite_code()
        db.add(
            StaffInvite(
                bar_id=bar.id,
                code_hash=invite_hash(code),
                created_by=admin.id,
                expires_at=now + timedelta(days=7),
            )
        )
        codes[spec.slug] = code

        db.execute(delete(BarSpecial).where(BarSpecial.bar_id == bar.id))
        for kind, title, details, days, start, end, cents in SPECIALS.get(spec.slug, []):
            db.add(
                BarSpecial(
                    bar_id=bar.id,
                    kind=kind,
                    title=title,
                    details=details,
                    days=days,
                    start_local=start,
                    end_local=end,
                    price_cents=cents,
                    posted_by_role="admin",
                    created_by=admin.id,
                )
            )
    db.commit()
    return codes


def main() -> None:
    require_dev_env()
    with get_sessionmaker()() as db:
        codes = run(db)
    print("Seeded 3 FAKE bars:")
    for spec in FAKE_BARS:
        price = (
            "no pass" if spec.pass_price_cents is None else f"${spec.pass_price_cents / 100:.0f}"
        )
        print(
            f"  {spec.name:22} cap {spec.capacity:3}  pass {price:8}  "
            f"staff invite {codes[spec.slug]}"
        )
    print()
    print(f"FAKE admin phone: {ADMIN_PHONE}")
    print("Log in (dev builds return the code in the response):")
    print(
        '  curl -s localhost:8000/v1/auth/request-code -H "content-type: application/json" '
        f'-d \'{{"phone": "{ADMIN_PHONE}"}}\''
    )
    print(
        '  curl -s localhost:8000/v1/auth/verify-code -H "content-type: application/json" '
        f'-d \'{{"phone": "{ADMIN_PHONE}", "code": "<dev_code>", '
        '"age_attested": true, "platform": "web"}\''
    )
    print("Staff invites are single use. Running this script again replaces them.")


if __name__ == "__main__":
    main()
