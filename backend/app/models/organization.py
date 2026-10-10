from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.batch import Batch
    from app.models.batch_event import BatchEvent


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    participant_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    originating_batches: Mapped[list["Batch"]] = relationship(
        back_populates="origin_organization",
        passive_deletes="all",
    )
    batch_events: Mapped[list["BatchEvent"]] = relationship(
        back_populates="organization",
        passive_deletes="all",
    )
