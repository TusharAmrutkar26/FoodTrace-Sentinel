import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Annotated

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
)


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")


class Unit(str, Enum):
    """Initial explicit units; the API does not convert between them."""

    KILOGRAM = "kg"
    GRAM = "g"
    MILLIGRAM = "mg"
    TONNE = "t"
    LITRE = "l"
    MILLILITRE = "ml"
    EACH = "each"


_DECIMAL_TEXT = re.compile(r"^-?\d+(?:\.\d+)?$")


def validate_positive_decimal_text(value: object) -> Decimal:
    if not isinstance(value, str):
        raise ValueError("quantity must be supplied as a decimal string")
    if len(value) > 64 or not _DECIMAL_TEXT.fullmatch(value):
        raise ValueError("quantity must be a plain decimal string of at most 64 characters")
    try:
        amount = Decimal(value)
    except InvalidOperation as error:
        raise ValueError("quantity must be a valid decimal value") from error
    if not amount.is_finite() or amount <= 0:
        raise ValueError("quantity must be a finite value greater than zero")
    return amount


def format_decimal(value: Decimal) -> str:
    return format(value, "f")


QuantityInput = Annotated[
    Decimal,
    BeforeValidator(validate_positive_decimal_text),
    PlainSerializer(format_decimal, return_type=str, when_used="json"),
    WithJsonSchema(
        {
            "type": "string",
            "pattern": r"^\d+(?:\.\d+)?$",
            "examples": ["100.000"],
        },
        mode="validation",
    ),
]

QuantityOutput = Annotated[
    Decimal,
    PlainSerializer(format_decimal, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "examples": ["100.000"]}, mode="serialization"),
]


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ParticipantType = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
]
