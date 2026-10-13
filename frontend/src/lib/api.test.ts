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
    headers: { get: () => "application/json" },
    json: async () => payload,
  } as unknown as Response;
}

function responseWithContentType(contentType: string, body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("registers a public account through the session API and stores the CSRF token in memory", async () => {
    const session = {
      user: { email: "new@example.test", role: "viewer", organization: null },
      csrf_token: "csrf-registration-token",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(session, 201))
      .mockResolvedValueOnce(jsonResponse(undefined, 204));
    vi.stubGlobal("fetch", fetchMock);

    await api.register({ email: "New@Example.Test", password: "A-long-test-password!" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/auth/register");
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      email: "New@Example.Test",
      password: "A-long-test-password!",
    });
    await api.logout();
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-CSRF-Token")).toBe("csrf-registration-token");
  });

  it("sends credentials and the synchronizer CSRF token, retaining it when logout fails", async () => {
    const session = {
      user: {
        email: "operator@example.test",
        role: "operator",
        organization: { id: 9, name: "Farm Nine" },
      },
      csrf_token: "csrf-retained-after-network-error",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(session))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse(batch))
      .mockResolvedValueOnce(jsonResponse(undefined, 204));
    vi.stubGlobal("fetch", fetchMock);

    await api.login({ email: "operator@example.test", password: "not-stored-here" });
    await expect(api.logout()).rejects.toMatchObject({ status: 0 });
    await api.createBatch({
      batch_code: "TRACE-002",
      product_id: 4,
      origin_organization_id: 6,
      origin_location: "Pune",
      quantity: "10.500",
      unit: "kg",
    });

    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
    expect(fetchMock.mock.calls[2][1]?.credentials).toBe("include");
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("X-CSRF-Token")).toBe("csrf-retained-after-network-error");
    await api.logout();
  });

  it("uses same-origin API paths so the Vite proxy handles local development", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0, limit: 10, offset: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.listBatches({ limit: 10, offset: 0 });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/batches?limit=10&offset=0");
  });

  it("checks health through the same API base and validates the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.health();

    expect(fetchMock.mock.calls[0][0]).toBe("/health");
  });

  it("requests filtered TraceTrust findings through the versioned API root", async () => {
    const payload = {
      items: [], total: 0, limit: 20, offset: 0,
      counts: { high: 0, medium: 0, low: 0, incomplete: 0 },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);

    await api.getTrustFindings({ severity: "high", check_type: "genealogy_cycle", batch_code: "MNG-201", limit: 20, offset: 0 });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/trust/findings?limit=20&offset=0&severity=high&check_type=genealogy_cycle&batch_code=MNG-201");
  });

  it("lists incidents and explicitly posts candidate snapshot requests to the incident API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, limit: 10, offset: 0 }))
      .mockResolvedValueOnce(jsonResponse({
        id: 4, captured_at: "2026-10-11T00:00:00Z", simulated_at: "2026-10-11T00:00:00Z",
        max_depth: 8, simulation: {},
      }));
    vi.stubGlobal("fetch", fetchMock);

    await api.listRecallIncidents({ limit: 10, offset: 20, status: "pending_review" });
    await api.captureRecallSnapshot("RC-ABC123", 8);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/recall-incidents?limit=10&offset=20&status=pending_review");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/recall-incidents/RC-ABC123/snapshots");
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ max_depth: 8 });
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
  });

  it("loads all incident list pages so later records are not silently hidden", async () => {
    const item = (reference_id: string) => ({
      reference_id, root_batch_code: "TRACE-002", reason: "Review", status: "pending_review",
      created_by: null, created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [item("RC-FIRST")], total: 2, limit: 1, offset: 0 }))
      .mockResolvedValueOnce(jsonResponse({ items: [item("RC-SECOND")], total: 2, limit: 1, offset: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listAllRecallIncidents()).resolves.toEqual([item("RC-FIRST"), item("RC-SECOND")]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/recall-incidents?limit=100&offset=0",
      "/api/v1/recall-incidents?limit=100&offset=1",
    ]);
  });

  it("rejects an unexpected TraceTrust response shape instead of treating it as empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 })));

    await expect(api.getTrustFindings()).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/valid TraceTrust findings page/),
    });
  });

  it("requests and validates the selected supply-chain reporting period", async () => {
    const report = {
      period: { start_date: "2026-10-01", end_date: "2026-10-07", timezone: "UTC" },
      generated_at: "2026-10-08T00:00:00Z",
      has_activity: false,
      batches_created: 0,
      batches_with_event_activity: 0,
      event_counts: [{ event_type: "received", count: 0 }],
      genealogy_counts: [{ relationship_type: "split", count: 0 }],
      quantity_metrics: { available: false, value: null, unit: null, reason: "No supported quantity metric." },
      trace_trust_findings: { available: false, value: null, unit: null, reason: "No historical finding times." },
      definitions: ["Aggregate counts only."],
      warnings: ["Quantity totals are unavailable."],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(report));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getSupplyChainReport({ start_date: "2026-10-01", end_date: "2026-10-07" })).resolves.toEqual(report);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/reports/supply-chain?start_date=2026-10-01&end_date=2026-10-07");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...report, batches_created: "zero" })));
    await expect(api.getSupplyChainReport()).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/valid supply-chain report/),
    });
  });

  it("posts the selected batch and traversal depth to the recall simulation endpoint", async () => {
    const result = {
      simulated_at: "2026-10-11T00:00:00Z",
      root_batch: { batch_code: "TRACE-002", events: [] },
      related_batches: [], upstream: [], downstream: [], relationships: [], trace_trust_findings: [],
      completeness: { max_depth: 25, traversal_complete: true }, warnings: [],
      human_review_warning: "Review before acting.", recommended_next_action: "Verify source records.",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(result));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.simulateRecall({ root_batch_code: "TRACE-002", max_depth: 12 })).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/recalls/simulate");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ root_batch_code: "TRACE-002", max_depth: 12 }),
    });
  });

  it("posts product and organization records to the existing catalog endpoints", async () => {
    const product = { id: 3, name: "Rice", created_at: "2026-04-01T00:00:00Z" };
    const organization = { id: 5, name: "Sunrise Agro", participant_type: "producer", created_at: "2026-04-01T00:00:00Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(product, 201))
      .mockResolvedValueOnce(jsonResponse(organization, 201));
    vi.stubGlobal("fetch", fetchMock);

    await api.createProduct({ name: "Rice" });
    await api.createOrganization({ name: "Sunrise Agro", participant_type: "producer" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/products");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ name: "Rice" }) });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/organizations");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ name: "Sunrise Agro", participant_type: "producer" }),
    });
  });

  it("reports network/CORS/proxy causes without asserting the backend is offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(api.listBatches({ limit: 10, offset: 0 })).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/Vite proxy.*CORS/),
    });
  });

  it("reports HTML responses and malformed list envelopes as API format errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(responseWithContentType("text/html", "<html>Vite fallback</html>")));

    await expect(api.listAllProducts()).rejects.toMatchObject({
      status: 200,
      message: expect.stringMatching(/expected JSON.*FastAPI API/),
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ data: [] })));
    await expect(api.listAllProducts()).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/paginated JSON result/),
    });
  });

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

  it("loads QR identity and public trace data from the versioned API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ trace_id: "abc123", trace_url: "https://trace.example/trace/abc123" }))
      .mockResolvedValueOnce(jsonResponse({ batch: { batch_code: "TRACE-002" }, events: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.getBatchQrIdentity("TRACE-002");
    await api.getPublicBatchTrace("abc123");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/batches/TRACE-002/qr");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/public-traces/abc123");
    expect(api.batchQrSvgUrl("TRACE-002")).toBe("/api/v1/batches/TRACE-002/qr.svg");
  });
});
