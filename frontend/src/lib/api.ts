import type {
  Batch,
  BatchCreateInput,
  BatchEvent,
  BatchEventCreateInput,
  BatchUpdateInput,
  GenealogyCreateInput,
  GenealogyGraph,
  GenealogyRelationship,
  GenealogyTrace,
  Organization,
  Page,
  Product,
  TraceDirection,
} from "../types/api";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const API_ROOT = `${API_BASE_URL}/api/v1`;
const PAGE_SIZE = 100;

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError("Could not reach the FoodTrace API. Check that the backend is running.", 0);
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const failure = explainFailure(payload, `The request failed (${response.status}).`);
    throw new ApiError(failure.message, response.status, failure.fields);
  }
  return (await response.json()) as T;
}

async function allPages<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  let offset = 0;
  let total = 0;
  do {
    const page = await request<Page<T>>(`${path}?limit=${PAGE_SIZE}&offset=${offset}`);
    result.push(...page.items);
    total = page.total;
    offset += page.items.length;
    if (page.items.length === 0 || offset > 10_000) break;
  } while (offset < total);
  return result;
}

export const api = {
  listBatches(options: { limit: number; offset: number; q?: string }): Promise<Page<Batch>> {
    const query = new URLSearchParams({ limit: String(options.limit), offset: String(options.offset) });
    if (options.q) query.set("q", options.q);
    return request<Page<Batch>>(`/batches?${query.toString()}`);
  },
  listAllProducts(): Promise<Product[]> {
    return allPages<Product>("/products");
  },
  listAllOrganizations(): Promise<Organization[]> {
    return allPages<Organization>("/organizations");
  },
  getBatch(batchCode: string): Promise<Batch> {
    return request<Batch>(`/batches/${encodeURIComponent(batchCode)}`);
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
