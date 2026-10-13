import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BatchGenealogyExplorer } from "./BatchGenealogyExplorer";
import { api } from "../lib/api";
import { I18nProvider, translations } from "../i18n";
import type {
  Batch,
  BatchEvent,
  GenealogyGraph,
  GenealogyRelationship,
  Page,
} from "../types/api";

vi.mock("../lib/api", () => ({
  api: {
    listBatches: vi.fn(),
    getGenealogy: vi.fn(),
    listAllBatchEvents: vi.fn(),
  },
}));

const selected = {
  id: 2,
  batch_code: "MNG-202",
  product_name: "Alphonso Mango",
  quantity: "78.500",
  unit: "kg" as const,
};
const source = {
  id: 1,
  batch_code: "MNG-201",
  product_name: "Alphonso Mango",
  quantity: "100.000",
  unit: "kg" as const,
};
const child = {
  id: 3,
  batch_code: "MNG-203",
  product_name: "Mango Pulp",
  quantity: "50.000",
  unit: "kg" as const,
};

const parentLink: GenealogyRelationship = {
  id: 11,
  relationship_type: "transformation",
  parent: source,
  child: selected,
  source_quantity: "80.000",
  source_unit: "kg",
  created_at: "2026-10-10T08:00:00Z",
};
const childLink: GenealogyRelationship = {
  id: 12,
  relationship_type: "split",
  parent: selected,
  child,
  source_quantity: null,
  source_unit: null,
  created_at: "2026-10-11T09:00:00Z",
};
const selectedGraph: GenealogyGraph = {
  batch: selected,
  parents: [parentLink],
  children: [childLink],
};
const event: BatchEvent = {
  id: 25,
  batch_id: selected.id,
  event_type: "quality_checked",
  occurred_at: "2026-10-11T10:30:00Z",
  organization: { id: 4, name: "Western Orchard", participant_type: "supplier" },
  location: "Packing station",
  notes: "Sample checked against the recorded specification.",
  created_at: "2026-10-11T10:30:00Z",
};
const searchBatch: Batch = {
  id: selected.id,
  batch_code: selected.batch_code,
  product: { id: 7, name: selected.product_name },
  origin_organization: { id: 4, name: "Western Orchard", participant_type: "supplier" },
  origin_location: "Ratnagiri",
  quantity: selected.quantity,
  unit: selected.unit,
  created_at: "2026-10-10T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
};

function batchPage(items: Batch[]): Page<Batch> {
  return { items, total: items.length, limit: 20, offset: 0 };
}

function renderExplorer(locale?: "en" | "hi" | "mr") {
  if (locale) window.localStorage.setItem("foodtrace-language", locale);
  return render(<I18nProvider><BatchGenealogyExplorer /></I18nProvider>);
}

async function searchAndSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("searchbox", { name: "Search for a batch" }), "MNG-202");
  await user.click(screen.getByRole("button", { name: /^Search$/ }));
  await user.click(await screen.findByRole("button", { name: "Explore batch MNG-202" }));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(api.listBatches).mockResolvedValue(batchPage([searchBatch]));
  vi.mocked(api.getGenealogy).mockResolvedValue(selectedGraph);
  vi.mocked(api.listAllBatchEvents).mockResolvedValue([event]);
});

afterEach(() => cleanup());

describe("Batch genealogy explorer", () => {
  it("searches real batch data and renders selected, upstream, downstream, quantity, relationship, and event details", async () => {
    const user = userEvent.setup();
    renderExplorer();
    await searchAndSelect(user);

    expect(api.listBatches).toHaveBeenCalledWith({ limit: 20, offset: 0, q: "MNG-202" });
    expect(api.getGenealogy).toHaveBeenCalledWith("MNG-202");
    expect(api.listAllBatchEvents).toHaveBeenCalledWith("MNG-202");
    expect(screen.getByRole("article", { name: "Selected batch" })).toHaveTextContent("MNG-202");
    expect(screen.getByText("Only recorded links are shown. Missing links cannot be inferred from available records.")).toBeInTheDocument();
    expect(screen.getAllByText("Alphonso Mango").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Explore batch MNG-201" })).toHaveTextContent("100.000 kg");
    expect(screen.getByRole("button", { name: "Explore batch MNG-203" })).toHaveTextContent("Mango Pulp");
    expect(screen.getByText(/80\.000 kg/)).toBeInTheDocument();
    expect(screen.getByText("Transformation")).toBeInTheDocument();
    expect(screen.getByText("Split")).toBeInTheDocument();

    const eventList = screen.getByRole("list", { name: "Recorded events for MNG-202" });
    expect(within(eventList).getByText("Quality checked")).toBeInTheDocument();
    expect(within(eventList).getByText("Location: Packing station")).toBeInTheDocument();
    expect(within(eventList).getByText(event.notes!)).toBeInTheDocument();
  });

  it("navigates to a connected batch and loads its own relationships", async () => {
    const nextGraph: GenealogyGraph = {
      batch: child,
      parents: [childLink],
      children: [],
    };
    vi.mocked(api.getGenealogy).mockResolvedValueOnce(selectedGraph).mockResolvedValueOnce(nextGraph);
    const user = userEvent.setup();
    renderExplorer();
    await searchAndSelect(user);
    await user.click(await screen.findByRole("button", { name: "Explore batch MNG-203" }));

    expect(await screen.findByRole("article", { name: "Selected batch" })).toHaveTextContent("MNG-203");
    await waitFor(() => expect(api.getGenealogy).toHaveBeenLastCalledWith("MNG-203"));
    expect(api.listAllBatchEvents).toHaveBeenLastCalledWith("MNG-203");
    expect(within(screen.getByRole("group", { name: "Recorded batch relationships" }))
      .getByRole("button", { name: "Explore batch MNG-202" })).toBeInTheDocument();
  });

  it("clearly states when the stored graph has no parent or child links", async () => {
    vi.mocked(api.getGenealogy).mockResolvedValue({ batch: selected, parents: [], children: [] });
    vi.mocked(api.listAllBatchEvents).mockResolvedValue([]);
    const user = userEvent.setup();
    renderExplorer();
    await searchAndSelect(user);

    expect(await screen.findByText(/No genealogy links are recorded for this batch/)).toBeInTheDocument();
    expect(screen.getByText("No parent batches are recorded.")).toBeInTheDocument();
    expect(screen.getByText("No child batches are recorded.")).toBeInTheDocument();
    expect(screen.getByText("No events are recorded for this batch.")).toBeInTheDocument();
  });

  it("shows search and genealogy API failures and allows a retry", async () => {
    vi.mocked(api.listBatches).mockRejectedValueOnce(new Error("Batch search unavailable")).mockResolvedValueOnce(batchPage([searchBatch]));
    vi.mocked(api.getGenealogy).mockRejectedValueOnce(new Error("Genealogy service unavailable")).mockResolvedValueOnce(selectedGraph);
    const user = userEvent.setup();
    renderExplorer();
    await user.type(screen.getByRole("searchbox", { name: "Search for a batch" }), "MNG-202");
    await user.click(screen.getByRole("button", { name: /^Search$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Batch search unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(await screen.findByRole("button", { name: "Explore batch MNG-202" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Genealogy service unavailable");
    await user.click(screen.getByRole("button", { name: "Retry genealogy" }));
    expect(await screen.findByRole("article", { name: "Selected batch" })).toHaveTextContent("MNG-202");
  });

  it.each(["en", "hi", "mr"] as const)("translates the explorer in %s", async (locale) => {
    renderExplorer(locale);
    expect(await screen.findByRole("heading", { name: translations["Batch genealogy explorer"][locale] })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: translations["Search for a batch"][locale] }), "MNG-202");
    await user.click(screen.getByRole("button", { name: translations.Search[locale] }));
    await user.click(await screen.findByRole("button", { name: /MNG-202/ }));
    expect(await screen.findByRole("heading", { name: new RegExp(translations["Upstream parents"][locale]) })).toBeInTheDocument();
  });
});
