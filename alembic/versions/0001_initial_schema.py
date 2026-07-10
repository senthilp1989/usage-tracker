"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-07-10

Baseline matching the table as it has existed in deployed environments up to
this point (created via Base.metadata.create_all(), never migrated). Existing
databases should be stamped at this revision rather than have it applied;
see README.md.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "usage_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("stack_id", sa.String(length=255), nullable=False),
        sa.Column("user_email", sa.String(length=255), nullable=False),
        sa.Column("environment_id", sa.String(length=255), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("test_cases_created", sa.Integer(), nullable=False),
        sa.Column("test_cases_executed", sa.Integer(), nullable=False),
        sa.Column("documents_generated", sa.Integer(), nullable=False),
        sa.Column(
            "reported_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "user_email", "report_date", "environment_id", name="uq_usage_reports_user_date_env"
        ),
    )
    op.create_index("ix_usage_reports_report_date", "usage_reports", ["report_date"])
    op.create_index("ix_usage_reports_user_email", "usage_reports", ["user_email"])


def downgrade() -> None:
    op.drop_index("ix_usage_reports_user_email", table_name="usage_reports")
    op.drop_index("ix_usage_reports_report_date", table_name="usage_reports")
    op.drop_table("usage_reports")
