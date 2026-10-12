from enum import Enum

from pydantic import Field

from app.schemas.common import APIModel


class FindingSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class FindingStatus(str, Enum):
    DETECTED = "detected"
    INCOMPLETE = "incomplete"


class FindingCheckType(str, Enum):
    BATCH_QUANTITY_INVALID = "batch_quantity_invalid"
    BATCH_UNIT_INVALID = "batch_unit_invalid"
    GENEALOGY_SOURCE_QUANTITY_INVALID = "genealogy_source_quantity_invalid"
    GENEALOGY_SOURCE_UNIT_INVALID = "genealogy_source_unit_invalid"
    GENEALOGY_SOURCE_UNIT_MISMATCH = "genealogy_source_unit_mismatch"
    SPLIT_OVERALLOCATED = "split_overallocated"
    GENEALOGY_CYCLE = "genealogy_cycle"
    PROCESS_LOSS = "process_loss"
    PROCESS_LOSS_INCOMPLETE = "process_loss_incomplete"


class FindingEvidence(APIModel):
    label: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=500)


class TrustFinding(APIModel):
    finding_id: str = Field(pattern=r"^tt-[0-9a-f]{20}$")
    check_type: FindingCheckType
    severity: FindingSeverity
    status: FindingStatus
    title: str = Field(min_length=1, max_length=120)
    explanation: str = Field(min_length=1, max_length=1000)
    batch_codes: list[str]
    evidence: list[FindingEvidence]
    recommended_action: str = Field(min_length=1, max_length=500)


class TrustFindingCounts(APIModel):
    high: int = Field(ge=0)
    medium: int = Field(ge=0)
    low: int = Field(ge=0)
    incomplete: int = Field(ge=0)


class TrustFindingPage(APIModel):
    items: list[TrustFinding]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0, le=10000)
    counts: TrustFindingCounts
