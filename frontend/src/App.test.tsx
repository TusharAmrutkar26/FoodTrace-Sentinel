import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { api, ApiError } from "./lib/api";
import type { Batch, Organization, Product } from "./types/api";
import { translateOrFallback } from "./i18n";

vi.mock("./lib/api", () => ({
  api: {
    getSession: vi.fn(),
    login: vi.fn(),
    registerWithInvitation: vi.fn(),
    logout: vi.fn(),
    createInvitation: vi.fn(),
    health: vi.fn(),
    listBatches: vi.fn(),
    listAllProducts: vi.fn(),
    listAllOrganizations: vi.fn(),
    getBatch: vi.fn(),
    getBatchQrIdentity: vi.fn(),
    batchQrSvgUrl: vi.fn((batchCode: string) => `/api/v1/batches/${batchCode}/qr.svg`),
    getPublicBatchTrace: vi.fn(),
    listAllBatchEvents: vi.fn(),
    createBatchEvent: vi.fn(),
    getGenealogy: vi.fn(),
    traceBatch: vi.fn(),
    getTrustFindings: vi.fn(),
    getSupplyChainReport: vi.fn(),
    simulateRecall: vi.fn(),
    listAllBatches: vi.fn(),
    listRecallIncidents: vi.fn(),
    listAllRecallIncidents: vi.fn(),
    getRecallIncident: vi.fn(),
    getRecallIncidentHistory: vi.fn(),
    createRecallIncident: vi.fn(),
    captureRecallSnapshot: vi.fn(),
    reviewRecallIncident: vi.fn(),
    createRecallAction: vi.fn(),
    updateRecallAction: vi.fn(),
    createGenealogyRelationship: vi.fn(),
    createBatch: vi.fn(),
    updateBatch: vi.fn(),
    createProduct: vi.fn(),
    createOrganization: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    fields: Record<string, string> = {};
    constructor(message = "API error", status = 400) {
      super(message);
      this.status = status;
    }
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
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.mocked(api.getSession).mockResolvedValue({
    user: { email: "platform-admin@example.test", role: "platform_admin", organization: null },
    csrf_token: "test-csrf-token",
  });
  vi.mocked(api.createInvitation).mockResolvedValue({
    email: "new-operator@example.test",
    role: "operator",
    organization: { id: 27, name: "Western Orchard" },
    invitation_token: "a-real-generated-test-token-from-the-api",
    expires_at: "2026-10-14T00:00:00Z",
  });
  vi.mocked(api.health).mockResolvedValue(undefined);
  vi.mocked(api.listAllProducts).mockResolvedValue(products);
  vi.mocked(api.listAllOrganizations).mockResolvedValue(organizations);
  vi.mocked(api.listBatches).mockResolvedValue(page([]));
  vi.mocked(api.getBatch).mockResolvedValue(sampleBatch);
  vi.mocked(api.getBatchQrIdentity).mockResolvedValue({
    trace_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    trace_url: "http://localhost:5173/trace/a1b2c3d4e5f60718293a4b5c6d7e8f90",
  });
  vi.mocked(api.listAllBatchEvents).mockResolvedValue([]);
  vi.mocked(api.createBatchEvent).mockResolvedValue(eventSample);
  vi.mocked(api.getGenealogy).mockResolvedValue({ batch: genealogyBatch, parents: [], children: [] });
  vi.mocked(api.traceBatch).mockImplementation(async (_code, direction) => ({
    root: genealogyBatch,
    direction,
    batches: [],
    relationships: [],
  }));
  vi.mocked(api.getTrustFindings).mockResolvedValue({
    items: [], total: 0, limit: 20, offset: 0,
    counts: { high: 0, medium: 0, low: 0, incomplete: 0 },
  });
  vi.mocked(api.getSupplyChainReport).mockResolvedValue({
    period: { start_date: "2026-10-04", end_date: "2026-10-10", timezone: "UTC" },
    generated_at: "2026-10-11T00:00:00Z", has_activity: false,
    batches_created: 0, batches_with_event_activity: 0,
    event_counts: [], genealogy_counts: [],
    quantity_metrics: { available: false, value: null, unit: null, reason: "No safe quantity total." },
    trace_trust_findings: { available: false, value: null, unit: null, reason: "No historical finding times." },
    definitions: [], warnings: [],
  });
  vi.mocked(api.listAllBatches).mockResolvedValue([sampleBatch]);
  vi.mocked(api.listRecallIncidents).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  vi.mocked(api.listAllRecallIncidents).mockResolvedValue([]);
  vi.mocked(api.createBatch).mockResolvedValue(sampleBatch);
  vi.mocked(api.updateBatch).mockResolvedValue(sampleBatch);
  vi.mocked(api.createProduct).mockResolvedValue({ id: 15, name: "Tomato", created_at: "2026-04-03T00:00:00Z" });
  vi.mocked(api.createOrganization).mockResolvedValue({ id: 28, name: "Sunrise Agro", participant_type: "producer", created_at: "2026-04-03T00:00:00Z" });
});

afterEach(() => cleanup());

async function renderDashboard() {
  render(<App />);
  await screen.findByRole("heading", { name: "Batch management" });
}

describe("FoodTrace Sentinel batch dashboard", () => {
  it("switches among English, Hindi, and Marathi immediately without losing page input", async () => {
    const user = userEvent.setup();
    await renderDashboard();
    const search = screen.getByPlaceholderText("Search by code, product, or origin…");
    await user.type(search, "MNG-201");

    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "hi");
    expect(await screen.findByRole("heading", { name: "बैच प्रबंधन" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("MNG-201")).toBeInTheDocument();
    expect(window.localStorage.getItem("foodtrace-language")).toBe("hi");

    await user.selectOptions(screen.getByRole("combobox", { name: "भाषा" }), "mr");
    expect(await screen.findByRole("heading", { name: "बॅच व्यवस्थापन" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("MNG-201")).toBeInTheDocument();
    expect(window.localStorage.getItem("foodtrace-language")).toBe("mr");

    await user.selectOptions(screen.getByRole("combobox", { name: "भाषा" }), "en");
    expect(await screen.findByRole("heading", { name: "Batch management" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("MNG-201")).toBeInTheDocument();
  });

  it("restores the selected language after the app is remounted", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await screen.findByRole("heading", { name: "Batch management" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "mr");
    expect(await screen.findByRole("heading", { name: "बॅच व्यवस्थापन" })).toBeInTheDocument();
    first.unmount();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "बॅच व्यवस्थापन" })).toBeInTheDocument();
  });

  it("keeps an open batch form and its unsaved input when the language changes", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getAllByRole("button", { name: "Register batch" })[0]);
    const dialog = screen.getByRole("dialog");
    const batchCode = within(dialog).getByPlaceholderText("e.g. MANGO-2026-001");
    await user.type(batchCode, "UNSAVED-MULTILINGUAL-01");
    const englishTitle = within(dialog).getByRole("heading").textContent;

    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "hi");

    expect(await within(dialog).findByDisplayValue("UNSAVED-MULTILINGUAL-01")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading").textContent).not.toBe(englishTitle);
  });

  it("falls back to the source phrase when a translation key is missing", () => {
    expect(translateOrFallback("hi", "Missing translation key")).toBe("Missing translation key");
  });

  it("translates parameterized backend messages while preserving their values", () => {
    const message = "Upstream traversal found additional links beyond the requested maximum depth of 4; those batches were not expanded.";
    const translated = translateOrFallback("mr", message);
    expect(translated).not.toBe(message);
    expect(translated).toContain("4");
  });

  it("opens the Reports workspace section and requests report data from the API", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole("button", { name: "Reports" }));

    expect(await screen.findByRole("heading", { name: "Supply-chain reports" })).toBeInTheDocument();
    await waitFor(() => expect(api.getSupplyChainReport).toHaveBeenCalledWith(expect.objectContaining({ start_date: expect.any(String), end_date: expect.any(String) })));
  });

  it("opens the live Batch Genealogy Explorer from workspace navigation", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole("button", { name: "Batch genealogy explorer" }));

    expect(await screen.findByRole("heading", { name: "Batch genealogy explorer" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search for a batch" })).toBeInTheDocument();
    expect(screen.getAllByText("Enter a batch code or product name to see its recorded relationships.")).toHaveLength(2);
  });

  it("opens the Recall simulator workspace and loads selectable batch records", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole("button", { name: "Recall simulator" }));

    expect(await screen.findByRole("heading", { name: "Recall simulator" })).toBeInTheDocument();
    expect(await screen.findByText("No batches are recorded yet")).toBeInTheDocument();
    expect(api.listBatches).toHaveBeenCalledWith({ limit: 25, offset: 0, q: undefined });
  });

  it("opens the Recall incidents workspace and loads its batch choices and incident list", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole("button", { name: "Recall incidents" }));

    expect(await screen.findByRole("heading", { name: "Recall incidents" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /MANGO-2026-001/ })).toBeInTheDocument();
    expect(screen.getByText("No incidents have been created.")).toBeInTheDocument();
    expect(api.listAllBatches).toHaveBeenCalled();
    expect(api.listAllRecallIncidents).toHaveBeenCalled();
  });

  it("opens the TraceTrust workspace section from navigation", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole("button", { name: "TraceTrust" }));

    expect(await screen.findByRole("heading", { name: "TraceTrust" })).toBeInTheDocument();
    expect(api.getTrustFindings).toHaveBeenCalled();
  });

  it("searches products, creates one through the API, and makes it available to batch registration", async () => {
    const created: Product = { id: 15, name: "Tomato", created_at: "2026-04-03T00:00:00Z" };
    vi.mocked(api.listAllProducts).mockResolvedValueOnce(products).mockResolvedValue([...products, created]);
    vi.mocked(api.createProduct).mockResolvedValue(created);
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole("button", { name: /Products/ }));
    expect(await screen.findByRole("heading", { name: "Products" })).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search products" });
    await user.type(search, "mango");
    expect(screen.getByText("Alphonso Mango")).toBeInTheDocument();
    await user.clear(search);
    await user.click(screen.getByRole("button", { name: "Add product" }));
    await user.type(screen.getByLabelText("Product name"), "Tomato");
    await user.click(screen.getByRole("button", { name: "Save product" }));

    await waitFor(() => expect(api.createProduct).toHaveBeenCalledWith({ name: "Tomato" }));
    expect(await screen.findByText(/Product “Tomato” was added/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Batches/ }));
    await user.click(screen.getAllByRole("button", { name: "Register batch" })[0]);
    expect(await within(screen.getByRole("dialog")).findByRole("option", { name: "Tomato" })).toBeInTheDocument();
  });

  it("creates organizations with a supported participant type and reports API errors", async () => {
    const created: Organization = { id: 28, name: "Sunrise Agro", participant_type: "producer", created_at: "2026-04-03T00:00:00Z" };
    vi.mocked(api.listAllOrganizations).mockResolvedValueOnce(organizations).mockResolvedValue([...organizations, created]);
    vi.mocked(api.createOrganization).mockResolvedValueOnce(created).mockRejectedValueOnce(new ApiError("Organization name is invalid", 422));
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole("button", { name: /Organizations/ }));
    await screen.findByRole("heading", { name: "Organizations" });
    await user.click(screen.getByRole("button", { name: "Add organization" }));
    await user.type(screen.getByLabelText("Organization name"), "Sunrise Agro");
    await user.selectOptions(screen.getByLabelText(/Participant type/), "producer");
    await user.click(screen.getByRole("button", { name: "Save organization" }));
    await waitFor(() => expect(api.createOrganization).toHaveBeenCalledWith({ name: "Sunrise Agro", participant_type: "producer" }));
    expect(await screen.findByText(/Organization “Sunrise Agro” was added/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add organization" }));
    await user.type(screen.getByLabelText("Organization name"), "Invalid Org");
    await user.click(screen.getByRole("button", { name: "Save organization" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Organization name is invalid");
  });

  it("loads API data and creates a batch using catalog IDs and an exact decimal string", async () => {
    const user = userEvent.setup();
    await renderDashboard();
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
    expect(await screen.findByRole("img", { name: "QR code for batch MANGO-2026-001" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open public trace page" })).toHaveAttribute(
      "href",
      "http://localhost:5173/trace/a1b2c3d4e5f60718293a4b5c6d7e8f90",
    );
    expect(api.listBatches).toHaveBeenCalled();
  });

  it("loads details by batch code and updates only editable batch fields", async () => {
    vi.mocked(api.listBatches).mockResolvedValue(page([sampleBatch]));
    const user = userEvent.setup();
    await renderDashboard();

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
    await renderDashboard();
    const search = screen.getByRole("searchbox", { name: "Search batches" });
    await user.type(search, "not-a-real-batch");
    expect(await screen.findByText("No matching batches")).toBeInTheDocument();
  });

  it("shows API catalog failures instead of presenting them as empty catalogs", async () => {
    vi.mocked(api.listAllProducts).mockRejectedValueOnce(
      new ApiError("Network request to /api/v1/products could not be completed. Check the API URL, Vite proxy, network, or browser CORS settings.", 0),
    );
    const user = userEvent.setup();
    await renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Network request.*Vite proxy.*CORS/);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "Register batch" })[0]);

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(within(dialog).queryByText(/Create at least one product/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Retry catalog request" })).toBeInTheDocument();
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
    await renderDashboard();

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
    await renderDashboard();
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

describe("public batch trace page", () => {
  const traceId = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const publicTrace = {
    batch: {
      batch_code: "MANGO-2026-001",
      product_name: "Alphonso Mango",
      quantity: "125.000",
      unit: "kg" as const,
      origin_organization: "Western Orchard",
      origin_location: "Ratnagiri, Maharashtra",
      created_at: "2026-04-01T00:00:00Z",
    },
    events: [{
      event_type: "quality_checked" as const,
      occurred_at: "2026-04-02T12:00:00Z",
      location: "Packing station",
      notes: "Private phone number must never appear here",
    }],
    parents: [{
      relationship_type: "transformation" as const,
      parent: { batch_code: "MANGO-SOURCE-1", product_name: "Alphonso Mango", quantity: "50.000", unit: "kg" as const },
      child: { batch_code: "MANGO-2026-001", product_name: "Alphonso Mango", quantity: "125.000", unit: "kg" as const },
      source_quantity: "50.000",
      source_unit: "kg" as const,
    }],
    children: [],
    upstream: [{ batch_code: "MANGO-SOURCE-1", product_name: "Alphonso Mango", quantity: "50.000", unit: "kg" as const, depth: 1 }],
    downstream: [],
    trace_trust_findings: [{
      check_type: "process_loss_incomplete" as const,
      severity: "low" as const,
      status: "incomplete" as const,
      title: "Process loss could not be assessed",
      explanation: "The relationship does not record an input quantity.",
    }],
  };

  beforeEach(() => {
    window.localStorage.removeItem("foodtrace-language");
    window.history.pushState({}, "", `/trace/${traceId}`);
    vi.mocked(api.getPublicBatchTrace).mockResolvedValue(publicTrace);
  });

  afterEach(() => window.history.pushState({}, "", "/"));

  it("loads the public record, events and genealogy without rendering private notes", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alphonso Mango" })).toBeInTheDocument();
    expect(screen.getByText("Ratnagiri, Maharashtra")).toBeInTheDocument();
    expect(screen.getByText("Quality Checked")).toBeInTheDocument();
    expect(screen.getByText("Packing station")).toBeInTheDocument();
    expect(screen.getAllByText("MANGO-SOURCE-1").length).toBeGreaterThan(0);
    expect(screen.getByText("TraceTrust data checks")).toBeInTheDocument();
    expect(screen.getByText("Process loss could not be assessed")).toBeInTheDocument();
    expect(screen.getByText("Incomplete evidence")).toBeInTheDocument();
    expect(screen.getByText(/Findings are prompts for review, not proof/i)).toBeInTheDocument();
    expect(screen.getByText(/does not prove the physical product or packaging is authentic/i)).toBeInTheDocument();
    expect(screen.queryByText(/Private phone number/)).not.toBeInTheDocument();
    expect(api.getPublicBatchTrace).toHaveBeenCalledWith(traceId);
    expect(api.getTrustFindings).not.toHaveBeenCalled();
  });

  it("shows honest empty states when no events, relationships, or findings are recorded", async () => {
    vi.mocked(api.getPublicBatchTrace).mockResolvedValueOnce({
      ...publicTrace,
      events: [],
      parents: [],
      children: [],
      upstream: [],
      downstream: [],
      trace_trust_findings: [],
    });
    render(<App />);

    expect(await screen.findByText(/No events or genealogy links are recorded for this batch/i)).toBeInTheDocument();
    expect(screen.getByText("No events have been recorded for this batch.")).toBeInTheDocument();
    expect(screen.getAllByText("No recorded batch links.")).toHaveLength(2);
    expect(screen.getByText(/No TraceTrust findings were returned/)).toBeInTheDocument();
    expect(screen.getByText(/No findings do not certify food safety/)).toBeInTheDocument();
  });

  it("keeps the public trace page readable when an older API omits TraceTrust findings", async () => {
    const { trace_trust_findings: _traceTrustFindings, ...legacyTrace } = publicTrace;
    expect(_traceTrustFindings).toBeDefined();
    vi.mocked(api.getPublicBatchTrace).mockResolvedValueOnce(legacyTrace);
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alphonso Mango" })).toBeInTheDocument();
    expect(screen.getByText("TraceTrust data checks")).toBeInTheDocument();
    expect(screen.getByText(/TraceTrust findings are unavailable in this API response/)).toBeInTheDocument();
    expect(screen.queryByText(/No TraceTrust findings were returned/)).not.toBeInTheDocument();
  });

  it("keeps the public route and data while translating passport labels", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alphonso Mango" })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "hi");

    expect(screen.getByText("दर्ज की गई जानकारी")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alphonso Mango" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/trace/${traceId}`);
    expect(api.getPublicBatchTrace).toHaveBeenCalledWith(traceId);
  });

  it("shows an unknown trace state for an invalid identity", async () => {
    vi.mocked(api.getPublicBatchTrace).mockRejectedValueOnce(new ApiError("Trace record was not found", 404));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Trace record not found" })).toBeInTheDocument();
  });

  it("offers retry when the public trace API is unavailable", async () => {
    vi.mocked(api.getPublicBatchTrace).mockRejectedValueOnce(new Error("Network unavailable"));
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Trace record unavailable" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Alphonso Mango" })).toBeInTheDocument();
    expect(api.getPublicBatchTrace).toHaveBeenCalledTimes(2);
  });
});
