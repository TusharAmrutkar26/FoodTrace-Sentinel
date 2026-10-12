import { describe, expect, it } from "vitest";
import { resolveApiProxyTarget } from "./apiProxy";

describe("Vite API proxy target", () => {
  it("uses the configured FastAPI address", () => {
    expect(resolveApiProxyTarget({ VITE_API_PROXY_TARGET: "http://127.0.0.1:8001" }))
      .toBe("http://127.0.0.1:8001");
  });

  it("uses the default backend port when no override is configured", () => {
    expect(resolveApiProxyTarget({})).toBe("http://127.0.0.1:8000");
    expect(resolveApiProxyTarget({ VITE_API_PROXY_TARGET: "   " })).toBe("http://127.0.0.1:8000");
  });
});
