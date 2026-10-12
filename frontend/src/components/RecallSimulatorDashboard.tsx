import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { recallSimulationCsv } from "../lib/recallSimulationCsv";
import type { Batch, RecallBatchRecord, RecallPathEntry, RecallSimulationResponse } from "../types/api";
import { translateMessage, translateOrFallback, useI18n } from "../i18n";

function readable(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTimestamp(value: string): string {
  return `${new Date(value).toISOString()} (UTC)`;
}

function saveCsv(result: RecallSimulationResponse) {
  const blob = new Blob([recallSimulationCsv(result)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `foodtrace-recall-candidate-${result.root_batch.batch_code}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function PathGroup({
  label,
  entries,
  records,
}: {
  label: string;
  entries: RecallPathEntry[];
  records: Map<string, RecallBatchRecord>;
}) {
  const { t } = useI18n();
  return (
    <section className="recall-panel" aria-label={label}>
      <header><h2>{label}</h2><span>{entries.length} {t("candidate {item}", { item: entries.length === 1 ? t("batch") : t("batches") })}</span></header>
      {entries.length ? <ol className="recall-path-list">
        {entries.map((entry, index) => {
          const record = entry.batch_code ? records.get(entry.batch_code) : undefined;
          return <li key={`${entry.batch_code ?? "missing"}-${index}`}>
            <div className="recall-path-heading">
              <strong>{entry.batch_code ?? t("Unavailable batch reference")}</strong>
              <span>{t("Depth {depth}", { depth: entry.depth })}</span>
            </div>
            <p className="recall-path-chain">{entry.path.map((code) => code ?? t("Unavailable reference")).join(" → ")}</p>
            {record ? <p className="recall-path-meta">{record.product_name ?? t("Product not recorded")} · {record.origin_organization ?? t("Organization not recorded")}</p> : <p className="recall-path-meta">{t("Batch details are unavailable for this recorded reference.")}</p>}
          </li>;
        })}
      </ol> : <p className="recall-empty-inline">{t("No recorded relationships in this direction.")}</p>}
    </section>
  );
}

function BatchEvidence({ batch, root = false }: { batch: RecallBatchRecord; root?: boolean }) {
  const { t, locale } = useI18n();
  return <details className="recall-evidence-item">
    <summary>{root ? t("Selected root") : t("Candidate batch")}: {batch.batch_code} <span>{batch.product_name ?? t("Product unavailable")}</span></summary>
    <div className="recall-evidence-body">
      <dl className="recall-facts">
        <div><dt>{t("Product")}</dt><dd>{batch.product_name ?? t("Not recorded")}</dd></div>
        <div><dt>{t("Origin organization")}</dt><dd>{batch.origin_organization ?? t("Not recorded")}{batch.participant_type ? ` · ${batch.participant_type}` : ""}</dd></div>
        <div><dt>{t("Origin location")}</dt><dd>{batch.origin_location ?? t("Not recorded")}</dd></div>
        <div><dt>{t("Recorded batch quantity")}</dt><dd>{batch.quantity ?? t("Unavailable")}{batch.unit ? ` ${batch.unit}` : ""}<small>{t("Individual stored value; not an affected-quantity total.")}</small></dd></div>
        <div><dt>{t("Batch created")}</dt><dd>{formatTimestamp(batch.created_at)}</dd></div>
      </dl>
      <section className="recall-event-evidence" aria-label={`${batch.batch_code} recorded events`}>
        <h4>{t("Recorded events")} <span>{batch.events.length}</span></h4>
        {batch.events.length ? <ol>
          {batch.events.map((event, index) => <li key={`${event.event_type}-${event.occurred_at}-${index}`}>
            <strong>{translateOrFallback(locale, readable(event.event_type))}</strong>
            <time>{formatTimestamp(event.occurred_at)}</time>
            <span>{event.organization_name ?? t("Organization not recorded")}{event.location ? ` · ${event.location}` : ""}</span>
            {event.notes ? <p>{t("Recorded note: {note}", { note: event.notes })}</p> : null}
          </li>)}
        </ol> : <p className="recall-empty-inline">{t("No event rows are recorded for this batch.")}</p>}
      </section>
    </div>
  </details>;
}

export function RecallSimulatorDashboard() {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedRootCode, setSelectedRootCode] = useState("");
  const [maxDepth, setMaxDepth] = useState(25);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [running, setRunning] = useState(false);
  const [simulationError, setSimulationError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [result, setResult] = useState<RecallSimulationResponse | null>(null);

  async function searchBatches(query: string) {
    setSearching(true);
    setSearchError("");
    try {
      const page = await api.listBatches({ limit: 25, offset: 0, q: query.trim() || undefined });
      setBatches(page.items);
      setSelectedRootCode((current) => page.items.some((item) => item.batch_code === current) ? current : page.items[0]?.batch_code ?? "");
    } catch (cause: unknown) {
      setSearchError(cause instanceof Error ? translateMessage(locale, cause.message) : t("Batches could not be loaded from the API."));
      setBatches([]);
      setSelectedRootCode("");
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => { void searchBatches(""); }, []);

  async function simulate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSelectionError("");
    if (!selectedRootCode) {
      setSelectionError(t("Search for and select a batch before running a simulation."));
      return;
    }
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 50) {
      setSelectionError(t("Maximum depth must be a whole number from 1 to 50."));
      return;
    }
    setRunning(true);
    setSimulationError("");
    setResult(null);
    try {
      const response = await api.simulateRecall({ root_batch_code: selectedRootCode, max_depth: maxDepth });
      setResult(response);
    } catch (cause: unknown) {
      setSimulationError(cause instanceof Error ? translateMessage(locale, cause.message) : t("The recall simulation could not be completed."));
    } finally {
      setRunning(false);
    }
  }

  const records = new Map<string, RecallBatchRecord>();
  if (result) {
    records.set(result.root_batch.batch_code, result.root_batch);
    for (const batch of result.related_batches) records.set(batch.batch_code, batch);
  }

  return <section className="recall-page" aria-labelledby="recall-page-title">
    <header className="page-heading">
      <div>
        <p className="eyebrow">{t("READ-ONLY CANDIDATE SCOPE")}</p>
        <h1 id="recall-page-title">{t("Recall simulator")}</h1>
        <p className="page-subtitle">{t("Trace recorded upstream sources and downstream batches for human review.")}</p>
      </div>
      <button className="button button-secondary" type="button" disabled={!result} onClick={() => { if (result) saveCsv(result); }}>{t("Export CSV")}</button>
    </header>

    <div className="recall-safety-banner" role="note"><strong>{t("Simulation only")}</strong><span>{t("This creates a candidate review list. It does not start an official recall, change batch status, or establish contamination.")}</span></div>

    <section className="recall-panel recall-selector" aria-labelledby="recall-select-title">
      <header><div><h2 id="recall-select-title">{t("Select a recorded batch")}</h2><p>{t("Search the live batch API, then choose a root batch.")}</p></div></header>
      <form className="recall-search-form" onSubmit={(event) => { event.preventDefault(); void searchBatches(search); }}>
        <label className="recall-search-label">{t("Search batches")}
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Batch code, product, or origin")} />
        </label>
        <button className="button button-secondary" type="submit" disabled={searching}>{searching ? t("Searching…") : t("Search")}</button>
      </form>
      {searching && !batches.length ? <div className="recall-state" role="status"><span className="spinner" /> {t("Loading batches from the API…")}</div> : null}
      {!searching && searchError ? <div className="recall-state error-state" role="alert"><span>{searchError}</span><button className="button button-secondary" type="button" onClick={() => void searchBatches(search)}>{t("Retry")}</button></div> : null}
      {!searching && !searchError && batches.length === 0 ? <div className="recall-state recall-empty" role="status"><strong>{search.trim() ? t("No matching batches") : t("No batches are recorded yet")}</strong><span>{search.trim() ? t("Try a different search.") : t("Create a batch in Batch management before running a simulation.")}</span></div> : null}
      {!searchError && batches.length ? <form className="recall-run-form" onSubmit={simulate} noValidate>
        <label className="recall-root-select">{t("Root batch")}
          <select value={selectedRootCode} onChange={(event) => { setSelectedRootCode(event.target.value); setResult(null); }} disabled={searching}>
            {batches.map((batch) => <option key={batch.id} value={batch.batch_code}>{batch.batch_code} · {batch.product.name}</option>)}
          </select>
        </label>
        <label className="recall-depth-select">{t("Maximum depth")}
          <input type="number" min="1" max="50" value={maxDepth} onChange={(event) => setMaxDepth(Number(event.target.value))} />
          <small>{t("Traversal is limited to 1–50 relationship levels.")}</small>
        </label>
        <button className="button button-primary" type="submit" disabled={running || searching || !selectedRootCode}>{running ? t("Simulating…") : t("Run simulation")}</button>
      </form> : null}
      {selectionError ? <p className="recall-inline-error" role="alert">{selectionError}</p> : null}
    </section>

    {running ? <div className="recall-state" role="status"><span className="spinner" /> {t("Traversing recorded genealogy and gathering evidence…")}</div> : null}
    {!running && simulationError ? <div className="recall-state error-state" role="alert"><span>{simulationError}</span><button className="button button-secondary" type="button" onClick={(event) => { const form = event.currentTarget.closest(".recall-page")?.querySelector<HTMLFormElement>(".recall-run-form"); form?.requestSubmit(); }}>{t("Try again")}</button></div> : null}

    {!running && result ? <>
      <div className="recall-result-heading">
        <div><p className="eyebrow">{t("CANDIDATE SCOPE · HUMAN REVIEW REQUIRED")}</p><h2>{t("Simulation for {code}", { code: result.root_batch.batch_code })}</h2><p>{t("Generated at {time}", { time: formatTimestamp(result.simulated_at) })}</p></div>
        <span className={`recall-completeness ${result.completeness.traversal_complete ? "complete" : "partial"}`}>{result.completeness.traversal_complete ? t("Traversal within limits") : t("Partial traversal")}</span>
      </div>
      <div className="recall-summary-grid" aria-label={t("Candidate scope summary")}>
        <article><span>{t("Root batch")}</span><strong>{result.root_batch.batch_code}</strong></article>
        <article><span>{t("Unique related batches")}</span><strong>{result.related_batches.length}</strong></article>
        <article><span>{t("Recorded relationships")}</span><strong>{result.relationships.length}</strong></article>
        <article><span>{t("TraceTrust findings")}</span><strong>{result.trace_trust_findings.length}</strong></article>
      </div>

      <div className="recall-path-grid">
        <PathGroup label={t("Upstream sources")} entries={result.upstream} records={records} />
        <PathGroup label={t("Downstream candidate batches")} entries={result.downstream} records={records} />
      </div>

      <section className="recall-panel" aria-labelledby="recall-relations-title">
        <header><div><h2 id="recall-relations-title">{t("Recorded relationship evidence")}</h2><p>{t("Each link is shown as stored. Input quantities are not added together.")}</p></div></header>
        {result.relationships.length ? <ul className="recall-relationship-list">
          {result.relationships.map((relationship, index) => <li key={`${relationship.parent_batch_code}-${relationship.child_batch_code}-${relationship.relationship_type}-${index}`}>
            <div><span className={`recall-edge-status ${relationship.structurally_valid ? "valid" : "invalid"}`}>{relationship.structurally_valid ? t("Recorded") : t("Needs review")}</span><strong>{relationship.parent_batch_code ?? t("Unknown parent")} → {relationship.child_batch_code ?? t("Unknown child")}</strong></div>
            <p>{translateOrFallback(locale, readable(relationship.relationship_type))} · {t("saved")} {formatTimestamp(relationship.recorded_at)}</p>
            <p>{t("Recorded parent input: {quantity}", { quantity: relationship.source_quantity ?? t("not recorded") })}{relationship.source_unit ? ` ${relationship.source_unit}` : ""}</p>
            {relationship.validation_issues.length ? <ul>{relationship.validation_issues.map((issue) => <li key={issue}>{translateOrFallback(locale, issue)}</li>)}</ul> : null}
          </li>)}
        </ul> : <p className="recall-empty-inline">{t("No relationship rows were returned for this scope.")}</p>}
      </section>

      <section className="recall-panel" aria-labelledby="recall-batch-evidence-title">
        <header><div><h2 id="recall-batch-evidence-title">{t("Batch and event evidence")}</h2><p>{t("Expand a record to inspect its stored details and event history.")}</p></div></header>
        <div className="recall-evidence-list"><BatchEvidence batch={result.root_batch} root />{result.related_batches.map((batch) => <BatchEvidence batch={batch} key={batch.batch_code} />)}</div>
      </section>

      <section className="recall-panel" aria-labelledby="recall-trust-title">
        <header><div><h2 id="recall-trust-title">{t("Associated TraceTrust findings")}</h2><p>{t("Current recorded-data checks linked to candidate batch codes; these are not safety determinations.")}</p></div></header>
        {result.trace_trust_findings.length ? <ul className="recall-trust-list">
          {result.trace_trust_findings.map((finding) => <li key={finding.finding_id}>
            <div><strong>{translateOrFallback(locale, finding.title)}</strong><span className={`trust-badge ${finding.severity}`}>{translateOrFallback(locale, finding.severity)}</span><span className={`trust-status ${finding.status}`}>{translateOrFallback(locale, finding.status)}</span></div>
            <p>{translateOrFallback(locale, finding.explanation)}</p><small>{finding.batch_codes.join(" · ")}</small>
            <ul>{finding.evidence.map((item) => <li key={`${item.label}-${item.value}`}><strong>{translateOrFallback(locale, item.label)}:</strong> {item.value}</li>)}</ul>
            <p className="recall-next-step">{t("Suggested review: {action}", { action: translateOrFallback(locale, finding.recommended_action) })}</p>
          </li>)}
        </ul> : <p className="recall-empty-inline">{t("No associated TraceTrust findings were returned. This does not establish that a batch is safe.")}</p>}
      </section>

      <section className="recall-panel recall-limitations" aria-labelledby="recall-gaps-title">
        <header><div><h2 id="recall-gaps-title">{t("Traceability limits and review notes")}</h2><p>{t("Use these limitations when assessing the candidate scope.")}</p></div></header>
        <p className="recall-human-warning">{translateOrFallback(locale, result.human_review_warning)}</p>
        <p className="recall-traversal-status">{t(result.completeness.traversal_complete ? "Traversal completed within the configured computation limits." : "Traversal is partial or recorded graph issues were detected.")} {t("Maximum depth: {depth}.", { depth: result.completeness.max_depth })}</p>
        <ul>{result.warnings.map((warning) => <li key={warning}>{translateOrFallback(locale, warning)}</li>)}</ul>
        <p className="recall-next-step">{translateOrFallback(locale, result.recommended_next_action)}</p>
      </section>
    </> : null}
  </section>;
}
