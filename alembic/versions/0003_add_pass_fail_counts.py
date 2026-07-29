"""add test_cases_passed and test_cases_failed counts

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "usage_reports",
        sa.Column("test_cases_passed", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "usage_reports",
        sa.Column("test_cases_failed", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("usage_reports", "test_cases_passed", server_default=None)
    op.alter_column("usage_reports", "test_cases_failed", server_default=None)


def downgrade() -> None:
    op.drop_column("usage_reports", "test_cases_failed")
    op.drop_column("usage_reports", "test_cases_passed")
