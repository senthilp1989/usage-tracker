"""drop package_name (never populated by the source system), add test_case_name

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-30

Package association turned out to not exist anywhere at rest in the source
system - it's only available via a live SAP API call, which the usage-metrics
background job deliberately doesn't make. Dropping package_name from all
three event tables (it was always 'unknown-package' in practice) and adding
test_case_name to the two test-case event tables, which the source system
does persist.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # test_case_created_events
    op.add_column(
        "test_case_created_events",
        sa.Column("test_case_name", sa.String(length=255), nullable=False, server_default=""),
    )
    op.alter_column("test_case_created_events", "test_case_name", server_default=None)
    op.drop_constraint(
        "uq_test_case_created_events_natural_key", "test_case_created_events", type_="unique"
    )
    op.drop_index("ix_test_case_created_events_package_name", table_name="test_case_created_events")
    op.drop_column("test_case_created_events", "package_name")
    op.create_unique_constraint(
        "uq_test_case_created_events_natural_key",
        "test_case_created_events",
        ["user_email", "environment", "interface_name", "test_case_name", "created_at"],
    )

    # test_case_executed_events
    op.add_column(
        "test_case_executed_events",
        sa.Column("test_case_name", sa.String(length=255), nullable=False, server_default=""),
    )
    op.alter_column("test_case_executed_events", "test_case_name", server_default=None)
    op.drop_constraint(
        "uq_test_case_executed_events_natural_key", "test_case_executed_events", type_="unique"
    )
    op.drop_index("ix_test_case_executed_events_package_name", table_name="test_case_executed_events")
    op.drop_column("test_case_executed_events", "package_name")
    op.create_unique_constraint(
        "uq_test_case_executed_events_natural_key",
        "test_case_executed_events",
        ["user_email", "environment", "interface_name", "test_case_name", "created_at"],
    )

    # document_generated_events
    op.drop_constraint(
        "uq_document_generated_events_natural_key", "document_generated_events", type_="unique"
    )
    op.drop_index("ix_document_generated_events_package_name", table_name="document_generated_events")
    op.drop_column("document_generated_events", "package_name")
    op.create_unique_constraint(
        "uq_document_generated_events_natural_key",
        "document_generated_events",
        ["user_email", "environment", "interface_name", "created_at"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_document_generated_events_natural_key", "document_generated_events", type_="unique"
    )
    op.add_column(
        "document_generated_events",
        sa.Column("package_name", sa.String(length=255), nullable=False, server_default="unknown-package"),
    )
    op.alter_column("document_generated_events", "package_name", server_default=None)
    op.create_index("ix_document_generated_events_package_name", "document_generated_events", ["package_name"])
    op.create_unique_constraint(
        "uq_document_generated_events_natural_key",
        "document_generated_events",
        ["user_email", "environment", "package_name", "interface_name", "created_at"],
    )

    op.drop_constraint(
        "uq_test_case_executed_events_natural_key", "test_case_executed_events", type_="unique"
    )
    op.add_column(
        "test_case_executed_events",
        sa.Column("package_name", sa.String(length=255), nullable=False, server_default="unknown-package"),
    )
    op.alter_column("test_case_executed_events", "package_name", server_default=None)
    op.create_index("ix_test_case_executed_events_package_name", "test_case_executed_events", ["package_name"])
    op.drop_column("test_case_executed_events", "test_case_name")
    op.create_unique_constraint(
        "uq_test_case_executed_events_natural_key",
        "test_case_executed_events",
        ["user_email", "environment", "package_name", "interface_name", "created_at"],
    )

    op.drop_constraint(
        "uq_test_case_created_events_natural_key", "test_case_created_events", type_="unique"
    )
    op.add_column(
        "test_case_created_events",
        sa.Column("package_name", sa.String(length=255), nullable=False, server_default="unknown-package"),
    )
    op.alter_column("test_case_created_events", "package_name", server_default=None)
    op.create_index("ix_test_case_created_events_package_name", "test_case_created_events", ["package_name"])
    op.drop_column("test_case_created_events", "test_case_name")
    op.create_unique_constraint(
        "uq_test_case_created_events_natural_key",
        "test_case_created_events",
        ["user_email", "environment", "package_name", "interface_name", "created_at"],
    )
