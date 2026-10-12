import { describe, expect, it } from "vitest";
import { publicTraceDevPort } from "./viteDevServer";

describe("Vite public trace server configuration", () => {
  it("uses the configured public URL port", () => {
    expect(publicTraceDevPort("http://192.0.2.10:5176")).toBe(5176);
  });

  it("uses Vite's normal port when QR URL configuration is absent", () => {
    expect(publicTraceDevPort(undefined)).toBe(5173);
  });

  it.each([
    "not a URL",
    "http://127.0.0.1:5176",
    "http://localhost:5176",
    "http://192.0.2.10",
    "http://192.0.2.10:5176/trace",
    "https://192.0.2.10:5176",
  ])("rejects unreachable or non-origin local URL %s", (baseUrl) => {
    expect(() => publicTraceDevPort(baseUrl)).toThrow(/PUBLIC_TRACE_BASE_URL/);
  });
});
