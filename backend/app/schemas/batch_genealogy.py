from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Annotated

from pydantic import Field, model_validator

from app.schemas.common import APIModel, QuantityInput, QuantityOutput, Unit, as_utc

if TYPE_CHECKING:
    from app.models.batch_genealogy import BatchGenealogy


class RelationshipType(str, Enum):
    SPLIT = "split"
    MERGE = "merge"
    TRANSFORMATION = "transformation"


class TraceDirection(str, Enum):
    UPSTREAM = "upstream"
    DOWNSTREAM = "downstream"


class GenealogyCreate(APIModel):
    parent_batch_id: int = Field(gt=0)
    child_batch_id: int = Field(gt=0)
    relationship_type: RelationshipType
    source_quantity: QuantityInput | None = None
    source_unit: Unit | None = None

    @model_validator(mode="after")
    def require_source_quantity_and_unit_together(self) -> "GenealogyCreate":
        if (self.source_quantity is None) != (self.source_unit is None):
            raise ValueError("source_quantity and source_unit must be supplied together")
        return self


class GenealogyBatch(APIModel):
    id: int
    batch_code: str
    product_name: str
    quantity: QuantityOutput
    unit: Unit

    @classmethod
    def from_batch(cls, batch: "Batch") -> "GenealogyBatch":
        return cls(
            id=batch.id,
            batch_code=batch.batch_code,
            product_name=batch.product.name,
            quantity=batch.quantity,
            unit=batch.unit,
        )


class GenealogyRead(APIModel):
    id: int
    relationship_type: RelationshipType
    parent: GenealogyBatch
    child: GenealogyBatch
    source_quantity: QuantityOutput | None
    source_unit: Unit | None
    created_at: datetime

    @classmethod
    def from_relationship(cls, relationship: "BatchGenealogy") -> "GenealogyRead":
        parent = relationship.parent
        child = relationship.child
        return cls(
            id=relationship.id,
            relationship_type=relationship.relationship_type,
            parent=GenealogyBatch(
                id=parent.id,
                batch_code=parent.batch_code,
                product_name=parent.product.name,
                quantity=parent.quantity,
                unit=parent.unit,
            ),
            child=GenealogyBatch(
                id=child.id,
                batch_code=child.batch_code,
                product_name=child.product.name,
                quantity=child.quantity,
                unit=child.unit,
            ),
            source_quantity=relationship.source_quantity,
            source_unit=relationship.source_unit,
            created_at=as_utc(relationship.created_at),
        )


class GenealogyGraphRead(APIModel):
    batch: GenealogyBatch
    parents: list[GenealogyRead]
    children: list[GenealogyRead]


class TraceBatch(GenealogyBatch):
    depth: Annotated[int, Field(ge=1)]


class GenealogyTraceRead(APIModel):
    root: GenealogyBatch
    direction: TraceDirection
    batches: list[TraceBatch]
    relationships: list[GenealogyRead]
