from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.organization import utc_now

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.user_session import UserSession


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('platform_admin', 'org_admin', 'operator', 'reviewer', 'viewer')",
            name="valid_role",
        ),
        CheckConstraint(
            "role = 'platform_admin' OR organization_id IS NOT NULL",
            name="organization_required_for_members",
        ),
        Index("ix_users_organization_role", "organization_id", "role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254, collation="NOCASE"), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=True
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.current_timestamp(), nullable=False
    )

    organization: Mapped["Organization | None"] = relationship()
    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user")
