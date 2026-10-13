from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.batch_genealogy import (
    GenealogyBatch,
    GenealogyRead,
    RelationshipType,
)
from app.schemas.batch_event import EventType
from app.schemas.common import APIModel, QuantityOutput, Unit, as_utc
from app.schemas.trust import FindingCheckType, FindingSeverity, FindingStatus


class BatchQrIdentityRead(APIModel):
    trace_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    trace_url: str


class PublicBatchRead(APIModel):
    batch_code: str
    product_name: str
    quantity: QuantityOutput
    unit: Unit
    origin_organization: str
    origin_location: str
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def normalize_created_at(cls, value: datetime) -> datetime:
        return as_utc(value)


class PublicEventRead(APIModel):
    event_type: EventType
    occurred_at: datetime
    location: str | None

    @field_validator("occurred_at")
    @classmethod
    def normalize_occurred_at(cls, value: datetime) -> datetime:
        return as_utc(value)


class PublicGenealogyBatch(APIModel):
    batch_code: str
    product_name: str
    quantity: QuantityOutput
    unit: Unit

    @classmethod
    def from_genealogy_batch(cls, batch: GenealogyBatch) -> "PublicGenealogyBatch":
        return cls(**batch.model_dump(exclude={"id"}))


class PublicGenealogyRelationship(APIModel):
    relationship_type: RelationshipType
    parent: PublicGenealogyBatch
    child: PublicGenealogyBatch
    source_quantity: QuantityOutput | None
    source_unit: Unit | None

    @classmethod
    def from_genealogy_read(
        cls, relationship: GenealogyRead
    ) -> "PublicGenealogyRelationship":
        return cls(
            relationship_type=relationship.relationship_type,
            parent=PublicGenealogyBatch.from_genealogy_batch(relationship.parent),
            child=PublicGenealogyBatch.from_genealogy_batch(relationship.child),
            source_quantity=relationship.source_quantity,
            source_unit=relationship.source_unit,
        )


class PublicTraceBatch(PublicGenealogyBatch):
    depth: int = Field(ge=1)


class PublicTraceTrustFinding(APIModel):
    """A privacy-minimized TraceTrust summary suitable for anonymous display."""

    check_type: FindingCheckType
    severity: FindingSeverity
    status: FindingStatus
    title: str = Field(min_length=1, max_length=120)
    explanation: str = Field(min_length=1, max_length=1000)


class PublicBatchTraceRead(APIModel):
    batch: PublicBatchRead
    events: list[PublicEventRead]
    parents: list[PublicGenealogyRelationship]
    children: list[PublicGenealogyRelationship]
    upstream: list[PublicTraceBatch]
    downstream: list[PublicTraceBatch]
    trace_trust_findings: list[PublicTraceTrustFinding]
