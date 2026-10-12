import type { SupplyChainReport } from "../types/api";
import { rowsToCsv } from "./csv";

export function supplyChainReportCsv(report: SupplyChainReport): string {
  const rows: (string | number)[][] = [
    ["Record type", "Metric", "Value", "Unit", "Availability", "Definition or reason"],
    ["period", "start_date", report.period.start_date, "UTC date", "available", "Inclusive start date"],
    ["period", "end_date", report.period.end_date, "UTC date", "available", "Inclusive end date"],
    ["report", "generated_at", report.generated_at, "UTC timestamp", "available", "Aggregate report generation time"],
    ["summary", "batches_created", report.batches_created, "batches", "available", "Uses batches.created_at within the period"],
    ["summary", "batches_with_event_activity", report.batches_with_event_activity, "batches", "available", "Distinct batches with an event occurred_at within the period"],
  ];
  for (const item of report.event_counts) {
    rows.push(["event count", item.event_type, item.count, "events", "available", "Grouped by event occurred_at; aggregate counts only"]);
  }
  for (const item of report.genealogy_counts) {
    rows.push(["genealogy activity", item.relationship_type, item.count, "relationships", "available", "Grouped by relationship row created_at, not necessarily operation time"]);
  }
  rows.push(["quantity", "weekly quantity totals", "UNAVAILABLE", "", "unavailable", report.quantity_metrics.reason]);
  rows.push(["TraceTrust", "findings in reporting period", "UNAVAILABLE", "findings", "unavailable", report.trace_trust_findings.reason]);
  for (const warning of report.warnings) {
    rows.push(["warning", "data limitation", "", "", "warning", warning]);
  }
  return rowsToCsv(rows);
}
