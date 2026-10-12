from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, localcontext
from fractions import Fraction
from typing import Iterable

from sqlalchemy import String, cast, select
from sqlalchemy.orm import Session, aliased

from app.models.batch import Batch
from app.models.batch_genealogy import BatchGenealogy
from app.schemas.common import Unit
from app.schemas.trust import (
    FindingCheckType,
    FindingEvidence,
    FindingSeverity,
    FindingStatus,
    TrustFinding,
    TrustFindingCounts,
    TrustFindingPage,
)

_STORED_DECIMAL_TEXT = re.compile(r"^-?\d+(?:\.\d+)?$")


@dataclass(frozen=True)
class BatchFact:
    row_id: int
    code: str
    quantity_text: str
    quantity: Decimal | None
    unit: str


@dataclass(frozen=True)
class EdgeFact:
    row_id: int
    parent_id: int
    parent_code: str | None
    child_id: int
    child_code: str | None
    relationship_type: str
    source_quantity_text: str | None
    source_quantity: Decimal | None
    source_unit: str | None


def _decimal_or_none(value: str | None) -> Decimal | None:
    if value is None or len(value) > 64 or not _STORED_DECIMAL_TEXT.fullmatch(value):
        return None
    try:
        parsed = Decimal(value)
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def _batch_facts(session: Session, organization_id: int | None = None) -> list[BatchFact]:
    statement = select(
            Batch.id,
            Batch.batch_code,
            cast(Batch.quantity, String),
            Batch.unit,
        )
    if organization_id is not None:
        statement = statement.where(Batch.origin_organization_id == organization_id)
    rows = session.execute(statement.order_by(Batch.batch_code))
    return [
        BatchFact(
            row_id=row.id,
            code=row.batch_code,
            quantity_text=str(row[2]) if row[2] is not None else "not recorded",
            quantity=_decimal_or_none(str(row[2]) if row[2] is not None else None),
            unit=row.unit,
        )
        for row in rows
    ]


def _edge_facts(session: Session, organization_id: int | None = None) -> list[EdgeFact]:
    parent = aliased(Batch)
    child = aliased(Batch)
    statement = (
        select(
            BatchGenealogy.id,
            BatchGenealogy.parent_batch_id,
            parent.batch_code,
            BatchGenealogy.child_batch_id,
            child.batch_code,
            BatchGenealogy.relationship_type,
            cast(BatchGenealogy.source_quantity, String),
            BatchGenealogy.source_unit,
        )
        .select_from(BatchGenealogy)
        .outerjoin(parent, parent.id == BatchGenealogy.parent_batch_id)
        .outerjoin(child, child.id == BatchGenealogy.child_batch_id)
    )
    if organization_id is not None:
        statement = statement.where(
            parent.origin_organization_id == organization_id,
            child.origin_organization_id == organization_id,
        )
    rows = session.execute(statement.order_by(BatchGenealogy.parent_batch_id, BatchGenealogy.child_batch_id))
    result: list[EdgeFact] = []
    for row in rows:
        source_text = row[6]
        result.append(
            EdgeFact(
                row_id=row[0],
                parent_id=row[1],
                parent_code=row[2],
                child_id=row[3],
                child_code=row[4],
                relationship_type=row[5],
                source_quantity_text=str(source_text) if source_text is not None else None,
                source_quantity=_decimal_or_none(str(source_text) if source_text is not None else None),
                source_unit=row[7],
            )
        )
    return result


def _finding_id(check_type: FindingCheckType, identity: Iterable[str]) -> str:
    payload = json.dumps([check_type.value, *identity], ensure_ascii=True, separators=(",", ":"))
    return "tt-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def _finding(
    *,
    check_type: FindingCheckType,
    severity: FindingSeverity,
    status: FindingStatus = FindingStatus.DETECTED,
    identity: Iterable[str],
    batch_codes: Iterable[str | None],
    title: str,
    explanation: str,
    evidence: Iterable[tuple[str, str]],
    recommended_action: str,
) -> TrustFinding:
    codes = sorted({code for code in batch_codes if code})
    return TrustFinding(
        finding_id=_finding_id(check_type, identity),
        check_type=check_type,
        severity=severity,
        status=status,
        title=title,
        explanation=explanation,
        batch_codes=codes,
        evidence=[
            FindingEvidence(
                label=label[:120],
                value=value if len(value) <= 500 else value[:497] + "...",
            )
            for label, value in evidence
        ],
        recommended_action=recommended_action,
    )


def _cycle_paths(edges: list[EdgeFact]) -> list[tuple[str, ...]]:
    adjacency: dict[str, list[str]] = {}
    for edge in edges:
        if edge.parent_code and edge.child_code:
            adjacency.setdefault(edge.parent_code, []).append(edge.child_code)
    for children in adjacency.values():
        children.sort()

    found: set[tuple[str, ...]] = set()
    visited: set[str] = set()
    stack: list[str] = []
    stack_positions: dict[str, int] = {}

    def canonical(cycle: list[str]) -> tuple[str, ...]:
        ring = cycle[:-1]
        rotations = [tuple(ring[index:] + ring[:index]) for index in range(len(ring))]
        best = min(rotations)
        return (*best, best[0])

    for node in sorted(adjacency):
        if node in visited:
            continue
        visited.add(node)
        stack_positions[node] = 0
        stack.append(node)
        frames: list[tuple[str, Iterator[str]]] = [(node, iter(adjacency.get(node, [])))]
        while frames:
            current, children = frames[-1]
            try:
                child_code = next(children)
            except StopIteration:
                frames.pop()
                stack.pop()
                stack_positions.pop(current, None)
                continue
            if child_code in stack_positions:
                found.add(canonical(stack[stack_positions[child_code] :] + [child_code]))
            elif child_code not in visited:
                visited.add(child_code)
                stack_positions[child_code] = len(stack)
                stack.append(child_code)
                frames.append((child_code, iter(adjacency.get(child_code, []))))
    return sorted(found)


def _scan(
    session: Session, process_loss_threshold_percent: Decimal, organization_id: int | None = None
) -> list[TrustFinding]:
    batches = _batch_facts(session, organization_id)
    edges = _edge_facts(session, organization_id)
    batch_by_id = {batch.row_id: batch for batch in batches}
    findings: list[TrustFinding] = []

    for batch in batches:
        if batch.quantity is None or batch.quantity <= 0:
            findings.append(
                _finding(
                    check_type=FindingCheckType.BATCH_QUANTITY_INVALID,
                    severity=FindingSeverity.HIGH,
                    identity=[batch.code, batch.quantity_text],
                    batch_codes=[batch.code],
                    title="Stored batch quantity is invalid",
                    explanation="The saved quantity is not a finite positive decimal, so quantity comparisons for this batch cannot be trusted.",
                    evidence=[("Recorded quantity", f"{batch.quantity_text} {batch.unit}")],
                    recommended_action="Review the source record and correct the batch quantity through an authorized data repair process.",
                )
            )
        if batch.unit not in {unit.value for unit in Unit}:
            findings.append(
                _finding(
                    check_type=FindingCheckType.BATCH_UNIT_INVALID,
                    severity=FindingSeverity.HIGH,
                    identity=[batch.code, batch.unit],
                    batch_codes=[batch.code],
                    title="Stored batch unit is unsupported",
                    explanation="The batch uses a unit outside the units currently supported by the API; quantities must not be compared until the unit is understood.",
                    evidence=[("Recorded unit", batch.unit)],
                    recommended_action="Confirm the source unit and correct it through an authorized data repair process without converting quantities silently.",
                )
            )

    split_allocations: dict[int, list[EdgeFact]] = {}
    all_split_edges: dict[int, list[EdgeFact]] = {}
    incoming: dict[int, list[EdgeFact]] = {}
    for edge in edges:
        parent = batch_by_id.get(edge.parent_id)
        child = batch_by_id.get(edge.child_id)
        if edge.relationship_type == "split":
            all_split_edges.setdefault(edge.parent_id, []).append(edge)
        if edge.parent_code is not None and edge.child_code is not None:
            incoming.setdefault(edge.child_id, []).append(edge)

        if edge.source_quantity_text is not None:
            if edge.source_quantity is None or edge.source_quantity <= 0:
                findings.append(
                    _finding(
                        check_type=FindingCheckType.GENEALOGY_SOURCE_QUANTITY_INVALID,
                        severity=FindingSeverity.HIGH,
                        identity=[edge.parent_code or "missing-parent", edge.child_code or "missing-child", edge.relationship_type, edge.source_quantity_text],
                        batch_codes=[edge.parent_code, edge.child_code],
                        title="Recorded genealogy quantity is invalid",
                        explanation="A relationship source quantity is not a finite positive decimal, so allocation and process-loss checks cannot use it.",
                        evidence=[("Relationship", f"{edge.parent_code or 'unknown'} → {edge.child_code or 'unknown'} ({edge.relationship_type})"), ("Source quantity", f"{edge.source_quantity_text} {edge.source_unit or 'unit not recorded'}")],
                        recommended_action="Verify the recorded input quantity and unit against the source documents before correcting the relationship.",
                    )
                )
                continue
            if edge.source_unit not in {unit.value for unit in Unit}:
                findings.append(
                    _finding(
                        check_type=FindingCheckType.GENEALOGY_SOURCE_UNIT_INVALID,
                        severity=FindingSeverity.HIGH,
                        identity=[edge.parent_code or "missing-parent", edge.child_code or "missing-child", edge.relationship_type, edge.source_unit or "missing"],
                        batch_codes=[edge.parent_code, edge.child_code],
                        title="Recorded genealogy unit is unsupported",
                        explanation="The relationship input quantity uses a unit outside the units supported by the API; no conversion has been assumed.",
                        evidence=[("Relationship", f"{edge.parent_code or 'unknown'} → {edge.child_code or 'unknown'} ({edge.relationship_type})"), ("Source quantity", f"{edge.source_quantity_text} {edge.source_unit or 'unit not recorded'}")],
                        recommended_action="Confirm the unit from the source record and correct it without converting or combining incompatible units.",
                    )
                )
                continue
            if parent is not None and edge.source_unit != parent.unit:
                findings.append(
                    _finding(
                        check_type=FindingCheckType.GENEALOGY_SOURCE_UNIT_MISMATCH,
                        severity=FindingSeverity.HIGH,
                        identity=[edge.parent_code or "missing-parent", edge.child_code or "missing-child", edge.relationship_type, edge.source_unit or "missing", parent.unit],
                        batch_codes=[edge.parent_code, edge.child_code],
                        title="Relationship unit does not match its parent batch",
                        explanation="The recorded source unit differs from the parent batch unit. TraceTrust did not convert the values.",
                        evidence=[("Relationship", f"{edge.parent_code or 'unknown'} → {edge.child_code or 'unknown'} ({edge.relationship_type})"), ("Recorded input", f"{edge.source_quantity_text} {edge.source_unit}"), ("Parent batch", f"{parent.quantity_text} {parent.unit}")],
                        recommended_action="Check the original relationship record and correct the unit if it was recorded incorrectly.",
                    )
                )
                continue
            if parent is not None and parent.quantity is not None and edge.source_quantity > parent.quantity:
                findings.append(
                    _finding(
                        check_type=FindingCheckType.GENEALOGY_SOURCE_QUANTITY_INVALID,
                        severity=FindingSeverity.HIGH,
                        identity=[edge.parent_code or "missing-parent", edge.child_code or "missing-child", edge.relationship_type, edge.source_quantity_text, parent.quantity_text],
                        batch_codes=[edge.parent_code, edge.child_code],
                        title="Recorded input exceeds the parent batch quantity",
                        explanation="The relationship allocates more material than the parent batch records. The values are in the same unit and were compared exactly.",
                        evidence=[("Relationship", f"{edge.parent_code or 'unknown'} → {edge.child_code or 'unknown'} ({edge.relationship_type})"), ("Recorded input", f"{edge.source_quantity_text} {edge.source_unit}"), ("Parent quantity", f"{parent.quantity_text} {parent.unit}")],
                        recommended_action="Reconcile the relationship quantity with the parent batch record and supporting documents.",
                    )
                )
                continue
            if edge.relationship_type == "split" and parent is not None:
                if edge.source_unit == parent.unit and parent.quantity is not None:
                    split_allocations.setdefault(edge.parent_id, []).append(edge)

    for parent_id, allocations in split_allocations.items():
        parent = batch_by_id[parent_id]
        # Do not aggregate if any split edge from this parent has an absent or
        # unsupported quantity: the recorded allocation set is incomplete.
        all_splits = all_split_edges.get(parent_id, [])
        if len(allocations) != len(all_splits):
            continue
        total_fraction = sum(
            (Fraction(edge.source_quantity) for edge in allocations if edge.source_quantity is not None),
            Fraction(0),
        )
        if total_fraction > Fraction(parent.quantity):
            with localcontext() as context:
                context.prec = 256
                total = sum(
                    (edge.source_quantity for edge in allocations if edge.source_quantity is not None),
                    Decimal("0"),
                )
            evidence = [("Parent quantity", f"{parent.quantity_text} {parent.unit}")]
            evidence.extend(
                ("Child allocation", f"{edge.child_code or 'unknown'}: {edge.source_quantity_text} {edge.source_unit}")
                for edge in sorted(allocations, key=lambda item: item.child_code or "")
            )
            evidence.append(("Recorded allocation total", f"{total} {parent.unit}"))
            findings.append(
                _finding(
                    check_type=FindingCheckType.SPLIT_OVERALLOCATED,
                    severity=FindingSeverity.HIGH,
                    identity=[parent.code, *(f"{edge.child_code}:{edge.source_quantity_text}:{edge.source_unit}" for edge in sorted(allocations, key=lambda item: item.child_code or ""))],
                    batch_codes=[parent.code, *(edge.child_code for edge in allocations)],
                    title="Split allocations exceed the parent quantity",
                    explanation="The exact sum of the recorded split input quantities is greater than the parent batch quantity.",
                    evidence=evidence,
                    recommended_action="Reconcile every child allocation against the parent batch record; do not adjust quantities by unit conversion.",
                )
            )

    for cycle in _cycle_paths(edges):
        findings.append(
            _finding(
                check_type=FindingCheckType.GENEALOGY_CYCLE,
                severity=FindingSeverity.HIGH,
                identity=cycle,
                batch_codes=cycle,
                title="Genealogy contains a cycle",
                explanation="Following the recorded parent-to-child relationships returns to a batch already in the path, so upstream and downstream lineage is inconsistent.",
                evidence=[("Recorded cycle", " → ".join(cycle))],
                recommended_action="Review the explicit relationships in this path and correct the source records before relying on the trace.",
            )
        )

    for child_id, child_edges in incoming.items():
        process_edges = [edge for edge in child_edges if edge.relationship_type in {"split", "transformation", "merge"}]
        if not process_edges:
            continue
        child = batch_by_id.get(child_id)
        if child is None:
            continue
        reason: str | None = None
        selected: EdgeFact | None = None
        if len(child_edges) != 1:
            reason = "Multiple parent relationships are recorded, and the schema has no operation-completeness record. Their quantities were not combined."
        elif process_edges[0].relationship_type == "merge":
            reason = "Merge input completeness is not recorded, so total input and output cannot be compared safely."
        else:
            selected = process_edges[0]
            parent = batch_by_id.get(selected.parent_id)
            if selected.source_quantity_text is None:
                reason = "The relationship does not record an input quantity."
            elif selected.source_quantity is None or selected.source_quantity <= 0:
                # A separate high-severity source-quantity finding carries the
                # actionable issue; avoid a duplicate incomplete finding.
                continue
            elif selected.source_unit not in {unit.value for unit in Unit}:
                continue
            elif parent is None or parent.quantity is None or child.quantity is None:
                continue
            elif selected.source_unit != parent.unit:
                continue
            elif selected.source_quantity > parent.quantity:
                # The input-over-parent finding already carries the relevant
                # evidence, and process loss would be based on an invalid input.
                continue
            elif child.unit != selected.source_unit:
                reason = "The input and output units differ; TraceTrust does not convert units."

        if reason is not None:
            evidence = [("Output batch", f"{child.code}: {child.quantity_text} {child.unit}")]
            evidence.extend(
                ("Recorded input", f"{edge.parent_code or 'unknown'}: {edge.source_quantity_text or 'not recorded'} {edge.source_unit or ''}".strip())
                for edge in sorted(child_edges, key=lambda item: item.parent_code or "")
            )
            findings.append(
                _finding(
                    check_type=FindingCheckType.PROCESS_LOSS_INCOMPLETE,
                    severity=FindingSeverity.LOW,
                    status=FindingStatus.INCOMPLETE,
                    identity=[child.code, *(f"{edge.parent_code or 'unknown'}:{edge.relationship_type}:{edge.source_quantity_text}:{edge.source_unit}" for edge in sorted(child_edges, key=lambda item: item.parent_code or ""))],
                    batch_codes=[child.code, *(edge.parent_code for edge in child_edges)],
                    title="Process loss could not be assessed",
                    explanation=reason,
                    evidence=evidence,
                    recommended_action="Record complete operation inputs and outputs in compatible units if process-loss review is required.",
                )
            )
            continue

        if selected is None or selected.source_quantity is None:
            continue
        parent = batch_by_id[selected.parent_id]
        if parent.quantity is None or child.quantity is None:
            continue
        loss_fraction = (
            (Fraction(selected.source_quantity) - Fraction(child.quantity))
            * 100
            / Fraction(selected.source_quantity)
        )
        if loss_fraction > Fraction(process_loss_threshold_percent):
            with localcontext() as context:
                context.prec = 256
                loss_percent = (
                    (selected.source_quantity - child.quantity)
                    * Decimal("100")
                    / selected.source_quantity
                )
            findings.append(
                _finding(
                    check_type=FindingCheckType.PROCESS_LOSS,
                    severity=FindingSeverity.MEDIUM,
                    identity=[selected.parent_code or "", child.code, selected.relationship_type, selected.source_quantity_text or "", selected.source_unit or "", child.quantity_text],
                    batch_codes=[selected.parent_code, child.code],
                    title="Recorded process loss exceeds the configured threshold",
                    explanation=f"The calculated input/output loss is {loss_percent:.2f}% in {selected.source_unit} (rounded for display) and exceeds the configured review threshold of {process_loss_threshold_percent}%. The threshold comparison uses exact decimal quantities.",
                    evidence=[
                        ("Recorded relationship", f"{selected.parent_code} → {child.code} ({selected.relationship_type})"),
                        ("Recorded input", f"{selected.source_quantity_text} {selected.source_unit}"),
                        ("Recorded output", f"{child.quantity_text} {child.unit}"),
                        ("Calculated difference", f"{loss_percent:.2f}% (rounded for display)"),
                        ("Configured threshold", f"{process_loss_threshold_percent}%"),
                    ],
                    recommended_action="Review the operation records, measurement basis, and documented process yield with the responsible participants.",
                )
            )

    return findings


def get_trust_findings(
    session: Session,
    *,
    process_loss_threshold_percent: Decimal,
    severity: FindingSeverity | None = None,
    check_type: FindingCheckType | None = None,
    batch_code: str | None = None,
    status: FindingStatus | None = None,
    limit: int = 50,
    offset: int = 0,
    organization_id: int | None = None,
) -> TrustFindingPage:
    findings = _scan(session, process_loss_threshold_percent, organization_id)
    normalized_code = batch_code.strip().upper() if batch_code else None
    if severity is not None:
        findings = [finding for finding in findings if finding.severity is severity]
    if check_type is not None:
        findings = [finding for finding in findings if finding.check_type is check_type]
    if normalized_code:
        findings = [finding for finding in findings if normalized_code in finding.batch_codes]
    if status is not None:
        findings = [finding for finding in findings if finding.status is status]

    findings = _ordered_findings(findings)
    counts = TrustFindingCounts(
        high=sum(finding.severity is FindingSeverity.HIGH for finding in findings),
        medium=sum(finding.severity is FindingSeverity.MEDIUM for finding in findings),
        low=sum(finding.severity is FindingSeverity.LOW for finding in findings),
        incomplete=sum(finding.status is FindingStatus.INCOMPLETE for finding in findings),
    )
    return TrustFindingPage(
        items=findings[offset : offset + limit],
        total=len(findings),
        limit=limit,
        offset=offset,
        counts=counts,
    )


def get_trust_findings_for_batch_codes(
    session: Session,
    *,
    process_loss_threshold_percent: Decimal,
    batch_codes: Iterable[str],
    organization_id: int | None = None,
) -> list[TrustFinding]:
    """Reuse the TraceTrust scan and return findings linked to any supplied batch code."""
    normalized_codes = {code.strip().upper() for code in batch_codes if code.strip()}
    if not normalized_codes:
        return []
    findings = [
        finding
        for finding in _scan(session, process_loss_threshold_percent, organization_id)
        if normalized_codes.intersection(code.upper() for code in finding.batch_codes)
    ]
    return _ordered_findings(findings)


def _ordered_findings(findings: list[TrustFinding]) -> list[TrustFinding]:
    severity_order = {
        FindingSeverity.HIGH: 0,
        FindingSeverity.MEDIUM: 1,
        FindingSeverity.LOW: 2,
    }
    return sorted(
        findings,
        key=lambda finding: (
            severity_order[finding.severity],
            finding.status.value,
            finding.check_type.value,
            finding.batch_codes,
            finding.finding_id,
        ),
    )
