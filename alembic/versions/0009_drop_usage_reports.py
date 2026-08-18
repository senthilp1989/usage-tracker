"""drop the frozen usage_reports archive

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-17

Removes the last remnant of the pre-aggregated design (one row per
user/environment/day, upserted with running totals). It has been frozen since
0004 introduced the raw event tables: nothing wrote to it and nothing read
from it, the dashboard being backed entirely by the four event tables. The
model, its Pydantic schemas and the GET/POST /reports routes are deleted in
the same change.

DESTRUCTIVE: the historical rows go with the table. `downgrade()` recreates
the empty structure only - it cannot bring the data back. Take a dump of the
table first if the history still matters:

    pg_dump -t usage_reports usage_tracker > usage_reports_backup.sql

Recreated in downgrade() at its post-0003 shape (the `environment` rename from
0002 plus the pass/fail columns from 0003) so that downgrading to any earlier
revision still finds the columns those migrations expect to act on.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No explicit drop_index first: Postgres drops a table's own indexes and
    # constraints with it, and naming them here would make this migration fail
    # on a database whose indexes were built by the old create_all() path
    # rather than by 0001. A failure here is not cheap - the API container
    # runs `alembic upgrade head` on startup, so it would refuse to boot.
    op.drop_table("usage_reports")


def downgrade() -> None:
    op.create_table(
        "usage_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_email", sa.String(length=255), nullable=False),
        sa.Column("environment", sa.String(length=255), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("test_cases_created", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("test_cases_executed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("documents_generated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("test_cases_passed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("test_cases_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "reported_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "user_email", "report_date", "environment", name="uq_usage_reports_user_date_env"
        ),
    )
    op.create_index("ix_usage_reports_report_date", "usage_reports", ["report_date"])
    op.create_index("ix_usage_reports_user_email", "usage_reports", ["user_email"])
