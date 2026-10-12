from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from uuid import uuid4

from app.models.batch import Batch
from app.models.batch_trace_identity import BatchTraceIdentity
from app.models.organization import Organization
from app.models.product import Product
from app.schemas.batch import BatchCreate, BatchUpdate
from app.services.batch_genealogy import validate_source_batch_update


class RelatedRecordMissing(Exception):
    """Raised when a batch refers to a product or organization that is absent."""


class DuplicateBatchCode(Exception):
    """Raised when a batch code is already in use."""


def _batch_query():
    return select(Batch).options(
        joinedload(Batch.product),
        joinedload(Batch.origin_organization),
    )


def get_batch(session: Session, batch_code: str) -> Batch | None:
    return session.scalar(
        _batch_query().where(Batch.batch_code == batch_code.strip().upper())
    )


def list_batches(
    session: Session,
    *,
    q: str | None,
    product_id: int | None,
    origin_organization_id: int | None,
    limit: int,
    offset: int,
) -> tuple[list[Batch], int]:
    filters = []
    if product_id is not None:
        filters.append(Batch.product_id == product_id)
    if origin_organization_id is not None:
        filters.append(Batch.origin_organization_id == origin_organization_id)
    if q is not None:
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                Batch.batch_code.ilike(pattern),
                Product.name.ilike(pattern),
                Batch.origin_location.ilike(pattern),
            )
        )

    total = session.scalar(
        select(func.count(Batch.id)).select_from(Batch).join(Product).where(*filters)
    ) or 0
    statement = (
        _batch_query()
        .join(Product)
        .where(*filters)
        .order_by(Batch.created_at.desc(), Batch.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(session.scalars(statement).all()), total


def create_batch(session: Session, payload: BatchCreate) -> Batch:
    if session.get(Product, payload.product_id) is None:
        raise RelatedRecordMissing("Product was not found")
    product = session.get(Product, payload.product_id)
    if product is not None and product.organization_id not in {None, payload.origin_organization_id}:
        raise RelatedRecordMissing("Product is not available to the selected organization")
    if session.get(Organization, payload.origin_organization_id) is None:
        raise RelatedRecordMissing("Origin organization was not found")

    batch = Batch(
        batch_code=payload.batch_code,
        product_id=payload.product_id,
        origin_organization_id=payload.origin_organization_id,
        origin_location=payload.origin_location,
        quantity=payload.quantity,
        unit=payload.unit.value,
        trace_identity=BatchTraceIdentity(trace_id=uuid4().hex),
    )
    session.add(batch)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        if session.scalar(
            select(Batch.id).where(Batch.batch_code == payload.batch_code)
        ) is not None:
            raise DuplicateBatchCode(payload.batch_code) from error
        raise

    return get_batch(session, payload.batch_code)  # type: ignore[return-value]


def update_batch(session: Session, batch_code: str, payload: BatchUpdate) -> Batch | None:
    batch = get_batch(session, batch_code)
    if batch is None:
        return None

    changes = payload.model_dump(exclude_unset=True)
    if "quantity" in changes or "unit" in changes:
        new_unit = changes.get("unit", batch.unit)
        validate_source_batch_update(
            session,
            batch.id,
            new_quantity=changes.get("quantity", batch.quantity),
            new_unit=new_unit.value if hasattr(new_unit, "value") else new_unit,
        )
    if "product_id" in changes:
        product = session.get(Product, changes["product_id"])
        if product is None:
            raise RelatedRecordMissing("Product was not found")
        if product.organization_id not in {None, batch.origin_organization_id}:
            raise RelatedRecordMissing("Product is not available to the selected organization")
        batch.product = product
    if "origin_organization_id" in changes:
        organization = session.get(Organization, changes["origin_organization_id"])
        if organization is None:
            raise RelatedRecordMissing("Origin organization was not found")
        batch.origin_organization = organization

    for field_name, value in changes.items():
        if field_name in {"product_id", "origin_organization_id"}:
            continue
        if field_name == "unit":
            value = value.value
        setattr(batch, field_name, value)

    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise
    return get_batch(session, batch.batch_code)
