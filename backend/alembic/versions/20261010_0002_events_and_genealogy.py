"""Add batch events and explicit genealogy edges.

Revision ID: 20261010_0002
Revises: 20261010_0001
Create Date: 2026-10-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261010_0002"
down_revision: Union[str, None] = "20261010_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "batch_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=True),
        sa.Column("location", sa.String(length=240), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('harvested', 'produced', 'received', 'quality_checked', "
            "'dispatched', 'delivered', 'stored', 'processed')",
            name="valid_event_type",
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"], ["batches.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_batch_events_batch_occurred",
        "batch_events",
        ["batch_id", "occurred_at", "id"],
    )

    op.create_table(
        "batch_genealogy",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("parent_batch_id", sa.Integer(), nullable=False),
        sa.Column("child_batch_id", sa.Integer(), nullable=False),
        sa.Column("relationship_type", sa.String(length=24), nullable=False),
        sa.Column("source_quantity", sa.Text(), nullable=True),
        sa.Column("source_unit", sa.String(length=16), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "parent_batch_id != child_batch_id", name="not_self_referential"
        ),
        sa.CheckConstraint(
            "relationship_type IN ('split', 'merge', 'transformation')",
            name="valid_relationship_type",
        ),
        sa.CheckConstraint(
            "(source_quantity IS NULL AND source_unit IS NULL) OR "
            "(source_quantity IS NOT NULL AND source_unit IS NOT NULL)",
            name="source_quantity_unit_pair",
        ),
        sa.ForeignKeyConstraint(
            ["parent_batch_id"], ["batches.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["child_batch_id"], ["batches.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "parent_batch_id", "child_batch_id", name="uq_batch_genealogy_parent_child"
        ),
    )
    op.create_index("ix_batch_genealogy_parent", "batch_genealogy", ["parent_batch_id"])
    op.create_index("ix_batch_genealogy_child", "batch_genealogy", ["child_batch_id"])


def downgrade() -> None:
    op.drop_index("ix_batch_genealogy_child", table_name="batch_genealogy")
    op.drop_index("ix_batch_genealogy_parent", table_name="batch_genealogy")
    op.drop_table("batch_genealogy")
    op.drop_index("ix_batch_events_batch_occurred", table_name="batch_events")
    op.drop_table("batch_events")
