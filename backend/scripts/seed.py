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
from app.models import (
    Bar,
    BarSpecial,
    DealCategory,
    PassPrice,
    Role,
    SpecialKind,
    StaffInvite,
    StaffLevel,
    utcnow,
)
from scripts._common import (
    ADMIN_PHONE,
    FAKE_BARS,
    get_or_create_user,
    require_dev_env,
)

# Deal items are (name, price_label, category, note). All FAKE, no real brands.
Item = tuple[str, str, DealCategory, str]
# (kind, title, details, days, start, end, price_cents, all_day, items)
FakeSpecial = tuple[SpecialKind, str, str, list[int], str, str, int | None, bool, list[Item]]
WEEKDAYS = [0, 1, 2, 3, 4]
EVERY = [0, 1, 2, 3, 4, 5, 6]
B, P, S, M, W, F = (
    DealCategory.beer,
    DealCategory.pitchers,
    DealCategory.shots,
    DealCategory.mixers,
    DealCategory.wine,
    DealCategory.food,
)
K = SpecialKind
SPECIALS: dict[str, list[FakeSpecial]] = {
    "fake-tipsy-owl": [
        (
            K.drink,
            "FAKE All Night Drafts",
            "Every night",
            EVERY,
            "12:00",
            "04:00",
            None,
            True,
            [("FAKE Lager drafts", "$3", B, "")],
        ),
        (
            K.happy_hour,
            "FAKE Owl Hour",
            "Weekdays 9 to 11 PM",
            WEEKDAYS,
            "21:00",
            "23:00",
            None,
            False,
            [
                ("FAKE Regular drafts", "$3", B, ""),
                ("FAKE House shots", "$3", S, ""),
                ("FAKE House wine", "$3", W, ""),
                ("FAKE 32oz pitchers", "$5", P, ""),
            ],
        ),
        (K.event, "FAKE DJ Night", "DJ on the floor", [3], "21:00", "02:00", None, False, []),
        (
            K.food,
            "FAKE Wing Night",
            "Wednesday dinner",
            [2],
            "18:00",
            "22:00",
            None,
            False,
            [("FAKE Ten wings", "$7", F, "Dine in only")],
        ),
        (K.cover, "FAKE Cover", "Cash or card", [3, 4, 5], "21:00", "02:00", 500, False, []),
    ],
    "fake-copper-fox": [
        (K.cover, "FAKE Cover", "Every night", EVERY, "18:00", "02:00", 300, False, []),
        (
            K.happy_hour,
            "FAKE Fox Hour",
            "Weekdays 4 to 7 PM",
            WEEKDAYS,
            "16:00",
            "19:00",
            None,
            False,
            [("FAKE Drafts", "2 for 1", B, ""), ("FAKE Well mixers", "$4", M, "")],
        ),
        (
            K.drink,
            "FAKE Pitcher Deal",
            "Tuesday and Thursday",
            [1, 3],
            "20:00",
            "00:00",
            None,
            False,
            [("FAKE Pitchers", "$12", P, "")],
        ),
        (K.event, "FAKE Live Band", "Local act", [4, 5], "22:00", "01:00", None, False, []),
        (
            K.food,
            "FAKE Lunch Special",
            "Burger and a soda",
            WEEKDAYS,
            "11:00",
            "14:00",
            None,
            False,
            [("FAKE Burger and soda", "$9", F, "Dine in only")],
        ),
    ],
    # The hidden gem: strong deals every night.
    "fake-neon-moose": [
        (
            K.drink,
            "FAKE Moose All Night",
            "Every night, all night",
            EVERY,
            "12:00",
            "04:00",
            None,
            True,
            [
                ("FAKE Double well mixers", "$2", M, ""),
                ("FAKE Lager drafts", "$2", B, ""),
                ("FAKE House shots", "$2", S, ""),
                ("FAKE House wine", "$3", W, ""),
            ],
        ),
        (
            K.happy_hour,
            "FAKE Moose Hour",
            "Every night 9 to 11 PM",
            EVERY,
            "21:00",
            "23:00",
            None,
            False,
            [
                ("FAKE Double well mixers", "$1", M, ""),
                ("FAKE Pitchers", "$5", P, ""),
                ("FAKE Rail shots", "50\u00a2", S, ""),
                ("FAKE Wings", "Half priced", F, "Dine in only"),
            ],
        ),
        (K.cover, "FAKE Cover", "After ten", [4, 5], "22:00", "03:00", 500, False, []),
        (K.event, "FAKE Karaoke", "Sign up at the bar", [3], "21:00", "01:00", None, False, []),
    ],
}


def run(db: Session) -> dict[str, dict[str, str]]:
    """Create or update the seed data. Returns {bar slug: {staff level: fresh invite code}}."""
    admin = get_or_create_user(db, ADMIN_PHONE, Role.admin)
    admin.role = Role.admin
    now = utcnow()
    codes: dict[str, dict[str, str]] = {}
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
        bar.counts_exits = spec.counts_exits
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

        # Old unredeemed invites are revoked so each run leaves one live code per level per bar.
        for old in db.scalars(
            select(StaffInvite).where(
                StaffInvite.bar_id == bar.id,
                StaffInvite.redeemed_at.is_(None),
                StaffInvite.revoked_at.is_(None),
            )
        ):
            old.revoked_at = now
        codes[spec.slug] = {}
        for level in (StaffLevel.manager, StaffLevel.door):
            code = new_invite_code()
            db.add(
                StaffInvite(
                    bar_id=bar.id,
                    level=level,
                    code_hash=invite_hash(code),
                    created_by=admin.id,
                    expires_at=now + timedelta(days=7),
                )
            )
            codes[spec.slug][level.value] = code

        db.execute(delete(BarSpecial).where(BarSpecial.bar_id == bar.id))
        for kind, title, details, days, start, end, cents, all_day, items in SPECIALS.get(
            spec.slug, []
        ):
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
                    all_day=all_day,
                    items=[
                        {"name": n, "price_label": p, "category": c.value, "note": note}
                        for n, p, c, note in items
                    ],
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
        mode = "counts in and out" if spec.counts_exits else "counts in only"
        print(f"  {spec.name:22} cap {spec.capacity:3}  pass {price:8}  {mode}")
        print(f"    manager invite {codes[spec.slug]['manager']}")
        print(f"    door invite    {codes[spec.slug]['door']}")
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
