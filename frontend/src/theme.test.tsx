import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "./i18n";
import { ThemeProvider, ThemeToggle } from "./theme";

function renderToggle() {
  return render(<ThemeProvider><I18nProvider><ThemeToggle /></I18nProvider></ThemeProvider>);
}

describe("theme toggle", () => {
  beforeEach(() => {
    window.localStorage.removeItem("foodtrace-theme");
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => {
    cleanup();
    window.localStorage.removeItem("foodtrace-theme");
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("defaults to light, toggles immediately, and restores the saved theme", () => {
    const view = renderToggle();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("foodtrace-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toHaveAttribute("aria-pressed", "true");

    view.unmount();
    renderToggle();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });
});
