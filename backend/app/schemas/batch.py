import re
from datetime import datetime
from typing import Annotated

from pydantic import Field, StringConstraints, field_validator, model_validator

from app.schemas.common import APIModel, QuantityInput, QuantityOutput, Unit, as_utc


BatchCode = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$",
    ),
]
OriginLocation = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=240),
]


class BatchCreate(APIModel):
    batch_code: BatchCode
    product_id: int = Field(gt=0)
    origin_organization_id: int = Field(gt=0)
    origin_location: OriginLocation
    quantity: QuantityInput
    unit: Unit

    @field_validator("batch_code")
    @classmethod
    def normalize_batch_code(cls, value: str) -> str:
        return value.upper()


class BatchUpdate(APIModel):
    product_id: int | None = Field(default=None, gt=0)
    origin_organization_id: int | None = Field(default=None, gt=0)
    origin_location: OriginLocation | None = None
    quantity: QuantityInput | None = None
    unit: Unit | None = None

    @model_validator(mode="after")
    def require_one_non_null_change(self) -> "BatchUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one permitted field must be supplied")
        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class ProductSummary(APIModel):
    id: int
    name: str


class OrganizationSummary(APIModel):
    id: int
    name: str
    participant_type: str | None


class BatchRead(APIModel):
    id: int
    batch_code: str
    product: ProductSummary
    origin_organization: OrganizationSummary
    origin_location: str
    quantity: QuantityOutput
    unit: Unit
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def normalize_timestamps(cls, value: datetime) -> datetime:
        return as_utc(value)


class BatchPage(APIModel):
    items: list[BatchRead]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0, le=10000)
