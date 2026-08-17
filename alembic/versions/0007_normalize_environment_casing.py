"""normalize environment casing

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-19

Case-only duplicates like Tarento_Dev vs TARENTO_DEV were being counted as
distinct environments in every dashboard aggregate - the same interface
would show up under both. Backfills existing rows to the same
Title_Case-per-underscore-segment form new rows get at ingestion (see
TestCaseCreatedEventIn._normalize_environment etc. in app/schemas.py), so
they collapse into one environment.

Only the four active raw event tables are touched - `usage_reports` is a
frozen archive nothing reads from anymore (see docs), and its
(user_email, report_date, environment) unique constraint has a real chance
of colliding if the same user reported under both casings on the same day,
which the timestamp-keyed event tables don't risk.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = [
    "test_case_created_events",
    "test_case_executed_events",
    "document_generated_events",
    "test_case_document_generated_events",
]


def _canonicalize(value: str) -> str:
    return "_".join(part.capitalize() for part in value.split("_"))


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
    # Casing normalization is not reversible - original casing isn't preserved.
    pass
