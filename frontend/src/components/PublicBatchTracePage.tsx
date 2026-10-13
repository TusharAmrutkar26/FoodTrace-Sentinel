import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { PublicBatchTrace, PublicGenealogyBatch, PublicGenealogyRelationship } from "../types/api";
import { LanguageSelector, translateMessage, translateOrFallback, useI18n } from "../i18n";
import { ThemeToggle } from "../theme";

function dateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

function eventLabel(value: string): string {
  const known: Record<string, string> = {
    harvested: "Harvested", produced: "Produced", received: "Received", quality_checked: "Quality Checked",
    dispatched: "Dispatched", delivered: "Delivered", stored: "Stored", processed: "Processed",
    split: "Split", merge: "Merge", transformation: "Transformation",
  };
  return known[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function BatchCard({ batch, depth }: { batch: PublicGenealogyBatch; depth?: number }) {
  const { t } = useI18n();
  return (
    <li className="public-batch-item">
      {typeof depth === "number" ? <span className="public-depth" aria-label={t("Depth {depth}", { depth })}>{depth}</span> : null}
      <div>
        <strong>{batch.batch_code}</strong>
        <span>{batch.product_name}</span>
        <small>{batch.quantity} {batch.unit}</small>
      </div>
    </li>
  );
}

function RelationshipList({ items }: { items: PublicGenealogyRelationship[] }) {
  const { t } = useI18n();
  if (!items.length) return <p className="public-empty">{t("No recorded batch links.")}</p>;
  return (
    <ul className="public-relations">
      {items.map((item, index) => (
        <li key={`${item.parent.batch_code}-${item.child.batch_code}-${index}`}>
          <span className="public-relation-type">{t((eventLabel(item.relationship_type)) as "Transformation")}</span>
          <div><strong>{item.parent.batch_code}</strong><span>{t("to")}</span><strong>{item.child.batch_code}</strong></div>
          {item.source_quantity && item.source_unit ? <small>{t("Source amount: {amount} {unit}", { amount: item.source_quantity, unit: item.source_unit })}</small> : null}
        </li>
      ))}
    </ul>
  );
}

function TraceList({ title, items }: { title: string; items: (PublicGenealogyBatch & { depth: number })[] }) {
  const { t } = useI18n();
  return (
    <section className="public-section" aria-labelledby={`trace-${title}`}>
      <div className="public-section-heading"><h2 id={`trace-${title}`}>{title}</h2><span>{items.length}</span></div>
      {items.length ? <ul className="public-batch-list">{items.map((batch) => <BatchCard key={`${batch.batch_code}-${batch.depth}`} batch={batch} depth={batch.depth} />)}</ul> : <p className="public-empty">{t("No linked batches in this direction.")}</p>}
    </section>
  );
}

export function PublicBatchTracePage({ traceId }: { traceId: string }) {
  const { t, intlLocale, locale } = useI18n();
  const [trace, setTrace] = useState<PublicBatchTrace | null>(null);
  const [loading, setLoading] = useState(Boolean(traceId));
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const traceTrustFindings = Array.isArray(trace?.trace_trust_findings)
    ? trace.trace_trust_findings
    : null;

  const load = useCallback(async () => {
    if (!traceId) {
      setLoading(false);
      setNotFound(true);
      setError(t("This trace link is incomplete or invalid."));
      return;
    }
    setLoading(true);
    setError("");
    setNotFound(false);
    try {
      setTrace(await api.getPublicBatchTrace(traceId));
    } catch (cause: unknown) {
      setTrace(null);
      setNotFound(cause instanceof ApiError && cause.status === 404);
      setError(cause instanceof ApiError ? translateMessage(locale, cause.message) : t("The trace record could not be loaded. Check your connection and retry."));
    } finally {
      setLoading(false);
    }
  }, [traceId, locale, t]);

  useEffect(() => { void load(); }, [load, retryKey]);

  return (
    <main className="public-trace-shell">
      <header className="public-header">
        <a className="public-brand" href="/" aria-label={t("FoodTrace Sentinel home")}>
          <span className="public-brand-mark" aria-hidden="true">F</span>
          <span>FoodTrace <strong>Sentinel</strong></span>
        </a>
        <span className="public-record-label">{t("Batch trace record")}</span>
        <div className="header-controls"><LanguageSelector /><ThemeToggle /></div>
      </header>

      {loading ? <div className="public-state" role="status"><span className="spinner" /> {t("Loading trace record…")}</div> : null}
      {!loading && error ? (
        <section className="public-state public-error" role="alert">
          <span className="public-state-icon" aria-hidden="true">!</span>
          <h1>{notFound ? t("Trace record not found") : t("Trace record unavailable")}</h1>
          <p>{notFound ? t("This QR identity does not match a batch record.") : error}</p>
          {!notFound ? <button type="button" className="button button-secondary" onClick={() => setRetryKey((value) => value + 1)}>{t("Try again")}</button> : null}
          <a className="public-home-link" href="/">{t("FoodTrace Sentinel home")}</a>
        </section>
      ) : null}

      {!loading && !error && trace ? (
        <div className="public-trace-content">
          <section className="public-hero">
            <p className="eyebrow">{t("TRACEPASS DIGITAL FOOD PASSPORT")}</p>
            <p className="public-passport-kicker">{t("A digital summary of available batch records")}</p>
            <h1>{trace.batch.product_name}</h1>
            <p className="public-batch-code">{t("Batch {code}", { code: trace.batch.batch_code })}</p>
            <div className="public-quantity"><span>{t("Recorded quantity")}</span><strong>{trace.batch.quantity} <small>{trace.batch.unit}</small></strong></div>
            <dl className="public-origin-grid">
              <div><dt>{t("Origin organization")}</dt><dd>{trace.batch.origin_organization}</dd></div>
              <div><dt>{t("Origin location")}</dt><dd>{trace.batch.origin_location}</dd></div>
              <div><dt>{t("Record created")}</dt><dd>{dateTime(trace.batch.created_at, intlLocale)}</dd></div>
            </dl>
          </section>

          <section className="public-passport-notes" aria-label={t("Passport record notes")}>
            <div><strong>{t("Recorded information")}</strong><p>{t("This passport displays information currently recorded in FoodTrace Sentinel.")}</p></div>
            <div><strong>{t("Record completeness")}</strong><p>{trace.events.length === 0 && trace.parents.length === 0 && trace.children.length === 0 && trace.upstream.length === 0 && trace.downstream.length === 0
              ? t("No events or genealogy links are recorded for this batch. A complete supply-chain journey cannot be established from this record.")
              : t("This page shows the entries currently recorded; unrecorded steps cannot be established from this record.")}</p></div>
            <div><strong>{t("Independent verification")}</strong><p>{t("These records have not been independently verified against source documents or the physical product. TracePass is not a food-safety certification.")}</p></div>
          </section>

          <section className="public-section" aria-labelledby="public-events-title">
            <div className="public-section-heading"><h2 id="public-events-title">{t("Recorded events")}</h2><span>{trace.events.length}</span></div>
            {trace.events.length ? (
              <ol className="public-event-list">
                {trace.events.map((event, index) => (
                  <li key={`${event.occurred_at}-${index}`}>
                    <span className="public-event-marker" aria-hidden="true" />
                    <div><strong>{t(eventLabel(event.event_type) as "Harvested")}</strong><time dateTime={event.occurred_at}>{dateTime(event.occurred_at, intlLocale)}</time>{event.location ? <span className="public-event-location">{event.location}</span> : null}</div>
                  </li>
                ))}
              </ol>
            ) : <p className="public-empty">{t("No events have been recorded for this batch.")}</p>}
          </section>

          <section className="public-section" aria-labelledby="public-links-title">
            <div className="public-section-heading"><h2 id="public-links-title">{t("Direct batch relationships")}</h2></div>
            <div className="public-relationship-columns">
              <div><h3>{t("Parent batches")}</h3><RelationshipList items={trace.parents} /></div>
              <div><h3>{t("Child batches")}</h3><RelationshipList items={trace.children} /></div>
            </div>
          </section>

          <div className="public-relationship-columns public-trace-columns">
          <TraceList title={t("Upstream sources")} items={trace.upstream} />
          <TraceList title={t("Downstream affected batches")} items={trace.downstream} />
          </div>

          <section className="public-section public-trust-section" aria-labelledby="public-trust-title">
            <div className="public-section-heading"><h2 id="public-trust-title">{t("TraceTrust data checks")}</h2><span>{traceTrustFindings?.length ?? "—"}</span></div>
            <p className="public-trust-note">{t("TraceTrust checks recorded data for supported inconsistencies. Findings are prompts for review, not proof of contamination, fraud, food safety, or physical product identity.")}</p>
            {traceTrustFindings === null ? (
              <p className="public-empty" role="status">{t("TraceTrust findings are unavailable in this API response. The API may need an update; batch details and trace data are still shown.")}</p>
            ) : traceTrustFindings.length ? (
              <ul className="public-trust-list">
                {traceTrustFindings.map((finding) => (
                  <li key={`${finding.check_type}-${finding.status}-${finding.title}`} className={`public-trust-finding ${finding.severity}`}>
                    <div className="public-trust-finding-heading">
                      <strong>{translateOrFallback(locale, finding.title)}</strong>
                      <span className={`public-trust-status ${finding.status}`}>{finding.status === "incomplete" ? t("Incomplete evidence") : t("Finding to review")}</span>
                    </div>
                    <p>{translateOrFallback(locale, finding.explanation)}</p>
                    <small>{t("Check type: {type}", { type: translateOrFallback(locale, finding.check_type.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")) })}</small>
                    <small>{t("Review priority: {severity}", { severity: t(finding.severity === "high" ? "High severity" : finding.severity === "medium" ? "Medium severity" : "Low severity") })}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="public-empty">{t("No TraceTrust findings were returned for this batch's recorded data. No findings do not certify food safety.")}</p>}
          </section>

          <p className="public-qr-disclaimer">{t("This QR code opens a traceability record. It does not prove the physical product or packaging is authentic.")}</p>
        </div>
      ) : null}

      <footer className="public-footer"><span>FoodTrace Sentinel</span><span>{t("Trace data reflects records available in this system.")}</span></footer>
    </main>
  );
}
