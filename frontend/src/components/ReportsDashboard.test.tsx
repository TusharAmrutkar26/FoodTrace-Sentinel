import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsDashboard } from "./ReportsDashboard";
import { api } from "../lib/api";
import { supplyChainReportCsv } from "../lib/supplyChainReportCsv";
import type { SupplyChainReport } from "../types/api";

vi.mock("../lib/api", () => ({ api: { getSupplyChainReport: vi.fn() } }));

const report: SupplyChainReport = {
  period: { start_date: "2026-10-04", end_date: "2026-10-10", timezone: "UTC" },
  generated_at: "2026-10-11T01:00:00Z",
  has_activity: true,
  batches_created: 2,
  batches_with_event_activity: 1,
  event_counts: [
    { event_type: "received", count: 0 },
    { event_type: "dispatched", count: 2 },
  ],
  genealogy_counts: [
    { relationship_type: "split", count: 1 },
    { relationship_type: "merge", count: 0 },
    { relationship_type: "transformation", count: 0 },
  ],
  quantity_metrics: { available: false, value: null, unit: null, reason: "Quantity totals unavailable, because event rows have no quantity.\nNo safe sum exists." },
  trace_trust_findings: { available: false, value: null, unit: null, reason: "No historical finding timestamp." },
  definitions: ["Event counts use occurrence time."],
  warnings: ["Genealogy link time may differ from operation time."],
};

afterEach(() => cleanup());

describe("ReportsDashboard", () => {
  it("loads API metrics, shows real zero separately from unavailable values, and refreshes the chosen range", async () => {
    vi.mocked(api.getSupplyChainReport).mockResolvedValue(report);
    const user = userEvent.setup();
    render(<ReportsDashboard />);

    expect(await screen.findByText("2", { selector: ".report-summary strong" })).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable", { selector: ".availability-badge" })).toHaveLength(2);
    expect(screen.getByText(/Quantity totals unavailable, because event rows have no quantity/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-03" } });
    await user.click(screen.getByRole("button", { name: "Refresh report" }));
    await waitFor(() => expect(api.getSupplyChainReport).toHaveBeenLastCalledWith({ start_date: "2026-10-01", end_date: "2026-10-03" }));
  });

  it("shows a loading state and a genuine empty-period state", async () => {
    let resolveReport: ((value: SupplyChainReport) => void) | undefined;
    vi.mocked(api.getSupplyChainReport).mockReturnValueOnce(new Promise((resolve) => { resolveReport = resolve; }));
    const emptyReport = { ...report, has_activity: false, batches_created: 0, batches_with_event_activity: 0, event_counts: report.event_counts.map((item) => ({ ...item, count: 0 })), genealogy_counts: report.genealogy_counts.map((item) => ({ ...item, count: 0 })) };
    render(<ReportsDashboard />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading report from the API");
    resolveReport?.(emptyReport);
    expect(await screen.findByText("No recorded activity in this period.")).toBeInTheDocument();
    expect(screen.getAllByText("0", { selector: ".report-breakdown-row strong" }).length).toBeGreaterThan(0);
  });

  it("shows API errors and retries against the API", async () => {
    vi.mocked(api.getSupplyChainReport).mockRejectedValueOnce(new Error("Report service unavailable"));
    vi.mocked(api.getSupplyChainReport).mockResolvedValueOnce(report);
    const user = userEvent.setup();
    render(<ReportsDashboard />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Report service unavailable");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Events by type" })).toBeInTheDocument();
  });

  it("rejects an inverted date range locally", async () => {
    vi.mocked(api.getSupplyChainReport).mockResolvedValue(report);
    const user = userEvent.setup();
    render(<ReportsDashboard />);
    await screen.findByRole("heading", { name: "Events by type" });
    const callsBeforeInvalidSubmit = vi.mocked(api.getSupplyChainReport).mock.calls.length;
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-08" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-07" } });
    await user.click(screen.getByRole("button", { name: "Refresh report" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Start date must be on or before end date");
    expect(api.getSupplyChainReport).toHaveBeenCalledTimes(callsBeforeInvalidSubmit);
  });

  it("exports actual aggregate values and safely escapes CSV punctuation and line breaks", () => {
    const csv = supplyChainReportCsv({
      ...report,
      warnings: ["Warning, with a \"quote\" and\nnext line"],
      quantity_metrics: { ...report.quantity_metrics, reason: "Reason, with \"quoted\" text\nand newline" },
    });

    expect(csv).toContain("period,start_date,2026-10-04,UTC date,available");
    expect(csv).toContain("summary,batches_created,2,batches,available");
    expect(csv).toContain("event count,received,0,events,available");
    expect(csv).toContain('quantity,weekly quantity totals,UNAVAILABLE,,unavailable,"Reason, with ""quoted"" text\nand newline"');
    expect(csv).toContain('"Warning, with a ""quote"" and\nnext line"');
    expect(csv).not.toContain("detailed event rows");
  });
});
