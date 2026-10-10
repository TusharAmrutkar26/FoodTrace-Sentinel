from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.organization import utc_now
from app.models.types import ExactDecimalText

if TYPE_CHECKING:
    from app.models.batch_event import BatchEvent
    from app.models.batch_genealogy import BatchGenealogy
    from app.models.organization import Organization
    from app.models.product import Product


class Batch(Base):
    __tablename__ = "batches"
    __table_args__ = (
        UniqueConstraint("batch_code", name="uq_batches_batch_code"),
        Index("ix_batches_product_id", "product_id"),
        Index("ix_batches_origin_organization_id", "origin_organization_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_code: Mapped[str] = mapped_column(
        String(64, collation="NOCASE"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    origin_organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    origin_location: Mapped[str] = mapped_column(String(240), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(ExactDecimalText(), nullable=False)
    unit: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    product: Mapped["Product"] = relationship(back_populates="batches")
    origin_organization: Mapped["Organization"] = relationship(
        back_populates="originating_batches"
    )
    events: Mapped[list["BatchEvent"]] = relationship(
        back_populates="batch",
        passive_deletes="all",
        order_by="(BatchEvent.occurred_at, BatchEvent.id)",
    )
    parent_relationships: Mapped[list["BatchGenealogy"]] = relationship(
        "BatchGenealogy",
        foreign_keys="BatchGenealogy.child_batch_id",
        back_populates="child",
        passive_deletes="all",
    )
    child_relationships: Mapped[list["BatchGenealogy"]] = relationship(
        "BatchGenealogy",
        foreign_keys="BatchGenealogy.parent_batch_id",
        back_populates="parent",
        passive_deletes="all",
    )
