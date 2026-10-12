export function publicTraceDevPort(baseUrl: string | undefined): number {
  if (!baseUrl?.trim()) return 5173;

  const match = /^http:\/\/(\[[0-9a-f:.]+\]|[^:/?#@\s]+):(\d+)\/?$/i.exec(baseUrl.trim());
  if (!match) {
    throw new Error(
      "For local QR scanning, PUBLIC_TRACE_BASE_URL must be an HTTP frontend origin with an explicit port and a phone-reachable host (for example, http://<your-laptop-lan-ip>:5176 after replacing the placeholder).",
    );
  }
  const host = match[1].toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "[::]" ||
    host === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(host);
  if (isLoopback) {
    throw new Error(
      "PUBLIC_TRACE_BASE_URL must use a phone-reachable host; localhost, loopback, and wildcard addresses cannot be opened from another device.",
    );
  }

  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PUBLIC_TRACE_BASE_URL must contain a valid TCP port from 1 to 65535.");
  }
  return port;
}
