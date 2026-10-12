import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TraceTrustDashboard } from "./TraceTrustDashboard";
import { api } from "../lib/api";
import type { TrustFinding, TrustFindingPage } from "../types/api";

vi.mock("../lib/api", () => ({ api: { getTrustFindings: vi.fn() } }));

const lossFinding: TrustFinding = {
  finding_id: "tt-0123456789abcdefabcd",
  check_type: "process_loss",
  severity: "medium",
  status: "detected",
  title: "Recorded process loss exceeds the configured threshold",
  explanation: "The recorded input/output difference is 30.00% in kg; the configured review threshold is 20%.",
  batch_codes: ["MNG-201", "MNG-202"],
  evidence: [
    { label: "Recorded input", value: "100.000 kg" },
    { label: "Recorded output", value: "70.000 kg" },
  ],
  recommended_action: "Review the operation records and supporting documents.",
};
const incompleteFinding: TrustFinding = {
  finding_id: "tt-fedcba9876543210fedc",
  check_type: "process_loss_incomplete",
  severity: "low",
  status: "incomplete",
  title: "Process loss could not be assessed",
  explanation: "The input and output units differ; TraceTrust does not convert units.",
  batch_codes: ["MNG-202"],
  evidence: [{ label: "Output batch", value: "MNG-202: 70.000 kg" }],
  recommended_action: "Record complete operation inputs and outputs in compatible units.",
};

function page(items: TrustFinding[] = [lossFinding, incompleteFinding]): TrustFindingPage {
  return {
    items, total: items.length, limit: 20, offset: 0,
    counts: { high: 0, medium: items.filter((item) => item.severity === "medium").length, low: items.filter((item) => item.severity === "low").length, incomplete: items.filter((item) => item.status === "incomplete").length },
  };
}

beforeEach(() => vi.mocked(api.getTrustFindings).mockResolvedValue(page()));
afterEach(() => cleanup());

describe("TraceTrust dashboard", () => {
  it("renders API findings and opens the evidence details", async () => {
    const onOpenBatch = vi.fn();
    const user = userEvent.setup();
    render(<TraceTrustDashboard onOpenBatch={onOpenBatch} />);

    expect(await screen.findByText(lossFinding.title)).toBeInTheDocument();
    expect(screen.getByText("MNG-201")).toBeInTheDocument();
    expect(screen.getByText("High severity")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `View details for ${lossFinding.title}` }));
    const details = screen.getByRole("region", { name: lossFinding.title });
    expect(within(details).getByText(lossFinding.explanation)).toBeInTheDocument();
    expect(within(details).getByText("100.000 kg")).toBeInTheDocument();
    expect(within(details).getByText(lossFinding.recommended_action)).toBeInTheDocument();
    await user.click(within(details).getByRole("button", { name: "MNG-201" }));
    expect(onOpenBatch).toHaveBeenCalledWith("MNG-201");
  });

  it("filters by severity and check type using the API", async () => {
    const user = userEvent.setup();
    render(<TraceTrustDashboard onOpenBatch={vi.fn()} />);
    await screen.findByText(lossFinding.title);

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by severity" }), "high");
    await waitFor(() => expect(api.getTrustFindings).toHaveBeenLastCalledWith(expect.objectContaining({ severity: "high", offset: 0 })));
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by check type" }), "genealogy_cycle");
    await waitFor(() => expect(api.getTrustFindings).toHaveBeenLastCalledWith(expect.objectContaining({ severity: "high", check_type: "genealogy_cycle", offset: 0 })));
  });

  it("applies a normalized batch filter", async () => {
    const user = userEvent.setup();
    render(<TraceTrustDashboard onOpenBatch={vi.fn()} />);
    await screen.findByText(lossFinding.title);
    await user.type(screen.getByRole("textbox", { name: "Filter by batch code" }), "mng-201");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(api.getTrustFindings).toHaveBeenLastCalledWith(expect.objectContaining({ batch_code: "MNG-201", offset: 0 })));
  });

  it("shows loading and empty states", async () => {
    let resolveRequest!: (value: TrustFindingPage) => void;
    vi.mocked(api.getTrustFindings).mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    render(<TraceTrustDashboard onOpenBatch={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Analyzing recorded data");
    resolveRequest(page([]));
    expect(await screen.findByText("No findings for these filters")).toBeInTheDocument();
  });

  it("shows an API error and retries", async () => {
    vi.mocked(api.getTrustFindings).mockRejectedValueOnce(new Error("Trust API unavailable")).mockResolvedValueOnce(page([lossFinding]));
    const user = userEvent.setup();
    render(<TraceTrustDashboard onOpenBatch={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Trust API unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(lossFinding.title)).toBeInTheDocument();
  });
});
