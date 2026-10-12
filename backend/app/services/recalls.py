from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session, aliased

from app.models.batch import Batch
from app.models.batch_event import BatchEvent
from app.models.batch_genealogy import BatchGenealogy
from app.models.organization import Organization
from app.models.product import Product
from app.schemas.recall import (
    RecallBatchRecord,
    RecallCompleteness,
    RecallEventEvidence,
    RecallPathEntry,
    RecallRelationshipEvidence,
    RecallSimulationResponse,
)
from app.schemas.trust import TrustFinding
from app.services.trace_trust import get_trust_findings_for_batch_codes

MAX_RECALL_BATCHES = 500
MAX_RECALL_RELATIONSHIPS = 2_000
MAX_RECALL_EVENTS = 5_000
MAX_RECALL_TRUST_FINDINGS = 1_000
SUPPORTED_RELATIONSHIP_TYPES = {"split", "merge", "transformation"}

HUMAN_REVIEW_WARNING = (
    "This is a simulated candidate scope for human assessment. It is not an official "
    "recall, a contamination finding, or a declaration that any batch is unsafe."
)
RECOMMENDED_NEXT_ACTION = (
    "Review the recorded batch and event evidence with responsible food-safety and "
    "supply-chain personnel, verify it against source records, and follow applicable "
    "organizational and regulatory procedures before making any decision."
)


class RecallRootBatchMissing(Exception):
    """Raised when the requested root batch code is not present."""


@dataclass(frozen=True)
class _Edge:
    relationship_id: int
    parent_id: int
    child_id: int
    parent_code: str | None
    child_code: str | None
    parent_unit: str | None
    relationship_type: str
    source_quantity: str | None
    source_unit: str | None
    created_at: datetime


@dataclass
class _WalkState:
    paths: dict[int, tuple[int, ...]]
    depth_limit_reached: bool = False
    batch_limit_reached: bool = False
    relationship_limit_reached: bool = False


def _root(session: Session, batch_code: str, organization_id: int | None = None):
    product = aliased(Product)
    organization = aliased(Organization)
    row = session.execute(
        select(
            Batch.id.label("batch_id"),
            Batch.batch_code,
            product.name.label("product_name"),
            organization.name.label("organization_name"),
            organization.participant_type.label("participant_type"),
            Batch.origin_organization_id.label("origin_organization_id"),
            Batch.origin_location,
            cast(Batch.quantity, String).label("quantity_text"),
            Batch.unit,
            Batch.created_at,
        )
        .select_from(Batch)
        .outerjoin(product, product.id == Batch.product_id)
        .outerjoin(organization, organization.id == Batch.origin_organization_id)
        .where(func.upper(Batch.batch_code) == batch_code.strip().upper())
    ).first()
    if row is not None and organization_id is not None and row.origin_organization_id != organization_id:
        return None
    return row


def _edge_statement(frontier: list[int], direction: str, organization_id: int | None = None):
    parent = aliased(Batch)
    child = aliased(Batch)
    statement = (
        select(
            BatchGenealogy.id.label("relationship_id"),
            BatchGenealogy.parent_batch_id.label("parent_id"),
            BatchGenealogy.child_batch_id.label("child_id"),
            parent.batch_code.label("parent_code"),
            child.batch_code.label("child_code"),
            parent.unit.label("parent_unit"),
            BatchGenealogy.relationship_type.label("relationship_type"),
            cast(BatchGenealogy.source_quantity, String).label("source_quantity"),
            BatchGenealogy.source_unit.label("source_unit"),
            BatchGenealogy.created_at.label("created_at"),
        )
        .select_from(BatchGenealogy)
        .outerjoin(parent, parent.id == BatchGenealogy.parent_batch_id)
        .outerjoin(child, child.id == BatchGenealogy.child_batch_id)
    )
    if direction == "downstream":
        statement = statement.where(BatchGenealogy.parent_batch_id.in_(frontier))
    else:
        statement = statement.where(BatchGenealogy.child_batch_id.in_(frontier))
    if organization_id is not None:
        statement = statement.where(
            parent.origin_organization_id == organization_id,
            child.origin_organization_id == organization_id,
        )
    return statement.order_by(
        func.coalesce(parent.batch_code, ""),
        func.coalesce(child.batch_code, ""),
        BatchGenealogy.id,
    ).limit(MAX_RECALL_RELATIONSHIPS + 1)


def _to_edge(row) -> _Edge:
    return _Edge(
        relationship_id=row.relationship_id,
        parent_id=row.parent_id,
        child_id=row.child_id,
        parent_code=row.parent_code,
        child_code=row.child_code,
        parent_unit=row.parent_unit,
        relationship_type=row.relationship_type,
        source_quantity=row.source_quantity,
        source_unit=row.source_unit,
        created_at=row.created_at,
    )


def _walk(
    session: Session,
    *,
    root_id: int,
    direction: str,
    max_depth: int,
    discovered_ids: set[int],
    edges_by_id: dict[int, _Edge],
    organization_id: int | None,
) -> _WalkState:
    paths: dict[int, tuple[int, ...]] = {root_id: (root_id,)}
    frontier = [root_id]
    state = _WalkState(paths=paths)

    for depth in range(max_depth + 1):
        if not frontier:
            break
        rows = session.execute(_edge_statement(frontier, direction, organization_id)).all()
        next_frontier: list[int] = []
        halted_by_relationship_limit = False
        for row in rows:
            edge = _to_edge(row)
            if edge.relationship_id not in edges_by_id:
                if len(edges_by_id) >= MAX_RECALL_RELATIONSHIPS:
                    state.relationship_limit_reached = True
                    halted_by_relationship_limit = True
                    break
                edges_by_id[edge.relationship_id] = edge

            current_id = edge.parent_id if direction == "downstream" else edge.child_id
            related_id = edge.child_id if direction == "downstream" else edge.parent_id
            current_path = paths.get(current_id)
            if current_path is None:
                continue
            if related_id in paths:
                continue
            if depth >= max_depth:
                state.depth_limit_reached = True
                continue
            if related_id not in discovered_ids and len(discovered_ids) >= MAX_RECALL_BATCHES:
                state.batch_limit_reached = True
                continue
            paths[related_id] = (*current_path, related_id)
            discovered_ids.add(related_id)
            next_frontier.append(related_id)
        if len(rows) > MAX_RECALL_RELATIONSHIPS:
            state.relationship_limit_reached = True
        if halted_by_relationship_limit or state.relationship_limit_reached:
            break
        frontier = sorted(set(next_frontier))
    return state


def _cycle_detected(edges: list[_Edge], available_ids: set[int]) -> bool:
    adjacency: dict[int, list[int]] = defaultdict(list)
    for edge in edges:
        if edge.parent_id in available_ids and edge.child_id in available_ids:
            adjacency[edge.parent_id].append(edge.child_id)
    for children in adjacency.values():
        children.sort()

    colors: dict[int, int] = {}

    def visit(node: int) -> bool:
        colors[node] = 1
        for child in adjacency.get(node, []):
            if colors.get(child) == 1:
                return True
            if colors.get(child, 0) == 0 and visit(child):
                return True
        colors[node] = 2
        return False

    return any(colors.get(node, 0) == 0 and visit(node) for node in sorted(available_ids))


def _batch_rows(session: Session, batch_ids: set[int]):
    if not batch_ids:
        return []
    product = aliased(Product)
    organization = aliased(Organization)
    return session.execute(
        select(
            Batch.id.label("batch_id"),
            Batch.batch_code.label("batch_code"),
            product.name.label("product_name"),
            organization.name.label("organization_name"),
            organization.participant_type.label("participant_type"),
            Batch.origin_location.label("origin_location"),
            cast(Batch.quantity, String).label("quantity_text"),
            Batch.unit.label("unit"),
            Batch.created_at.label("created_at"),
        )
        .select_from(Batch)
        .outerjoin(product, product.id == Batch.product_id)
        .outerjoin(organization, organization.id == Batch.origin_organization_id)
        .where(Batch.id.in_(batch_ids))
        .order_by(Batch.batch_code, Batch.id)
    ).all()


def _event_rows(session: Session, batch_ids: set[int]):
    if not batch_ids:
        return [], False
    organization = aliased(Organization)
    rows = session.execute(
        select(
            BatchEvent.batch_id,
            BatchEvent.event_type,
            BatchEvent.occurred_at,
            organization.name.label("organization_name"),
            organization.participant_type.label("participant_type"),
            BatchEvent.location,
            BatchEvent.notes,
            BatchEvent.created_at.label("recorded_at"),
        )
        .select_from(BatchEvent)
        .outerjoin(organization, organization.id == BatchEvent.organization_id)
        .where(BatchEvent.batch_id.in_(batch_ids))
        .order_by(BatchEvent.batch_id, BatchEvent.occurred_at, BatchEvent.id)
        .limit(MAX_RECALL_EVENTS + 1)
    ).all()
    truncated = len(rows) > MAX_RECALL_EVENTS
    return rows[:MAX_RECALL_EVENTS], truncated


def _relationship_evidence(
    edges: list[_Edge], available_ids: set[int]
) -> tuple[list[RecallRelationshipEvidence], bool, bool]:
    pair_counts: dict[tuple[int, int], int] = defaultdict(int)
    for edge in edges:
        pair_counts[(edge.parent_id, edge.child_id)] += 1

    output: list[RecallRelationshipEvidence] = []
    has_missing_references = False
    has_invalid_relationships = False
    for edge in sorted(
        edges,
        key=lambda item: (
            item.parent_code or "",
            item.child_code or "",
            item.relationship_type,
            item.relationship_id,
        ),
    ):
        issues: list[str] = []
        if edge.parent_code is None or edge.child_code is None:
            has_missing_references = True
            issues.append("A referenced batch record is unavailable.")
        if edge.parent_id == edge.child_id:
            issues.append("The recorded relationship is a self-link.")
        if edge.relationship_type not in SUPPORTED_RELATIONSHIP_TYPES:
            issues.append("The recorded relationship type is not supported.")
        if pair_counts[(edge.parent_id, edge.child_id)] > 1:
            issues.append("More than one relationship row exists for this parent-child pair.")
        if issues:
            has_invalid_relationships = True
        output.append(
            RecallRelationshipEvidence(
                parent_batch_code=edge.parent_code,
                child_batch_code=edge.child_code,
                relationship_type=edge.relationship_type,
                source_quantity=edge.source_quantity,
                source_unit=edge.source_unit,
                recorded_at=edge.created_at,
                structurally_valid=not issues,
                validation_issues=issues,
            )
        )
    return output, has_missing_references, has_invalid_relationships


def simulate_recall(
    session: Session,
    *,
    root_batch_code: str,
    max_depth: int,
    process_loss_threshold_percent: Decimal,
    organization_id: int | None = None,
) -> RecallSimulationResponse:
    root = _root(session, root_batch_code, organization_id)
    if root is None:
        raise RecallRootBatchMissing("The selected root batch was not found")

    discovered_ids = {root.batch_id}
    edges_by_id: dict[int, _Edge] = {}
    upstream_walk = _walk(
        session,
        root_id=root.batch_id,
        direction="upstream",
        max_depth=max_depth,
        discovered_ids=discovered_ids,
        edges_by_id=edges_by_id,
        organization_id=organization_id,
    )
    downstream_walk = _walk(
        session,
        root_id=root.batch_id,
        direction="downstream",
        max_depth=max_depth,
        discovered_ids=discovered_ids,
        edges_by_id=edges_by_id,
        organization_id=organization_id,
    )

    edge_list = list(edges_by_id.values())
    record_rows = _batch_rows(session, discovered_ids)
    events, event_history_truncated = _event_rows(
        session, {row.batch_id for row in record_rows}
    )
    events_by_batch: dict[int, list[RecallEventEvidence]] = defaultdict(list)
    for event in events:
        events_by_batch[event.batch_id].append(
            RecallEventEvidence(
                event_type=event.event_type,
                occurred_at=event.occurred_at,
                organization_name=event.organization_name,
                participant_type=event.participant_type,
                location=event.location,
                notes=event.notes,
                recorded_at=event.recorded_at,
            )
        )

    records_by_id = {
        row.batch_id: RecallBatchRecord(
            batch_code=row.batch_code,
            product_name=row.product_name,
            origin_organization=row.organization_name,
            participant_type=row.participant_type,
            origin_location=row.origin_location,
            quantity=row.quantity_text,
            unit=row.unit,
            created_at=row.created_at,
            events=events_by_batch.get(row.batch_id, []),
        )
        for row in record_rows
    }
    root_record = records_by_id[root.batch_id]

    def path_entries(walk: _WalkState) -> list[RecallPathEntry]:
        result: list[RecallPathEntry] = []
        for batch_id, path in walk.paths.items():
            if batch_id == root.batch_id:
                continue
            code_path = [records_by_id[item].batch_code if item in records_by_id else None for item in path]
            result.append(
                RecallPathEntry(
                    batch_code=records_by_id[batch_id].batch_code if batch_id in records_by_id else None,
                    depth=len(path) - 1,
                    path=code_path,
                )
            )
        return sorted(
            result,
            key=lambda item: (item.depth, item.batch_code or "", tuple(code or "" for code in item.path)),
        )

    upstream = path_entries(upstream_walk)
    downstream = path_entries(downstream_walk)
    related_batches = sorted(
        (record for batch_id, record in records_by_id.items() if batch_id != root.batch_id),
        key=lambda record: record.batch_code,
    )
    relationship_items, relationship_missing_refs, invalid_relationships = _relationship_evidence(
        edge_list, discovered_ids
    )
    missing_batch_references = (
        len(records_by_id) != len(discovered_ids) or relationship_missing_refs
    )
    cycle_detected = _cycle_detected(edge_list, discovered_ids)

    trust_findings_all = get_trust_findings_for_batch_codes(
        session,
        process_loss_threshold_percent=process_loss_threshold_percent,
        batch_codes=[record.batch_code for record in records_by_id.values()],
        organization_id=organization_id,
    )
    trace_trust_findings_truncated = len(trust_findings_all) > MAX_RECALL_TRUST_FINDINGS
    trust_findings: list[TrustFinding] = trust_findings_all[:MAX_RECALL_TRUST_FINDINGS]

    warnings = [
        "Only explicitly recorded genealogy links are traversed. An absent link cannot be inferred, and no recorded link does not prove physical batches are unrelated.",
        "Recorded genealogy relationships have not been independently verified against source documents or physical product.",
        "This simulation does not verify physical product identity, quality, contamination, or authenticity.",
        "Displayed batch quantities and relationship input quantities are individual recorded values only. No affected quantity is calculated or summed.",
        "Event history is recorded system evidence, not independent verification. Event notes are shown as entered and have not been validated.",
    ]
    if not upstream:
        warnings.append(
            "The selected batch has no recorded upstream relationships in the traversed graph; this does not prove that no upstream source exists."
        )
    if not downstream:
        warnings.append(
            "The selected batch has no recorded downstream relationships in the traversed graph; this does not prove that no affected batch exists."
        )
    if upstream_walk.depth_limit_reached:
        warnings.append(f"Upstream traversal found additional links beyond the requested maximum depth of {max_depth}; those batches were not expanded.")
    if downstream_walk.depth_limit_reached:
        warnings.append(f"Downstream traversal found additional links beyond the requested maximum depth of {max_depth}; those batches were not expanded.")
    if upstream_walk.batch_limit_reached or downstream_walk.batch_limit_reached:
        warnings.append(f"The candidate batch safety limit of {MAX_RECALL_BATCHES} was reached; traversal results are partial.")
    if upstream_walk.relationship_limit_reached or downstream_walk.relationship_limit_reached:
        warnings.append(f"The relationship evidence safety limit of {MAX_RECALL_RELATIONSHIPS} was reached; traversal results are partial.")
    if event_history_truncated:
        warnings.append(f"Event history was truncated at {MAX_RECALL_EVENTS} rows for this simulation.")
    if trace_trust_findings_truncated:
        warnings.append(f"TraceTrust evidence was truncated at {MAX_RECALL_TRUST_FINDINGS} findings.")
    if cycle_detected:
        warnings.append("A cycle was detected in the traversed recorded relationships. Cycle-safe traversal stopped repeating batches; the graph requires review.")
    if missing_batch_references:
        warnings.append("At least one recorded relationship refers to a batch record that is unavailable; affected path details are incomplete.")
    if invalid_relationships:
        warnings.append("At least one relationship has an invalid or duplicate structural reference. Review the relationship evidence before relying on this scope.")
    if any(finding.status.value == "incomplete" for finding in trust_findings):
        warnings.append("Some associated TraceTrust checks are marked incomplete because the recorded data cannot support a safe comparison.")

    traversal_complete = not any(
        (
            upstream_walk.depth_limit_reached,
            downstream_walk.depth_limit_reached,
            upstream_walk.batch_limit_reached,
            downstream_walk.batch_limit_reached,
            upstream_walk.relationship_limit_reached,
            downstream_walk.relationship_limit_reached,
            event_history_truncated,
            trace_trust_findings_truncated,
            cycle_detected,
            missing_batch_references,
            invalid_relationships,
        )
    )
    return RecallSimulationResponse(
        simulated_at=datetime.now(timezone.utc),
        root_batch=root_record,
        related_batches=related_batches,
        upstream=upstream,
        downstream=downstream,
        relationships=relationship_items,
        trace_trust_findings=trust_findings,
        completeness=RecallCompleteness(
            max_depth=max_depth,
            upstream_depth_limit_reached=upstream_walk.depth_limit_reached,
            downstream_depth_limit_reached=downstream_walk.depth_limit_reached,
            batch_limit_reached=(upstream_walk.batch_limit_reached or downstream_walk.batch_limit_reached),
            relationship_limit_reached=(upstream_walk.relationship_limit_reached or downstream_walk.relationship_limit_reached),
            event_history_truncated=event_history_truncated,
            trace_trust_findings_truncated=trace_trust_findings_truncated,
            cycle_detected=cycle_detected,
            missing_batch_references=missing_batch_references,
            invalid_relationships=invalid_relationships,
            traversal_complete=traversal_complete,
        ),
        warnings=warnings,
        human_review_warning=HUMAN_REVIEW_WARNING,
        recommended_next_action=RECOMMENDED_NEXT_ACTION,
    )
