from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.batch import Batch
from app.models.batch_genealogy import BatchGenealogy
from app.schemas.batch_genealogy import (
    GenealogyBatch,
    GenealogyCreate,
    GenealogyGraphRead,
    GenealogyRead,
    GenealogyTraceRead,
    RelationshipType,
    TraceBatch,
    TraceDirection,
)


class GenealogyBatchMissing(Exception):
    """Raised when one of the batches in a relationship does not exist."""


class GenealogyConflict(Exception):
    """Raised when a relationship duplicates or cycles through the graph."""


class GenealogyValidationError(Exception):
    """Raised when a genealogy relationship violates quantity rules."""


class GenealogyBatchUpdateConflict(Exception):
    """Raised when a batch update would invalidate recorded source quantities."""


def _batch_by_id(session: Session, batch_id: int) -> Batch | None:
    return session.scalar(
        select(Batch)
        .options(joinedload(Batch.product))
        .where(Batch.id == batch_id)
    )


def _batch_by_code(session: Session, batch_code: str) -> Batch | None:
    return session.scalar(
        select(Batch)
        .options(joinedload(Batch.product))
        .where(Batch.batch_code == batch_code.strip().upper())
    )


def _edge_query():
    return select(BatchGenealogy).options(
        joinedload(BatchGenealogy.parent).joinedload(Batch.product),
        joinedload(BatchGenealogy.child).joinedload(Batch.product),
    )


def _scoped_edges(statement, organization_id: int | None):
    if organization_id is None:
        return statement
    return statement.where(
        BatchGenealogy.parent.has(Batch.origin_organization_id == organization_id),
        BatchGenealogy.child.has(Batch.origin_organization_id == organization_id),
    )


def _path_exists(session: Session, start_id: int, target_id: int) -> bool:
    frontier = [start_id]
    visited = {start_id}
    while frontier:
        children = session.scalars(
            select(BatchGenealogy.child_batch_id).where(
                BatchGenealogy.parent_batch_id.in_(frontier)
            )
        ).all()
        next_frontier = []
        for child_id in children:
            if child_id == target_id:
                return True
            if child_id not in visited:
                visited.add(child_id)
                next_frontier.append(child_id)
        frontier = next_frontier
    return False


def _sum_split_allocations(session: Session, parent_id: int) -> Decimal:
    quantities = session.scalars(
        select(BatchGenealogy.source_quantity).where(
            BatchGenealogy.parent_batch_id == parent_id,
            BatchGenealogy.relationship_type == RelationshipType.SPLIT.value,
            BatchGenealogy.source_quantity.is_not(None),
        )
    ).all()
    return sum(quantities, Decimal("0"))


def create_relationship(
    session: Session, payload: GenealogyCreate
) -> BatchGenealogy:
    if payload.parent_batch_id == payload.child_batch_id:
        raise GenealogyValidationError("A batch cannot be its own parent")

    parent = _batch_by_id(session, payload.parent_batch_id)
    if parent is None:
        raise GenealogyBatchMissing("Parent batch was not found")
    child = _batch_by_id(session, payload.child_batch_id)
    if child is None:
        raise GenealogyBatchMissing("Child batch was not found")

    duplicate_id = session.scalar(
        select(BatchGenealogy.id).where(
            BatchGenealogy.parent_batch_id == parent.id,
            BatchGenealogy.child_batch_id == child.id,
        )
    )
    if duplicate_id is not None:
        raise GenealogyConflict("A relationship between these batches already exists")
    if _path_exists(session, child.id, parent.id):
        raise GenealogyConflict("This relationship would create a genealogy cycle")

    if payload.source_quantity is not None and payload.source_unit is not None:
        if payload.source_unit.value != parent.unit:
            raise GenealogyValidationError(
                "source_unit must match the parent batch unit; unit conversion is not performed"
            )
        if payload.source_quantity > parent.quantity:
            raise GenealogyValidationError(
                "source_quantity cannot exceed the parent batch quantity"
            )
        if payload.relationship_type is RelationshipType.SPLIT:
            allocated = _sum_split_allocations(session, parent.id)
            if allocated + payload.source_quantity > parent.quantity:
                raise GenealogyValidationError(
                    "Recorded split quantities cannot exceed the parent batch quantity"
                )

    relationship = BatchGenealogy(
        parent_batch_id=parent.id,
        child_batch_id=child.id,
        relationship_type=payload.relationship_type.value,
        source_quantity=payload.source_quantity,
        source_unit=payload.source_unit.value if payload.source_unit else None,
    )
    session.add(relationship)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        duplicate_id = session.scalar(
            select(BatchGenealogy.id).where(
                BatchGenealogy.parent_batch_id == parent.id,
                BatchGenealogy.child_batch_id == child.id,
            )
        )
        if duplicate_id is not None:
            raise GenealogyConflict(
                "A relationship between these batches already exists"
            ) from error
        raise

    return session.scalar(
        _edge_query().where(BatchGenealogy.id == relationship.id)
    )  # type: ignore[return-value]


def get_genealogy(
    session: Session, batch_code: str, *, organization_id: int | None = None
) -> GenealogyGraphRead | None:
    batch = _batch_by_code(session, batch_code)
    if batch is None:
        return None
    parents = session.scalars(
        _scoped_edges(_edge_query(), organization_id)
        .where(BatchGenealogy.child_batch_id == batch.id)
        .order_by(BatchGenealogy.created_at, BatchGenealogy.id)
    ).all()
    children = session.scalars(
        _scoped_edges(_edge_query(), organization_id)
        .where(BatchGenealogy.parent_batch_id == batch.id)
        .order_by(BatchGenealogy.created_at, BatchGenealogy.id)
    ).all()
    return GenealogyGraphRead(
        batch=GenealogyBatch.from_batch(batch),
        parents=[GenealogyRead.from_relationship(edge) for edge in parents],
        children=[GenealogyRead.from_relationship(edge) for edge in children],
    )


def trace_genealogy(
    session: Session, batch_code: str, direction: TraceDirection, *, organization_id: int | None = None
) -> GenealogyTraceRead | None:
    root = _batch_by_code(session, batch_code)
    if root is None:
        return None

    depths = {root.id: 0}
    frontier = [root.id]
    edges_by_id: dict[int, BatchGenealogy] = {}
    while frontier:
        if direction is TraceDirection.DOWNSTREAM:
            statement = _edge_query().where(
                BatchGenealogy.parent_batch_id.in_(frontier)
            )
        else:
            statement = _edge_query().where(
                BatchGenealogy.child_batch_id.in_(frontier)
            )
        edges = session.scalars(
            _scoped_edges(statement, organization_id).order_by(
                BatchGenealogy.created_at, BatchGenealogy.id
            )
        ).all()
        next_frontier = []
        for edge in edges:
            edges_by_id[edge.id] = edge
            related_id = (
                edge.child_batch_id
                if direction is TraceDirection.DOWNSTREAM
                else edge.parent_batch_id
            )
            if related_id not in depths:
                depths[related_id] = depths[
                    edge.parent_batch_id
                    if direction is TraceDirection.DOWNSTREAM
                    else edge.child_batch_id
                ] + 1
                next_frontier.append(related_id)
        frontier = next_frontier

    related_batches: list[TraceBatch] = []
    for batch_id, depth in sorted(
        ((batch_id, depth) for batch_id, depth in depths.items() if batch_id != root.id),
        key=lambda item: (item[1], item[0]),
    ):
        batch = _batch_by_id(session, batch_id)
        if batch is not None:
            node = GenealogyBatch.from_batch(batch)
            related_batches.append(TraceBatch(**node.model_dump(), depth=depth))

    return GenealogyTraceRead(
        root=GenealogyBatch.from_batch(root),
        direction=direction,
        batches=related_batches,
        relationships=[
            GenealogyRead.from_relationship(edge)
            for edge in sorted(edges_by_id.values(), key=lambda item: item.id)
        ],
    )


def validate_source_batch_update(
    session: Session,
    batch_id: int,
    *,
    new_quantity: Decimal,
    new_unit: str,
) -> None:
    relationships = session.scalars(
        select(BatchGenealogy).where(
            BatchGenealogy.parent_batch_id == batch_id,
            BatchGenealogy.source_quantity.is_not(None),
        )
    ).all()
    if any(edge.source_unit != new_unit for edge in relationships):
        raise GenealogyBatchUpdateConflict(
            "The batch unit cannot change while genealogy records use its current unit"
        )
    if any(edge.source_quantity is not None and edge.source_quantity > new_quantity for edge in relationships):
        raise GenealogyBatchUpdateConflict(
            "Batch quantity cannot be reduced below a recorded genealogy source quantity"
        )
    split_total = sum(
        (
            edge.source_quantity
            for edge in relationships
            if edge.relationship_type == RelationshipType.SPLIT.value
            and edge.source_quantity is not None
        ),
        Decimal("0"),
    )
    if split_total > new_quantity:
        raise GenealogyBatchUpdateConflict(
            "Batch quantity cannot be reduced below its recorded split allocations"
        )
