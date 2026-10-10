from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import APIModel, Name, as_utc


class ProductCreate(APIModel):
    name: Name


class ProductRead(APIModel):
    id: int
    name: str
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def normalize_created_at(cls, value: datetime) -> datetime:
        return as_utc(value)


class ProductPage(APIModel):
    items: list[ProductRead]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0, le=10000)
