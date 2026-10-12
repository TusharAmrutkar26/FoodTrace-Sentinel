import { useMemo, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { Organization, Product } from "../types/api";
import { translateMessage, useI18n } from "../i18n";

type CatalogKind = "products" | "organizations";

interface Props {
  kind: CatalogKind;
  products: Product[];
  organizations: Organization[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onCreated: (record: Product | Organization) => void;
}

const participantTypes = [
  "farm",
  "supplier",
  "producer",
  "processor",
  "manufacturer",
  "distributor",
  "retailer",
  "transporter",
];

export function CatalogManagement({
  kind,
  products,
  organizations,
  loading,
  error,
  onRetry,
  onCreated,
}: Props) {
  const { t, intlLocale, locale } = useI18n();
  const isProduct = kind === "products";
  const title = t(isProduct ? "Products" : "Organizations");
  const item = t(isProduct ? "Product" : "Organization").toLocaleLowerCase(intlLocale);
  const records = isProduct ? products : organizations;
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [participantType, setParticipantType] = useState("");
  const [customParticipantType, setCustomParticipantType] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return records;
    return records.filter((record) => {
      const searchText = "participant_type" in record
        ? `${record.name} ${record.participant_type ?? ""}`
        : record.name;
      return searchText.toLocaleLowerCase().includes(needle);
    });
  }, [query, records]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const type = participantType === "custom"
      ? customParticipantType.trim()
      : participantType;
    if (!cleanName) {
      setFormError(t("Enter a name before saving."));
      return;
    }
    if (!isProduct && participantType === "custom" && !type) {
      setFormError(t("Enter the custom participant type."));
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const saved = isProduct
        ? await api.createProduct({ name: cleanName })
        : await api.createOrganization({
            name: cleanName,
            participant_type: type || null,
          });
      onCreated(saved);
      setSuccess(t(isProduct ? "Product {name} was added." : "Organization {name} was added.", { name: saved.name }));
      setName("");
      setParticipantType("");
      setCustomParticipantType("");
      setShowForm(false);
    } catch (cause: unknown) {
      setFormError(cause instanceof Error ? translateMessage(locale, cause.message) : t("The {item} could not be saved.", { item }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="catalog-page" aria-labelledby="catalog-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("WORKSPACE CATALOG")}</p>
          <h1 id="catalog-title">{title}</h1>
          <p className="page-subtitle">
            {t(isProduct
              ? "Manage the product names available when registering a batch."
              : "Manage the organizations recorded as supply-chain participants.")}
          </p>
        </div>
        <button className="button button-primary create-button" onClick={() => { setShowForm((visible) => !visible); setFormError(""); }}>
          <span aria-hidden="true">{showForm ? "−" : "+"}</span> {showForm ? t("Close form") : t(isProduct ? "Add product" : "Add organization")}
        </button>
      </div>

      {success ? <div className="catalog-success" role="status">{success}</div> : null}
      {error ? (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button className="button button-secondary" onClick={onRetry}>{t("Retry")}</button>
        </div>
      ) : null}

      {showForm ? (
        <form className="catalog-form-panel" onSubmit={(event) => void handleSubmit(event)} aria-label={t("Add {item}", { item })}>
          <div className="catalog-form-heading">
            <div><p className="eyebrow">{t("NEW RECORD")}</p><h2>{t("Add {item}", { item })}</h2></div>
          </div>
          {formError ? <div className="form-error" role="alert">{formError}</div> : null}
          <div className="catalog-form-fields">
            <label className="field-label">
              <span>{t(isProduct ? "Product name" : "Organization name")}</span>
              <input
                autoFocus
                maxLength={120}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={isProduct ? t("e.g. Mango") : t("e.g. Mango Farm")}
              />
            </label>
            {!isProduct ? (
              <label className="field-label">
                <span>{t("Participant type")} <small>{t("(optional)")}</small></span>
                <select value={participantType} onChange={(event) => setParticipantType(event.target.value)}>
                  <option value="">{t("Not specified")}</option>
                  {participantTypes.map((type) => <option key={type} value={type}>{t((type[0].toUpperCase() + type.slice(1)) as "Farm")}</option>)}
                  <option value="custom">{t("Other type…")}</option>
                </select>
              </label>
            ) : null}
            {!isProduct && participantType === "custom" ? (
              <label className="field-label">
                <span>{t("Custom participant type")}</span>
                <input
                  autoFocus
                  maxLength={80}
                  required
                  value={customParticipantType}
                  onChange={(event) => setCustomParticipantType(event.target.value)}
                  placeholder={t("Enter the type accepted by your organization")}
                />
              </label>
            ) : null}
            <div className="catalog-form-actions">
              <button className="button button-secondary" type="button" onClick={() => { setShowForm(false); setFormError(""); }}>{t("Cancel")}</button>
              <button className="button button-primary" type="submit" disabled={saving}>
                {saving ? t("Saving…") : t(isProduct ? "Save product" : "Save organization")}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      <section className="catalog-panel" aria-label={`${title} list`}>
        <div className="panel-heading">
          <div><h2>{t("All {item}", { item: title.toLocaleLowerCase(intlLocale) })}</h2><p>{t("These records are loaded from the FoodTrace API.")}</p></div>
          <span className="catalog-count">{loading ? t("Loading…") : `${records.length.toLocaleString(intlLocale)} ${t(records.length === 1 ? "record" : "records")}`}</span>
        </div>
        <div className="table-toolbar catalog-toolbar">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">{t("Search {item}", { item: title.toLocaleLowerCase(intlLocale) })}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(isProduct ? "Search by product name…" : "Search by name or participant type…")} />
          </label>
          <span className="table-total">{loading ? t("Loading records…") : `${filtered.length.toLocaleString(intlLocale)} ${t("shown")}`}</span>
        </div>
        {loading ? (
          <div className="catalog-state" role="status"><span className="spinner" /> {t("Loading {item} from your database…", { item: title.toLocaleLowerCase(intlLocale) })}</div>
        ) : error ? null : filtered.length === 0 ? (
          <div className="catalog-state empty-state">
            <strong>{records.length && query.trim() ? t("No {item} match {query}", { item: title.toLocaleLowerCase(intlLocale), query: `“${query.trim()}”` }) : t("No {item} yet", { item: title.toLocaleLowerCase(intlLocale) })}</strong>
            <p>{records.length && query.trim() ? t("Try a different search.") : t(isProduct ? "Add a product to use it in batch registration." : "Add an organization to use it in batch registration.")}</p>
            {!records.length && !query.trim() ? <button className="button button-primary" onClick={() => setShowForm(true)}>{t(isProduct ? "Add product" : "Add organization")}</button> : null}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="catalog-table">
              <thead><tr><th scope="col">{t(isProduct ? "Product name" : "Organization name")}</th>{!isProduct ? <th scope="col">{t("Participant type")}</th> : null}<th scope="col">{t("Created")}</th></tr></thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id}>
                    <td><span className="cell-main">{record.name}</span><span className="cell-sub">{t("Catalog record")}</span></td>
                    {!isProduct && "participant_type" in record ? <td><span className="catalog-type">{typeof record.participant_type === "string" && record.participant_type.trim() ? record.participant_type : t("Not specified")}</span></td> : null}
                    <td><time className="date-value" dateTime={record.created_at}>{new Intl.DateTimeFormat(intlLocale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(record.created_at))}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="catalog-note">{t("Catalog names are shared by batches that reference these records. Existing records are retained.")}</p>
    </section>
  );
}
