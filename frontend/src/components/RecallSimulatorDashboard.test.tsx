import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecallSimulatorDashboard } from "./RecallSimulatorDashboard";
import { api, ApiError } from "../lib/api";
import { recallSimulationCsv } from "../lib/recallSimulationCsv";
import type { Batch, RecallSimulationResponse } from "../types/api";

vi.mock("../lib/api", () => ({
  api: { listBatches: vi.fn(), simulateRecall: vi.fn() },
  ApiError: class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } },
}));

const batch: Batch = {
  id: 31,
  batch_code: "MANGO-ROOT-1",
  product: { id: 8, name: "Alphonso Mango" },
  origin_organization: { id: 9, name: "Western Orchard", participant_type: "supplier" },
  origin_location: "Ratnagiri",
  quantity: "100.000",
  unit: "kg",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const simulation: RecallSimulationResponse = {
  simulated_at: "2026-10-11T03:00:00Z",
  root_batch: {
    batch_code: "MANGO-ROOT-1", product_name: "Alphonso Mango", origin_organization: "Western Orchard",
    participant_type: "supplier", origin_location: "Ratnagiri", quantity: "100.000", unit: "kg",
    created_at: "2026-10-01T00:00:00Z", events: [],
  },
  related_batches: [{
    batch_code: "MANGO-SOURCE-1", product_name: "Alphonso Mango", origin_organization: "Western Orchard",
    participant_type: "supplier", origin_location: "Ratnagiri", quantity: "100.000", unit: "kg",
    created_at: "2026-09-30T00:00:00Z", events: [],
  }, {
    batch_code: "MANGO-CHILD-1", product_name: "Alphonso Mango", origin_organization: "Packing House",
    participant_type: "processor", origin_location: "Pune", quantity: "45.000", unit: "kg",
    created_at: "2026-10-03T00:00:00Z", events: [{
      event_type: "dispatched", occurred_at: "2026-10-04T09:00:00Z", organization_name: "Packing House",
      participant_type: "processor", location: "Pune depot", notes: "Carrier, \"North\"\nreceipt",
      recorded_at: "2026-10-04T09:00:01Z",
    }],
  }],
  upstream: [{ batch_code: "MANGO-SOURCE-1", depth: 1, path: ["MANGO-ROOT-1", "MANGO-SOURCE-1"] }],
  downstream: [{ batch_code: "MANGO-CHILD-1", depth: 1, path: ["MANGO-ROOT-1", "MANGO-CHILD-1"] }],
  relationships: [{
    parent_batch_code: "MANGO-ROOT-1", child_batch_code: "MANGO-CHILD-1", relationship_type: "split",
    source_quantity: "45.000", source_unit: "kg", recorded_at: "2026-10-03T00:00:00Z",
    structurally_valid: true, validation_issues: [],
  }],
  trace_trust_findings: [{
    finding_id: "tt-0123456789abcdef0123", check_type: "process_loss_incomplete", severity: "low", status: "incomplete",
    title: "Process loss could not be assessed", explanation: "Recorded quantities are incomplete.",
    batch_codes: ["MANGO-ROOT-1", "MANGO-CHILD-1"], evidence: [{ label: "Input", value: "not recorded" }],
    recommended_action: "Review source operation records.",
  }],
  completeness: {
    max_depth: 25, upstream_depth_limit_reached: false, downstream_depth_limit_reached: false,
    batch_limit_reached: false, relationship_limit_reached: false, event_history_truncated: false,
    trace_trust_findings_truncated: false, cycle_detected: false, missing_batch_references: false,
    invalid_relationships: false, traversal_complete: true,
  },
  warnings: ["Only explicitly recorded genealogy links are traversed."],
  human_review_warning: "This is a simulated candidate scope for human assessment, not an official recall.",
  recommended_next_action: "Review the recorded evidence with responsible personnel.",
};

beforeEach(() => {
  vi.mocked(api.listBatches).mockResolvedValue({ items: [batch], total: 1, limit: 25, offset: 0 });
  vi.mocked(api.simulateRecall).mockResolvedValue(simulation);
});
afterEach(() => cleanup());

describe("RecallSimulatorDashboard", () => {
  it("selects a real batch, runs the API simulation, and renders both directions and evidence", async () => {
    const user = userEvent.setup();
    render(<RecallSimulatorDashboard />);

    await screen.findByRole("option", { name: /MANGO-ROOT-1/ });
    await user.click(screen.getByRole("button", { name: "Run simulation" }));

    expect(api.simulateRecall).toHaveBeenCalledWith({ root_batch_code: "MANGO-ROOT-1", max_depth: 25 });
    expect(await screen.findByRole("heading", { name: "Simulation for MANGO-ROOT-1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Upstream sources" })).toHaveTextContent("MANGO-SOURCE-1");
    expect(screen.getByRole("region", { name: "Downstream candidate batches" })).toHaveTextContent("MANGO-CHILD-1");
    expect(screen.getByText("Recorded parent input: 45.000 kg")).toBeInTheDocument();
    expect(screen.getByText(/Carrier, "North"\s+receipt/)).toBeInTheDocument();
    expect(screen.getByText("Process loss could not be assessed")).toBeInTheDocument();
    expect(screen.getByText(/not an official recall/i)).toBeInTheDocument();
    expect(screen.getByText("Only explicitly recorded genealogy links are traversed.")).toBeInTheDocument();
  });

  it("shows batch-search loading, empty, and API error states", async () => {
    let resolvePage: ((value: { items: Batch[]; total: number; limit: number; offset: number }) => void) | undefined;
    vi.mocked(api.listBatches).mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }));
    const view = render(<RecallSimulatorDashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading batches from the API");
    resolvePage?.({ items: [], total: 0, limit: 25, offset: 0 });
    expect(await screen.findByText("No batches are recorded yet")).toBeInTheDocument();
    view.unmount();

    vi.mocked(api.listBatches).mockRejectedValueOnce(new ApiError("Batch API unavailable", 503));
    render(<RecallSimulatorDashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Batch API unavailable");
  });

  it("renders an isolated root with empty upstream, downstream, relationship, and finding sections", async () => {
    vi.mocked(api.simulateRecall).mockResolvedValueOnce({
      ...simulation,
      related_batches: [],
      upstream: [],
      downstream: [],
      relationships: [],
      trace_trust_findings: [],
      warnings: ["No recorded upstream or downstream relationships were found."],
    });
    const user = userEvent.setup();
    render(<RecallSimulatorDashboard />);

    await screen.findByRole("option", { name: /MANGO-ROOT-1/ });
    await user.click(screen.getByRole("button", { name: "Run simulation" }));

    expect(await screen.findByRole("heading", { name: "Simulation for MANGO-ROOT-1" })).toBeInTheDocument();
    expect(screen.getAllByText("No recorded relationships in this direction.")).toHaveLength(2);
    expect(screen.getByText("No relationship rows were returned for this scope.")).toBeInTheDocument();
    expect(screen.getByText(/No associated TraceTrust findings/)).toBeInTheDocument();
  });

  it("shows simulation loading and a clear API failure with retry", async () => {
    let resolveSimulation: ((value: RecallSimulationResponse) => void) | undefined;
    vi.mocked(api.simulateRecall).mockReturnValueOnce(new Promise((resolve) => { resolveSimulation = resolve; }));
    const user = userEvent.setup();
    render(<RecallSimulatorDashboard />);
    await screen.findByRole("option", { name: /MANGO-ROOT-1/ });
    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(screen.getByRole("status")).toHaveTextContent("Traversing recorded genealogy");
    resolveSimulation?.(simulation);
    expect(await screen.findByRole("heading", { name: "Simulation for MANGO-ROOT-1" })).toBeInTheDocument();

    vi.mocked(api.simulateRecall).mockRejectedValueOnce(new ApiError("Unknown root batch", 404));
    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown root batch");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.simulateRecall).toHaveBeenCalledTimes(3));
  });

  it("rejects an invalid depth before making the simulation request", async () => {
    const user = userEvent.setup();
    render(<RecallSimulatorDashboard />);
    await screen.findByRole("option", { name: /MANGO-ROOT-1/ });
    await user.clear(screen.getByRole("spinbutton"));
    await user.type(screen.getByRole("spinbutton"), "0");
    await user.click(screen.getByRole("button", { name: "Run simulation" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Maximum depth must be a whole number from 1 to 50.");
    expect(api.simulateRecall).not.toHaveBeenCalled();
  });

  it("renders incomplete traversal and depth-limit warnings returned by the API", async () => {
    vi.mocked(api.simulateRecall).mockResolvedValueOnce({
      ...simulation,
      completeness: {
        ...simulation.completeness,
        downstream_depth_limit_reached: true,
        traversal_complete: false,
      },
      warnings: ["Downstream traversal found additional links beyond the requested maximum depth of 1; those batches were not expanded."],
    });
    const user = userEvent.setup();
    render(<RecallSimulatorDashboard />);

    await screen.findByRole("option", { name: /MANGO-ROOT-1/ });
    await user.click(screen.getByRole("button", { name: "Run simulation" }));

    expect(await screen.findByText("Partial traversal")).toBeInTheDocument();
    expect(screen.getByText(/additional links beyond the requested maximum depth of 1/)).toBeInTheDocument();
  });

  it("shows the selected safety and traversal limitations and escapes CSV evidence", () => {
    const partial: RecallSimulationResponse = {
      ...simulation,
      completeness: { ...simulation.completeness, downstream_depth_limit_reached: true, traversal_complete: false },
      warnings: ["Warning, with a \"quote\" and\nline break"],
    };
    const csv = recallSimulationCsv(partial);
    expect(csv).toContain("relationship,MANGO-ROOT-1,split: MANGO-ROOT-1 -> MANGO-CHILD-1,45.000,kg");
    expect(csv).toContain('"Organization: Packing House; Notes: Carrier, ""North""\nreceipt; row recorded 2026-10-04T09:00:01Z"');
    expect(csv).toContain('"Warning, with a ""quote"" and\nline break"');
    expect(csv).toContain("human review");
    expect(csv).toContain("downstream_depth_limit_reached,true");
  });
});
