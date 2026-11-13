// Web Crypto helpers (work on Cloudflare Workers and Node >= 18).
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function randomToken(len = 32): string {
  const out: string[] = []; const buf = new Uint8Array(len * 2);
  while (out.length < len) { crypto.getRandomValues(buf); for (const b of buf) { if (b < 248 && out.length < len) out.push(B62[b % 62]); } }
  return out.join("");
}
export const newId = (prefix: string) => `${prefix}_${randomToken(16)}`;
/** API keys: `cyg_live_` + 32 base62 chars (~190 bits). High entropy, so a fast SHA-256 hash is appropriate. */
export const newApiKey = () => `cyg_live_${randomToken(32)}`;
export async function sha256Hex(s: string): Promise<string> { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export async function sha256B64Url(s: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  let bin = ""; for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
export async function hmacSha512Hex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const b64encode = (u8: Uint8Array) => { let s = ""; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
export const b64decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function hmacSha256B64(secret: string | Uint8Array, msg: string): Promise<string> {
  const raw = typeof secret === "string" ? enc.encode(secret) : secret;
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg))));
}
async function aesKey(b64Key: string) {
  const raw = b64decode(b64Key); if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}
/** AES-256-GCM. Output: base64(iv[12] || ciphertext+tag). */
export async function encryptString(b64Key: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(b64Key), enc.encode(plain)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64encode(out);
}
export async function decryptString(b64Key: string, blob: string): Promise<string> {
  const all = b64decode(blob);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await aesKey(b64Key), all.slice(12));
  return new TextDecoder().decode(pt);
}
