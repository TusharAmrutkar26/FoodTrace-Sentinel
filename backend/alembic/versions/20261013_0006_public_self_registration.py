"""Allow least-privilege users to register before joining an organization.

Revision ID: 20261013_0006
Revises: 20261011_0005
Create Date: 2026-10-13
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20261013_0006"
down_revision: Union[str, None] = "20261011_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite needs to rebuild this table to update its CHECK constraint. The
    # existing users, sessions, invitations, and audit references are copied
    # by Alembic's batch operation; do not drop or recreate any records.
    # Alembic's SQLite migration environment disables foreign-key checks for
    # the duration of the schema rebuild, verifies them afterward, and restores
    # enforcement before returning to the application.
    with op.batch_alter_table("users", recreate="always") as batch_op:
        batch_op.drop_constraint("organization_required_for_members", type_="check")
        batch_op.create_check_constraint(
            "organization_required_for_privileged_members",
            "role IN ('platform_admin', 'viewer') OR organization_id IS NOT NULL",
        )
    violations = op.get_bind().exec_driver_sql("PRAGMA foreign_key_check").all()
    if violations:
        raise RuntimeError("Self-registration migration would leave invalid foreign-key references")


def downgrade() -> None:
    raise NotImplementedError(
        "Self-registration migration is forward-only to preserve account and session records."
    )
