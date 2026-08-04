"""add test_case_document_generated_events

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-04

New raw event table for "Generate Report" clicks on a test suite's
consolidated test execution document (Word/PDF) - the fourth event type
alongside test case created/executed and (interface) document generated.
Unlike those three, environment and interface_name are nullable here: the
source tool resolves them from the test suite at log time, and a suite with
no environment/interface assigned yet should still be able to log the click.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_IST_NOW = sa.text("(now() AT TIME ZONE 'Asia/Kolkata')")


def upgrade() -> None:
    op.create_table(
        "test_case_document_generated_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_email", sa.String(length=255), nullable=False),
        sa.Column("environment", sa.String(length=255), nullable=True),
        sa.Column("interface_name", sa.String(length=255), nullable=True),
        sa.Column("suite_name", sa.String(length=255), nullable=False),
        sa.Column("test_case_names", JSONB(), nullable=False),
        sa.Column("test_case_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("reported_at", sa.DateTime(timezone=False), nullable=False, server_default=_IST_NOW),
        sa.UniqueConstraint(
            "user_email", "environment", "interface_name", "suite_name", "created_at",
            name="uq_test_case_document_generated_events_natural_key",
        ),
    )
    op.create_index(
        "ix_test_case_document_generated_events_user_email",
        "test_case_document_generated_events", ["user_email"],
    )
    op.create_index(
        "ix_test_case_document_generated_events_environment",
        "test_case_document_generated_events", ["environment"],
    )
    op.create_index(
        "ix_test_case_document_generated_events_interface_name",
        "test_case_document_generated_events", ["interface_name"],
    )
    op.create_index(
        "ix_test_case_document_generated_events_suite_name",
        "test_case_document_generated_events", ["suite_name"],
    )
    op.create_index(
        "ix_test_case_document_generated_events_created_at",
        "test_case_document_generated_events", ["created_at"],
    )


def downgrade() -> None:
    op.drop_table("test_case_document_generated_events")
