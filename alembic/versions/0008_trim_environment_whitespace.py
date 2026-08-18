"""trim environment whitespace

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-17

Whitespace-only duplicates like "Heineken_Dev" vs "Heineken_Dev  " were being
counted as distinct environments in every dashboard aggregate - and unlike the
casing duplicates 0007 fixed, these were invisible: the filter popover renders
each option as plain text and HTML collapses trailing spaces, so the same
environment appeared twice under the same label with its activity split across
the two rows. Backfills existing rows to the stripped form new rows get at
ingestion (see _canonicalize_environment in app/schemas.py), so they collapse
into one environment.

Same table scope and rationale as 0007: only the four active raw event tables,
never the frozen `usage_reports` archive, whose
(user_email, report_date, environment) unique constraint could collide.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = [
    "test_case_created_events",
    "test_case_executed_events",
    "document_generated_events",
    "test_case_document_generated_events",
]


def _canonicalize(value: str) -> str:
    return "_".join(part.strip().capitalize() for part in value.strip().split("_"))


def upgrade() -> None:
    bind = op.get_bind()
    for table in _TABLES:
        rows = bind.execute(
            sa.text(f"SELECT DISTINCT environment FROM {table} WHERE environment IS NOT NULL")
        ).fetchall()
        for (raw,) in rows:
            canon = _canonicalize(raw)
            if canon != raw:
                bind.execute(
                    sa.text(f"UPDATE {table} SET environment = :canon WHERE environment = :raw"),
                    {"canon": canon, "raw": raw},
                )


def downgrade() -> None:
    # Whitespace normalization is not reversible - the original padding isn't
    # preserved, same as 0007.
    pass
