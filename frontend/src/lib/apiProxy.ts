export function resolveApiProxyTarget(env: Record<string, string | undefined>): string {
  const configured = env.VITE_API_PROXY_TARGET?.trim();
  return configured || "http://127.0.0.1:8000";
}
