import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { supplyChainReportCsv } from "../lib/supplyChainReportCsv";
import type { SupplyChainReport } from "../types/api";
import { translateMessage, translateOrFallback, useI18n } from "../i18n";

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function defaultPeriod(): { start: string; end: string } {
  const yesterday = shiftDate(utcToday(), -1);
  return { start: shiftDate(yesterday, -6), end: yesterday };
}

function readable(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ReportsDashboard() {
  const { t, intlLocale, locale } = useI18n();
  const initialPeriod = defaultPeriod();
  const [startDate, setStartDate] = useState(initialPeriod.start);
  const [endDate, setEndDate] = useState(initialPeriod.end);
  const [report, setReport] = useState<SupplyChainReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rangeError, setRangeError] = useState("");

  async function generateReport(start: string, end: string) {
    setRangeError("");
    if (!start || !end) {
      setRangeError(t("Choose both a start date and an end date."));
      return;
    }
    if (start > end) {
      setRangeError(t("Start date must be on or before end date."));
      return;
    }
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const result = await api.getSupplyChainReport({ start_date: start, end_date: end });
      setReport(result);
    } catch (cause: unknown) {
      setError(translateMessage(locale, cause instanceof Error ? cause.message : t("The supply-chain report could not be loaded.")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void generateReport(initialPeriod.start, initialPeriod.end);
    // The initial request intentionally uses the period computed on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportCsv() {
    if (!report) return;
    const blob = new Blob([supplyChainReportCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `foodtrace-supply-chain-${report.period.start_date}-to-${report.period.end_date}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="reports-page" aria-labelledby="reports-title">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t("RECORDED DATA · UTC")}</p>
          <h1 id="reports-title">{t("Supply-chain reports")}</h1>
          <p className="page-subtitle">{t("Review recorded batch, event, and genealogy activity for a selected period.")}</p>
        </div>
        <button className="button button-secondary" type="button" onClick={exportCsv} disabled={!report}>
          {t("Export CSV")}
        </button>
      </header>

      <form className="report-controls" onSubmit={(event) => { event.preventDefault(); void generateReport(startDate, endDate); }}>
        <label>
          {t("Start date")}
          <input aria-label={t("Start date")} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          {t("End date")}
          <input aria-label={t("End date")} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <button className="button button-primary" type="submit" disabled={loading}>
          {loading ? t("Generating…") : report ? t("Refresh report") : t("Generate report")}
        </button>
      </form>
      <p className="report-period-note">{t("Dates include both selected UTC calendar days. The default period is the most recent seven completed UTC days.")}</p>

      {rangeError ? <div className="report-state error-state" role="alert">{rangeError}</div> : null}
      {loading ? <div className="report-state" role="status"><span className="spinner" /> {t("Loading report from the API…")}</div> : null}
      {!loading && error ? (
        <div className="report-state error-state" role="alert">
          <span>{error}</span>
          <button className="button button-secondary" type="button" onClick={() => void generateReport(startDate, endDate)}>{t("Try again")}</button>
        </div>
      ) : null}

      {!loading && report ? <>
        <div className="report-success" role="status">
          {t("Report for")} <strong>{report.period.start_date}</strong> {t("through")} <strong>{report.period.end_date}</strong> (UTC)
          <span>{t("Generated at")} {new Date(report.generated_at).toISOString()} (UTC)</span>
        </div>
        <section className="summary-grid report-summary" aria-label={t("Supported report metrics")}>
          <article className="summary-card"><span className="summary-icon green">B</span><div><p>{t("Batches created")}</p><strong>{report.batches_created.toLocaleString(intlLocale)}</strong><small>{t("Batch creation date in period")}</small></div></article>
          <article className="summary-card"><span className="summary-icon blue">E</span><div><p>{t("Batches with event activity")}</p><strong>{report.batches_with_event_activity.toLocaleString(intlLocale)}</strong><small>{t("Distinct batches with recorded events")}</small></div></article>
          <article className="summary-card"><span className="summary-icon yellow">G</span><div><p>{t("Genealogy links recorded")}</p><strong>{report.genealogy_counts.reduce((total, item) => total + item.count, 0).toLocaleString(intlLocale)}</strong><small>{t("Links saved in period")}</small></div></article>
        </section>

        {!report.has_activity ? <div className="report-empty" role="status"><strong>{t("No recorded activity in this period.")}</strong><span>{t("These zero counts come from the report API response; they do not indicate missing or unavailable quantity data.")}</span></div> : null}

        <div className="report-grid">
          <section className="report-panel" aria-labelledby="event-breakdown-title">
            <div className="panel-heading"><div><h2 id="event-breakdown-title">{t("Events by type")}</h2><p>{t("Counts are based on event occurrence time.")}</p></div></div>
            <div className="report-breakdown">
              {report.event_counts.map((item) => <div className="report-breakdown-row" key={item.event_type}><span>{translateOrFallback(locale, readable(item.event_type))}</span><strong>{item.count.toLocaleString(intlLocale)}</strong></div>)}
            </div>
          </section>
          <section className="report-panel" aria-labelledby="genealogy-breakdown-title">
            <div className="panel-heading"><div><h2 id="genealogy-breakdown-title">{t("Genealogy activity")}</h2><p>{t("Counts use when each relationship was saved.")}</p></div></div>
            <div className="report-breakdown">
              {report.genealogy_counts.map((item) => <div className="report-breakdown-row" key={item.relationship_type}><span>{translateOrFallback(locale, readable(item.relationship_type))}</span><strong>{item.count.toLocaleString(intlLocale)}</strong></div>)}
            </div>
            <p className="report-definition">{t("A saved link may have been recorded after the physical operation took place.")}</p>
          </section>
        </div>

        <section className="report-panel report-unavailable" aria-labelledby="report-limitations-title">
          <div className="panel-heading"><div><h2 id="report-limitations-title">{t("Metrics unavailable from current records")}</h2><p>{t("Unavailable is different from a measured zero.")}</p></div></div>
          <div className="unavailable-metrics">
            <article><span className="availability-badge">{t("Unavailable")}</span><h3>{t("Quantity totals")}</h3><p>{translateOrFallback(locale, report.quantity_metrics.reason)}</p></article>
            <article><span className="availability-badge">{t("Unavailable")}</span><h3>{t("TraceTrust findings in period")}</h3><p>{translateOrFallback(locale, report.trace_trust_findings.reason)}</p></article>
          </div>
        </section>

        <section className="report-panel report-warnings" aria-labelledby="report-warnings-title">
          <div className="panel-heading"><div><h2 id="report-warnings-title">{t("Data notes and metric definitions")}</h2><p>{t("Read these alongside the aggregate counts.")}</p></div></div>
          <ul>{report.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{translateOrFallback(locale, warning)}</li>)}</ul>
          <details><summary>{t("Metric definitions")}</summary><ul>{report.definitions.map((definition) => <li key={definition}>{translateOrFallback(locale, definition)}</li>)}</ul></details>
        </section>
        <p className="report-export-note">{t("CSV export contains this report's aggregate metrics and limitations. It does not contain detailed event rows.")}</p>
      </> : null}
    </section>
  );
}
