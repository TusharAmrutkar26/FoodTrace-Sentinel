import { useCallback, useEffect, useState } from "react";
import { BatchDialog } from "./components/BatchDialog";
import { CatalogManagement } from "./components/CatalogManagement";
import { PublicBatchTracePage } from "./components/PublicBatchTracePage";
import { RecallSimulatorDashboard } from "./components/RecallSimulatorDashboard";
import { RecallIncidentsDashboard } from "./components/RecallIncidentsDashboard";
import { ReportsDashboard } from "./components/ReportsDashboard";
import { TraceTrustDashboard } from "./components/TraceTrustDashboard";
import { AuthenticationPage, AuthProvider, InviteUserDialog, useAuth } from "./auth";
import { I18nProvider, LanguageSelector, translateMessage, useI18n } from "./i18n";
import { ThemeProvider, ThemeToggle } from "./theme";
import { api } from "./lib/api";
import type { Batch, Organization, Product } from "./types/api";

const PAGE_SIZE = 10;
type WorkspaceSection = "batches" | "products" | "organizations" | "trust" | "reports" | "recalls" | "recall_incidents";

type DialogState = { mode: "create" } | { mode: "details"; batchCode: string } | null;

function dateLabel(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function Icon({ name }: { name: "leaf" | "box" | "users" | "search" | "plus" | "refresh" | "arrow" | "shield" | "report" }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths = {
    leaf: <><path d="M20.5 3.5c-9.5 0-15 4-15 10a6 6 0 0 0 6 6c6 0 9-7 9-16Z" /><path d="M4 21c2.5-5 6.5-8 12-11" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 5 9-5V8" /><path d="M12 13v9" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3" /></>,
    arrow: <><path d="m9 18 6-6-6-6" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    report: <><path d="M4 19V5M4 19h17" /><path d="M8 15v-4M13 15V8M18 15v-7" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function Dashboard() {
  const { t, intlLocale, locale } = useI18n();
  const { user, signOut, error: authError } = useAuth();
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("batches");
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
  const [catalogError, setCatalogError] = useState("");
  const [productError, setProductError] = useState("");
  const [organizationError, setOrganizationError] = useState("");
  const [health, setHealth] = useState<"checking" | "online" | "connection-issue">("checking");
  const [inviteOpen, setInviteOpen] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setPageError("");
    setCatalogError("");
    setProductError("");
    setOrganizationError("");
    const [productResult, organizationResult, batchResult] = await Promise.allSettled([
      api.listAllProducts(),
      api.listAllOrganizations(),
      api.listBatches({ limit: 1, offset: 0 }),
    ]);
    const overviewErrors: string[] = [];
    const catalogErrors: string[] = [];

    if (productResult.status === "fulfilled") {
      setProducts(productResult.value);
      setProductTotal(productResult.value.length);
    } else {
      const message = translateMessage(locale, productResult.reason instanceof Error ? productResult.reason.message : t("Products could not be loaded from the API."));
      overviewErrors.push(message);
      catalogErrors.push(message);
      setProductError(message);
    }
    if (organizationResult.status === "fulfilled") {
      setOrganizations(organizationResult.value);
      setOrganizationTotal(organizationResult.value.length);
    } else {
      const message = translateMessage(locale, organizationResult.reason instanceof Error ? organizationResult.reason.message : t("Organizations could not be loaded from the API."));
      overviewErrors.push(message);
      catalogErrors.push(message);
      setOrganizationError(message);
    }
    if (batchResult.status === "fulfilled") {
      setBatchTotal(batchResult.value.total);
    } else {
      overviewErrors.push(translateMessage(locale, batchResult.reason instanceof Error ? batchResult.reason.message : t("Batch totals could not be loaded from the API.")));
    }

    setPageError(overviewErrors.join(" "));
    setCatalogError(catalogErrors.join(" "));
    setLoading(false);
  }, [locale, t]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    let active = true;
    setHealth("checking");
    api.health()
      .then(() => { if (active) setHealth("online"); })
      .catch(() => { if (active) setHealth("connection-issue"); });
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
        if (active) setTableError(translateMessage(locale, cause instanceof Error ? cause.message : t("Batches could not be loaded.")));
      } finally {
        if (active) setTableLoading(false);
      }
    }, query ? 200 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [page, query, refreshKey, locale, t]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function handleSaved(saved: Batch, message: string) {
    setDialog({ mode: "details", batchCode: saved.batch_code });
    setNotice(message);
    setQuery("");
    setPage(0);
    setRefreshKey((current) => current + 1);
    setBatches((current) => current.filter((item) => item.batch_code !== saved.batch_code));
    void loadOverview();
  }

  function handleCatalogCreated(record: Product | Organization) {
    if ("participant_type" in record) {
      setOrganizations((current) => [...current.filter((item) => item.id !== record.id), record]);
      setOrganizationTotal((current) => current + 1);
    } else {
      setProducts((current) => [...current.filter((item) => item.id !== record.id), record]);
      setProductTotal((current) => current + 1);
    }
    void loadOverview();
  }

  const shownFirst = batches.length ? page * PAGE_SIZE + 1 : 0;
  const shownLast = page * PAGE_SIZE + batches.length;
  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label={t("Main navigation")}>
        <a className="brand" href="#dashboard" aria-label={t("FoodTrace Sentinel dashboard")}>
          <span className="brand-mark"><Icon name="leaf" /></span>
          <span className="brand-name">FoodTrace<span>Sentinel</span></span>
        </a>
        <div className="nav-label">{t("WORKSPACE")}</div>
        <nav className="workspace-nav" aria-label={t("Workspace sections")}>
          <button type="button" className={`nav-link ${activeSection === "batches" ? "active" : ""}`} aria-current={activeSection === "batches" ? "page" : undefined} onClick={() => setActiveSection("batches")}><Icon name="box" /><span>{t("Batches")}</span><span className="nav-count">{loading || pageError ? "—" : batchTotal}</span></button>
          <button type="button" className={`nav-link ${activeSection === "products" ? "active" : ""}`} aria-current={activeSection === "products" ? "page" : undefined} onClick={() => setActiveSection("products")}><Icon name="leaf" /><span>{t("Products")}</span><span className="nav-count">{loading || catalogError ? "—" : productTotal}</span></button>
          <button type="button" className={`nav-link ${activeSection === "organizations" ? "active" : ""}`} aria-current={activeSection === "organizations" ? "page" : undefined} onClick={() => setActiveSection("organizations")}><Icon name="users" /><span>{t("Organizations")}</span><span className="nav-count">{loading || catalogError ? "—" : organizationTotal}</span></button>
          <button type="button" className={`nav-link ${activeSection === "trust" ? "active" : ""}`} aria-current={activeSection === "trust" ? "page" : undefined} onClick={() => setActiveSection("trust")}><Icon name="shield" /><span>{t("TraceTrust")}</span></button>
          <button type="button" className={`nav-link ${activeSection === "reports" ? "active" : ""}`} aria-current={activeSection === "reports" ? "page" : undefined} onClick={() => setActiveSection("reports")}><Icon name="report" /><span>{t("Reports")}</span></button>
          <button type="button" className={`nav-link ${activeSection === "recalls" ? "active" : ""}`} aria-current={activeSection === "recalls" ? "page" : undefined} onClick={() => setActiveSection("recalls")}><Icon name="shield" /><span>{t("Recall simulator")}</span></button>
          <button type="button" className={`nav-link ${activeSection === "recall_incidents" ? "active" : ""}`} aria-current={activeSection === "recall_incidents" ? "page" : undefined} onClick={() => setActiveSection("recall_incidents")}><Icon name="shield" /><span>{t("Recall incidents")}</span></button>
        </nav>
        <div className="sidebar-note">
          <div className="note-icon"><Icon name="leaf" /></div>
          <strong>{t("Trace with confidence")}</strong>
          <p>{t("Keep batch records clear, connected, and ready to inspect.")}</p>
        </div>
        <div className="sidebar-footer"><span className={`health-dot ${health}`} />API {t(health === "checking" ? "checking" : health === "online" ? "online" : "connection issue")}</div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div className="breadcrumb">{t("Workspace")} <span>/</span> <strong>{t(activeSection === "batches" ? "Batch management" : activeSection === "products" ? "Product management" : activeSection === "organizations" ? "Organization management" : activeSection === "reports" ? "Supply-chain reports" : activeSection === "recalls" ? "Recall simulator" : activeSection === "recall_incidents" ? "Recall incidents" : "TraceTrust")}</strong></div>
          <div className="topbar-meta"><span className="live-indicator"><span /> {t("Live data")}</span><LanguageSelector /><ThemeToggle />
            <div className="user-session"><span className="user-session-email">{user?.email}</span><span className="user-session-role">{t(user?.role ?? "viewer")} · {user?.organization?.name ?? t("Platform-wide")}</span></div>
            {user && ["platform_admin", "org_admin"].includes(user.role) ? <button className="button button-secondary invite-button" onClick={() => setInviteOpen(true)}>{t("Invite user")}</button> : null}
            <button className="button button-secondary signout-button" onClick={() => void signOut().catch(() => undefined)}>{t("Sign out")}</button>
          </div>
          {authError ? <div className="auth-error session-action-error" role="alert">{translateMessage(locale, authError)}</div> : null}
        </header>

        <div className="page-content">
          {activeSection === "trust" ? <TraceTrustDashboard onOpenBatch={(batchCode) => { setActiveSection("batches"); setDialog({ mode: "details", batchCode }); }} /> : activeSection === "reports" ? <ReportsDashboard /> : activeSection === "recalls" ? <RecallSimulatorDashboard /> : activeSection === "recall_incidents" ? <RecallIncidentsDashboard /> : activeSection === "batches" ? <>
          <section className="page-heading" aria-labelledby="page-title">
            <div>
              <p className="eyebrow">{t("SUPPLY CHAIN OVERVIEW")}</p>
              <h1 id="page-title">{t("Batch management")}</h1>
              <p className="page-subtitle">{t("Track the products and origins connected to every batch.")}</p>
            </div>
            <button className="button button-primary create-button" onClick={() => setDialog({ mode: "create" })}>
              <Icon name="plus" /> {t("Register batch")}
            </button>
          </section>

          {pageError ? <div className="page-error" role="alert"><span>{pageError}</span><button className="button button-secondary" onClick={() => { void loadOverview(); setRefreshKey((value) => value + 1); }}>{t("Retry")}</button></div> : null}

          <section className="summary-grid" aria-label={t("Workspace summary")}>
            <article className="summary-card">
              <span className="summary-icon green"><Icon name="box" /></span>
              <div><p>{t("Total batches")}</p><strong>{loading ? <span className="skeleton skeleton-number" /> : pageError ? "—" : batchTotal.toLocaleString(intlLocale)}</strong><small>{t("Registered in workspace")}</small></div>
              <span className="summary-decoration">01</span>
            </article>
            <article className="summary-card">
              <span className="summary-icon yellow"><Icon name="leaf" /></span>
              <div><p>{t("Products")}</p><strong>{loading ? <span className="skeleton skeleton-number" /> : pageError ? "—" : productTotal.toLocaleString(intlLocale)}</strong><small>{t("Available to track")}</small></div>
              <span className="summary-decoration">02</span>
            </article>
            <article className="summary-card">
              <span className="summary-icon blue"><Icon name="users" /></span>
              <div><p>{t("Organizations")}</p><strong>{loading ? <span className="skeleton skeleton-number" /> : pageError ? "—" : organizationTotal.toLocaleString(intlLocale)}</strong><small>{t("Connected origins")}</small></div>
              <span className="summary-decoration">03</span>
            </article>
          </section>

          <section className="table-panel" id="batches" aria-labelledby="batch-table-title">
            <div className="panel-heading">
              <div><h2 id="batch-table-title">{t("All batches")}</h2><p>{t("Search and review your registered traceability records.")}</p></div>
              <button className="icon-button refresh-button" onClick={() => { void loadOverview(); setRefreshKey((value) => value + 1); }} aria-label={t("Refresh batch data")} title={t("Refresh")}><Icon name="refresh" /></button>
            </div>
            <div className="table-toolbar">
              <label className="search-box">
                <Icon name="search" />
                <span className="sr-only">{t("Search batches")}</span>
                <input type="search" placeholder={t("Search by code, product, or origin…")} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
                {query ? <button type="button" aria-label={t("Clear search")} onClick={() => { setQuery(""); setPage(0); }}>×</button> : null}
              </label>
              <span className="table-total">{tableLoading ? t("Loading records…") : query.trim() ? `${filteredTotal.toLocaleString(intlLocale)} ${t("matches")}` : `${filteredTotal.toLocaleString(intlLocale)} ${t("total records")}`}</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">{t("Batch")}</th><th scope="col">{t("Product")}</th><th scope="col">{t("Origin organization")}</th><th scope="col">{t("Quantity")}</th><th scope="col">{t("Created")}</th><th scope="col"><span className="sr-only">{t("Actions")}</span></th></tr></thead>
                <tbody>
                  {tableLoading && !batches.length ? <tr><td colSpan={6}><div className="table-state" role="status"><span className="spinner" /> {t("Loading batches from your database…")}</div></td></tr> : null}
                  {!tableLoading && tableError ? <tr><td colSpan={6}><div className="table-state error-state" role="alert"><span>{tableError}</span><button className="button button-secondary" onClick={() => setRefreshKey((value) => value + 1)}>{t("Try again")}</button></div></td></tr> : null}
                  {!tableLoading && !tableError && batches.length === 0 ? <tr><td colSpan={6}><div className="empty-state"><span className="empty-icon"><Icon name="box" /></span><strong>{query.trim() ? t("No matching batches") : t("No batches yet")}</strong><p>{query.trim() ? t("Try another batch code, product name, or origin.") : t("Register your first batch to start building a traceable record.")}</p>{!query.trim() ? <button className="button button-primary" onClick={() => setDialog({ mode: "create" })}><Icon name="plus" /> {t("Register batch")}</button> : null}</div></td></tr> : null}
                  {!tableError && batches.map((batch) => (
                    <tr key={batch.id}>
                      <td><button className="batch-code" onClick={() => setDialog({ mode: "details", batchCode: batch.batch_code })}>{batch.batch_code}<Icon name="arrow" /></button><span className="record-id">ID {batch.id}</span></td>
                      <td><span className="cell-main">{batch.product.name}</span><span className="cell-sub">{t("Product")}</span></td>
                      <td><span className="cell-main">{batch.origin_organization.name}</span><span className="cell-sub">{batch.origin_location}</span></td>
                      <td><span className="quantity-value">{batch.quantity}</span><span className="unit-pill">{batch.unit}</span></td>
                      <td><span className="date-value">{dateLabel(batch.created_at, intlLocale)}</span></td>
                      <td><button className="row-action" onClick={() => setDialog({ mode: "details", batchCode: batch.batch_code })} aria-label={`${t("View details")}: ${batch.batch_code}`} title={t("View details")}><Icon name="arrow" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="table-footer">
              <span>{t("Showing")} <strong>{shownFirst}–{shownLast}</strong> {t("of")} <strong>{filteredTotal}</strong> {t("batches")}</span>
              <nav className="pagination" aria-label={t("Batch pages")}>
                <button className="page-button" aria-label={t("Previous page")} disabled={page <= 0 || tableLoading} onClick={() => setPage((current) => Math.max(0, current - 1))}>‹</button>
                <span>{t("Page")} <strong>{Math.min(page + 1, pageCount)}</strong> {t("of")} <strong>{pageCount}</strong></span>
                <button className="page-button" aria-label={t("Next page")} disabled={page + 1 >= pageCount || tableLoading} onClick={() => setPage((current) => current + 1)}>›</button>
              </nav>
            </footer>
          </section>

          <footer className="app-footer"><span><Icon name="leaf" /> FoodTrace Sentinel</span><span>{t("Batch records are served from your database.")}</span></footer>
          </> : (
            <CatalogManagement
              kind={activeSection}
              products={products}
              organizations={organizations}
              loading={loading}
              error={activeSection === "products" ? productError : organizationError}
              onRetry={() => void loadOverview()}
              onCreated={handleCatalogCreated}
            />
          )}
        </div>
      </main>

      {notice ? <div className="toast" role="status"><span className="toast-check">✓</span>{notice}<button onClick={() => setNotice("")} aria-label={t("Dismiss message")}>×</button></div> : null}
      {dialog ? <BatchDialog key={dialog.mode === "create" ? "create" : `details-${dialog.batchCode}`} initialMode={dialog.mode} batchCode={dialog.mode === "details" ? dialog.batchCode : undefined} products={products} organizations={organizations} catalogLoading={loading} catalogError={catalogError} onRetryCatalogs={() => void loadOverview()} onClose={() => setDialog(null)} onSaved={handleSaved} /> : null}
      {inviteOpen && user ? <InviteUserDialog organizationId={user.organization?.id} isPlatformAdmin={user.role === "platform_admin"} onClose={() => setInviteOpen(false)} /> : null}
    </div>
  );
}

function invitationFromHash(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get("invite")?.trim() ?? "";
}

function AppContent() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [invitationToken, setInvitationToken] = useState(() => invitationFromHash(window.location.hash));

  useEffect(() => {
    const updatePath = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", updatePath);
    const updateInvitation = () => setInvitationToken(invitationFromHash(window.location.hash));
    window.addEventListener("hashchange", updateInvitation);
    return () => {
      window.removeEventListener("popstate", updatePath);
      window.removeEventListener("hashchange", updateInvitation);
    };
  }, []);

  if (pathname === "/trace" || pathname.startsWith("/trace/")) {
    const match = pathname.match(/^\/trace\/([^/]+)\/?$/);
    let traceId = "";
    if (match) {
      try {
        traceId = decodeURIComponent(match[1]);
      } catch {
        traceId = "";
      }
    }
    return <PublicBatchTracePage key={traceId || pathname} traceId={traceId} />;
  }

  return <AuthProvider><ProtectedWorkspace invitationToken={invitationToken} registrationRequested={pathname === "/register"} /></AuthProvider>;
}

function ProtectedWorkspace({ invitationToken, registrationRequested }: { invitationToken: string; registrationRequested: boolean }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  if (loading) return <main className="auth-page"><div className="auth-loading" role="status">{t("Checking your session…")} <LanguageSelector /><ThemeToggle /></div></main>;
  if (!user) return <AuthenticationPage key="authentication" invitationToken={invitationToken} registrationRequested={registrationRequested} />;
  return <Dashboard key="authenticated-dashboard" />;
}

function App() {
  return <ThemeProvider><I18nProvider><AppContent /></I18nProvider></ThemeProvider>;
}

export default App;
