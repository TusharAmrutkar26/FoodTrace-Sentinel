from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import APIModel, Name, ParticipantType, as_utc


class OrganizationCreate(APIModel):
    name: Name
    participant_type: ParticipantType | None = None


class OrganizationRead(APIModel):
    id: int
    name: str
    participant_type: str | None
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def normalize_created_at(cls, value: datetime) -> datetime:
        return as_utc(value)


class OrganizationPage(APIModel):
    items: list[OrganizationRead]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0, le=10000)
