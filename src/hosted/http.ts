export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Api-Key, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Retry-After, X-Cygnix-Quota-Limit, X-Cygnix-Quota-Remaining",
  "Access-Control-Max-Age": "86400",
};
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS, ...headers } });
}
export const apiError = (status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json({ error: { code, message, ...extra } }, status, headers);
export function withCors(res: Response): Response {
  const h = new Headers(res.headers); for (const [k, v] of Object.entries(CORS_HEADERS)) if (!h.has(k)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") || "";
  const text = await req.text();
  if (!text) return {};
  if (ct.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  try { const v = JSON.parse(text); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
