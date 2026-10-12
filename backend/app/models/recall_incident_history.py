from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.organization import utc_now

if TYPE_CHECKING:
    from app.models.recall_incident import RecallIncident


class RecallIncidentHistory(Base):
    __tablename__ = "recall_incident_history"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('incident_created', 'candidate_scope_captured', "
            "'review_recorded', 'follow_up_action_added', 'follow_up_action_updated')",
            name="valid_event_type",
        ),
        Index("ix_recall_incident_history_incident_time", "incident_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("recall_incidents.id", ondelete="RESTRICT"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    details_json: Mapped[str] = mapped_column(Text, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now,
        server_default=func.current_timestamp(), nullable=False
    )

    incident: Mapped["RecallIncident"] = relationship(back_populates="history")
