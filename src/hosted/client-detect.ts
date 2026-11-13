// Client detection for "hide prices" mode. OpenAI's plugin/app guidelines forbid showing plans, prices or
// upgrade CTAs inside ChatGPT (users may only be told a feature isn't on their plan, plus a link to an
// informational page). We hide prices whenever any client signal matches HIDE_PRICES_FOR_CLIENTS
// (comma-separated, case-insensitive substrings; default "chatgpt,openai"; set "" to disable).
// Signals, any one is enough (the server is stateless, so tools/call requests rarely carry clientInfo):
//   1. User-Agent header. ChatGPT sends "openai-mcp/1.0.0 (ChatGPT)" (seen in public server logs, not an OpenAI spec).
//   2. initialize params.clientInfo.name / title in the same request (ChatGPT reports "openai-mcp").
//   3. OAuth client_name the connector registered with (DCR), when the request uses an OAuth token.
//   4. The last clientInfo name stored for this OAuth client / API key at initialize time.
import type { HostedEnv } from "./env.js";

export const DEFAULT_HIDE_PRICES_FOR = "chatgpt,openai";
export function hidePatterns(env: HostedEnv): string[] {
  const v = env.HIDE_PRICES_FOR_CLIENTS;
  const raw = typeof v === "string" ? v : DEFAULT_HIDE_PRICES_FOR;
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
export function matchesHidden(env: HostedEnv, signals: (string | null | undefined)[]): boolean {
  const pats = hidePatterns(env); if (!pats.length) return false;
  return signals.some(s => typeof s === "string" && s && pats.some(p => s.toLowerCase().includes(p)));
}
type Rpc = { method?: string; params?: { clientInfo?: { name?: unknown; title?: unknown } } };
/** clientInfo name (+ title) from an initialize message in this request body, if any. */
export function initClientInfo(msgs: Rpc[]): string | null {
  const m = msgs.find(x => x && x.method === "initialize"); const ci = m?.params?.clientInfo;
  if (!ci) return null;
  const parts = [ci.name, ci.title].filter((x): x is string => typeof x === "string" && !!x).map(s => s.slice(0, 100));
  return parts.length ? parts.join(" / ") : null;
}
