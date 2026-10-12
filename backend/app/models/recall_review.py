from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.organization import utc_now

if TYPE_CHECKING:
    from app.models.recall_incident import RecallIncident


class RecallReview(Base):
    __tablename__ = "recall_reviews"
    __table_args__ = (
        CheckConstraint(
            "decision IN ('requires_investigation', 'approved_for_next_step', 'rejected')",
            name="valid_decision",
        ),
        Index("ix_recall_reviews_incident", "incident_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("recall_incidents.id", ondelete="RESTRICT"), nullable=False
    )
    decision: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reviewer_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now,
        server_default=func.current_timestamp(), nullable=False
    )

    incident: Mapped["RecallIncident"] = relationship(back_populates="reviews")
