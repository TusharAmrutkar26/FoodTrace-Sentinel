from decimal import Decimal, InvalidOperation

from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator


class ExactDecimalText(TypeDecorator[Decimal]):
    """Store decimal quantities as text so SQLite never converts them to float."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Decimal | str | None, dialect: object) -> str | None:
        if value is None:
            return None
        try:
            amount = value if isinstance(value, Decimal) else Decimal(value)
        except InvalidOperation as error:
            raise ValueError("Quantity must be a valid decimal value") from error
        if not amount.is_finite():
            raise ValueError("Quantity must be finite")
        return format(amount, "f")

    def process_result_value(self, value: str | None, dialect: object) -> Decimal | None:
        if value is None:
            return None
        return Decimal(value)
