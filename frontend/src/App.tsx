import { useCallback, useEffect, useState } from "react";
import { BatchDialog } from "./components/BatchDialog";
import { api, ApiError } from "./lib/api";
import type { Batch, Organization, Product } from "./types/api";

const PAGE_SIZE = 10;

type DialogState = { mode: "create" } | { mode: "details"; batchCode: string } | null;

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function Icon({ name }: { name: "leaf" | "box" | "users" | "search" | "plus" | "refresh" | "arrow" }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths = {
    leaf: <><path d="M20.5 3.5c-9.5 0-15 4-15 10a6 6 0 0 0 6 6c6 0 9-7 9-16Z" /><path d="M4 21c2.5-5 6.5-8 12-11" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 5 9-5V8" /><path d="M12 13v9" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3" /></>,
    arrow: <><path d="m9 18 6-6-6-6" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function App() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [productTotal, setProductTotal] = useState(0);
  const [organizationTotal, setOrganizationTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [tableError, setTableError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setPageError("");
    try {
      const [productItems, organizationItems, allBatches] = await Promise.all([
        api.listAllProducts(),
        api.listAllOrganizations(),
        api.listBatches({ limit: 1, offset: 0 }),
      ]);
      setProducts(productItems);
      setOrganizations(organizationItems);
      setProductTotal(productItems.length);
      setOrganizationTotal(organizationItems.length);
      setBatchTotal(allBatches.total);
    } catch (cause: unknown) {
      setPageError(cause instanceof ApiError ? cause.message : "The dashboard could not load from the API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    let active = true;
    setHealth("checking");
    const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
    fetch(`${base}/health`)
      .then((response) => { if (active) setHealth(response.ok ? "online" : "offline"); })
      .catch(() => { if (active) setHealth("offline"); });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setTableLoading(true);
      setTableError("");
      try {
        const result = await api.listBatches({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, q: query.trim() || undefined });
        if (active) {
          setBatches(result.items);
          setFilteredTotal(result.total);
        }
      } catch (cause: unknown) {
        if (active) setTableError(cause instanceof Error ? cause.message : "Batches could not be loaded.");
      } finally {
        if (active) setTableLoading(false);
      }
    }, query ? 200 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [page, query, refreshKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function handleSaved(saved: Batch, message: string) {
    setDialog(null);
    setNotice(message);
    setQuery("");
    setPage(0);
    setRefreshKey((current) => current + 1);
    setBatches((current) => current.filter((item) => item.batch_code !== saved.batch_code));
    void loadOverview();
  }

  const shownFirst = batches.length ? page * PAGE_SIZE + 1 : 0;
  const shownLast = page * PAGE_SIZE + batches.length;
  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#dashboard" aria-label="FoodTrace Sentinel dashboard">
          <span className="brand-mark"><Icon name="leaf" /></span>
          <span className="brand-name">FoodTrace<span>Sentinel</span></span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <a className="nav-link active" href="#batches" aria-current="page"><Icon name="box" /><span>Batches</span><span className="nav-count">{loading ? "—" : batchTotal}</span></a>
        <div className="sidebar-note">
          <div className="note-icon"><Icon name="leaf" /></div>
          <strong>Trace with confidence</strong>
          <p>Keep batch records clear, connected, and ready to inspect.</p>
        </div>
        <div className="sidebar-footer"><span className={`health-dot ${health}`} />API {health === "checking" ? "checking" : health}</div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>Batch management</strong></div>
          <div className="topbar-meta"><span className="live-indicator"><span /> Live data</span><span className="avatar" aria-label="FoodTrace user">FT</span></div>
        </header>

        <div className="page-content">
          <section className="page-heading" aria-labelledby="page-title">
            <div>
              <p className="eyebrow">SUPPLY CHAIN OVERVIEW</p>
              <h1 id="page-title">Batch management</h1>
              <p className="page-subtitle">Track the products and origins connected to every batch.</p>
            </div>
            <button className="button button-primary create-button" onClick={() => setDialog({ mode: "create" })}>
              <Icon name="plus" /> Register batch
            </button>
          </section>

          {pageError ? <div className="page-error" role="alert"><span>{pageError}</span><button className="button button-secondary" onClick={() => { void loadOverview(); setRefreshKey((value) => value + 1); }}>Retry</button></div> : null}

          <section className="summary-grid" aria-label="Workspace summary">
            <article className="summary-card">
              <span className="summary-icon green"><Icon name="box" /></span>
              <div><p>Total batches</p><strong>{loading ? <span className="skeleton skeleton-number" /> : batchTotal.toLocaleString()}</strong><small>Registered in workspace</small></div>
              <span className="summary-decoration">01</span>
            </article>
            <article className="summary-card">
              <span className="summary-icon yellow"><Icon name="leaf" /></span>
              <div><p>Products</p><strong>{loading ? <span className="skeleton skeleton-number" /> : productTotal.toLocaleString()}</strong><small>Available to track</small></div>
              <span className="summary-decoration">02</span>
            </article>
            <article className="summary-card">
              <span className="summary-icon blue"><Icon name="users" /></span>
              <div><p>Organizations</p><strong>{loading ? <span className="skeleton skeleton-number" /> : organizationTotal.toLocaleString()}</strong><small>Connected origins</small></div>
              <span className="summary-decoration">03</span>
            </article>
          </section>

          <section className="table-panel" id="batches" aria-labelledby="batch-table-title">
            <div className="panel-heading">
              <div><h2 id="batch-table-title">All batches</h2><p>Search and review your registered traceability records.</p></div>
              <button className="icon-button refresh-button" onClick={() => { void loadOverview(); setRefreshKey((value) => value + 1); }} aria-label="Refresh batch data" title="Refresh"><Icon name="refresh" /></button>
            </div>
            <div className="table-toolbar">
              <label className="search-box">
                <Icon name="search" />
                <span className="sr-only">Search batches</span>
                <input type="search" placeholder="Search by code, product, or origin…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
                {query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setPage(0); }}>×</button> : null}
              </label>
              <span className="table-total">{tableLoading ? "Loading records…" : query.trim() ? `${filteredTotal.toLocaleString()} matches` : `${filteredTotal.toLocaleString()} total records`}</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Batch</th><th scope="col">Product</th><th scope="col">Origin organization</th><th scope="col">Quantity</th><th scope="col">Created</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {tableLoading && !batches.length ? <tr><td colSpan={6}><div className="table-state" role="status"><span className="spinner" /> Loading batches from your database…</div></td></tr> : null}
                  {!tableLoading && tableError ? <tr><td colSpan={6}><div className="table-state error-state" role="alert"><span>{tableError}</span><button className="button button-secondary" onClick={() => setRefreshKey((value) => value + 1)}>Try again</button></div></td></tr> : null}
                  {!tableLoading && !tableError && batches.length === 0 ? <tr><td colSpan={6}><div className="empty-state"><span className="empty-icon"><Icon name="box" /></span><strong>{query.trim() ? "No matching batches" : "No batches yet"}</strong><p>{query.trim() ? "Try another batch code, product name, or origin." : "Register your first batch to start building a traceable record."}</p>{!query.trim() ? <button className="button button-primary" onClick={() => setDialog({ mode: "create" })}><Icon name="plus" /> Register batch</button> : null}</div></td></tr> : null}
                  {!tableError && batches.map((batch) => (
                    <tr key={batch.id}>
                      <td><button className="batch-code" onClick={() => setDialog({ mode: "details", batchCode: batch.batch_code })}>{batch.batch_code}<Icon name="arrow" /></button><span className="record-id">ID {batch.id}</span></td>
                      <td><span className="cell-main">{batch.product.name}</span><span className="cell-sub">Product</span></td>
                      <td><span className="cell-main">{batch.origin_organization.name}</span><span className="cell-sub">{batch.origin_location}</span></td>
                      <td><span className="quantity-value">{batch.quantity}</span><span className="unit-pill">{batch.unit}</span></td>
                      <td><span className="date-value">{dateLabel(batch.created_at)}</span></td>
                      <td><button className="row-action" onClick={() => setDialog({ mode: "details", batchCode: batch.batch_code })} aria-label={`View ${batch.batch_code} details`} title="View details"><Icon name="arrow" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="table-footer">
              <span>Showing <strong>{shownFirst}–{shownLast}</strong> of <strong>{filteredTotal}</strong> batches</span>
              <nav className="pagination" aria-label="Batch pages">
                <button className="page-button" aria-label="Previous page" disabled={page <= 0 || tableLoading} onClick={() => setPage((current) => Math.max(0, current - 1))}>‹</button>
                <span>Page <strong>{Math.min(page + 1, pageCount)}</strong> of <strong>{pageCount}</strong></span>
                <button className="page-button" aria-label="Next page" disabled={page + 1 >= pageCount || tableLoading} onClick={() => setPage((current) => current + 1)}>›</button>
              </nav>
            </footer>
          </section>

          <footer className="app-footer"><span><Icon name="leaf" /> FoodTrace Sentinel</span><span>Batch records are served from your database.</span></footer>
        </div>
      </main>

      {notice ? <div className="toast" role="status"><span className="toast-check">✓</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div> : null}
      {dialog ? <BatchDialog key={dialog.mode === "create" ? "create" : `details-${dialog.batchCode}`} initialMode={dialog.mode} batchCode={dialog.mode === "details" ? dialog.batchCode : undefined} products={products} organizations={organizations} onClose={() => setDialog(null)} onSaved={handleSaved} /> : null}
    </div>
  );
}

export default App;
