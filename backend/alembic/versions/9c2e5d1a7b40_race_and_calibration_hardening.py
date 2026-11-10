"""race and calibration hardening (security review phase 1.5)

Revision ID: 9c2e5d1a7b40
Revises: eafcdb6a3a21
Create Date: 2026-11-10 18:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9c2e5d1a7b40"
down_revision: Union[str, Sequence[str], None] = "eafcdb6a3a21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Close duplicate active timers left by the old race before adding the unique index.
    # Keep the newest active timer per user, abandon the rest.
    op.execute(
        """
        UPDATE line_sessions SET status = 'abandoned', ended_at = now()
        WHERE status = 'active' AND id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY user_id ORDER BY started_at DESC, id
                ) AS rn
                FROM line_sessions WHERE status = 'active'
            ) ranked WHERE rn > 1
        )
        """
    )
    # Drop duplicate rewards from the old race. Keep the first row per (reason, ref_id).
    op.execute(
        """
        DELETE FROM reward_ledger WHERE id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY reason, ref_id ORDER BY created_at, id
                ) AS rn
                FROM reward_ledger WHERE ref_id IS NOT NULL
            ) ranked WHERE rn > 1
        )
        """
    )
    op.add_column(
        "line_sessions",
        sa.Column("calibration_eligible", sa.Boolean(), server_default="false", nullable=False),
    )
    op.create_index(
        "uq_line_sessions_one_active",
        "line_sessions",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index(
        "uq_reward_ledger_reason_ref",
        "reward_ledger",
        ["reason", "ref_id"],
        unique=True,
        postgresql_where=sa.text("ref_id IS NOT NULL"),
    )
    # Existing rows are not trusted for calibration (they may be poisoned). They stay for
    # accuracy metrics as source "timer", not eligible.
    op.add_column(
        "estimate_errors",
        sa.Column("source", sa.String(length=8), server_default="timer", nullable=False),
    )
    op.add_column(
        "estimate_errors",
        sa.Column("eligible", sa.Boolean(), server_default="false", nullable=False),
    )
    op.create_index(
        "ix_estimate_errors_bar_created",
        "estimate_errors",
        ["bar_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_estimate_errors_bar_created", table_name="estimate_errors")
    op.drop_column("estimate_errors", "eligible")
    op.drop_column("estimate_errors", "source")
    op.drop_index("uq_reward_ledger_reason_ref", table_name="reward_ledger")
    op.drop_index("uq_line_sessions_one_active", table_name="line_sessions")
    op.drop_column("line_sessions", "calibration_eligible")
