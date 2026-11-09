"""Promote an existing user to admin by phone. There is deliberately no API for this."""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from app.db import get_sessionmaker
from app.models import AuditLog, Role, User
from app.schemas import RequestCodeIn
from app.services.auth import phone_hash


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("phone", help="E.164 phone the user signed in with")
    args = ap.parse_args()
    phone = RequestCodeIn(phone=args.phone).phone
    with get_sessionmaker()() as db:
        user = db.scalar(select(User).where(User.phone_hash == phone_hash(phone)))
        if user is None:
            print("no user with that phone. Sign in once first.")
            return 1
        user.role = Role.admin
        db.add(
            AuditLog(
                actor_user_id=None,
                actor_role="cli",
                action="user.make_admin",
                target_type="user",
                target_id=str(user.id),
            )
        )
        db.commit()
        print(f"user {user.id} is now admin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
