from datetime import datetime
from enum import Enum
from typing import Annotated

from pydantic import Field, StringConstraints, field_validator

from app.schemas.common import APIModel, as_utc


class EventType(str, Enum):
    HARVESTED = "harvested"
    PRODUCED = "produced"
    RECEIVED = "received"
    QUALITY_CHECKED = "quality_checked"
    DISPATCHED = "dispatched"
    DELIVERED = "delivered"
    STORED = "stored"
    PROCESSED = "processed"


EventLocation = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=240),
]
EventNotes = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class EventCreate(APIModel):
    event_type: EventType
    occurred_at: datetime | None = None
    organization_id: int | None = Field(default=None, gt=0)
    location: EventLocation | None = None
    notes: EventNotes | None = None

    @field_validator("occurred_at")
    @classmethod
    def normalize_occurred_at(cls, value: datetime | None) -> datetime | None:
        return as_utc(value) if value is not None else None


class EventOrganization(APIModel):
    id: int
    name: str
    participant_type: str | None


class BatchEventRead(APIModel):
    id: int
    batch_id: int
    event_type: EventType
    occurred_at: datetime
    organization: EventOrganization | None
    location: str | None
    notes: str | None
    created_at: datetime

    @field_validator("occurred_at", "created_at")
    @classmethod
    def normalize_timestamps(cls, value: datetime) -> datetime:
        return as_utc(value)


class BatchEventPage(APIModel):
    items: list[BatchEventRead]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0, le=10000)
