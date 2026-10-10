"""Create organizations, products, and batches.

Revision ID: 20261010_0001
Revises:
Create Date: 2026-10-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261010_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("participant_type", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_organizations"),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_products"),
    )
    op.create_table(
        "batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("batch_code", sa.String(length=64, collation="NOCASE"), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("origin_organization_id", sa.Integer(), nullable=False),
        sa.Column("origin_location", sa.String(length=240), nullable=False),
        sa.Column("quantity", sa.Text(), nullable=False),
        sa.Column("unit", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["origin_organization_id"],
            ["organizations.id"],
            name="fk_batches_origin_organization_id_organizations",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name="fk_batches_product_id_products",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_batches"),
        sa.UniqueConstraint("batch_code", name="uq_batches_batch_code"),
    )
    op.create_index("ix_batches_product_id", "batches", ["product_id"])
    op.create_index(
        "ix_batches_origin_organization_id",
        "batches",
        ["origin_organization_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_batches_origin_organization_id", table_name="batches")
    op.drop_index("ix_batches_product_id", table_name="batches")
    op.drop_table("batches")
    op.drop_table("products")
    op.drop_table("organizations")
