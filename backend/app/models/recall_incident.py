from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.organization import utc_now

if TYPE_CHECKING:
    from app.models.batch import Batch
    from app.models.recall_candidate_snapshot import RecallCandidateSnapshot
    from app.models.recall_follow_up_action import RecallFollowUpAction
    from app.models.recall_incident_history import RecallIncidentHistory
    from app.models.recall_review import RecallReview


class RecallIncident(Base):
    __tablename__ = "recall_incidents"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending_review', 'requires_investigation', "
            "'approved_for_next_step', 'rejected')",
            name="valid_status",
        ),
        Index("ix_recall_incidents_root_batch", "root_batch_id"),
        Index("ix_recall_incidents_status_created", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    reference_id: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    root_batch_id: Mapped[int] = mapped_column(
        ForeignKey("batches.id", ondelete="RESTRICT"), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default="pending_review", server_default="pending_review", nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now,
        server_default=func.current_timestamp(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now,
        server_default=func.current_timestamp(), nullable=False
    )

    root_batch: Mapped["Batch"] = relationship()
    snapshots: Mapped[list["RecallCandidateSnapshot"]] = relationship(
        back_populates="incident", order_by="RecallCandidateSnapshot.captured_at"
    )
    reviews: Mapped[list["RecallReview"]] = relationship(
        back_populates="incident", order_by="RecallReview.created_at"
    )
    actions: Mapped[list["RecallFollowUpAction"]] = relationship(
        back_populates="incident", order_by="RecallFollowUpAction.created_at"
    )
    history: Mapped[list["RecallIncidentHistory"]] = relationship(
        back_populates="incident", order_by="RecallIncidentHistory.recorded_at"
    )
