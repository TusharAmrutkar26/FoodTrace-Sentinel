import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { api } from "./lib/api";
import type { Batch, Organization, Product } from "./types/api";

vi.mock("./lib/api", () => ({
  api: {
    listBatches: vi.fn(),
    listAllProducts: vi.fn(),
    listAllOrganizations: vi.fn(),
    getBatch: vi.fn(),
    listAllBatchEvents: vi.fn(),
    createBatchEvent: vi.fn(),
    getGenealogy: vi.fn(),
    traceBatch: vi.fn(),
    createGenealogyRelationship: vi.fn(),
    createBatch: vi.fn(),
    updateBatch: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status = 400;
    fields: Record<string, string> = {};
  },
}));

const products: Product[] = [{ id: 14, name: "Alphonso Mango", created_at: "2026-04-01T00:00:00Z" }];
const organizations: Organization[] = [{ id: 27, name: "Western Orchard", participant_type: "supplier", created_at: "2026-04-01T00:00:00Z" }];
const sampleBatch: Batch = {
  id: 8,
  batch_code: "MANGO-2026-001",
  product: { id: 14, name: "Alphonso Mango" },
  origin_organization: { id: 27, name: "Western Orchard", participant_type: "supplier" },
  origin_location: "Ratnagiri, Maharashtra",
  quantity: "125.000",
  unit: "kg",
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

const page = (items: Batch[], total = items.length) => ({ items, total, limit: 10, offset: 0 });
const genealogyBatch = { id: 8, batch_code: "MANGO-2026-001", product_name: "Alphonso Mango", quantity: "125.000", unit: "kg" as const };
const sourceRelationship = {
  id: 11,
  relationship_type: "transformation" as const,
  parent: { ...genealogyBatch, id: 7, batch_code: "MANGO-SOURCE-1" },
  child: genealogyBatch,
  source_quantity: "50.000",
  source_unit: "kg" as const,
  created_at: "2026-04-01T00:00:00Z",
};
const eventSample = {
  id: 12,
  batch_id: sampleBatch.id,
  event_type: "quality_checked" as const,
  occurred_at: "2026-04-02T12:00:00Z",
  organization: organizations[0],
  location: "Packing station",
  notes: "Grade A sample passed",
  created_at: "2026-04-02T12:00:00Z",
};

beforeEach(() => {
  vi.mocked(api.listAllProducts).mockResolvedValue(products);
  vi.mocked(api.listAllOrganizations).mockResolvedValue(organizations);
  vi.mocked(api.listBatches).mockResolvedValue(page([]));
  vi.mocked(api.getBatch).mockResolvedValue(sampleBatch);
  vi.mocked(api.listAllBatchEvents).mockResolvedValue([]);
  vi.mocked(api.createBatchEvent).mockResolvedValue(eventSample);
  vi.mocked(api.getGenealogy).mockResolvedValue({ batch: genealogyBatch, parents: [], children: [] });
  vi.mocked(api.traceBatch).mockImplementation(async (_code, direction) => ({
    root: genealogyBatch,
    direction,
    batches: [],
    relationships: [],
  }));
  vi.mocked(api.createBatch).mockResolvedValue(sampleBatch);
  vi.mocked(api.updateBatch).mockResolvedValue(sampleBatch);
});

afterEach(() => cleanup());

describe("FoodTrace Sentinel batch dashboard", () => {
  it("loads API data and creates a batch using catalog IDs and an exact decimal string", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("No batches yet");

    await user.click(screen.getAllByRole("button", { name: "Register batch" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("option", { name: "Alphonso Mango" })).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Batch code/), "MANGO-NEW-007");
    await user.type(within(dialog).getByLabelText(/Origin location/), "Ratnagiri, Maharashtra");
    await user.type(within(dialog).getByLabelText(/Quantity/), "125.000");
    await user.click(within(dialog).getByRole("button", { name: "Create batch" }));

    await waitFor(() => expect(api.createBatch).toHaveBeenCalledWith({
      batch_code: "MANGO-NEW-007",
      product_id: 14,
      origin_organization_id: 27,
      origin_location: "Ratnagiri, Maharashtra",
      quantity: "125.000",
      unit: "kg",
    }));
    expect(await screen.findByText("Batch MANGO-2026-001 was created.")).toBeInTheDocument();
    expect(api.listBatches).toHaveBeenCalled();
  });

  it("loads details by batch code and updates only editable batch fields", async () => {
    vi.mocked(api.listBatches).mockResolvedValue(page([sampleBatch]));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "MANGO-2026-001" }));
    const detailDialog = await screen.findByRole("dialog");
    expect(within(detailDialog).getByText("Ratnagiri, Maharashtra")).toBeInTheDocument();
    expect(api.getBatch).toHaveBeenCalledWith("MANGO-2026-001");
    await user.click(screen.getByRole("button", { name: "Edit batch" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("MANGO-2026-001", { selector: "strong" })).toBeInTheDocument();
    const quantity = within(dialog).getByLabelText(/Quantity/);
    await user.clear(quantity);
    await user.type(quantity, "130.250");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateBatch).toHaveBeenCalledWith("MANGO-2026-001", {
      product_id: 14,
      origin_organization_id: 27,
      origin_location: "Ratnagiri, Maharashtra",
      quantity: "130.250",
      unit: "kg",
    }));
    expect(await screen.findByText("Batch MANGO-2026-001 was updated.")).toBeInTheDocument();
  });

  it("shows API validation feedback and an empty-search state", async () => {
    vi.mocked(api.listBatches).mockResolvedValue(page([]));
    const user = userEvent.setup();
    render(<App />);
    const search = screen.getByRole("searchbox", { name: "Search batches" });
    await user.type(search, "not-a-real-batch");
    expect(await screen.findByText("No matching batches")).toBeInTheDocument();
  });

  it("renders event history and explicit parent, child, and trace genealogy", async () => {
    vi.mocked(api.listBatches).mockResolvedValue(page([sampleBatch]));
    vi.mocked(api.listAllBatchEvents).mockResolvedValue([eventSample]);
    vi.mocked(api.getGenealogy).mockResolvedValue({
      batch: genealogyBatch,
      parents: [sourceRelationship],
      children: [{
        ...sourceRelationship,
        id: 13,
        parent: genealogyBatch,
        child: { ...genealogyBatch, id: 9, batch_code: "MANGO-CHILD-1" },
      }],
    });
    vi.mocked(api.traceBatch).mockImplementation(async (_code, direction) => ({
      root: genealogyBatch,
      direction,
      batches: direction === "upstream"
        ? [{ ...sourceRelationship.parent, depth: 1 }]
        : [{ ...sourceRelationship.child, id: 9, batch_code: "MANGO-CHILD-1", depth: 1 }],
      relationships: [sourceRelationship],
    }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "MANGO-2026-001" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("Quality checked")).toBeInTheDocument();
    expect((await within(dialog).findAllByText("MANGO-SOURCE-1")).length).toBeGreaterThan(0);
    expect((await within(dialog).findAllByText("MANGO-CHILD-1")).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Upstream sources")).toBeInTheDocument();
    expect(within(dialog).getByText("Downstream affected batches")).toBeInTheDocument();
    expect(api.listAllBatchEvents).toHaveBeenCalledWith("MANGO-2026-001");
    expect(api.traceBatch).toHaveBeenCalledWith("MANGO-2026-001", "upstream");
    expect(api.traceBatch).toHaveBeenCalledWith("MANGO-2026-001", "downstream");
  });

  it("records an event with the selected organization ID and refreshes the history", async () => {
    vi.mocked(api.listBatches).mockResolvedValue(page([sampleBatch]));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "MANGO-2026-001" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record event" }));
    await user.selectOptions(within(dialog).getByLabelText(/Event type/), "quality_checked");
    await user.selectOptions(within(dialog).getByLabelText(/Organization/), "27");
    await user.type(within(dialog).getByLabelText(/Location/), "Packing station");
    await user.type(within(dialog).getByLabelText(/Notes/), "Sample passed");
    await user.click(within(dialog).getByRole("button", { name: "Save event" }));

    await waitFor(() => expect(api.createBatchEvent).toHaveBeenCalledWith("MANGO-2026-001", {
      event_type: "quality_checked",
      organization_id: 27,
      location: "Packing station",
      notes: "Sample passed",
    }));
    expect(await within(dialog).findByText("Event recorded.")).toBeInTheDocument();
    expect(api.listAllBatchEvents).toHaveBeenCalledTimes(2);
  });
});
