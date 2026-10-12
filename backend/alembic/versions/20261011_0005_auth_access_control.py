"""Add invitation-based accounts, revocable sessions, and verified recall actors.

Revision ID: 20261011_0005
Revises: 20261011_0004
Create Date: 2026-10-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261011_0005"
down_revision: Union[str, None] = "20261011_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=254, collation="NOCASE"), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=True),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "role IN ('platform_admin', 'org_admin', 'operator', 'reviewer', 'viewer')",
            name="valid_role",
        ),
        sa.CheckConstraint(
            "role = 'platform_admin' OR organization_id IS NOT NULL",
            name="organization_required_for_members",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_organization_role", "users", ["organization_id", "role"])

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_token", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_auth_sessions_token_hash"),
    )
    op.create_index("ix_auth_sessions_user_expiry", "auth_sessions", ["user_id", "expires_at"])

    op.create_table(
        "user_invitations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=254, collation="NOCASE"), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('org_admin', 'operator', 'reviewer', 'viewer')",
            name="valid_role",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_user_invitations_token_hash"),
    )
    op.create_index("ix_user_invitations_email_expiry", "user_invitations", ["email", "expires_at"])

    # SQLite supports ADD COLUMN for nullable foreign keys. Use it directly:
    # batch_alter_table would rebuild/drop products and recall_incidents while
    # existing batches and incident child tables still reference them.
    op.execute(
        "ALTER TABLE products ADD COLUMN organization_id INTEGER "
        "REFERENCES organizations(id) ON DELETE RESTRICT"
    )
    op.create_index("ix_products_organization_id", "products", ["organization_id"])

    op.execute(
        "ALTER TABLE recall_incidents ADD COLUMN created_by_user_id INTEGER "
        "REFERENCES users(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE recall_reviews ADD COLUMN reviewer_user_id INTEGER "
        "REFERENCES users(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE recall_incident_history ADD COLUMN actor_user_id INTEGER "
        "REFERENCES users(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    raise NotImplementedError(
        "Authentication migration is forward-only to preserve account and audit records."
    )
