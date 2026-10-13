import type {
  AuthSession,
  UserInvitation,
  Batch,
  BatchCreateInput,
  BatchEvent,
  BatchEventCreateInput,
  BatchQrIdentity,
  BatchUpdateInput,
  GenealogyCreateInput,
  GenealogyGraph,
  GenealogyRelationship,
  GenealogyTrace,
  Organization,
  OrganizationCreateInput,
  Page,
  Product,
  ProductCreateInput,
  PublicBatchTrace,
  RecallSimulationRequest,
  RecallSimulationResponse,
  RecallIncidentPage,
  RecallIncidentDetail,
  RecallIncidentSummary,
  RecallCandidateSnapshot,
  RecallReviewDecision,
  RecallActionStatus,
  RecallIncidentHistoryItem,
  SupplyChainReport,
  TraceDirection,
  TrustFindingFilters,
  TrustFindingPage,
} from "../types/api";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/api\/v1\/?$/i, "")
  .replace(/\/+$/, "");
const API_ROOT = `${API_BASE_URL}/api/v1`;
const PAGE_SIZE = 100;
let csrfToken: string | null = null;

function setCsrfToken(value: string | null) {
  csrfToken = value;
}

export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;

  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

function explainFailure(payload: unknown, fallback: string): { message: string; fields: Record<string, string> } {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = payload.detail;
    if (typeof detail === "string") return { message: detail, fields: {} };
    if (Array.isArray(detail)) {
      const fields: Record<string, string> = {};
      const messages = detail.map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const issue = item as { loc?: unknown[]; msg?: string };
        const field = issue.loc?.at(-1);
        const message = issue.msg ?? "Invalid value";
        if (typeof field === "string" && field !== "body") fields[field] = message;
        return `${typeof field === "string" ? `${field}: ` : ""}${message}`;
      });
      return { message: messages.join(". "), fields };
    }
  }
  return { message: fallback, fields: {} };
}

function endpointLabel(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function isJsonContentType(contentType: string): boolean {
  return /(?:application\/json|[+]json)(?:\s*;|$)/i.test(contentType);
}

async function requestAt<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  try {
    response = await fetch(url, {
      ...init,
      credentials: "include",
      headers,
    });
  } catch {
    throw new ApiError(
      `Network request to ${endpointLabel(url)} could not be completed. Check the API URL, Vite proxy, network, or browser CORS settings.`,
      0,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    if (response.status === 401 && !/\/auth\/(?:login|register|me)(?:\?|$)/.test(url)) {
      window.dispatchEvent(new CustomEvent("foodtrace:authentication-expired"));
    }
    const payload: unknown = isJsonContentType(contentType)
      ? await response.json().catch(() => null)
      : null;
    const fallback = contentType
      ? `API endpoint ${endpointLabel(url)} returned HTTP ${response.status} (${contentType}).`
      : `API endpoint ${endpointLabel(url)} returned HTTP ${response.status}.`;
    const failure = explainFailure(payload, fallback);
    throw new ApiError(failure.message, response.status, failure.fields);
  }

  if (response.status === 204) return undefined as T;

  if (!isJsonContentType(contentType)) {
    throw new ApiError(
      `Unexpected response from ${endpointLabel(url)}: expected JSON but received ${contentType || "no content type"}. Check that this request reached the FastAPI API through the configured proxy.`,
      response.status,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(`API endpoint ${endpointLabel(url)} returned invalid JSON.`, response.status);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestAt<T>(`${API_ROOT}${path}`, init);
}

function asPage<T>(payload: unknown, endpoint: string): Page<T> {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("items" in payload) ||
    !Array.isArray(payload.items) ||
    !("total" in payload) ||
    typeof payload.total !== "number" ||
    !Number.isInteger(payload.total) ||
    payload.total < 0 ||
    !("limit" in payload) ||
    typeof payload.limit !== "number" ||
    !("offset" in payload) ||
    typeof payload.offset !== "number"
  ) {
    throw new ApiError(
      `Unexpected response from ${endpoint}: expected a paginated JSON result with items and total.`,
      502,
    );
  }
  return payload as Page<T>;
}

function asTrustFindingPage(payload: unknown): TrustFindingPage {
  const endpoint = `${API_ROOT}/trust/findings`;
  const checkTypes = [
    "batch_quantity_invalid", "batch_unit_invalid", "genealogy_source_quantity_invalid",
    "genealogy_source_unit_invalid", "genealogy_source_unit_mismatch", "split_overallocated",
    "genealogy_cycle", "process_loss", "process_loss_incomplete",
  ];
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const counts = record?.counts && typeof record.counts === "object" ? record.counts as Record<string, unknown> : null;
  const isCount = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
  const isFinding = (value: unknown) => {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item.finding_id === "string" && /^tt-[0-9a-f]{20}$/.test(item.finding_id)
      && typeof item.check_type === "string" && checkTypes.includes(item.check_type)
      && ["low", "medium", "high"].includes(String(item.severity))
      && ["detected", "incomplete"].includes(String(item.status))
      && typeof item.title === "string"
      && typeof item.explanation === "string"
      && Array.isArray(item.batch_codes) && item.batch_codes.every((code) => typeof code === "string")
      && Array.isArray(item.evidence) && item.evidence.every((entry) => !!entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).label === "string" && typeof (entry as Record<string, unknown>).value === "string")
      && typeof item.recommended_action === "string";
  };
  if (
    !record || !Array.isArray(record.items) || !record.items.every(isFinding)
    || !isCount(record.total) || typeof record.limit !== "number" || !isCount(record.limit) || record.limit < 1 || record.limit > 100
    || typeof record.offset !== "number" || !isCount(record.offset) || record.offset > 10000
    || !counts || !isCount(counts.high) || !isCount(counts.medium) || !isCount(counts.low) || !isCount(counts.incomplete)
  ) {
    throw new ApiError(`Unexpected response from ${endpoint}: expected a valid TraceTrust findings page.`, 502);
  }
  return payload as TrustFindingPage;
}

function asSupplyChainReport(payload: unknown): SupplyChainReport {
  const endpoint = `${API_ROOT}/reports/supply-chain`;
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const period = record?.period && typeof record.period === "object" ? record.period as Record<string, unknown> : null;
  const isNonNegativeInteger = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
  const isUnavailable = (value: unknown) => !!value && typeof value === "object"
    && (value as Record<string, unknown>).available === false
    && (value as Record<string, unknown>).value === null
    && (value as Record<string, unknown>).unit === null
    && typeof (value as Record<string, unknown>).reason === "string";
  const eventTypes = ["harvested", "produced", "received", "quality_checked", "dispatched", "delivered", "stored", "processed"];
  const relationshipTypes = ["split", "merge", "transformation"];
  const isStringList = (value: unknown) => Array.isArray(value) && value.every((entry) => typeof entry === "string");
  if (
    !record || !period || typeof period.start_date !== "string" || typeof period.end_date !== "string" || period.timezone !== "UTC"
    || typeof record.generated_at !== "string" || typeof record.has_activity !== "boolean"
    || !isNonNegativeInteger(record.batches_created) || !isNonNegativeInteger(record.batches_with_event_activity)
    || !Array.isArray(record.event_counts) || !record.event_counts.every((item) => !!item && typeof item === "object" && eventTypes.includes(String((item as Record<string, unknown>).event_type)) && isNonNegativeInteger((item as Record<string, unknown>).count))
    || !Array.isArray(record.genealogy_counts) || !record.genealogy_counts.every((item) => !!item && typeof item === "object" && relationshipTypes.includes(String((item as Record<string, unknown>).relationship_type)) && isNonNegativeInteger((item as Record<string, unknown>).count))
    || !isUnavailable(record.quantity_metrics) || !isUnavailable(record.trace_trust_findings)
    || !isStringList(record.definitions) || !isStringList(record.warnings)
  ) {
    throw new ApiError(`Unexpected response from ${endpoint}: expected a valid supply-chain report.`, 502);
  }
  return payload as SupplyChainReport;
}

async function allPages<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  let offset = 0;
  let total = 0;
  do {
    const endpoint = `${path}?limit=${PAGE_SIZE}&offset=${offset}`;
    const page = asPage<T>(await request<unknown>(endpoint), `${API_ROOT}${endpoint}`);
    result.push(...page.items);
    total = page.total;
    offset += page.items.length;
    if (page.items.length === 0 || offset > 10_000) break;
  } while (offset < total);
  return result;
}

export const api = {
  async getSession(): Promise<AuthSession> {
    const result = await request<AuthSession>("/auth/me");
    setCsrfToken(result.csrf_token);
    return result;
  },
  async login(payload: { email: string; password: string }): Promise<AuthSession> {
    const result = await request<AuthSession>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setCsrfToken(result.csrf_token);
    return result;
  },
  async registerWithInvitation(payload: { invitation_token: string; password: string }): Promise<AuthSession> {
    const result = await request<AuthSession>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setCsrfToken(result.csrf_token);
    return result;
  },
  async register(payload: { email: string; password: string }): Promise<AuthSession> {
    const result = await request<AuthSession>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setCsrfToken(result.csrf_token);
    return result;
  },
  async logout(): Promise<void> {
    await request<void>("/auth/logout", { method: "POST" });
    setCsrfToken(null);
  },
  createInvitation(payload: { email: string; role: Exclude<import("../types/api").UserRole, "platform_admin">; organization_id?: number }): Promise<UserInvitation> {
    return request<UserInvitation>("/auth/invitations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async health(): Promise<void> {
    const payload = await requestAt<unknown>(`${API_BASE_URL}/health`);
    if (!payload || typeof payload !== "object" || !("status" in payload) || payload.status !== "ok") {
      throw new ApiError("Health endpoint returned an unexpected JSON response; expected { status: \"ok\" }.", 502);
    }
  },
  async listBatches(options: { limit: number; offset: number; q?: string }): Promise<Page<Batch>> {
    const query = new URLSearchParams({ limit: String(options.limit), offset: String(options.offset) });
    if (options.q) query.set("q", options.q);
    const endpoint = `/batches?${query.toString()}`;
    return asPage<Batch>(await request<unknown>(endpoint), `${API_ROOT}${endpoint}`);
  },
  listAllProducts(): Promise<Product[]> {
    return allPages<Product>("/products");
  },
  listAllBatches(): Promise<Batch[]> {
    return allPages<Batch>("/batches");
  },
  listAllOrganizations(): Promise<Organization[]> {
    return allPages<Organization>("/organizations");
  },
  createProduct(payload: ProductCreateInput): Promise<Product> {
    return request<Product>("/products", { method: "POST", body: JSON.stringify(payload) });
  },
  createOrganization(payload: OrganizationCreateInput): Promise<Organization> {
    return request<Organization>("/organizations", { method: "POST", body: JSON.stringify(payload) });
  },
  getBatch(batchCode: string): Promise<Batch> {
    return request<Batch>(`/batches/${encodeURIComponent(batchCode)}`);
  },
  getBatchQrIdentity(batchCode: string): Promise<BatchQrIdentity> {
    return request<BatchQrIdentity>(`/batches/${encodeURIComponent(batchCode)}/qr`);
  },
  batchQrSvgUrl(batchCode: string): string {
    return `${API_ROOT}/batches/${encodeURIComponent(batchCode)}/qr.svg`;
  },
  getPublicBatchTrace(traceId: string): Promise<PublicBatchTrace> {
    return request<PublicBatchTrace>(`/public-traces/${encodeURIComponent(traceId)}`);
  },
  listAllBatchEvents(batchCode: string): Promise<BatchEvent[]> {
    return allPages<BatchEvent>(`/batches/${encodeURIComponent(batchCode)}/events`);
  },
  createBatchEvent(batchCode: string, payload: BatchEventCreateInput): Promise<BatchEvent> {
    return request<BatchEvent>(`/batches/${encodeURIComponent(batchCode)}/events`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getGenealogy(batchCode: string): Promise<GenealogyGraph> {
    return request<GenealogyGraph>(`/batches/${encodeURIComponent(batchCode)}/genealogy`);
  },
  traceBatch(batchCode: string, direction: TraceDirection): Promise<GenealogyTrace> {
    const query = new URLSearchParams({ direction });
    return request<GenealogyTrace>(`/batches/${encodeURIComponent(batchCode)}/trace?${query.toString()}`);
  },
  getTrustFindings(options: TrustFindingFilters = {}): Promise<TrustFindingPage> {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
    });
    if (options.severity) query.set("severity", options.severity);
    if (options.check_type) query.set("check_type", options.check_type);
    if (options.batch_code?.trim()) query.set("batch_code", options.batch_code.trim());
    const endpoint = `/trust/findings?${query.toString()}`;
    return request<unknown>(endpoint).then(asTrustFindingPage);
  },
  getSupplyChainReport(options: { start_date?: string; end_date?: string } = {}): Promise<SupplyChainReport> {
    const query = new URLSearchParams();
    if (options.start_date) query.set("start_date", options.start_date);
    if (options.end_date) query.set("end_date", options.end_date);
    const suffix = query.size ? `?${query.toString()}` : "";
    return request<unknown>(`/reports/supply-chain${suffix}`).then(asSupplyChainReport);
  },
  simulateRecall(payload: RecallSimulationRequest): Promise<RecallSimulationResponse> {
    return request<RecallSimulationResponse>("/recalls/simulate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  listRecallIncidents(options: { limit?: number; offset?: number; status?: string } = {}): Promise<RecallIncidentPage> {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
    });
    if (options.status) query.set("status", options.status);
    return request<RecallIncidentPage>(`/recall-incidents?${query.toString()}`);
  },
  async listAllRecallIncidents(): Promise<RecallIncidentSummary[]> {
    const result: RecallIncidentSummary[] = [];
    let offset = 0;
    let total = 0;
    do {
      const query = new URLSearchParams({ limit: "100", offset: String(offset) });
      const page = await request<RecallIncidentPage>(`/recall-incidents?${query.toString()}`);
      result.push(...page.items);
      total = page.total;
      if (page.items.length === 0) break;
      offset += page.items.length;
    } while (offset < total && offset <= 10_000);
    return result;
  },
  createRecallIncident(payload: { root_batch_code: string; reason: string }): Promise<RecallIncidentDetail> {
    return request<RecallIncidentDetail>("/recall-incidents", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getRecallIncident(referenceId: string): Promise<RecallIncidentDetail> {
    return request<RecallIncidentDetail>(`/recall-incidents/${encodeURIComponent(referenceId)}`);
  },
  getRecallIncidentHistory(referenceId: string): Promise<RecallIncidentHistoryItem[]> {
    return request<RecallIncidentHistoryItem[]>(`/recall-incidents/${encodeURIComponent(referenceId)}/history`);
  },
  captureRecallSnapshot(referenceId: string, maxDepth = 25): Promise<RecallCandidateSnapshot> {
    return request<RecallCandidateSnapshot>(`/recall-incidents/${encodeURIComponent(referenceId)}/snapshots`, {
      method: "POST",
      body: JSON.stringify({ max_depth: maxDepth }),
    });
  },
  reviewRecallIncident(referenceId: string, payload: { decision: RecallReviewDecision; notes?: string }): Promise<RecallIncidentDetail> {
    return request<RecallIncidentDetail>(`/recall-incidents/${encodeURIComponent(referenceId)}/reviews`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  createRecallAction(referenceId: string, payload: { description: string; assignee?: string; due_at?: string; evidence_references?: string[] }): Promise<RecallIncidentDetail> {
    return request<RecallIncidentDetail>(`/recall-incidents/${encodeURIComponent(referenceId)}/actions`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateRecallAction(referenceId: string, actionId: number, payload: { status?: RecallActionStatus; completion_notes?: string; assignee?: string; due_at?: string; evidence_references?: string[] }): Promise<RecallIncidentDetail> {
    return request<RecallIncidentDetail>(`/recall-incidents/${encodeURIComponent(referenceId)}/actions/${actionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  createGenealogyRelationship(payload: GenealogyCreateInput): Promise<GenealogyRelationship> {
    return request<GenealogyRelationship>("/genealogy", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  createBatch(payload: BatchCreateInput): Promise<Batch> {
    return request<Batch>("/batches", { method: "POST", body: JSON.stringify(payload) });
  },
  updateBatch(batchCode: string, payload: BatchUpdateInput): Promise<Batch> {
    return request<Batch>(`/batches/${encodeURIComponent(batchCode)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
};
