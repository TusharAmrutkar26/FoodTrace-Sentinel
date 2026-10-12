from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.organization import utc_now

if TYPE_CHECKING:
    from app.models.recall_incident import RecallIncident


class RecallCandidateSnapshot(Base):
    __tablename__ = "recall_candidate_snapshots"
    __table_args__ = (Index("ix_recall_candidate_snapshots_incident", "incident_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("recall_incidents.id", ondelete="RESTRICT"), nullable=False
    )
    simulated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    max_depth: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now,
        server_default=func.current_timestamp(), nullable=False
    )

    incident: Mapped["RecallIncident"] = relationship(back_populates="snapshots")
