import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecallIncidentsDashboard } from "./RecallIncidentsDashboard";
import { api } from "../lib/api";
import type {
  Batch,
  RecallCandidateSnapshot,
  RecallIncidentDetail,
  RecallIncidentPage,
  RecallSimulationResponse,
} from "../types/api";

vi.mock("../lib/api", () => ({
  api: {
    listAllBatches: vi.fn(), listRecallIncidents: vi.fn(), listAllRecallIncidents: vi.fn(), getRecallIncident: vi.fn(),
    createRecallIncident: vi.fn(), simulateRecall: vi.fn(), captureRecallSnapshot: vi.fn(),
    reviewRecallIncident: vi.fn(), createRecallAction: vi.fn(), updateRecallAction: vi.fn(),
  },
}));

const batch: Batch = {
  id: 1, batch_code: "INC-ROOT", product: { id: 2, name: "Mango" },
  origin_organization: { id: 3, name: "Farm", participant_type: "supplier" },
  origin_location: "Field 1", quantity: "10.000", unit: "kg",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};

const summary = {
  reference_id: "RC-123456789ABC", root_batch_code: "INC-ROOT", reason: "Review a report",
  status: "pending_review" as const, created_by: null, created_by_verified: false,
  created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
};

const simulation: RecallSimulationResponse = {
  simulated_at: "2026-10-11T01:00:00Z",
  root_batch: { batch_code: "INC-ROOT", product_name: "Mango", origin_organization: "Farm", participant_type: "supplier", origin_location: "Field 1", quantity: "10.000", unit: "kg", created_at: "2026-10-01T00:00:00Z", events: [] },
  related_batches: [{ batch_code: "INC-CHILD", product_name: "Mango", origin_organization: "Packer", participant_type: "processor", origin_location: "Shed", quantity: "5.000", unit: "kg", created_at: "2026-10-02T00:00:00Z", events: [] }],
  upstream: [], downstream: [{ batch_code: "INC-CHILD", depth: 1, path: ["INC-ROOT", "INC-CHILD"] }],
  relationships: [{ parent_batch_code: "INC-ROOT", child_batch_code: "INC-CHILD", relationship_type: "split", source_quantity: "5.000", source_unit: "kg", recorded_at: "2026-10-02T00:00:00Z", structurally_valid: true, validation_issues: [] }],
  trace_trust_findings: [],
  completeness: { max_depth: 25, upstream_depth_limit_reached: false, downstream_depth_limit_reached: false, batch_limit_reached: false, relationship_limit_reached: false, event_history_truncated: false, trace_trust_findings_truncated: false, cycle_detected: false, missing_batch_references: false, invalid_relationships: false, traversal_complete: true },
  warnings: ["Only explicitly recorded genealogy links are traversed."],
  human_review_warning: "This candidate scope is not an official recall.",
  recommended_next_action: "Review the stored evidence.",
};

const detail = (overrides: Partial<RecallIncidentDetail> = {}): RecallIncidentDetail => ({
  ...summary, snapshots: [], reviews: [], actions: [],
  history: [{ id: 1, event_type: "incident_created", actor_name: null, actor_identity_verified: false, details: { root_batch_code: "INC-ROOT" }, recorded_at: "2026-10-11T00:00:00Z" }],
  ...overrides,
});
const page = (items: RecallIncidentPage["items"] = []) => ({ items, total: items.length, limit: 100, offset: 0 });

beforeEach(() => {
  vi.mocked(api.listAllBatches).mockResolvedValue([batch]);
  vi.mocked(api.listRecallIncidents).mockResolvedValue(page([summary]));
  vi.mocked(api.listAllRecallIncidents).mockResolvedValue([summary]);
  vi.mocked(api.getRecallIncident).mockResolvedValue(detail());
  vi.mocked(api.simulateRecall).mockResolvedValue(simulation);
  vi.mocked(api.createRecallIncident).mockResolvedValue(detail());
  vi.mocked(api.reviewRecallIncident).mockResolvedValue(detail());
  vi.mocked(api.createRecallAction).mockResolvedValue(detail());
  vi.mocked(api.updateRecallAction).mockResolvedValue(detail());
});
afterEach(() => cleanup());

describe("RecallIncidentsDashboard", () => {
  it("creates an incident from an existing batch and uses authenticated account attribution", async () => {
    vi.mocked(api.listRecallIncidents).mockResolvedValue(page());
    vi.mocked(api.listAllRecallIncidents).mockResolvedValueOnce([]).mockResolvedValue([summary]);
    const attributed = detail({
      created_by: "admin@example.test", created_by_verified: true,
      history: [{ id: 1, event_type: "incident_created", actor_name: "admin@example.test", actor_identity_verified: true, details: { root_batch_code: "INC-ROOT" }, recorded_at: "2026-10-11T00:00:00Z" }],
    });
    vi.mocked(api.createRecallIncident).mockResolvedValue(attributed);
    vi.mocked(api.getRecallIncident).mockResolvedValue(attributed);
    const user = userEvent.setup();
    render(<RecallIncidentsDashboard />);

    await screen.findByRole("option", { name: /INC-ROOT/ });
    await user.type(screen.getByRole("textbox", { name: "Incident reason" }), "Review a reported temperature excursion");
    expect(screen.queryByRole("textbox", { name: "Creator name" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create incident" }));

    await waitFor(() => expect(api.createRecallIncident).toHaveBeenCalledWith({
      root_batch_code: "INC-ROOT", reason: "Review a reported temperature excursion",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("created and set to pending review");
    expect(screen.getByText(/actions are attributed to the signed-in account/i)).toBeInTheDocument();
    expect(await screen.findByText("Created by authenticated account: admin@example.test (real-world identity not verified)")).toBeInTheDocument();
  });

  it("runs the existing simulator, shows evidence, and persists only on explicit capture", async () => {
    const saved: RecallCandidateSnapshot = {
      id: 9, captured_at: "2026-10-11T01:01:00Z", simulated_at: simulation.simulated_at,
      max_depth: 25, simulation,
    };
    vi.mocked(api.captureRecallSnapshot).mockResolvedValue(saved);
    vi.mocked(api.getRecallIncident)
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ snapshots: [saved] }));
    const user = userEvent.setup();
    render(<RecallIncidentsDashboard />);

    await screen.findByRole("heading", { name: "RC-123456789ABC" });
    expect(api.captureRecallSnapshot).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(api.simulateRecall).toHaveBeenCalledWith({ root_batch_code: "INC-ROOT", max_depth: 25 });
    expect(await screen.findByText("INC-ROOT → INC-CHILD")).toBeInTheDocument();
    expect(screen.getByText(/not an official recall/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save candidate snapshot" }));
    await waitFor(() => expect(api.captureRecallSnapshot).toHaveBeenCalledWith("RC-123456789ABC", 25));
    expect(await screen.findByRole("status")).toHaveTextContent("snapshot 9 saved");
    expect(screen.getByText(/1 explicit capture/i)).toBeInTheDocument();
  });

  it("records review decisions and follow-up actions and updates action completion", async () => {
    const withReview = detail({
      status: "requires_investigation",
      reviews: [{ id: 2, decision: "requires_investigation", notes: "Check original documents", reviewer_name: "reviewer@example.test", reviewer_identity_verified: true, created_at: "2026-10-11T02:00:00Z" }],
    });
    const withAction = detail({ status: "requires_investigation", reviews: withReview.reviews, actions: [{ id: 4, description: "Check paperwork", status: "open", assignee: "Operator label", due_at: null, completion_notes: null, evidence_references: ["DOC-7"], created_at: "2026-10-11T02:00:00Z", updated_at: "2026-10-11T02:00:00Z", completed_at: null }] });
    const completed = detail({ status: "requires_investigation", reviews: withReview.reviews, actions: [{ ...withAction.actions[0], status: "completed", completion_notes: "Checked", completed_at: "2026-10-11T03:00:00Z" }] });
    vi.mocked(api.reviewRecallIncident).mockResolvedValue(withReview);
    vi.mocked(api.createRecallAction).mockResolvedValue(withAction);
    vi.mocked(api.updateRecallAction).mockResolvedValue(completed);
    vi.mocked(api.getRecallIncident)
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(withReview)
      .mockResolvedValueOnce(withAction)
      .mockResolvedValueOnce(completed);
    vi.mocked(api.listAllRecallIncidents).mockResolvedValue([summary]);
    const user = userEvent.setup();
    render(<RecallIncidentsDashboard />);
    await screen.findByRole("heading", { name: "RC-123456789ABC" });

    await user.selectOptions(screen.getByLabelText("Decision"), "requires_investigation");
    await user.type(screen.getByLabelText("Review notes"), "Check original documents");
    expect(screen.queryByLabelText(/Reviewer name/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record review decision" }));
    await waitFor(() => expect(api.reviewRecallIncident).toHaveBeenCalledWith("RC-123456789ABC", { decision: "requires_investigation", notes: "Check original documents" }));

    await user.type(screen.getByLabelText("Action description"), "Check paperwork");
    await user.type(screen.getByLabelText(/Assignee/), "Operator label");
    await user.type(screen.getByLabelText(/Evidence references/), "DOC-7");
    await user.click(screen.getByRole("button", { name: "Add follow-up action" }));
    await waitFor(() => expect(api.createRecallAction).toHaveBeenCalledWith("RC-123456789ABC", expect.objectContaining({ description: "Check paperwork", assignee: "Operator label", evidence_references: ["DOC-7"] })));
    expect(await screen.findByText("Check original documents")).toBeInTheDocument();
    expect(screen.getByText("Reviewed by authenticated account: reviewer@example.test (real-world identity not verified)")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Status"), "completed");
    await user.click(screen.getByRole("button", { name: "Update action" }));
    await waitFor(() => expect(api.updateRecallAction).toHaveBeenCalledWith("RC-123456789ABC", 4, expect.objectContaining({ status: "completed" })));
    expect(screen.getByText(/Marked complete/)).toBeInTheDocument();
  });

  it("shows an API error and retry for failed incident loading", async () => {
    vi.mocked(api.listAllRecallIncidents).mockRejectedValueOnce(new Error("Incident API unavailable"));
    render(<RecallIncidentsDashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Incident API unavailable");
  });
});
