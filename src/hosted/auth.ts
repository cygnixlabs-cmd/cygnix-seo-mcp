// Authentication. Requests carry `Authorization: Bearer <token>` (or `X-Api-Key: <key>`).
// Authenticators form a chain so new schemes (e.g. a third-party OAuth provider) can be added later
// without touching metering or the MCP handler: implement Authenticator and append it in defaultAuthenticators().
import { effectiveTier, type Store, type Account } from "./store.js";
import type { TierId } from "./tiers.js";

export interface Principal { accountId: string; keyId: string; tier: TierId; email: string; status: string; via: "api_key" | "oauth"; account: Account; oauthClientId?: string }
export interface Authenticator { name: string; matches(token: string): boolean; authenticate(token: string): Promise<Principal | null> }

export function extractToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h) { const m = h.match(/^Bearer\s+(.+)$/i); return m ? m[1].trim() : null; }
  const k = req.headers.get("x-api-key");
  return k ? k.trim() : null;
}

const toPrincipal = (row: (Account & { key_id: string; revoked_at: number | null }) | null, via: Principal["via"]): Principal | null => {
  if (!row || row.revoked_at) return null;
  const { key_id, revoked_at: _r, ...account } = row;
  return { accountId: account.id, keyId: key_id, tier: effectiveTier(account), email: account.email, status: account.status, via, account: account as Account };
};

export const apiKeyAuthenticator = (store: Store): Authenticator => ({
  name: "api_key", matches: t => t.startsWith("cyg_live_"),
  authenticate: async t => toPrincipal(await store.keyByPlaintext(t), "api_key"),
});
/** Tokens minted by the built-in OAuth bridge (/oauth/*). Each is bound to one API key, so metering is identical. */
export const oauthTokenAuthenticator = (store: Store): Authenticator => ({
  name: "oauth", matches: t => t.startsWith("cyg_at_"),
  authenticate: async t => {
    const tok = await store.tokenLookup(t, "access"); if (!tok) return null;
    const p = toPrincipal(await store.keyContext(tok.key_id), "oauth"); return p ? { ...p, oauthClientId: tok.client_id } : null;
  },
});
export const defaultAuthenticators = (store: Store): Authenticator[] => [apiKeyAuthenticator(store), oauthTokenAuthenticator(store)];

export async function authenticate(req: Request, chain: Authenticator[]): Promise<Principal | null> {
  const token = extractToken(req); if (!token || token.length > 512) return null;
  for (const a of chain) if (a.matches(token)) return a.authenticate(token);
  return null;
}
