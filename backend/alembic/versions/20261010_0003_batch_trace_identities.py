"""Add opaque public trace identities for batches.

Revision ID: 20261010_0003
Revises: 20261010_0002
Create Date: 2026-10-10
"""
from typing import Sequence, Union
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "20261010_0003"
down_revision: Union[str, None] = "20261010_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "batch_trace_identities",
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("trace_id", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"], ["batches.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("batch_id", name="pk_batch_trace_identities"),
        sa.UniqueConstraint("trace_id", name="uq_batch_trace_identities_trace_id"),
    )

    bind = op.get_bind()
    batch_ids = bind.execute(sa.text("SELECT id FROM batches ORDER BY id")).scalars()
    table = sa.table(
        "batch_trace_identities",
        sa.column("batch_id", sa.Integer()),
        sa.column("trace_id", sa.String(length=32)),
    )
    op.bulk_insert(
        table,
        [{"batch_id": batch_id, "trace_id": uuid4().hex} for batch_id in batch_ids],
    )


def downgrade() -> None:
    op.drop_table("batch_trace_identities")
