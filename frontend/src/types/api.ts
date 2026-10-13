export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type UserRole = "platform_admin" | "org_admin" | "operator" | "reviewer" | "viewer";

export interface AuthUser {
  email: string;
  role: UserRole;
  organization: { id: number; name: string } | null;
}

export interface AuthSession {
  user: AuthUser;
  csrf_token: string;
}

export interface UserInvitation {
  email: string;
  role: Exclude<UserRole, "platform_admin">;
  organization: { id: number; name: string };
  invitation_token: string;
  expires_at: string;
}

export interface Product {
  id: number;
  name: string;
  created_at: string;
}

export interface ProductCreateInput {
  name: string;
}

export interface Organization {
  id: number;
  name: string;
  participant_type: string | null;
  created_at: string;
}

export interface OrganizationCreateInput {
  name: string;
  participant_type?: string | null;
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

export interface BatchQrIdentity {
  trace_id: string;
  trace_url: string;
}

export interface PublicGenealogyBatch {
  batch_code: string;
  product_name: string;
  quantity: string;
  unit: Unit;
}

export interface PublicGenealogyRelationship {
  relationship_type: GenealogyRelationshipType;
  parent: PublicGenealogyBatch;
  child: PublicGenealogyBatch;
  source_quantity: string | null;
  source_unit: Unit | null;
}

export interface PublicBatchTrace {
  batch: {
    batch_code: string;
    product_name: string;
    quantity: string;
    unit: Unit;
    origin_organization: string;
    origin_location: string;
    created_at: string;
  };
  events: {
    event_type: BatchEventType;
    occurred_at: string;
    location: string | null;
  }[];
  parents: PublicGenealogyRelationship[];
  children: PublicGenealogyRelationship[];
  upstream: (PublicGenealogyBatch & { depth: number })[];
  downstream: (PublicGenealogyBatch & { depth: number })[];
  trace_trust_findings?: Omit<TrustFinding, "finding_id" | "batch_codes" | "evidence" | "recommended_action">[];
}

export type TrustSeverity = "low" | "medium" | "high";
export type TrustFindingStatus = "detected" | "incomplete";
export type TrustCheckType =
  | "batch_quantity_invalid"
  | "batch_unit_invalid"
  | "genealogy_source_quantity_invalid"
  | "genealogy_source_unit_invalid"
  | "genealogy_source_unit_mismatch"
  | "split_overallocated"
  | "genealogy_cycle"
  | "process_loss"
  | "process_loss_incomplete";

export interface TrustFinding {
  finding_id: string;
  check_type: TrustCheckType;
  severity: TrustSeverity;
  status: TrustFindingStatus;
  title: string;
  explanation: string;
  batch_codes: string[];
  evidence: { label: string; value: string }[];
  recommended_action: string;
}

export interface TrustFindingCounts {
  high: number;
  medium: number;
  low: number;
  incomplete: number;
}

export interface TrustFindingPage {
  items: TrustFinding[];
  total: number;
  limit: number;
  offset: number;
  counts: TrustFindingCounts;
}

export interface TrustFindingFilters {
  severity?: TrustSeverity;
  check_type?: TrustCheckType;
  batch_code?: string;
  limit?: number;
  offset?: number;
}

export interface SupplyChainReport {
  period: { start_date: string; end_date: string; timezone: "UTC" };
  generated_at: string;
  has_activity: boolean;
  batches_created: number;
  batches_with_event_activity: number;
  event_counts: { event_type: BatchEventType; count: number }[];
  genealogy_counts: { relationship_type: GenealogyRelationshipType; count: number }[];
  quantity_metrics: { available: false; value: null; unit: null; reason: string };
  trace_trust_findings: { available: false; value: null; unit: null; reason: string };
  definitions: string[];
  warnings: string[];
}

export interface RecallSimulationRequest {
  root_batch_code: string;
  max_depth?: number;
}

export interface RecallEventEvidence {
  event_type: string;
  occurred_at: string;
  organization_name: string | null;
  participant_type: string | null;
  location: string | null;
  notes: string | null;
  recorded_at: string;
}

export interface RecallBatchRecord {
  batch_code: string;
  product_name: string | null;
  origin_organization: string | null;
  participant_type: string | null;
  origin_location: string | null;
  quantity: string | null;
  unit: string | null;
  created_at: string;
  events: RecallEventEvidence[];
}

export interface RecallPathEntry {
  batch_code: string | null;
  depth: number;
  path: (string | null)[];
}

export interface RecallRelationshipEvidence {
  parent_batch_code: string | null;
  child_batch_code: string | null;
  relationship_type: string;
  source_quantity: string | null;
  source_unit: string | null;
  recorded_at: string;
  structurally_valid: boolean;
  validation_issues: string[];
}

export interface RecallCompleteness {
  max_depth: number;
  upstream_depth_limit_reached: boolean;
  downstream_depth_limit_reached: boolean;
  batch_limit_reached: boolean;
  relationship_limit_reached: boolean;
  event_history_truncated: boolean;
  trace_trust_findings_truncated: boolean;
  cycle_detected: boolean;
  missing_batch_references: boolean;
  invalid_relationships: boolean;
  traversal_complete: boolean;
}

export interface RecallSimulationResponse {
  simulated_at: string;
  root_batch: RecallBatchRecord;
  related_batches: RecallBatchRecord[];
  upstream: RecallPathEntry[];
  downstream: RecallPathEntry[];
  relationships: RecallRelationshipEvidence[];
  trace_trust_findings: TrustFinding[];
  completeness: RecallCompleteness;
  warnings: string[];
  human_review_warning: string;
  recommended_next_action: string;
}

export type RecallIncidentStatus =
  | "pending_review"
  | "requires_investigation"
  | "approved_for_next_step"
  | "rejected";
export type RecallReviewDecision = Exclude<RecallIncidentStatus, "pending_review">;
export type RecallActionStatus = "open" | "in_progress" | "completed" | "cancelled";

export interface RecallIncidentSummary {
  reference_id: string;
  root_batch_code: string;
  reason: string;
  status: RecallIncidentStatus;
  created_by: string | null;
  created_by_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecallIncidentHistoryItem {
  id: number;
  event_type: "incident_created" | "candidate_scope_captured" | "review_recorded" | "follow_up_action_added" | "follow_up_action_updated";
  actor_name: string | null;
  actor_identity_verified: boolean;
  details: Record<string, unknown>;
  recorded_at: string;
}

export interface RecallIncidentReview {
  id: number;
  decision: RecallReviewDecision;
  notes: string | null;
  reviewer_name: string | null;
  reviewer_identity_verified: boolean;
  created_at: string;
}

export interface RecallIncidentAction {
  id: number;
  description: string;
  status: RecallActionStatus;
  assignee: string | null;
  due_at: string | null;
  completion_notes: string | null;
  evidence_references: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RecallCandidateSnapshot {
  id: number;
  captured_at: string;
  simulated_at: string;
  max_depth: number;
  simulation: RecallSimulationResponse;
}

export interface RecallIncidentDetail extends RecallIncidentSummary {
  snapshots: RecallCandidateSnapshot[];
  reviews: RecallIncidentReview[];
  actions: RecallIncidentAction[];
  history: RecallIncidentHistoryItem[];
}

export interface RecallIncidentPage {
  items: RecallIncidentSummary[];
  total: number;
  limit: number;
  offset: number;
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
