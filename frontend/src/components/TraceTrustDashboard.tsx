import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { TrustCheckType, TrustFinding, TrustFindingPage, TrustSeverity } from "../types/api";
import { translateMessage, translateOrFallback, useI18n } from "../i18n";

const PAGE_SIZE = 20;
const CHECK_TYPES: TrustCheckType[] = [
  "batch_quantity_invalid",
  "batch_unit_invalid",
  "genealogy_source_quantity_invalid",
  "genealogy_source_unit_invalid",
  "genealogy_source_unit_mismatch",
  "split_overallocated",
  "genealogy_cycle",
  "process_loss",
  "process_loss_incomplete",
];

function readable(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function emptyPage(): TrustFindingPage {
  return { items: [], total: 0, limit: PAGE_SIZE, offset: 0, counts: { high: 0, medium: 0, low: 0, incomplete: 0 } };
}

export function TraceTrustDashboard({ onOpenBatch }: { onOpenBatch: (batchCode: string) => void }) {
  const { t, intlLocale, locale } = useI18n();
  const [result, setResult] = useState<TrustFindingPage>(emptyPage);
  const [severity, setSeverity] = useState<TrustSeverity | "">("");
  const [checkType, setCheckType] = useState<TrustCheckType | "">("");
  const [batchDraft, setBatchDraft] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.getTrustFindings({
      severity: severity || undefined,
      check_type: checkType || undefined,
      batch_code: batchFilter || undefined,
      limit: PAGE_SIZE,
      offset,
    }).then((data) => {
      if (!active) return;
      setResult(data);
      setSelectedId((current) => data.items.some((item) => item.finding_id === current) ? current : "");
    }).catch((cause: unknown) => {
      if (active) setError(translateMessage(locale, cause instanceof Error ? cause.message : t("TraceTrust findings could not be loaded.")));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [severity, checkType, batchFilter, offset, retryKey]);

  const selected = result.items.find((item) => item.finding_id === selectedId) ?? null;
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const currentPage = Math.min(Math.floor(offset / PAGE_SIZE) + 1, pageCount);

  function applyBatchFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setBatchFilter(batchDraft.trim().toUpperCase());
  }

  function setFilter<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setOffset(0);
    setSelectedId("");
  }

  return (
    <section className="trust-page" aria-labelledby="trust-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("EVIDENCE-BASED REVIEW")}</p>
          <h1 id="trust-title">TraceTrust</h1>
          <p className="page-subtitle">{t("Review explainable checks against currently recorded batches and genealogy.")}</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => setRetryKey((value) => value + 1)}>{t("Refresh findings")}</button>
      </div>

      <div className="trust-note" role="note">
        {t("Findings describe recorded data inconsistencies or checks that could not be completed. They are prompts for review, not proof of fraud or product authenticity.")}
      </div>

      <section className="summary-grid trust-summary" aria-label={t("Finding counts by severity")} aria-live="polite">
        <article className="summary-card"><span className="trust-severity-mark high" aria-hidden="true" /><div><p>{t("High severity")}</p><strong>{loading ? "—" : error ? "—" : result.counts.high.toLocaleString(intlLocale)}</strong><small>{t("Recorded quantity or genealogy inconsistency")}</small></div></article>
        <article className="summary-card"><span className="trust-severity-mark medium" aria-hidden="true" /><div><p>{t("Medium severity")}</p><strong>{loading ? "—" : error ? "—" : result.counts.medium.toLocaleString(intlLocale)}</strong><small>{t("Process loss above configured threshold")}</small></div></article>
        <article className="summary-card"><span className="trust-severity-mark low" aria-hidden="true" /><div><p>{t("Low severity")}</p><strong>{loading ? "—" : error ? "—" : result.counts.low.toLocaleString(intlLocale)}</strong><small>{loading || error ? t("Incomplete checks unavailable") : t("{count} incomplete checks included", { count: result.counts.incomplete.toLocaleString(intlLocale) })}</small></div></article>
      </section>

      <section className="table-panel trust-panel" aria-labelledby="trust-findings-title">
        <div className="panel-heading">
          <div><h2 id="trust-findings-title">{t("Findings")}</h2><p>{t("Each result includes the recorded evidence and a suggested review action.")}</p></div>
          <span className="catalog-count" aria-live="polite">{loading ? t("Loading") : error ? t("Unavailable") : t("{count} results", { count: result.total.toLocaleString(intlLocale) })}</span>
        </div>
        <form className="trust-filters" onSubmit={applyBatchFilter}>
          <label>{t("Severity")}
            <select aria-label={t("Filter by severity")} value={severity} onChange={(event) => setFilter(setSeverity, event.target.value as TrustSeverity | "")}>
              <option value="">{t("All severities")}</option><option value="high">{t("High")}</option><option value="medium">{t("Medium")}</option><option value="low">{t("Low")}</option>
            </select>
          </label>
          <label>{t("Check type")}
            <select aria-label={t("Filter by check type")} value={checkType} onChange={(event) => setFilter(setCheckType, event.target.value as TrustCheckType | "")}>
              <option value="">{t("All check types")}</option>{CHECK_TYPES.map((type) => <option key={type} value={type}>{translateOrFallback(locale, readable(type))}</option>)}
            </select>
          </label>
          <label className="trust-batch-filter">{t("Batch code")}
            <input aria-label={t("Filter by batch code")} value={batchDraft} onChange={(event) => setBatchDraft(event.target.value)} placeholder={t("For example, MNG-201")} />
          </label>
          <div className="trust-filter-actions"><button className="button button-primary" type="submit">{t("Apply")}</button><button className="button button-secondary" type="button" onClick={() => { setSeverity(""); setCheckType(""); setBatchDraft(""); setBatchFilter(""); setOffset(0); setSelectedId(""); }}>{t("Clear")}</button></div>
        </form>

        {error ? <div className="trust-state error-state" role="alert"><span>{error}</span><button className="button button-secondary" type="button" onClick={() => setRetryKey((value) => value + 1)}>{t("Retry")}</button></div> : null}
        {!error && loading ? <div className="trust-state" role="status"><span className="spinner" /> {t("Analyzing recorded data…")}</div> : null}
        {!error && !loading && result.items.length === 0 ? <div className="trust-state trust-empty"><strong>{t("No findings for these filters")}</strong><p>{t("TraceTrust found no supported checks to report in the selected records. Missing events or links are not treated as issues unless the recorded workflow establishes that they are required.")}</p></div> : null}
        {!error && !loading && result.items.length > 0 ? <>
          <div className="table-wrap">
            <table className="trust-table">
              <thead><tr><th scope="col">{t("Severity")}</th><th scope="col">{t("Finding")}</th><th scope="col">{t("Batch codes")}</th><th scope="col">{t("Status")}</th><th scope="col"><span className="sr-only">{t("Details")}</span></th></tr></thead>
              <tbody>{result.items.map((finding) => <tr key={finding.finding_id}>
                <td><span className={`trust-badge ${finding.severity}`}>{translateOrFallback(locale, finding.severity[0].toUpperCase() + finding.severity.slice(1))}</span></td>
                <td><strong className="trust-row-title">{translateOrFallback(locale, finding.title)}</strong><span className="trust-row-type">{translateOrFallback(locale, readable(finding.check_type))}</span></td>
                <td><div className="trust-code-list">{finding.batch_codes.length ? finding.batch_codes.map((code) => <button type="button" className="trust-code-link" key={code} onClick={() => onOpenBatch(code)}>{code}</button>) : <span>{t("Unavailable")}</span>}</div></td>
                <td><span className={`trust-status ${finding.status}`}>{translateOrFallback(locale, finding.status.replaceAll("_", " "))}</span></td>
                <td><button className="button button-secondary trust-detail-button" type="button" aria-label={t("View details for {title}", { title: finding.title })} aria-pressed={selectedId === finding.finding_id} onClick={() => setSelectedId((current) => current === finding.finding_id ? "" : finding.finding_id)}>{t("Details")}</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          {selected ? <FindingDetails finding={selected} onOpenBatch={onOpenBatch} /> : null}
          <footer className="trust-pagination"><span>{t("Page")} <strong>{currentPage}</strong> {t("of")} <strong>{pageCount}</strong></span><div><button className="button button-secondary" type="button" disabled={offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>{t("Previous")}</button><button className="button button-secondary" type="button" disabled={offset + PAGE_SIZE >= result.total || loading} onClick={() => setOffset((value) => value + PAGE_SIZE)}>{t("Next")}</button></div></footer>
        </> : null}
      </section>
      <p className="trust-method-note">{t("TraceTrust only compares quantities with the same recorded unit. Incomplete multi-input operations are not summed. The analysis reads existing records and does not change them.")}</p>
    </section>
  );
}

function FindingDetails({ finding, onOpenBatch }: { finding: TrustFinding; onOpenBatch: (batchCode: string) => void }) {
  const { t, locale } = useI18n();
  return <section className="trust-detail" aria-labelledby="finding-detail-title">
    <div className="trust-detail-heading"><div><p className="eyebrow">{translateOrFallback(locale, readable(finding.check_type))}</p><h3 id="finding-detail-title">{translateOrFallback(locale, finding.title)}</h3></div><span className={`trust-badge ${finding.severity}`}>{translateOrFallback(locale, finding.severity[0].toUpperCase() + finding.severity.slice(1))} {t("severity")}</span></div>
    <p>{translateOrFallback(locale, finding.explanation)}</p>
    <h4>{t("Evidence from recorded data")}</h4>
    <dl className="trust-evidence">{finding.evidence.map((item, index) => <div key={`${item.label}-${index}`}><dt>{translateOrFallback(locale, item.label)}</dt><dd>{item.value}</dd></div>)}</dl>
    <div className="trust-action"><strong>{t("Suggested review")}</strong><p>{translateOrFallback(locale, finding.recommended_action)}</p></div>
    {finding.batch_codes.length ? <div className="trust-related"><strong>{t("Related batches")}</strong>{finding.batch_codes.map((code) => <button className="trust-code-link" type="button" key={code} onClick={() => onOpenBatch(code)}>{code}</button>)}</div> : null}
    <p className="trust-finding-key">{t("Finding key: {id}", { id: finding.finding_id })}</p>
  </section>;
}
