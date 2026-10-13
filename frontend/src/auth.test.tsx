import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import App from "./App";
import { AuthProvider, AuthenticationPage, InviteUserDialog, useAuth } from "./auth";
import { I18nProvider } from "./i18n";
import { ThemeProvider } from "./theme";
import { api, ApiError } from "./lib/api";
import type { AuthSession } from "./types/api";

vi.mock("./lib/api", () => ({
  api: {
    getSession: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    registerWithInvitation: vi.fn(),
    logout: vi.fn(),
    createInvitation: vi.fn(),
    listAllOrganizations: vi.fn(),
    listAllProducts: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    fields: Record<string, string> = {};
    constructor(message = "API error", status = 400) { super(message); this.status = status; }
  },
}));

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

const signedIn: AuthSession = {
  user: {
    email: "reviewer@example.test",
    role: "reviewer",
    organization: { id: 17, name: "Test Orchard" },
  },
  csrf_token: "csrf-test-token",
};

function AuthStatus() {
  const { user, signOut, error } = useAuth();
  return <div>
    <span>{user?.email ?? "signed out"}</span>
    <button onClick={() => void signOut().catch(() => undefined)}>Sign out</button>
    {error ? <div role="alert">{error}</div> : null}
  </div>;
}

function renderWithProviders(children: ReactNode) {
  return render(<ThemeProvider><I18nProvider><AuthProvider>{children}</AuthProvider></I18nProvider></ThemeProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.mocked(api.getSession).mockRejectedValue(new ApiError("Authentication is required", 401));
  vi.mocked(api.login).mockResolvedValue(signedIn);
  vi.mocked(api.register).mockResolvedValue({
    ...signedIn,
    user: { ...signedIn.user, role: "viewer", organization: null },
  });
  vi.mocked(api.registerWithInvitation).mockResolvedValue(signedIn);
  vi.mocked(api.logout).mockResolvedValue(undefined);
  vi.mocked(api.listAllOrganizations).mockResolvedValue([
    { id: 17, name: "Test Orchard", participant_type: "farm", created_at: "2026-01-01T00:00:00Z" },
    { id: 18, name: "River Market", participant_type: "distributor", created_at: "2026-01-02T00:00:00Z" },
  ]);
  vi.mocked(api.createInvitation).mockResolvedValue({
    email: "new-user@example.test",
    role: "operator",
    organization: { id: 18, name: "River Market" },
    invitation_token: "generated-one-time-token-from-api-123456",
    expires_at: "2026-10-14T00:00:00Z",
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  if (originalClipboardDescriptor) Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("authentication UI", () => {
  it("shows sign-in and updates auth screen translations immediately", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuthenticationPage />);
    expect(await screen.findByRole("heading", { name: "Sign in to FoodTrace Sentinel" })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "hi");
    expect(screen.getByRole("heading", { name: "FoodTrace Sentinel में साइन इन करें" })).toBeInTheDocument();
    expect(window.localStorage.getItem("foodtrace-language")).toBe("hi");
  });

  it("submits login credentials to the API without persisting them in browser storage", async () => {
    const user = userEvent.setup();
    renderWithProviders(<><AuthenticationPage /><AuthStatus /></>);
    await user.type(await screen.findByLabelText("Email address"), "reviewer@example.test");
    await user.type(screen.getByLabelText(/Password/), "A-long-test-password!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("reviewer@example.test")).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith({ email: "reviewer@example.test", password: "A-long-test-password!" });
    expect(window.localStorage.getItem("foodtrace_session")).toBeNull();
    expect(window.localStorage.getItem("foodtrace-language")).toBeNull();
  });

  it("opens an invitation link at the frontend registration route instead of a not-found page", async () => {
    const token = "generated-invitation-token-that-is-long-enough-12345";
    window.history.replaceState(null, "", `/register#invite=${encodeURIComponent(token)}`);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Accept invitation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Invitation token")).toHaveValue(token);
  });

  it("opens /register without a token as public self-registration", async () => {
    window.history.replaceState(null, "", "/register");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invitation token")).not.toBeInTheDocument();
    expect(screen.getByText(/start without an organization/i)).toBeInTheDocument();
  });

  it("submits public registration with email and password without an invitation token", async () => {
    const user = userEvent.setup();
    renderWithProviders(<><AuthenticationPage registrationRequested /><AuthStatus /></>);
    await user.type(await screen.findByLabelText("Email address"), "new-user@example.test");
    await user.type(screen.getByLabelText(/Password/), "A-long-test-password!");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(api.register).toHaveBeenCalledWith({
      email: "new-user@example.test",
      password: "A-long-test-password!",
    }));
  });

  it("explains a missing authentication API route instead of showing an unexplained Not Found", async () => {
    vi.mocked(api.getSession).mockRejectedValueOnce(new ApiError("Not Found", 404));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Check that the FastAPI server includes Phase 12 routes");
  });

  it("keeps private workspace routes behind sign-in", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in to FoodTrace Sentinel" })).toBeInTheDocument();
    expect(api.listAllProducts).not.toHaveBeenCalled();
    expect(api.listAllOrganizations).not.toHaveBeenCalled();
  });

  it("prefills the invitation token from a fragment link and removes it after acceptance", async () => {
    const user = userEvent.setup();
    const token = "actual-generated-token-from-the-invitation-api-456";
    window.history.replaceState(null, "", `/register#invite=${encodeURIComponent(token)}`);
    renderWithProviders(<AuthenticationPage invitationToken={new URLSearchParams(window.location.hash.slice(1)).get("invite") ?? ""} />);
    expect(await screen.findByRole("heading", { name: "Accept invitation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Invitation token")).toHaveValue(token);
    await user.type(screen.getByLabelText(/Password/), "A-long-test-password!");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(api.registerWithInvitation).toHaveBeenCalledWith({
      invitation_token: token,
      password: "A-long-test-password!",
    }));
    expect(window.location.hash).toBe("");
  });

  it("shows invalid or expired invitation errors without hiding them", async () => {
    const user = userEvent.setup();
    vi.mocked(api.registerWithInvitation).mockRejectedValue(new ApiError("The invitation is invalid or has expired", 400));
    renderWithProviders(<AuthenticationPage invitationToken="bad-token-which-will-be-rejected-by-the-api" />);
    await user.type(screen.getByLabelText(/Password/), "A-long-test-password!");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The invitation is invalid or has expired");
  });

  it("keeps the user signed in when server-side logout fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSession).mockResolvedValue(signedIn);
    vi.mocked(api.logout).mockRejectedValue(new ApiError("Network request to /api/v1/auth/logout failed", 0));
    renderWithProviders(<AuthStatus />);
    expect(await screen.findByText("reviewer@example.test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network request to /api/v1/auth/logout failed");
    expect(screen.getByText("reviewer@example.test")).toBeInTheDocument();
  });

  it("creates an authorized invitation and provides an accept link without a server query token", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<I18nProvider><InviteUserDialog isPlatformAdmin organizationId={undefined} onClose={() => undefined} /></I18nProvider>);
    await user.type(screen.getByLabelText("Email address"), "new-user@example.test");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Organization" }), "18");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByRole("heading", { name: "Invite a user" })).toBeInTheDocument();
    expect(api.createInvitation).toHaveBeenCalledWith({
      email: "new-user@example.test",
      role: "operator",
      organization_id: 18,
    });
    const link = screen.getByLabelText("Invitation link") as HTMLInputElement;
    expect(link.value).toContain("/register#invite=generated-one-time-token-from-api-123456");
    expect(link.value).not.toContain("?invite=");
    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(writeText).toHaveBeenCalledWith("generated-one-time-token-from-api-123456");
    expect(screen.getByText("Invitation token copied.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith(link.value);
    expect(screen.getByText("Invitation link copied.")).toBeInTheDocument();
  });
});
