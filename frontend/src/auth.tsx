import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { LanguageSelector, translateMessage, useI18n } from "./i18n";
import { ThemeToggle } from "./theme";
import { api, ApiError } from "./lib/api";
import type { AuthUser, Organization, UserInvitation, UserRole } from "./types/api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string;
  signIn(email: string, password: string): Promise<void>;
  register(email: string, password: string, invitationToken?: string): Promise<void>;
  signOut(): Promise<void>;
  retrySession(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function authFailure(error: unknown): string {
  return error instanceof Error ? error.message : "Authentication request failed.";
}

function sessionFailure(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return "The authentication API route was not found. Check that the FastAPI server includes Phase 12 routes and that Vite targets the correct backend port.";
  }
  return authFailure(error);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const retrySession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await api.getSession();
      setUser(session.user);
    } catch (cause: unknown) {
      if (cause instanceof ApiError && cause.status === 401) {
        setUser(null);
        setError("");
      } else {
        setUser(null);
        setError(sessionFailure(cause));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const handleExpired = () => {
      if (active) {
        setUser(null);
        setError("Your session expired. Sign in again.");
      }
    };
    window.addEventListener("foodtrace:authentication-expired", handleExpired);
    void api.getSession().then((session) => {
      if (active) setUser(session.user);
    }).catch((cause: unknown) => {
      if (!active) return;
      if (cause instanceof ApiError && cause.status === 401) {
        setUser(null);
        setError("");
      } else {
        setUser(null);
        setError(sessionFailure(cause));
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      window.removeEventListener("foodtrace:authentication-expired", handleExpired);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError("");
    const session = await api.login({ email, password });
    setUser(session.user);
  }, []);
  const register = useCallback(async (email: string, password: string, invitationToken?: string) => {
    setError("");
    const session = invitationToken
      ? await api.registerWithInvitation({ invitation_token: invitationToken, password })
      : await api.register({ email, password });
    setUser(session.user);
  }, []);
  const signOut = useCallback(async () => {
    setError("");
    try {
      await api.logout();
      setUser(null);
    } catch (cause: unknown) {
      setError(authFailure(cause));
      throw cause;
    }
  }, []);

  const value = useMemo(() => ({ user, loading, error, signIn, register, signOut, retrySession }), [
    user, loading, error, signIn, register, signOut, retrySession,
  ]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function AuthenticationPage({
  invitationToken: initialInvitationToken = "",
  registrationRequested = false,
}: {
  invitationToken?: string;
  registrationRequested?: boolean;
}) {
  const { t, locale } = useI18n();
  const { error: sessionError, signIn, register, retrySession } = useAuth();
  const [registrationMode, setRegistrationMode] = useState(Boolean(initialInvitationToken) || registrationRequested);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitationToken, setInvitationToken] = useState(initialInvitationToken);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const acceptingInvitation = registrationMode && Boolean(invitationToken.trim());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      if (registrationMode) {
        await register(email, password, acceptingInvitation ? invitationToken.trim() : undefined);
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      } else await signIn(email, password);
    } catch (cause: unknown) {
      setFormError(translateMessage(locale, authFailure(cause)));
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-card-top"><span className="brand-mark" aria-hidden="true">FS</span><div className="header-controls"><LanguageSelector /><ThemeToggle /></div></div>
      <p className="eyebrow">{t("FOOD SUPPLY CHAIN TRACEABILITY")}</p>
      <h1 id="auth-title">{registrationMode ? acceptingInvitation ? t("Accept invitation") : t("Create account") : t("Sign in to FoodTrace Sentinel")}</h1>
      <p className="auth-intro">{registrationMode
        ? acceptingInvitation
          ? t("Create an account using a valid invitation. This application does not send invitation emails.")
          : t("Create an account without an invitation. New accounts start without an organization and cannot access private organization records until authorized to join.")
        : t("Use your organization account to access private records.")}</p>
      {sessionError ? <div className="auth-error" role="alert">{translateMessage(locale, sessionError)} <button className="auth-retry" type="button" onClick={() => void retrySession()}>{t("Retry")}</button></div> : null}
      {formError ? <div className="auth-error" role="alert">{formError}</div> : null}
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        {acceptingInvitation ? <label>{t("Invitation token")}
          <input autoComplete="one-time-code" required value={invitationToken} onChange={(event) => setInvitationToken(event.target.value)} />
        </label> : <label>{t("Email address")}
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>}
        <label>{t("Password")}
          <input type="password" autoComplete={registrationMode ? "new-password" : "current-password"} minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} />
          {registrationMode ? <small>{t("Use 12 to 128 characters.")}</small> : null}
        </label>
        <button className="button button-primary auth-submit" type="submit" disabled={submitting}>
          {submitting ? t("Please wait…") : registrationMode ? t("Create account") : t("Sign in")}
        </button>
      </form>
      <button className="auth-mode-switch" type="button" onClick={() => { setRegistrationMode((value) => !value); setFormError(""); }}>
        {registrationMode ? t("Return to sign in") : t("Create account")}
      </button>
      <p className="auth-security-note">{t("Passwords are stored as secure hashes. Sessions use an HTTP-only cookie and are revoked when you sign out.")}</p>
    </section>
  </main>;
}

export function InviteUserDialog({
  organizationId,
  isPlatformAdmin,
  onClose,
}: {
  organizationId?: number;
  isPlatformAdmin: boolean;
  onClose(): void;
}) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<UserRole, "platform_admin">>("operator");
  const [selectedOrganization, setSelectedOrganization] = useState(organizationId ? String(organizationId) : "");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loadingOrganizations, setLoadingOrganizations] = useState(isPlatformAdmin);
  const [invitation, setInvitation] = useState<UserInvitation | null>(null);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    let active = true;
    setLoadingOrganizations(true);
    api.listAllOrganizations().then((items) => {
      if (!active) return;
      setOrganizations(items);
      setSelectedOrganization((current) => current || (items[0] ? String(items[0].id) : ""));
    }).catch((cause: unknown) => {
      if (active) setError(translateMessage(locale, authFailure(cause)));
    }).finally(() => { if (active) setLoadingOrganizations(false); });
    return () => { active = false; };
  }, [isPlatformAdmin, locale]);

  const invitationUrl = invitation
    ? `${window.location.origin}/register#invite=${encodeURIComponent(invitation.invitation_token)}`
    : "";

  async function copyInvitationValue(value: string, kind: "token" | "link") {
    setCopyNotice("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is unavailable");
      await navigator.clipboard.writeText(value);
      setCopyNotice(t(kind === "token" ? "Invitation token copied." : "Invitation link copied."));
    } catch {
      setCopyNotice(t("Clipboard access is unavailable. Select the field text and copy it manually."));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload: { email: string; role: Exclude<UserRole, "platform_admin">; organization_id?: number } = { email, role };
      if (isPlatformAdmin) {
        if (!selectedOrganization || !organizations.some((organization) => organization.id === Number(selectedOrganization))) {
          throw new Error("Select an existing organization.");
        }
        payload.organization_id = Number(selectedOrganization);
      }
      setInvitation(await api.createInvitation(payload));
    } catch (cause: unknown) {
      setError(translateMessage(locale, authFailure(cause)));
    } finally {
      setSaving(false);
    }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="auth-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <button className="dialog-close" type="button" aria-label={t("Close dialog")} onClick={onClose}>×</button>
      <p className="eyebrow">{t("ACCESS CONTROL")}</p>
      <h2 id="invite-title">{t("Invite a user")}</h2>
      {invitation ? <div className="invitation-result" role="status">
        <strong>{t("Invitation created")}</strong>
        <p>{t("Share this one-time token with {email}. It expires at {expires_at}. No email was sent.", { email: invitation.email, expires_at: new Date(invitation.expires_at).toLocaleString() })}</p>
        <label>{t("Invitation token")}<div className="invitation-copy-row"><input aria-label={t("Invitation token")} readOnly value={invitation.invitation_token} onFocus={(event) => event.currentTarget.select()} /><button className="button button-secondary" type="button" onClick={() => void copyInvitationValue(invitation.invitation_token, "token")}>{t("Copy token")}</button></div></label>
        <label>{t("Invitation link")}<div className="invitation-copy-row"><input readOnly value={invitationUrl} onFocus={(event) => event.currentTarget.select()} /><button className="button button-secondary" type="button" onClick={() => void copyInvitationValue(invitationUrl, "link")}>{t("Copy link")}</button></div></label>
        {copyNotice ? <p className="copy-notice">{copyNotice}</p> : null}
        <p>{t("Open this link to accept the invitation. The token is carried in the page fragment and is not sent in the HTTP request.")}</p>
        <p>{t("This token is shown once. Keep it private and share it through a trusted channel.")}</p>
        <button className="button button-secondary" type="button" onClick={onClose}>{t("Done")}</button>
      </div> : <form className="auth-form" onSubmit={(event) => void submit(event)}>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        <label>{t("Email address")}<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>{t("Role")}
          <select value={role} onChange={(event) => setRole(event.target.value as Exclude<UserRole, "platform_admin">)}>
            {isPlatformAdmin ? <option value="org_admin">{t("Organization administrator")}</option> : null}
            <option value="operator">{t("Operator")}</option>
            <option value="reviewer">{t("Reviewer")}</option>
            <option value="viewer">{t("Viewer")}</option>
          </select>
        </label>
        {isPlatformAdmin ? <label>{t("Organization")}
          <select required disabled={loadingOrganizations || organizations.length === 0} value={selectedOrganization} onChange={(event) => setSelectedOrganization(event.target.value)}>
            <option value="">{loadingOrganizations ? t("Loading organizations…") : t("Select an organization")}</option>
            {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
          </select>
        </label> : null}
        <p className="auth-security-note">{t("Invitations are created by an administrator and expire after the configured period. No email verification is sent.")}</p>
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>{t("Cancel")}</button>
          <button className="button button-primary" disabled={saving || (isPlatformAdmin && (loadingOrganizations || organizations.length === 0))} type="submit">{saving ? t("Please wait…") : t("Create invitation")}</button></div>
      </form>}
    </section>
  </div>;
}
