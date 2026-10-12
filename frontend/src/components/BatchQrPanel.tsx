import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { BatchQrIdentity } from "../types/api";
import { translateMessage, useI18n } from "../i18n";

export function BatchQrPanel({ batchCode }: { batchCode: string }) {
  const { t, locale } = useI18n();
  const [identity, setIdentity] = useState<BatchQrIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setImageError(false);
    api.getBatchQrIdentity(batchCode)
      .then((result) => active && setIdentity(result))
      .catch((cause: unknown) => {
        if (active) setError(translateMessage(locale, cause instanceof ApiError ? cause.message : t("The QR code could not be loaded.")));
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [batchCode, retryKey]);

  return (
    <section className="batch-qr-panel" aria-labelledby="batch-qr-title">
      <div className="qr-copy">
        <p className="eyebrow">{t("BATCH IDENTITY")}</p>
        <h3 id="batch-qr-title">{t("Scan to view this trace")}</h3>
        <p>{t("This QR opens the public trace page. It is a lookup link, not proof of physical product authenticity.")}</p>
      </div>
      {loading ? <p className="qr-status" role="status"><span className="spinner" /> {t("Preparing QR code…")}</p> : null}
      {!loading && error ? (
        <div className="qr-error" role="alert">
          <span>{error}</span>
          <button className="button button-secondary" type="button" onClick={() => setRetryKey((value) => value + 1)}>{t("Retry")}</button>
        </div>
      ) : null}
      {!loading && !error && identity ? (
        <div className="qr-output">
          {imageError ? (
            <div className="qr-image-error" role="alert">{t("QR image could not be displayed.")}</div>
          ) : (
            <img
              className="batch-qr-image"
              src={api.batchQrSvgUrl(batchCode)}
              alt={`${t("QR code for batch {code}", { code: batchCode })}`}
              onError={() => setImageError(true)}
            />
          )}
          <code className="qr-url">{identity.trace_url}</code>
          <a className="button button-secondary qr-open-link" href={identity.trace_url} target="_blank" rel="noreferrer">
            {t("Open public trace page")}
          </a>
        </div>
      ) : null}
    </section>
  );
}
