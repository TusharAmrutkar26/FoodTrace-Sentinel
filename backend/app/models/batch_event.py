from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.organization import utc_now

if TYPE_CHECKING:
    from app.models.batch import Batch
    from app.models.organization import Organization


class BatchEvent(Base):
    __tablename__ = "batch_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('harvested', 'produced', 'received', 'quality_checked', "
            "'dispatched', 'delivered', 'stored', 'processed')",
            name="valid_event_type",
        ),
        Index("ix_batch_events_batch_occurred", "batch_id", "occurred_at", "id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("batches.id", ondelete="RESTRICT"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=True
    )
    location: Mapped[str | None] = mapped_column(String(240), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    batch: Mapped["Batch"] = relationship(back_populates="events")
    organization: Mapped["Organization | None"] = relationship(
        back_populates="batch_events"
    )
