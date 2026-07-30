"""add raw per-event tables (test case created/executed, document generated)

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-30

Replaces the aggregated usage_reports ingestion path with raw, ungrouped
event rows - one row per test case creation, per test case execution, and
per document generation. usage_reports is left in place as a frozen
historical archive; the dashboard now reads exclusively from these new
tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_IST_NOW = sa.text("(now() AT TIME ZONE 'Asia/Kolkata')")


def _create_event_table(name: str, *, extra_columns: list[sa.Column] | None = None) -> None:
    columns = [
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_email", sa.String(length=255), nullable=False),
        sa.Column("environment", sa.String(length=255), nullable=False),
        sa.Column("package_name", sa.String(length=255), nullable=False),
        sa.Column("interface_name", sa.String(length=255), nullable=False),
        *(extra_columns or []),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("reported_at", sa.DateTime(timezone=False), nullable=False, server_default=_IST_NOW),
        sa.UniqueConstraint(
            "user_email", "environment", "package_name", "interface_name", "created_at",
            name=f"uq_{name}_natural_key",
        ),
    ]
    op.create_table(name, *columns)
    op.create_index(f"ix_{name}_user_email", name, ["user_email"])
    op.create_index(f"ix_{name}_environment", name, ["environment"])
    op.create_index(f"ix_{name}_package_name", name, ["package_name"])
    op.create_index(f"ix_{name}_interface_name", name, ["interface_name"])
    op.create_index(f"ix_{name}_created_at", name, ["created_at"])


def upgrade() -> None:
    _create_event_table("test_case_created_events")
    _create_event_table(
        "test_case_executed_events",
        extra_columns=[sa.Column("status", sa.String(length=50), nullable=False)],
    )
    op.create_index("ix_test_case_executed_events_status", "test_case_executed_events", ["status"])
    _create_event_table("document_generated_events")


def downgrade() -> None:
    op.drop_table("document_generated_events")
    op.drop_index("ix_test_case_executed_events_status", table_name="test_case_executed_events")
    op.drop_table("test_case_executed_events")
    op.drop_table("test_case_created_events")
