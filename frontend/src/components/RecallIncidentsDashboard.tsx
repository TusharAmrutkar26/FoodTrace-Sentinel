import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type {
  Batch,
  RecallActionStatus,
  RecallIncidentAction,
  RecallIncidentDetail,
  RecallIncidentHistoryItem,
  RecallIncidentSummary,
  RecallReviewDecision,
  RecallSimulationResponse,
} from "../types/api";
import { translateMessage, translateOrFallback, useI18n } from "../i18n";

const DECISIONS: { value: RecallReviewDecision; label: string }[] = [
  { value: "requires_investigation", label: "Requires investigation" },
  { value: "approved_for_next_step", label: "Approved for next operational step" },
  { value: "rejected", label: "Rejected" },
];
const ACTION_STATUSES: RecallActionStatus[] = ["open", "in_progress", "completed", "cancelled"];

function readable(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayStatus(value: string, locale: "en" | "hi" | "mr"): string {
  const labels: Record<string, string> = {
    pending_review: "Pending review",
    requires_investigation: "Requires investigation",
    approved_for_next_step: "Approved for next operational step",
    rejected: "Rejected",
    open: "Open",
    in_progress: "In progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return translateOrFallback(locale, labels[value] ?? readable(value));
}

function errorText(locale: "en" | "hi" | "mr", cause: unknown, fallback: string): string {
  return cause instanceof Error ? translateMessage(locale, cause.message) : fallback;
}

function timeLabel(value: string): string {
  return `${new Date(value).toISOString()} (UTC)`;
}

function ProposedScope({ result }: { result: RecallSimulationResponse }) {
  const { t, locale } = useI18n();
  return <section className="recall-panel incident-scope" aria-labelledby="incident-scope-title">
    <header><div><h2 id="incident-scope-title">{t("Candidate scope for human review")}</h2><p>{t("Simulation generated {time}", { time: timeLabel(result.simulated_at) })}</p></div><span className={`recall-completeness ${result.completeness.traversal_complete ? "complete" : "partial"}`}>{result.completeness.traversal_complete ? t("Within limits") : t("Partial scope")}</span></header>
    <p className="recall-human-warning">{translateOrFallback(locale, result.human_review_warning)}</p>
    <div className="incident-scope-grid">
      <div><strong>{t("Upstream sources")}</strong><p>{result.upstream.length ? result.upstream.map((item) => item.batch_code).join(", ") : t("No recorded upstream links")}</p></div>
      <div><strong>{t("Downstream candidate batches")}</strong><p>{result.downstream.length ? result.downstream.map((item) => item.batch_code).join(", ") : t("No recorded downstream links")}</p></div>
    </div>
    <h3>{t("Recorded relationship evidence")} ({result.relationships.length})</h3>
    {result.relationships.length ? <ul className="incident-evidence-list">{result.relationships.map((edge, index) => <li key={`${edge.parent_batch_code}-${edge.child_batch_code}-${index}`}>
      <strong>{edge.parent_batch_code ?? t("Unknown parent")} → {edge.child_batch_code ?? t("Unknown child")}</strong>
      <span>{displayStatus(edge.relationship_type, locale)}{edge.source_quantity ? ` · ${edge.source_quantity} ${edge.source_unit ?? t("unit not recorded")}` : ` · ${t("input quantity not recorded")}`}</span>
      {!edge.structurally_valid ? <small>{edge.validation_issues.join(" ")}</small> : null}
    </li>)}</ul> : <p className="recall-empty-inline">{t("No relationship rows in this simulation.")}</p>}
    {!result.completeness.traversal_complete ? <p className="incident-warning" role="alert">{t("The traversal is incomplete or recorded graph issues were found. Review the warnings before relying on this scope.")}</p> : null}
    {result.warnings.map((warning) => <p className="incident-warning" key={warning}>{warning}</p>)}
  </section>;
}

function History({ items }: { items: RecallIncidentHistoryItem[] }) {
  const { t, locale } = useI18n();
  return <section className="recall-panel" aria-labelledby="incident-history-title">
    <header><div><h2 id="incident-history-title">{t("Incident history")}</h2><p>{t("Recorded changes and decisions in this application.")}</p></div></header>
    {items.length ? <ol className="incident-history-list">{items.map((item) => <li key={item.id}>
      <span className="timeline-marker" />
      <div><strong>{displayStatus(item.event_type, locale)}</strong><time>{timeLabel(item.recorded_at)}</time>
        {item.actor_name ? <small>{item.actor_identity_verified
          ? t("Authenticated account: {name} (real-world identity not verified)", { name: item.actor_name })
          : t("Entered name: {name} (not verified)", { name: item.actor_name })}</small> : null}
        {Object.entries(item.details).map(([key, value]) => <small key={key}>{translateOrFallback(locale, readable(key))}: {String(value)}</small>)}
      </div>
    </li>)}</ol> : <p className="recall-empty-inline">{t("No history has been recorded.")}</p>}
  </section>;
}

function ActionCard({
  action,
  onSave,
  saving,
}: {
  action: RecallIncidentAction;
  onSave: (action: RecallIncidentAction, status: RecallActionStatus, notes: string) => void;
  saving: boolean;
}) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState(action.status);
  const [notes, setNotes] = useState(action.completion_notes ?? "");
  useEffect(() => { setStatus(action.status); setNotes(action.completion_notes ?? ""); }, [action.status, action.completion_notes]);
  return <form className="incident-action-card" onSubmit={(event) => { event.preventDefault(); onSave(action, status, notes); }}>
    <div><strong>{action.description}</strong><span className={`incident-status ${action.status}`}>{displayStatus(action.status, locale)}</span></div>
    <p>{action.assignee ? t("Assignee: {name} (unverified)", { name: action.assignee }) : t("No assignee")}{action.due_at ? ` · ${t("Due {time}", { time: timeLabel(action.due_at) })}` : ""}</p>
    {action.evidence_references.length ? <p>{t("Evidence references: {refs}", { refs: action.evidence_references.join(", ") })}</p> : null}
    <label className="field">{t("Status")}<select value={status} onChange={(event) => setStatus(event.target.value as RecallActionStatus)}>{ACTION_STATUSES.map((value) => <option value={value} key={value}>{displayStatus(value, locale)}</option>)}</select></label>
    <label className="field">{t("Completion notes")}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} rows={2} /></label>
    {action.completed_at ? <small>{t("Marked complete {time}", { time: timeLabel(action.completed_at) })}</small> : null}
    <button className="button button-secondary" type="submit" disabled={saving}>{saving ? t("Saving…") : t("Update action")}</button>
  </form>;
}

export function RecallIncidentsDashboard() {
  const { t, locale } = useI18n();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [incidents, setIncidents] = useState<RecallIncidentSummary[]>([]);
  const [selected, setSelected] = useState<RecallIncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [busyActionId, setBusyActionId] = useState<number | null>(null);
  const [rootBatchCode, setRootBatchCode] = useState("");
  const [reason, setReason] = useState("");
  const [maxDepth, setMaxDepth] = useState(25);
  const [proposal, setProposal] = useState<RecallSimulationResponse | null>(null);
  const [decision, setDecision] = useState<RecallReviewDecision>("requires_investigation");
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [evidenceReferences, setEvidenceReferences] = useState("");

  async function loadData(preferredReference?: string) {
    setLoading(true);
    setError("");
    try {
      const [batchRecords, incidentRecords] = await Promise.all([api.listAllBatches(), api.listAllRecallIncidents()]);
      setBatches(batchRecords);
      setIncidents(incidentRecords);
      setRootBatchCode((current) => current || batchRecords[0]?.batch_code || "");
      const nextReference = preferredReference ?? selected?.reference_id;
      if (nextReference && incidentRecords.some((item) => item.reference_id === nextReference)) {
        await loadDetail(nextReference);
      } else if (incidentRecords.length && !selected) {
        await loadDetail(incidentRecords[0].reference_id);
      } else if (!incidentRecords.length) {
        setSelected(null);
      }
    } catch (cause) {
      setError(errorText(locale, cause, "Recall incidents could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(referenceId: string) {
    setDetailLoading(true);
    setDetailError("");
    try {
      const detail = await api.getRecallIncident(referenceId);
      setSelected(detail);
      setProposal(null);
    } catch (cause) {
      setDetailError(errorText(locale, cause, "Incident details could not be loaded."));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  async function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rootBatchCode || !reason.trim()) return;
    setCreating(true);
    setNotice("");
    try {
      const detail = await api.createRecallIncident({ root_batch_code: rootBatchCode, reason: reason.trim() });
      setSelected(detail);
      setProposal(null);
      setReason("");
      setNotice(t("Incident {reference} created and set to pending review.", { reference: detail.reference_id }));
      await loadData(detail.reference_id);
    } catch (cause) {
      setError(errorText(locale, cause, "The incident could not be created."));
    } finally {
      setCreating(false);
    }
  }

  async function runSimulation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || maxDepth < 1 || maxDepth > 50) return;
    setRunning(true);
    setDetailError("");
    setNotice("");
    try {
      setProposal(await api.simulateRecall({ root_batch_code: selected.root_batch_code, max_depth: maxDepth }));
    } catch (cause) {
      setDetailError(errorText(locale, cause, "The existing recall simulation failed."));
    } finally {
      setRunning(false);
    }
  }

  async function captureSnapshot() {
    if (!selected) return;
    setSavingSnapshot(true);
    setDetailError("");
    try {
      const snapshot = await api.captureRecallSnapshot(selected.reference_id, maxDepth);
      const detail = await api.getRecallIncident(selected.reference_id);
      setSelected(detail);
      setProposal(snapshot.simulation);
      setNotice(t("Candidate scope snapshot {id} saved. It is evidence for review, not an approved recall.", { id: snapshot.id }));
    } catch (cause) {
      setDetailError(errorText(locale, cause, "The candidate scope snapshot could not be saved."));
    } finally {
      setSavingSnapshot(false);
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSavingReview(true);
    setDetailError("");
    try {
      const detail = await api.reviewRecallIncident(selected.reference_id, {
        decision,
        ...(reviewNotes.trim() ? { notes: reviewNotes.trim() } : {}),
      });
      setSelected(detail);
      setReviewNotes("");
      setNotice(t("Review recorded: {decision}. Attributed to the signed-in account; real-world identity is not independently verified.", { decision: t(({ requires_investigation: "Requires investigation", approved_for_next_step: "Approved for next operational step", rejected: "Rejected" } as const)[decision]) }));
      await refreshList(detail.reference_id);
    } catch (cause) {
      setDetailError(errorText(locale, cause, "The review decision could not be saved."));
    } finally {
      setSavingReview(false);
    }
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !actionDescription.trim()) return;
    setSavingAction(true);
    setDetailError("");
    try {
      const references = evidenceReferences.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      const detail = await api.createRecallAction(selected.reference_id, {
        description: actionDescription.trim(),
        ...(assignee.trim() ? { assignee: assignee.trim() } : {}),
        ...(dueAt ? { due_at: new Date(dueAt).toISOString() } : {}),
        evidence_references: references,
      });
      setSelected(detail);
      setActionDescription("");
      setAssignee("");
      setDueAt("");
      setEvidenceReferences("");
      setNotice(t("Follow-up action added."));
      await refreshList(detail.reference_id);
    } catch (cause) {
      setDetailError(errorText(locale, cause, "The follow-up action could not be added."));
    } finally {
      setSavingAction(false);
    }
  }

  async function updateAction(action: RecallIncidentAction, status: RecallActionStatus, notes: string) {
    if (!selected) return;
    setBusyActionId(action.id);
    setDetailError("");
    try {
      const detail = await api.updateRecallAction(selected.reference_id, action.id, { status, ...(notes.trim() ? { completion_notes: notes.trim() } : { completion_notes: "" }) });
      setSelected(detail);
      setNotice(t("Follow-up action updated."));
      await refreshList(detail.reference_id);
    } catch (cause) {
      setDetailError(errorText(locale, cause, "The follow-up action could not be updated."));
    } finally {
      setBusyActionId(null);
    }
  }

  async function refreshList(referenceId: string) {
    try {
      const incidentRecords = await api.listAllRecallIncidents();
      setIncidents(incidentRecords);
      const refreshed = await api.getRecallIncident(referenceId);
      setSelected(refreshed);
    } catch (cause) {
      setDetailError(errorText(locale, cause, "The updated incident list could not be refreshed."));
    }
  }

  const latestSnapshot = selected?.snapshots.at(-1);
  const proposed = proposal ?? latestSnapshot?.simulation ?? null;

  return <section className="recall-page incident-page" aria-labelledby="recall-incidents-title">
    <div className="page-heading">
      <div><p className="eyebrow">{t("DECISION SUPPORT · HUMAN REVIEW REQUIRED")}</p><h1 id="recall-incidents-title">{t("Recall incidents")}</h1><p className="page-subtitle">{t("Document a concern, preserve a candidate scope, and track review and follow-up work.")}</p></div>
    </div>
    <p className="incident-safety-note" role="note">{t("Candidate scope is not an approved recall. A review decision does not prove contamination, fraud, or physical product identity. Creator and reviewer actions are attributed to the signed-in account, but the account holder's real-world identity and email ownership are not independently verified. Legacy entered names and assignee labels remain unverified.")}</p>
    {error ? <div className="page-error" role="alert"><span>{error}</span><button className="button button-secondary" type="button" onClick={() => void loadData()}>{t("Retry")}</button></div> : null}
    {notice ? <p className="activity-success" role="status">{notice}</p> : null}

    <div className="incident-layout">
      <aside className="incident-list-panel" aria-label={t("Recall incidents")}>
        <header><h2>{t("Incidents")}</h2><button className="button button-secondary" type="button" onClick={() => void loadData()} disabled={loading}>{t("Refresh")}</button></header>
        <form className="incident-create-form" onSubmit={createIncident}>
          <h3>{t("Create incident")}</h3>
          {loading ? <p className="activity-state"><span className="spinner" /> {t("Loading batches…")}</p> : batches.length ? <label className="field">{t("Root batch")}<select aria-label={t("Root batch")} value={rootBatchCode} onChange={(event) => setRootBatchCode(event.target.value)} required>{batches.map((batch) => <option key={batch.id} value={batch.batch_code}>{batch.batch_code} · {batch.product.name}</option>)}</select></label> : <p className="recall-empty-inline">{t("Create a batch before opening an incident.")}</p>}
          <label className="field">{t("Reason")}<textarea aria-label={t("Incident reason")} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={5000} rows={3} required /></label>
          <button className="button button-primary" type="submit" disabled={creating || loading || !batches.length || !reason.trim()}>{creating ? t("Creating…") : t("Create incident")}</button>
        </form>
        {loading ? <p className="activity-state"><span className="spinner" /> {t("Loading incidents…")}</p> : incidents.length ? <ul className="incident-list">{incidents.map((incident) => <li key={incident.reference_id}><button type="button" className={selected?.reference_id === incident.reference_id ? "selected" : ""} onClick={() => void loadDetail(incident.reference_id)}>
          <span><strong>{incident.reference_id}</strong><small>{incident.root_batch_code}</small></span><span className={`incident-status ${incident.status}`}>{displayStatus(incident.status, locale)}</span><small>{incident.reason}</small>
        </button></li>)}</ul> : <p className="recall-empty-inline">{t("No incidents have been created.")}</p>}
      </aside>

      <div className="incident-detail-panel">
        {detailLoading ? <div className="recall-state" role="status"><span className="spinner" /> {t("Loading incident…")}</div> : detailError ? <div className="recall-state error-state" role="alert">{detailError}<button className="button button-secondary" type="button" onClick={() => selected && void loadDetail(selected.reference_id)}>{t("Retry")}</button></div> : !selected ? <div className="recall-state recall-empty"><strong>{t("Select or create an incident")}</strong><span>{t("Incident details, reviews, snapshots, and actions will appear here.")}</span></div> : <>
          <header className="incident-detail-heading"><div><p className="eyebrow">{t("INCIDENT REFERENCE")}</p><h2>{selected.reference_id}</h2><p>{t("Root batch {code} · created {time}", { code: selected.root_batch_code, time: timeLabel(selected.created_at) })}</p></div><span className={`incident-status ${selected.status}`}>{displayStatus(selected.status, locale)}</span></header>
          <div className="recall-panel"><h3>{t("Reason")}</h3><p>{selected.reason}</p><p className="incident-muted">{selected.created_by ? (selected.created_by_verified
            ? t("Created by authenticated account: {name} (real-world identity not verified)", { name: selected.created_by })
            : t("Created by: {name}", { name: `${selected.created_by} (not verified)` })) : t("Not recorded")}</p></div>

          <section className="recall-panel" aria-labelledby="incident-simulation-title">
            <header><div><h2 id="incident-simulation-title">{t("Candidate scope")}</h2><p>{t("Run the existing read-only simulator, review its evidence, then explicitly capture a snapshot.")}</p></div></header>
            <form className="incident-inline-form" onSubmit={runSimulation}>
              <label className="field">{t("Maximum depth")}<input type="number" min="1" max="50" value={maxDepth} onChange={(event) => setMaxDepth(Number(event.target.value))} required /></label>
              <button className="button button-secondary" type="submit" disabled={running || maxDepth < 1 || maxDepth > 50}>{running ? t("Simulating…") : t("Run simulation")}</button>
            </form>
            {running ? <p className="activity-state" role="status"><span className="spinner" /> {t("Traversing recorded genealogy…")}</p> : null}
            {proposed ? <>
              {latestSnapshot && !proposal ? <p className="incident-muted">{t("Showing the latest saved candidate snapshot from {time}", { time: timeLabel(latestSnapshot.captured_at) })}</p> : null}
              <ProposedScope result={proposed} />
              <button className="button button-primary" type="button" onClick={() => void captureSnapshot()} disabled={savingSnapshot}>{savingSnapshot ? t("Saving snapshot…") : t("Save candidate snapshot")}</button>
            </> : !running ? <p className="recall-empty-inline">{t("Run a simulation to review candidate batches and relationship evidence. No scope is saved until you choose to capture it.")}</p> : null}
          </section>
          {selected.snapshots.length ? <section className="recall-panel"><header><div><h2>{t("Saved candidate snapshots")}</h2><p>{selected.snapshots.length} {t(selected.snapshots.length === 1 ? "explicit capture" : "captures")}; {t("Each snapshot preserves its own simulator result.")}</p></div></header><ol className="incident-snapshot-list">{selected.snapshots.map((snapshot) => <li key={snapshot.id}><strong>{t("Snapshot {id}", { id: snapshot.id })}</strong><span>{t("Captured {time}", { time: timeLabel(snapshot.captured_at) })} ? {t("maximum depth {depth}", { depth: snapshot.max_depth })} ? {snapshot.simulation.related_batches.length} {t("related batches")}</span></li>)}</ol></section> : null}

          <section className="recall-panel" aria-labelledby="incident-review-title"><header><div><h2 id="incident-review-title">{t("Human review")}</h2><p>{t("Decision status never asserts that the food is unsafe or that a recall has been declared.")}</p></div></header>
            <form className="incident-review-form" onSubmit={submitReview}>
              <label className="field">{t("Decision")}<select value={decision} onChange={(event) => setDecision(event.target.value as RecallReviewDecision)}>{DECISIONS.map((item) => <option value={item.value} key={item.value}>{t(item.label as "Requires investigation")}</option>)}</select></label>
              <label className="field">{t("Review notes")}<textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} maxLength={5000} rows={3} /></label>
              <button className="button button-primary" type="submit" disabled={savingReview}>{savingReview ? t("Recording…") : t("Record review decision")}</button>
            </form>
            {selected.reviews.length ? <ol className="incident-review-list">{selected.reviews.map((review) => <li key={review.id}><strong>{t(({ requires_investigation: "Requires investigation", approved_for_next_step: "Approved for next operational step", rejected: "Rejected" } as const)[review.decision])}</strong><time>{timeLabel(review.created_at)}</time><p>{review.notes || t("No review notes recorded.")}</p><small>{review.reviewer_name ? (review.reviewer_identity_verified
              ? t("Reviewed by authenticated account: {name} (real-world identity not verified)", { name: review.reviewer_name })
              : t("Entered reviewer name: {name} (not verified)", { name: review.reviewer_name })) : t("Not recorded")}</small></li>)}</ol> : <p className="recall-empty-inline">{t("No human review decisions have been recorded.")}</p>}
          </section>

          <section className="recall-panel" aria-labelledby="incident-actions-title"><header><div><h2 id="incident-actions-title">{t("Follow-up actions")}</h2><p>{t("Track work and references. No supplier or customer notifications are sent.")}</p></div></header>
            <form className="incident-action-create" onSubmit={submitAction}>
              <label className="field">{t("Action description")}<textarea value={actionDescription} onChange={(event) => setActionDescription(event.target.value)} maxLength={5000} rows={2} required /></label>
              <div className="incident-form-grid"><label className="field">{t("Assignee")} <small>{t("Optional, unverified")}</small><input value={assignee} onChange={(event) => setAssignee(event.target.value)} maxLength={120} /></label><label className="field">{t("Due date")}<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label></div>
              <label className="field">{t("Evidence references")} <small>{t("One reference per line; no files are uploaded.")}</small><textarea value={evidenceReferences} onChange={(event) => setEvidenceReferences(event.target.value)} rows={2} /></label>
              <button className="button button-secondary" type="submit" disabled={savingAction || !actionDescription.trim()}>{savingAction ? t("Adding…") : t("Add follow-up action")}</button>
            </form>
            {selected.actions.length ? <div className="incident-action-list">{selected.actions.map((action) => <ActionCard action={action} key={action.id} saving={busyActionId === action.id} onSave={(item, nextStatus, notes) => void updateAction(item, nextStatus, notes)} />)}</div> : <p className="recall-empty-inline">{t("No follow-up actions have been added.")}</p>}
          </section>
          <History items={selected.history} />
        </>}
      </div>
    </div>
  </section>;
}
