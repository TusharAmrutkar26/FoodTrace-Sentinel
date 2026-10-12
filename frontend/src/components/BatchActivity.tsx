import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import {
  BATCH_EVENT_TYPES,
  type BatchEvent,
  type BatchEventCreateInput,
  type GenealogyGraph,
  type GenealogyTrace,
  type Organization,
} from "../types/api";
import { translateMessage, useI18n } from "../i18n";

const EVENT_LABELS: Record<(typeof BATCH_EVENT_TYPES)[number], string> = {
  harvested: "Harvested",
  produced: "Produced",
  received: "Received",
  quality_checked: "Quality checked",
  dispatched: "Dispatched",
  delivered: "Delivered",
  stored: "Stored",
  processed: "Processed",
};

function dateLabel(value: string, locale: string): string {
  return `${new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function TraceList({ trace, loading, label }: { trace: GenealogyTrace | null; loading: boolean; label: string }) {
  const { t } = useI18n();
  return (
    <section className="trace-card" aria-label={label}>
      <h4>{label}</h4>
      {loading ? <p className="activity-state" role="status"><span className="spinner" /> {t("Tracing batches…")}</p> : null}
      {!loading && trace?.batches.length === 0 ? <p className="activity-empty">{t("No linked batches in this direction.")}</p> : null}
      {!loading && trace && trace.batches.length > 0 ? (
        <ol className="trace-list">
          {trace.batches.map((batch) => (
            <li key={batch.id}>
              <span className="trace-depth">{batch.depth}</span>
              <span className="trace-batch"><strong>{batch.batch_code}</strong><small>{batch.product_name} · {batch.quantity} {batch.unit}</small></span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

interface BatchActivityProps {
  batchCode: string;
  organizations: Organization[];
}

export function BatchActivity({ batchCode, organizations }: BatchActivityProps) {
  const { t, intlLocale, locale } = useI18n();
  const [events, setEvents] = useState<BatchEvent[]>([]);
  const [graph, setGraph] = useState<GenealogyGraph | null>(null);
  const [upstream, setUpstream] = useState<GenealogyTrace | null>(null);
  const [downstream, setDownstream] = useState<GenealogyTrace | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [genealogyLoading, setGenealogyLoading] = useState(true);
  const [eventsError, setEventsError] = useState("");
  const [genealogyError, setGenealogyError] = useState("");
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventType, setEventType] = useState<(typeof BATCH_EVENT_TYPES)[number]>("harvested");
  const [occurredAt, setOccurredAt] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [savingEvent, setSavingEvent] = useState(false);
  const [eventMessage, setEventMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reloadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError("");
    try {
      setEvents(await api.listAllBatchEvents(batchCode));
    } catch (cause: unknown) {
      setEventsError(translateMessage(locale, cause instanceof Error ? cause.message : t("Event history could not be loaded.")));
    } finally {
      setEventsLoading(false);
    }
  }, [batchCode, locale, t]);

  const reloadGenealogy = useCallback(async () => {
    setGenealogyLoading(true);
    setGenealogyError("");
    const responses = await Promise.allSettled([
      api.getGenealogy(batchCode),
      api.traceBatch(batchCode, "upstream"),
      api.traceBatch(batchCode, "downstream"),
    ]);
    const [graphResult, upstreamResult, downstreamResult] = responses;
    const errors: string[] = [];
    if (graphResult.status === "fulfilled") setGraph(graphResult.value);
    else errors.push(translateMessage(locale, graphResult.reason instanceof Error ? graphResult.reason.message : t("Immediate genealogy could not be loaded.")));
    if (upstreamResult.status === "fulfilled") setUpstream(upstreamResult.value);
    else errors.push(translateMessage(locale, upstreamResult.reason instanceof Error ? upstreamResult.reason.message : t("Upstream trace could not be loaded.")));
    if (downstreamResult.status === "fulfilled") setDownstream(downstreamResult.value);
    else errors.push(translateMessage(locale, downstreamResult.reason instanceof Error ? downstreamResult.reason.message : t("Downstream trace could not be loaded.")));
    setGenealogyError(errors.join(" "));
    setGenealogyLoading(false);
  }, [batchCode, locale, t]);

  useEffect(() => {
    void reloadEvents();
    void reloadGenealogy();
  }, [reloadEvents, reloadGenealogy]);

  async function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: BatchEventCreateInput = { event_type: eventType };
    if (occurredAt) {
      const parsed = new Date(occurredAt);
      if (Number.isNaN(parsed.getTime())) {
        setFieldErrors({ occurred_at: t("Event date and time must be valid.") });
        return;
      }
      payload.occurred_at = parsed.toISOString();
    }
    if (organizationId) payload.organization_id = Number(organizationId);
    if (location.trim()) payload.location = location.trim();
    if (notes.trim()) payload.notes = notes.trim();

    setSavingEvent(true);
    setEventsError("");
    setFieldErrors({});
    setEventMessage("");
    try {
      await api.createBatchEvent(batchCode, payload);
      setEventMessage("Event recorded.");
      setShowEventForm(false);
      setOccurredAt("");
      setOrganizationId("");
      setLocation("");
      setNotes("");
      await reloadEvents();
    } catch (cause: unknown) {
      if (cause instanceof ApiError) {
        setEventsError(translateMessage(locale, cause.message));
        setFieldErrors(Object.fromEntries(Object.entries(cause.fields).map(([key, value]) => [key, translateMessage(locale, value)])));
      } else {
        setEventsError(translateMessage(locale, cause instanceof Error ? cause.message : t("Event could not be recorded.")));
      }
    } finally {
      setSavingEvent(false);
    }
  }

  return (
    <div className="batch-activity">
      <section className="activity-section" aria-labelledby="event-history-title">
        <div className="activity-heading">
              <div><h3 id="event-history-title">{t("Supply-chain events")}</h3><p>{t("Timeline of recorded activity for this batch.")}</p></div>
          <button type="button" className="button button-secondary activity-button" onClick={() => { setShowEventForm((current) => !current); setEventsError(""); }}>
            {showEventForm ? t("Cancel") : t("Record event")}
          </button>
        </div>

        {showEventForm ? (
          <form className="event-form" onSubmit={submitEvent}>
            <div className="event-form-row">
              <label className="field"><span>{t("Event type")} <em>{t("Required")}</em></span>
                <select value={eventType} onChange={(event) => setEventType(event.target.value as typeof eventType)}>
                  {BATCH_EVENT_TYPES.map((type) => <option key={type} value={type}>{t(EVENT_LABELS[type] as "Harvested")}</option>)}
                </select>
              </label>
              <label className="field"><span>{t("Occurred at")} <em>{t("Optional; defaults to now")}</em></span>
                <input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} aria-invalid={Boolean(fieldErrors.occurred_at)} />
                {fieldErrors.occurred_at ? <small className="field-error">{fieldErrors.occurred_at}</small> : null}
              </label>
            </div>
            <div className="event-form-row">
              <label className="field"><span>{t("Organization")} <em>{t("Optional")}</em></span>
                <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
                  <option value="">{t("No organization selected")}</option>
                  {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
                </select>
              </label>
              <label className="field"><span>{t("Location")} <em>{t("Optional")}</em></span>
                <input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={240} placeholder={t("Facility or location")} />
              </label>
            </div>
            <label className="field"><span>{t("Notes")} <em>{t("Optional")}</em></span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} placeholder={t("Add a short note about this event")} />
            </label>
            {eventsError ? <div className="form-error" role="alert">{eventsError}</div> : null}
            <div className="event-form-actions">
              <button className="button button-primary" type="submit" disabled={savingEvent}>{savingEvent ? <><span className="spinner spinner-light" /> {t("Saving…")}</> : t("Save event")}</button>
            </div>
          </form>
        ) : null}

        {eventMessage ? <p className="activity-success" role="status">{eventMessage}</p> : null}
        {!showEventForm && eventsError ? <div className="activity-error" role="alert">{eventsError}<button type="button" className="button button-secondary" onClick={() => void reloadEvents()}>{t("Retry")}</button></div> : null}
        {eventsLoading ? <p className="activity-state" role="status"><span className="spinner" /> {t("Loading event history…")}</p> : null}
        {!eventsLoading && !eventsError && events.length === 0 ? <p className="activity-empty">{t("No events recorded yet.")}</p> : null}
        {!eventsLoading && !eventsError && events.length > 0 ? (
          <ol className="event-timeline">
            {events.map((item) => (
              <li key={item.id}>
                <span className="timeline-marker" aria-hidden="true" />
                <div className="event-timeline-body">
                  <div className="event-title-row"><strong>{t(EVENT_LABELS[item.event_type] as "Harvested")}</strong><time dateTime={item.occurred_at}>{dateLabel(item.occurred_at, intlLocale)}</time></div>
                  <p>{[item.organization?.name, item.location].filter(Boolean).join(" · ") || t("No participant or location recorded")}</p>
                  {item.notes ? <small>{item.notes}</small> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <section className="activity-section genealogy-section" aria-labelledby="genealogy-title">
        <div className="activity-heading"><div><h3 id="genealogy-title">{t("Batch genealogy")}</h3><p>{t("Explicit links only; similar batch codes are not treated as related.")}</p></div></div>
        {genealogyError ? <div className="activity-error" role="alert">{genealogyError}<button type="button" className="button button-secondary" onClick={() => void reloadGenealogy()}>{t("Retry")}</button></div> : null}
        {genealogyLoading ? <p className="activity-state" role="status"><span className="spinner" /> {t("Loading genealogy…")}</p> : null}
        {!genealogyLoading && !genealogyError && graph ? (
          <>
            <div className="genealogy-columns">
              <section className="genealogy-card" aria-label={t("Parent batches")}>
                <h4>{t("Parent batches")} <span>{graph.parents.length}</span></h4>
                {graph.parents.length === 0 ? <p className="activity-empty">{t("No parent batch linked.")}</p> : (
                  <ul className="genealogy-list">
                    {graph.parents.map((edge) => <li key={edge.id}><strong>{edge.parent.batch_code}</strong><small>{edge.parent.product_name} · {t(({ transformation: "Transformation", split: "Split", merge: "Merge" } as const)[edge.relationship_type])}</small>{edge.source_quantity ? <small>{t("Source amount")}: {edge.source_quantity} {edge.source_unit}</small> : null}</li>)}
                  </ul>
                )}
              </section>
              <section className="genealogy-card" aria-label={t("Child batches")}>
                <h4>{t("Child batches")} <span>{graph.children.length}</span></h4>
                {graph.children.length === 0 ? <p className="activity-empty">{t("No child batch linked.")}</p> : (
                  <ul className="genealogy-list">
                    {graph.children.map((edge) => <li key={edge.id}><strong>{edge.child.batch_code}</strong><small>{edge.child.product_name} · {t(({ transformation: "Transformation", split: "Split", merge: "Merge" } as const)[edge.relationship_type])}</small>{edge.source_quantity ? <small>{t("Source amount")}: {edge.source_quantity} {edge.source_unit}</small> : null}</li>)}
                  </ul>
                )}
              </section>
            </div>
            <div className="trace-columns">
              <TraceList trace={upstream} loading={!upstream && genealogyLoading} label={t("Upstream sources")} />
              <TraceList trace={downstream} loading={!downstream && genealogyLoading} label={t("Downstream affected batches")} />
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
