"""rename environment_id to environment, drop stack_id

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("usage_reports", "environment_id", new_column_name="environment")
    op.drop_column("usage_reports", "stack_id")


def downgrade() -> None:
    op.alter_column("usage_reports", "environment", new_column_name="environment_id")
    op.add_column(
        "usage_reports",
        sa.Column("stack_id", sa.String(length=255), nullable=False, server_default=""),
    )
    op.alter_column("usage_reports", "stack_id", server_default=None)
