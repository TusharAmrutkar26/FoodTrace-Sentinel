import type { RecallBatchRecord, RecallSimulationResponse } from "../types/api";
import { rowsToCsv } from "./csv";

export function recallSimulationCsv(result: RecallSimulationResponse): string {
  const rows: (string | number)[][] = [
    ["Record type", "Batch or direction", "Related data", "Value", "Unit", "Status or details"],
    ["simulation", "simulated_at", result.simulated_at, "", "", "Read-only candidate scope"],
    ["simulation", "max_depth", result.completeness.max_depth, "levels", "", "Configured traversal limit"],
    ["warning", "human review", result.human_review_warning, "", "", result.recommended_next_action],
  ];
  const addBatch = (kind: "root batch" | "candidate batch", batch: RecallBatchRecord) => {
    rows.push([
      kind,
      batch.batch_code,
      batch.product_name ?? "",
      batch.quantity ?? "UNAVAILABLE",
      batch.unit ?? "",
      `Origin: ${batch.origin_organization ?? "not recorded"}; ${batch.origin_location ?? "location not recorded"}; created ${batch.created_at}`,
    ]);
    for (const event of batch.events) {
      rows.push([
        "event",
        batch.batch_code,
        event.event_type,
        event.occurred_at,
        event.location ?? "",
        `Organization: ${event.organization_name ?? "not recorded"}; Notes: ${event.notes ?? "not recorded"}; row recorded ${event.recorded_at}`,
      ]);
    }
  };
  addBatch("root batch", result.root_batch);
  for (const batch of result.related_batches) addBatch("candidate batch", batch);
  for (const entry of result.upstream) {
    rows.push(["upstream path", entry.batch_code ?? "unavailable batch reference", entry.path.map((code) => code ?? "unavailable batch reference").join(" -> "), entry.depth, "edges", "Recorded genealogy path"]);
  }
  for (const entry of result.downstream) {
    rows.push(["downstream path", entry.batch_code ?? "unavailable batch reference", entry.path.map((code) => code ?? "unavailable batch reference").join(" -> "), entry.depth, "edges", "Recorded genealogy path"]);
  }
  for (const relationship of result.relationships) {
    rows.push([
      "relationship",
      relationship.parent_batch_code ?? "unavailable batch reference",
      `${relationship.relationship_type}: ${relationship.parent_batch_code ?? "?"} -> ${relationship.child_batch_code ?? "?"}`,
      relationship.source_quantity ?? "not recorded",
      relationship.source_unit ?? "",
      `${relationship.structurally_valid ? "structurally valid" : "needs review"}; recorded ${relationship.recorded_at}; ${relationship.validation_issues.join("; ")}`,
    ]);
  }
  for (const finding of result.trace_trust_findings) {
    rows.push([
      "TraceTrust finding",
      finding.batch_codes.join(" | "),
      `${finding.check_type} (${finding.severity}, ${finding.status})`,
      finding.title,
      "",
      `${finding.explanation} Recommended action: ${finding.recommended_action}`,
    ]);
  }
  for (const [name, value] of Object.entries(result.completeness)) {
    rows.push(["traversal completeness", name, String(value), "", "", "Simulation limit or graph check"]);
  }
  for (const warning of result.warnings) rows.push(["warning", "limitation", warning, "", "", "Review before making a decision"]);
  return rowsToCsv(rows);
}
