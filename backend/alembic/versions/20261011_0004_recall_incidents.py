"""Add recall incident management records.

Revision ID: 20261011_0004
Revises: 20261010_0003
Create Date: 2026-10-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261011_0004"
down_revision: Union[str, None] = "20261010_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recall_incidents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reference_id", sa.String(length=24), nullable=False),
        sa.Column("root_batch_id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="pending_review", nullable=False),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending_review', 'requires_investigation', 'approved_for_next_step', 'rejected')",
            name="valid_status",
        ),
        sa.ForeignKeyConstraint(["root_batch_id"], ["batches.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reference_id", name="uq_recall_incidents_reference_id"),
    )
    op.create_index("ix_recall_incidents_root_batch", "recall_incidents", ["root_batch_id"])
    op.create_index("ix_recall_incidents_status_created", "recall_incidents", ["status", "created_at"])

    op.create_table(
        "recall_candidate_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("incident_id", sa.Integer(), nullable=False),
        sa.Column("simulated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("max_depth", sa.Integer(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["incident_id"], ["recall_incidents.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recall_candidate_snapshots_incident", "recall_candidate_snapshots", ["incident_id"])

    op.create_table(
        "recall_reviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("incident_id", sa.Integer(), nullable=False),
        sa.Column("decision", sa.String(length=32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("reviewer_name", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "decision IN ('requires_investigation', 'approved_for_next_step', 'rejected')",
            name="valid_decision",
        ),
        sa.ForeignKeyConstraint(["incident_id"], ["recall_incidents.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recall_reviews_incident", "recall_reviews", ["incident_id"])

    op.create_table(
        "recall_follow_up_actions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("incident_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), server_default="open", nullable=False),
        sa.Column("assignee", sa.String(length=120), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completion_notes", sa.Text(), nullable=True),
        sa.Column("evidence_references_json", sa.Text(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('open', 'in_progress', 'completed', 'cancelled')", name="valid_status"),
        sa.ForeignKeyConstraint(["incident_id"], ["recall_incidents.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recall_follow_up_actions_incident", "recall_follow_up_actions", ["incident_id"])

    op.create_table(
        "recall_incident_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("incident_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("actor_name", sa.String(length=120), nullable=True),
        sa.Column("details_json", sa.Text(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "event_type IN ('incident_created', 'candidate_scope_captured', 'review_recorded', 'follow_up_action_added', 'follow_up_action_updated')",
            name="valid_event_type",
        ),
        sa.ForeignKeyConstraint(["incident_id"], ["recall_incidents.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recall_incident_history_incident_time", "recall_incident_history", ["incident_id", "recorded_at"])


def downgrade() -> None:
    raise NotImplementedError(
        "Recall incident migration 20261011_0004 is forward-only to preserve incident history."
    )
