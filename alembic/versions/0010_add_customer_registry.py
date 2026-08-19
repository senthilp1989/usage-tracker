"""add the customer registry (customers, customer_rules, environment_mappings)

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-19

Adds the environment -> customer link the event tables never carried. Three
tables, matching the three resolution layers:

  customers             one row per customer the business reports on
  customer_rules        ordered match patterns; first match wins
  environment_mappings  manual overrides, which always beat a rule

Seeds the four customers visible in the data to date and their patterns, so
the registry resolves every existing environment on the first boot after this
lands rather than dumping all of them into the Unassigned queue. The seed is
additive and id-keyed: re-running it on a database that already has these
rows is a no-op, and a customer someone renamed or re-patterned by hand is
left alone.

Patterns match the NORMALISED name (case-folded, `-`/whitespace collapsed to
`_`) and use `(?=_|$)` rather than `\\b`, because `_` is a word character in
both Python and JS regex - `^hei\\b` does not match `hei_test`. The lookahead
is also what keeps `^hei(neken)?(?=_|$)` off `heidelberg_dev`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_IST_NOW = sa.text("(now() AT TIME ZONE 'Asia/Kolkata')")

# (customer id, display name, is_internal, [patterns])
_SEED = [
    ("heineken", "Heineken", False, [r"^hei(neken)?(?=_|$)"]),
    ("celanese", "Celanese", False, [r"^celanese(?=_|$)"]),
    ("bat", "BAT", False, [r"^bat(?=_|$)"]),
    ("internal", "Tarento (internal)", True, [r"^tarento(?=_|$)", r"^local(-|_)?dev(?=_|$)"]),
]


def upgrade() -> None:
    customers = op.create_table(
        "customers",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False, unique=True),
        sa.Column("is_internal", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False, server_default=_IST_NOW),
    )
    rules = op.create_table(
        "customer_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "customer_id",
            sa.String(length=64),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pattern", sa.String(length=255), nullable=False),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False, server_default=_IST_NOW),
    )
    op.create_index("ix_customer_rules_customer_id", "customer_rules", ["customer_id"])

    op.create_table(
        "environment_mappings",
        sa.Column("name_normalised", sa.String(length=255), primary_key=True),
        sa.Column(
            "customer_id",
            sa.String(length=64),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("resolved_by", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("confirmed_at", sa.DateTime(timezone=False), nullable=False, server_default=_IST_NOW),
    )
    op.create_index("ix_environment_mappings_customer_id", "environment_mappings", ["customer_id"])

    bind = op.get_bind()
    existing = {row[0] for row in bind.execute(sa.text("SELECT id FROM customers"))}
    for position, (cid, name, internal, patterns) in enumerate(_SEED):
        if cid in existing:
            continue
        op.bulk_insert(customers, [{"id": cid, "name": name, "is_internal": internal}])
        op.bulk_insert(
            rules,
            [
                {"customer_id": cid, "pattern": p, "position": position * 10 + i, "note": "seeded default"}
                for i, p in enumerate(patterns)
            ],
        )


def downgrade() -> None:
    # environment_mappings and customer_rules both FK into customers, so they
    # go first. Any manual overrides an admin recorded go with them - the
    # registry is configuration, not history, and re-running upgrade() puts
    # the seeded rules back.
    op.drop_table("environment_mappings")
    op.drop_table("customer_rules")
    op.drop_table("customers")
