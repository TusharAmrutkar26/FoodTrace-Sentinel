export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Product {
  id: number;
  name: string;
  created_at: string;
}

export interface Organization {
  id: number;
  name: string;
  participant_type: string | null;
  created_at: string;
}

export interface Batch {
  id: number;
  batch_code: string;
  product: { id: number; name: string };
  origin_organization: {
    id: number;
    name: string;
    participant_type: string | null;
  };
  origin_location: string;
  quantity: string;
  unit: Unit;
  created_at: string;
  updated_at: string;
}

export type Unit = "kg" | "g" | "mg" | "t" | "l" | "ml" | "each";

export type BatchEventType =
  | "harvested"
  | "produced"
  | "received"
  | "quality_checked"
  | "dispatched"
  | "delivered"
  | "stored"
  | "processed";

export interface BatchEvent {
  id: number;
  batch_id: number;
  event_type: BatchEventType;
  occurred_at: string;
  organization: { id: number; name: string; participant_type: string | null } | null;
  location: string | null;
  notes: string | null;
  created_at: string;
}

export interface BatchEventCreateInput {
  event_type: BatchEventType;
  occurred_at?: string;
  organization_id?: number;
  location?: string;
  notes?: string;
}

export type GenealogyRelationshipType = "split" | "merge" | "transformation";
export type TraceDirection = "upstream" | "downstream";

export interface GenealogyBatch {
  id: number;
  batch_code: string;
  product_name: string;
  quantity: string;
  unit: Unit;
}

export interface GenealogyRelationship {
  id: number;
  relationship_type: GenealogyRelationshipType;
  parent: GenealogyBatch;
  child: GenealogyBatch;
  source_quantity: string | null;
  source_unit: Unit | null;
  created_at: string;
}

export interface GenealogyGraph {
  batch: GenealogyBatch;
  parents: GenealogyRelationship[];
  children: GenealogyRelationship[];
}

export interface GenealogyTrace {
  root: GenealogyBatch;
  direction: TraceDirection;
  batches: (GenealogyBatch & { depth: number })[];
  relationships: GenealogyRelationship[];
}

export interface GenealogyCreateInput {
  parent_batch_id: number;
  child_batch_id: number;
  relationship_type: GenealogyRelationshipType;
  source_quantity?: string;
  source_unit?: Unit;
}

export interface BatchCreateInput {
  batch_code: string;
  product_id: number;
  origin_organization_id: number;
  origin_location: string;
  quantity: string;
  unit: Unit;
}

export type BatchUpdateInput = Partial<
  Pick<
    BatchCreateInput,
    "product_id" | "origin_organization_id" | "origin_location" | "quantity" | "unit"
  >
>;

export const UNITS: Unit[] = ["kg", "g", "mg", "t", "l", "ml", "each"];
export const BATCH_EVENT_TYPES: BatchEventType[] = [
  "harvested",
  "produced",
  "received",
  "quality_checked",
  "dispatched",
  "delivered",
  "stored",
  "processed",
];
