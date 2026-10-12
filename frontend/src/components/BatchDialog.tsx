import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BatchActivity } from "./BatchActivity";
import { BatchQrPanel } from "./BatchQrPanel";
import { api, ApiError } from "../lib/api";
import { UNITS, type Batch, type BatchCreateInput, type BatchUpdateInput, type Organization, type Product } from "../types/api";
import { translateMessage, translateOrFallback, useI18n } from "../i18n";

type DialogMode = "create" | "details";
type FormState = {
  batch_code: string;
  product_id: string;
  origin_organization_id: string;
  origin_location: string;
  quantity: string;
  unit: (typeof UNITS)[number];
};

const emptyForm: FormState = {
  batch_code: "",
  product_id: "",
  origin_organization_id: "",
  origin_location: "",
  quantity: "",
  unit: "kg",
};

function toForm(batch: Batch): FormState {
  return {
    batch_code: batch.batch_code,
    product_id: String(batch.product.id),
    origin_organization_id: String(batch.origin_organization.id),
    origin_location: batch.origin_location,
    quantity: batch.quantity,
    unit: batch.unit,
  };
}

function isPositiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
}

function displayDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

interface BatchDialogProps {
  initialMode: DialogMode;
  batchCode?: string;
  products: Product[];
  organizations: Organization[];
  catalogLoading: boolean;
  catalogError: string;
  onRetryCatalogs: () => void;
  onClose: () => void;
  onSaved: (batch: Batch, message: string) => void;
}

export function BatchDialog({ initialMode, batchCode, products, organizations, catalogLoading, catalogError, onRetryCatalogs, onClose, onSaved }: BatchDialogProps) {
  const { t, intlLocale, locale } = useI18n();
  const [mode] = useState<DialogMode>(initialMode);
  const [editing, setEditing] = useState(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(initialMode === "details");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const title = useMemo(() => {
    if (mode === "create") return t("Register a batch");
    if (editing) return `${t("Edit batch")} ${batch?.batch_code ?? t("Batch")}`;
    return t("Batch details");
  }, [batch?.batch_code, editing, mode, t]);

  useEffect(() => {
    if (mode !== "details" || !batchCode) return;
    let active = true;
    setLoading(true);
    api.getBatch(batchCode)
      .then((item) => {
        if (!active) return;
        setBatch(item);
        setForm(toForm(item));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? translateMessage(locale, cause.message) : t("Unable to load this batch."));
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [batchCode, mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  useEffect(() => {
    if (mode !== "create") return;
    setForm((current) => ({
      ...current,
      product_id: current.product_id || (products[0] ? String(products[0].id) : ""),
      origin_organization_id: current.origin_organization_id || (organizations[0] ? String(organizations[0].id) : ""),
    }));
  }, [mode, organizations, products]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
    setError("");
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (mode === "create") {
      if (!form.batch_code.trim()) errors.batch_code = t("Enter a batch code.");
      else if (form.batch_code.trim().length > 64 || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(form.batch_code.trim())) {
        errors.batch_code = t("Use letters, numbers, and single hyphens between groups (up to 64 characters).");
      }
    }
    if (!form.product_id || !products.some((item) => item.id === Number(form.product_id))) errors.product_id = t("Choose an available product.");
    if (!form.origin_organization_id || !organizations.some((item) => item.id === Number(form.origin_organization_id))) {
      errors.origin_organization_id = t("Choose an available organization.");
    }
    if (!form.origin_location.trim()) errors.origin_location = t("Enter the batch origin location.");
    if (form.origin_location.trim().length > 240) errors.origin_location = t("Location must be 240 characters or fewer.");
    if (!isPositiveDecimal(form.quantity)) errors.quantity = t("Enter a positive decimal, for example 100.000.");
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError(t("Review the highlighted fields and try again."));
      return;
    }
    setSaving(true);
    setError("");
    try {
      let saved: Batch;
      if (mode === "create") {
        const payload: BatchCreateInput = {
          batch_code: form.batch_code.trim(),
          product_id: Number(form.product_id),
          origin_organization_id: Number(form.origin_organization_id),
          origin_location: form.origin_location.trim(),
          quantity: form.quantity,
          unit: form.unit,
        };
        saved = await api.createBatch(payload);
        onSaved(saved, t("Batch {code} was created.", { code: saved.batch_code }));
      } else if (batch) {
        const payload: BatchUpdateInput = {
          product_id: Number(form.product_id),
          origin_organization_id: Number(form.origin_organization_id),
          origin_location: form.origin_location.trim(),
          quantity: form.quantity,
          unit: form.unit,
        };
        saved = await api.updateBatch(batch.batch_code, payload);
        onSaved(saved, t("Batch {code} was updated.", { code: saved.batch_code }));
      }
    } catch (cause: unknown) {
      if (cause instanceof ApiError) {
        setError(translateMessage(locale, cause.message));
        setFieldErrors(Object.fromEntries(Object.entries(cause.fields).map(([key, value]) => [key, translateOrFallback(locale, value)])));
      } else {
        setError(cause instanceof Error ? translateMessage(locale, cause.message) : t("The batch could not be saved."));
      }
    } finally {
      setSaving(false);
    }
  }

  function beginEditing() {
    if (!batch) return;
    setForm(toForm(batch));
    setFieldErrors({});
    setError("");
    setEditing(true);
  }

  const canCreate = products.length > 0 && organizations.length > 0 && !catalogLoading && !catalogError;

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="batch-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{t("Batch management")}</p>
            <h2 id="batch-dialog-title">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Close dialog")} disabled={saving}>×</button>
        </header>

        {loading ? <div className="dialog-loading" role="status"><span className="spinner" /> {t("Loading batch…")}</div> : null}

        {!loading && mode === "details" && !editing && batch ? (
          <div className="detail-content">
            <div className="detail-code"><span className="status-dot" />{batch.batch_code}</div>
            <dl className="detail-grid">
              <div><dt>{t("Product")}</dt><dd>{batch.product.name}</dd></div>
              <div><dt>{t("Origin organization")}</dt><dd>{batch.origin_organization.name}<small>{batch.origin_organization.participant_type ?? t("Organization")}</small></dd></div>
              <div><dt>{t("Origin location")}</dt><dd>{batch.origin_location}</dd></div>
              <div><dt>{t("Quantity")}</dt><dd>{batch.quantity} <span className="unit-value">{batch.unit}</span></dd></div>
              <div><dt>{t("Created")}</dt><dd>{displayDate(batch.created_at, intlLocale)}</dd></div>
              <div><dt>{t("Last updated")}</dt><dd>{displayDate(batch.updated_at, intlLocale)}</dd></div>
            </dl>
            <BatchQrPanel batchCode={batch.batch_code} />
            <BatchActivity batchCode={batch.batch_code} organizations={organizations} />
            <div className="dialog-actions">
              <button type="button" className="button button-secondary" onClick={onClose}>{t("Close")}</button>
              <button type="button" className="button button-primary" onClick={beginEditing}>{t("Edit batch")}</button>
            </div>
          </div>
        ) : null}

        {!loading && (mode === "create" || editing) ? (
          <form className="batch-form" onSubmit={handleSubmit} noValidate>
            {mode === "create" && catalogLoading ? (
              <div className="callout" role="status"><span className="spinner" /> {t("Loading products and organizations from the API…")}</div>
            ) : null}
            {mode === "create" && !catalogLoading && catalogError ? (
              <div className="callout catalog-error" role="alert">
                <span>{t("Product and organization options could not be loaded: ")}{catalogError}</span>
                <button className="button button-secondary" type="button" onClick={onRetryCatalogs}>{t("Retry catalog request")}</button>
              </div>
            ) : null}
            {mode === "create" && !catalogLoading && !catalogError && !canCreate ? (
              <div className="callout" role="status">{t("Create at least one product and one organization in the API before registering a batch.")}</div>
            ) : null}
            {mode === "create" ? (
              <label className="field">
                <span>{t("Batch code")} <em>{t("Required")}</em></span>
                <input autoFocus value={form.batch_code} onChange={(event) => updateField("batch_code", event.target.value)} placeholder="e.g. MANGO-2026-001" maxLength={64} aria-invalid={Boolean(fieldErrors.batch_code)} aria-describedby={fieldErrors.batch_code ? "batch_code-error" : "batch_code-hint"} />
                {fieldErrors.batch_code ? <small className="field-error" id="batch_code-error">{fieldErrors.batch_code}</small> : <small id="batch_code-hint">{t("Letters, numbers, and hyphens. Codes cannot be changed later.")}</small>}
              </label>
            ) : <div className="immutable-code"><span>{t("Batch code")}</span><strong>{batch?.batch_code}</strong><small>{t("Batch codes are immutable.")}</small></div>}

            <div className="form-row">
              <label className="field">
                <span>{t("Product")} <em>{t("Required")}</em></span>
                <select value={form.product_id} onChange={(event) => updateField("product_id", event.target.value)} aria-invalid={Boolean(fieldErrors.product_id)}>
                  <option value="">{t("Select a product")}</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
                {fieldErrors.product_id ? <small className="field-error">{fieldErrors.product_id}</small> : null}
              </label>
              <label className="field">
                <span>{t("Origin organization")} <em>{t("Required")}</em></span>
                <select value={form.origin_organization_id} onChange={(event) => updateField("origin_organization_id", event.target.value)} aria-invalid={Boolean(fieldErrors.origin_organization_id)}>
                  <option value="">{t("Select an organization")}</option>
                  {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
                </select>
                {fieldErrors.origin_organization_id ? <small className="field-error">{fieldErrors.origin_organization_id}</small> : null}
              </label>
            </div>

            <label className="field">
              <span>{t("Origin location")} <em>{t("Required")}</em></span>
              <input value={form.origin_location} onChange={(event) => updateField("origin_location", event.target.value)} placeholder={t("Town, region, or facility")} maxLength={240} aria-invalid={Boolean(fieldErrors.origin_location)} />
              {fieldErrors.origin_location ? <small className="field-error">{fieldErrors.origin_location}</small> : null}
            </label>

            <div className="form-row quantity-row">
              <label className="field">
                <span>{t("Quantity")} <em>{t("Required")}</em></span>
                <input inputMode="decimal" value={form.quantity} onChange={(event) => updateField("quantity", event.target.value)} placeholder="100.000" aria-invalid={Boolean(fieldErrors.quantity)} />
                {fieldErrors.quantity ? <small className="field-error">{fieldErrors.quantity}</small> : <small>{t("Stored exactly as entered; use a plain decimal.")}</small>}
              </label>
              <label className="field field-unit">
                <span>{t("Unit")}</span>
                <select value={form.unit} onChange={(event) => updateField("unit", event.target.value as FormState["unit"])}>
                  {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </label>
            </div>

            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <div className="dialog-actions">
              {editing ? <button className="button button-secondary" type="button" onClick={() => { setEditing(false); setError(""); setFieldErrors({}); }} disabled={saving}>{t("Cancel")}</button> : <button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>{t("Cancel")}</button>}
              <button className="button button-primary" type="submit" disabled={saving || (mode === "create" && !canCreate)}>{saving ? <><span className="spinner spinner-light" /> {t("Saving…")}</> : mode === "create" ? t("Create batch") : t("Save changes")}</button>
            </div>
          </form>
        ) : null}

        {!loading && mode === "details" && !batch ? <div className="dialog-error" role="alert">{error || t("This batch could not be found.")}</div> : null}
        {!loading && mode === "create" && error ? <div className="sr-only" role="alert">{error}</div> : null}
      </section>
    </div>
  );
}
