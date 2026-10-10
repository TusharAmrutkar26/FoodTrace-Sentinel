import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import type { Batch } from "../types/api";

const batch: Batch = {
  id: 2,
  batch_code: "TRACE-002",
  product: { id: 4, name: "Tomato" },
  origin_organization: { id: 6, name: "Green Farm", participant_type: "supplier" },
  origin_location: "Pune",
  quantity: "10.500",
  unit: "kg",
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("sends the exact create contract to the versioned API and preserves quantity text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(batch, 201));
    vi.stubGlobal("fetch", fetchMock);

    await api.createBatch({
      batch_code: "TRACE-002",
      product_id: 4,
      origin_organization_id: 6,
      origin_location: "Pune",
      quantity: "10.500",
      unit: "kg",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/batches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      batch_code: "TRACE-002",
      product_id: 4,
      origin_organization_id: 6,
      origin_location: "Pune",
      quantity: "10.500",
      unit: "kg",
    });
  });

  it("maps FastAPI validation errors to readable field errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      detail: [{ loc: ["body", "quantity"], msg: "quantity must be greater than zero", type: "value_error" }],
    }, 422)));

    await expect(api.createBatch({
      batch_code: "TRACE-002",
      product_id: 4,
      origin_organization_id: 6,
      origin_location: "Pune",
      quantity: "0",
      unit: "kg",
    })).rejects.toMatchObject({
      status: 422,
      fields: { quantity: "quantity must be greater than zero" },
    });
  });

  it("uses the batch event and genealogy API contracts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 3, event_type: "received" }, 201))
      .mockResolvedValueOnce(jsonResponse({ root: {}, direction: "upstream", batches: [], relationships: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.createBatchEvent("TRACE-002", {
      event_type: "received",
      organization_id: 6,
      occurred_at: "2026-10-10T12:00:00.000Z",
    });
    await api.traceBatch("TRACE-002", "upstream");

    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/batches/TRACE-002/events");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      event_type: "received",
      organization_id: 6,
      occurred_at: "2026-10-10T12:00:00.000Z",
    });
    expect(fetchMock.mock.calls[1][0]).toContain("/api/v1/batches/TRACE-002/trace?direction=upstream");
  });
});
