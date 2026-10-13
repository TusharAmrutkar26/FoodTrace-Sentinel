import { useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { translateMessage, useI18n, type TranslationKey } from "../i18n";
import type {
  Batch,
  BatchEvent,
  BatchEventType,
  GenealogyBatch,
  GenealogyRelationship,
  GenealogyRelationshipType,
  Page,
} from "../types/api";

const SEARCH_LIMIT = 20;

const relationshipLabels: Record<GenealogyRelationshipType, TranslationKey> = {
  split: "Relationship: split",
  merge: "Relationship: merge",
  transformation: "Relationship: transformation",
};

const eventLabels: Record<BatchEventType, TranslationKey> = {
  harvested: "Genealogy event: harvested",
  produced: "Genealogy event: produced",
  received: "Genealogy event: received",
  quality_checked: "Genealogy event: quality_checked",
  dispatched: "Genealogy event: dispatched",
  delivered: "Genealogy event: delivered",
  stored: "Genealogy event: stored",
  processed: "Genealogy event: processed",
};

function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function errorText(
  cause: unknown,
  fallback: string,
  locale: "en" | "hi" | "mr",
): string {
  const detail = cause instanceof Error ? translateMessage(locale, cause.message) : "";
  return detail ? `${fallback} ${detail}` : fallback;
}

function BatchNode({
  batch,
  selected = false,
  onExplore,
  exploreLabel,
}: {
  batch: GenealogyBatch;
  selected?: boolean;
  onExplore?: () => void;
  exploreLabel: string;
}) {
  const content = <>
    <strong className="genealogy-node-code" dir="auto">{batch.batch_code}</strong>
    <span className="genealogy-node-product">{batch.product_name}</span>
    <span className="genealogy-node-quantity"><bdi>{batch.quantity} {batch.unit}</bdi></span>
  </>;

  if (selected) {
    return <article className="genealogy-explorer-node is-selected" aria-label={exploreLabel} aria-current="true">
      <span className="genealogy-selected-label">{exploreLabel}</span>
      {content}
    </article>;
  }

  return <button
    type="button"
    className="genealogy-explorer-node"
    aria-label={exploreLabel}
    onClick={onExplore}
  >
    {content}
  </button>;
}

function RelationshipDetails({
  relationship,
  timestamp,
  t,
}: {
  relationship: GenealogyRelationship;
  timestamp: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return <div className="genealogy-edge-details">
    <span className="genealogy-edge-type">{t(relationshipLabels[relationship.relationship_type])}</span>
    {relationship.source_quantity !== null && relationship.source_unit !== null
      ? <span>{t("Recorded input from parent: {quantity} {unit}", {
        quantity: relationship.source_quantity,
        unit: relationship.source_unit,
      })}</span>
      : <span>{t("No input quantity recorded")}</span>}
    <time dateTime={relationship.created_at}>{t("Recorded on {date}", { date: timestamp })}</time>
  </div>;
}

function ParentLink({
  relationship,
  onExplore,
  timestamp,
  t,
}: {
  relationship: GenealogyRelationship;
  onExplore: (batchCode: string) => void;
  timestamp: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const { locale } = useI18n();
  return <li className="genealogy-edge-card">
    <BatchNode
      batch={relationship.parent}
      exploreLabel={t("Explore batch {batch_code}", { batch_code: relationship.parent.batch_code })}
      onExplore={() => onExplore(relationship.parent.batch_code)}
    />
    <div className="genealogy-edge-direction">
      <span aria-hidden="true">→</span>
      <span>{t("To selected batch")}</span>
    </div>
    <RelationshipDetails relationship={relationship} timestamp={timestamp || formatTimestamp(relationship.created_at, locale)} t={t} />
  </li>;
}

function ChildLink({
  relationship,
  onExplore,
  timestamp,
  t,
}: {
  relationship: GenealogyRelationship;
  onExplore: (batchCode: string) => void;
  timestamp: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const { locale } = useI18n();
  return <li className="genealogy-edge-card">
    <div className="genealogy-edge-direction">
      <span>{t("From selected batch")}</span>
      <span aria-hidden="true">→</span>
    </div>
    <RelationshipDetails relationship={relationship} timestamp={timestamp || formatTimestamp(relationship.created_at, locale)} t={t} />
    <BatchNode
      batch={relationship.child}
      exploreLabel={t("Explore batch {batch_code}", { batch_code: relationship.child.batch_code })}
      onExplore={() => onExplore(relationship.child.batch_code)}
    />
  </li>;
}

export function BatchGenealogyExplorer() {
  const { t, locale, intlLocale } = useI18n();
  const [query, setQuery] = useState("");
  const [resultPage, setResultPage] = useState<Page<Batch> | null>(null);
  const [resultOffset, setResultOffset] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [graph, setGraph] = useState<Awaited<ReturnType<typeof api.getGenealogy>> | null>(null);
  const [events, setEvents] = useState<BatchEvent[]>([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [eventsError, setEventsError] = useState("");
  const searchRequestId = useRef(0);
  const selectionRequestId = useRef(0);

  async function searchBatches(offset: number) {
    const term = query.trim();
    const requestId = ++searchRequestId.current;
    if (!term) {
      setResultPage(null);
      setResultOffset(0);
      setSearchError("");
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    try {
      const page = await api.listBatches({ limit: SEARCH_LIMIT, offset, q: term });
      if (requestId === searchRequestId.current) {
        setResultPage(page);
        setResultOffset(offset);
      }
    } catch (cause) {
      if (requestId === searchRequestId.current) {
        setSearchError(errorText(cause, t("Could not search batches."), locale));
        setResultPage(null);
      }
    } finally {
      if (requestId === searchRequestId.current) setSearchLoading(false);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchBatches(0);
  }

  function exploreBatch(batchCode: string) {
    const requestId = ++selectionRequestId.current;
    setSelectedCode(batchCode);
    setGraph(null);
    setEvents([]);
    setGraphError("");
    setEventsError("");
    setGraphLoading(true);
    setEventsLoading(true);

    void api.getGenealogy(batchCode)
      .then((result) => {
        if (requestId === selectionRequestId.current) setGraph(result);
      })
      .catch((cause: unknown) => {
        if (requestId === selectionRequestId.current) {
          setGraphError(errorText(cause, t("Could not load genealogy."), locale));
        }
      })
      .finally(() => {
        if (requestId === selectionRequestId.current) setGraphLoading(false);
      });

    void api.listAllBatchEvents(batchCode)
      .then((result) => {
        if (requestId === selectionRequestId.current) setEvents(result);
      })
      .catch((cause: unknown) => {
        if (requestId === selectionRequestId.current) {
          setEventsError(errorText(cause, t("Could not load event history."), locale));
        }
      })
      .finally(() => {
        if (requestId === selectionRequestId.current) setEventsLoading(false);
      });
  }

  const start = resultPage && resultPage.total > 0 ? resultOffset + 1 : 0;
  const end = resultPage ? resultOffset + resultPage.items.length : 0;
  const hasParents = !!graph?.parents.length;
  const hasChildren = !!graph?.children.length;

  return <div className="genealogy-explorer">
    <section className="page-heading" aria-labelledby="genealogy-title">
      <div>
        <p className="eyebrow">{t("GENEALOGY EXPLORER")}</p>
        <h1 id="genealogy-title">{t("Batch genealogy explorer")}</h1>
        <p className="page-subtitle">{t("Follow the batch links recorded in the workspace. Select any connected batch to continue exploring.")}</p>
      </div>
    </section>

    <section className="genealogy-search-panel" aria-label={t("Search for a batch")}>
      <form className="genealogy-search-form" onSubmit={handleSearch}>
        <label className="field" htmlFor="genealogy-batch-search">
          <span>{t("Search for a batch")}</span>
          <input
            id="genealogy-batch-search"
            type="search"
            autoComplete="off"
            value={query}
            placeholder={t("Search by batch code or product name")}
            onChange={(event) => {
              searchRequestId.current += 1;
              setSearchLoading(false);
              setResultPage(null);
              setSearchError("");
              setQuery(event.target.value);
            }}
          />
        </label>
        <button className="button button-primary" type="submit" disabled={searchLoading}>
          {searchLoading ? t("Searching batches…") : t("Search genealogy")}
        </button>
      </form>

      {searchError ? <div className="genealogy-explorer-error" role="alert">
        <span>{searchError}</span>
        <button className="button button-secondary" type="button" onClick={() => void searchBatches(resultOffset)}>{t("Retry")}</button>
      </div> : null}

      {searchLoading ? <p className="genealogy-explorer-state" role="status"><span className="spinner" />{t("Searching batches…")}</p> : null}
      {!searchLoading && resultPage?.items.length ? <>
        <p className="genealogy-result-count" role="status">
          {t("Showing {from}–{to} of {total} results", {
            from: start.toLocaleString(intlLocale),
            to: end.toLocaleString(intlLocale),
            total: resultPage.total.toLocaleString(intlLocale),
          })}
        </p>
        <ul className="genealogy-search-results">
          {resultPage.items.map((batch) => <li key={batch.id}>
            <button
              type="button"
              className="genealogy-search-result"
              aria-label={t("Explore batch {batch_code}", { batch_code: batch.batch_code })}
              onClick={() => exploreBatch(batch.batch_code)}
            >
              <strong dir="auto">{batch.batch_code}</strong>
              <span>{batch.product.name}</span>
              <small><bdi>{batch.quantity} {batch.unit}</bdi></small>
            </button>
          </li>)}
        </ul>
        {resultPage.total > SEARCH_LIMIT ? <div className="genealogy-pagination">
          <button className="button button-secondary" type="button" disabled={resultOffset === 0 || searchLoading} onClick={() => void searchBatches(Math.max(0, resultOffset - SEARCH_LIMIT))}>{t("Previous results")}</button>
          <button className="button button-secondary" type="button" disabled={resultOffset + resultPage.items.length >= resultPage.total || searchLoading} onClick={() => void searchBatches(resultOffset + SEARCH_LIMIT)}>{t("Next results")}</button>
        </div> : null}
      </> : null}
      {!searchLoading && !searchError && resultPage && resultPage.items.length === 0
        ? <p className="genealogy-explorer-empty">{t("No batches match this search.")}</p>
        : null}
      {!searchLoading && !searchError && !resultPage
        ? <p className="genealogy-explorer-hint">{t("Enter a batch code or product name to see its recorded relationships.")}</p>
        : null}
    </section>

    {!selectedCode ? <section className="genealogy-explorer-placeholder" aria-live="polite">
      <span className="genealogy-placeholder-mark" aria-hidden="true">↔</span>
      <p>{t("Enter a batch code or product name to see its recorded relationships.")}</p>
    </section> : <>
      {graphLoading ? <p className="genealogy-explorer-state" role="status"><span className="spinner" />{t("Loading recorded relationships…")}</p> : null}
      {graphError ? <div className="genealogy-explorer-error" role="alert">
        <span>{graphError}</span>
        <button className="button button-secondary" type="button" onClick={() => exploreBatch(selectedCode)}>{t("Retry genealogy")}</button>
      </div> : null}

      {graph && !graphLoading ? <>
        <p className="genealogy-recording-note" role="note">{t("Only recorded links are shown. Missing links cannot be inferred from available records.")}</p>
        {!hasParents && !hasChildren
          ? <p className="genealogy-recording-note" role="note">{t("No genealogy links are recorded for this batch. This view cannot establish whether unrecorded links exist.")}</p>
          : null}
        <div className="genealogy-explorer-flow" role="group" aria-label={t("Recorded batch relationships")}>
          <section className="genealogy-explorer-lane" aria-labelledby="genealogy-parents-title">
            <h2 id="genealogy-parents-title">{t("Upstream parents")} <span>{graph.parents.length.toLocaleString(intlLocale)}</span></h2>
            {hasParents ? <ul className="genealogy-explorer-links">
              {graph.parents.map((relationship) => <ParentLink
                key={relationship.id}
                relationship={relationship}
                onExplore={exploreBatch}
                timestamp={formatTimestamp(relationship.created_at, intlLocale)}
                t={t}
              />)}
            </ul> : <p className="genealogy-explorer-empty">{t("No parent batches are recorded.")}</p>}
          </section>

          <section className="genealogy-explorer-lane genealogy-current-lane" aria-labelledby="genealogy-selected-title">
            <h2 id="genealogy-selected-title">{t("Selected batch")}</h2>
            <BatchNode
              batch={graph.batch}
              selected
              exploreLabel={t("Selected batch")}
            />
          </section>

          <section className="genealogy-explorer-lane" aria-labelledby="genealogy-children-title">
            <h2 id="genealogy-children-title">{t("Downstream children")} <span>{graph.children.length.toLocaleString(intlLocale)}</span></h2>
            {hasChildren ? <ul className="genealogy-explorer-links">
              {graph.children.map((relationship) => <ChildLink
                key={relationship.id}
                relationship={relationship}
                onExplore={exploreBatch}
                timestamp={formatTimestamp(relationship.created_at, intlLocale)}
                t={t}
              />)}
            </ul> : <p className="genealogy-explorer-empty">{t("No child batches are recorded.")}</p>}
          </section>
        </div>

        <section className="genealogy-events-panel" aria-labelledby="genealogy-events-title">
          <div className="genealogy-events-heading">
            <div>
              <p className="eyebrow">{t("BATCH EVENTS")}</p>
              <h2 id="genealogy-events-title">{t("Recorded events for {batch_code}", { batch_code: graph.batch.batch_code })}</h2>
            </div>
          </div>
          {eventsLoading ? <p className="genealogy-explorer-state" role="status"><span className="spinner" />{t("Loading event history…")}</p> : null}
          {eventsError ? <div className="genealogy-explorer-error" role="alert">
            <span>{eventsError}</span>
            <button className="button button-secondary" type="button" onClick={() => {
              const requestId = selectionRequestId.current;
              setEventsLoading(true);
              setEventsError("");
              void api.listAllBatchEvents(selectedCode)
                .then((result) => { if (requestId === selectionRequestId.current) setEvents(result); })
                .catch((cause: unknown) => {
                  if (requestId === selectionRequestId.current) setEventsError(errorText(cause, t("Could not load event history."), locale));
                })
                .finally(() => { if (requestId === selectionRequestId.current) setEventsLoading(false); });
            }}>{t("Retry event history")}</button>
          </div> : null}
          {!eventsLoading && !eventsError && events.length === 0 ? <p className="genealogy-explorer-empty">{t("No events are recorded for this batch.")}</p> : null}
          {!eventsLoading && !eventsError && events.length > 0 ? <ol className="genealogy-event-list" aria-label={t("Recorded events for {batch_code}", { batch_code: graph.batch.batch_code })}>
            {events.map((event) => <li key={event.id} className="genealogy-event-card">
              <span className="genealogy-event-marker" aria-hidden="true" />
              <div className="genealogy-event-body">
                <div className="genealogy-event-title">
                  <strong>{t(eventLabels[event.event_type])}</strong>
                  <time dateTime={event.occurred_at}>{formatTimestamp(event.occurred_at, intlLocale)}</time>
                </div>
                {event.organization ? <p>{t("Organization: {name}", { name: event.organization.name })}</p> : null}
                {event.location ? <p>{t("Location: {location}", { location: event.location })}</p> : null}
                {event.notes ? <p className="genealogy-event-notes">{event.notes}</p> : null}
              </div>
            </li>)}
          </ol> : null}
        </section>
      </> : null}
    </>}
  </div>;
}
