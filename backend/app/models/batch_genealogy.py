from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.organization import utc_now
from app.models.types import ExactDecimalText

if TYPE_CHECKING:
    from app.models.batch import Batch


class BatchGenealogy(Base):
    __tablename__ = "batch_genealogy"
    __table_args__ = (
        UniqueConstraint(
            "parent_batch_id", "child_batch_id", name="uq_batch_genealogy_parent_child"
        ),
        CheckConstraint(
            "parent_batch_id != child_batch_id", name="not_self_referential"
        ),
        CheckConstraint(
            "relationship_type IN ('split', 'merge', 'transformation')",
            name="valid_relationship_type",
        ),
        CheckConstraint(
            "(source_quantity IS NULL AND source_unit IS NULL) OR "
            "(source_quantity IS NOT NULL AND source_unit IS NOT NULL)",
            name="source_quantity_unit_pair",
        ),
        Index("ix_batch_genealogy_parent", "parent_batch_id"),
        Index("ix_batch_genealogy_child", "child_batch_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_batch_id: Mapped[int] = mapped_column(
        ForeignKey("batches.id", ondelete="RESTRICT"), nullable=False
    )
    child_batch_id: Mapped[int] = mapped_column(
        ForeignKey("batches.id", ondelete="RESTRICT"), nullable=False
    )
    relationship_type: Mapped[str] = mapped_column(String(24), nullable=False)
    source_quantity: Mapped[Decimal | None] = mapped_column(
        ExactDecimalText(), nullable=True
    )
    source_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    parent: Mapped["Batch"] = relationship(
        "Batch",
        foreign_keys=[parent_batch_id],
        back_populates="child_relationships",
    )
    child: Mapped["Batch"] = relationship(
        "Batch",
        foreign_keys=[child_batch_id],
        back_populates="parent_relationships",
    )
