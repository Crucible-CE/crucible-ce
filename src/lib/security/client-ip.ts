// Edge-safe client-IP derivation. ZERO `node:*` imports — this module is used
// from the edge middleware runtime as well as Node routes, and MUST stay pure so
// the two runtimes derive an identical IP for the same request.
//
// Replaces the previous leftmost-`x-forwarded-for`
// trust let any client spoof its IP (defeating the org IP allowlist and the
// per-IP login limiter).
//
// Selection semantic: a trusted reverse proxy
// appends the real peer IP as the RIGHTMOST X-Forwarded-For entry, so with a
// single trusted hop the client IP is the rightmost token; entries to its left
// are client-controlled and ignored. `TRUSTED_PROXY_HOPS` counts trusted proxies
// that append (one reverse proxy = 1); the client token is the `hops`-th from the
// right. NOTE: two earlier example vectors were internally inconsistent and
// its `n-1-hops` prose would null out a normal single-entry chain; the
// implemented rule is `index = n - hops`, which keeps the common case working.
//
// CE default is 0 hops: a self-hosted install may be exposed directly (the
// compose quickstart publishes :3000), and with no proxy in front EVERY
// forwarding header (X-Forwarded-For and X-Real-IP alike) is set by the client
// itself. So at 0 hops neither header is trusted and getClientIp returns null
// (rate limits collapse into the shared "unknown" bucket: stricter, never a
// bypass). Behind ONE reverse proxy (Caddy, nginx, Traefik) set
// TRUSTED_PROXY_HOPS=1; add one per further appending hop (CDN/WAF -> proxy = 2).

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  const n = raw == null ? def : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Parse a TRUSTED_PROXY_HOPS value: integer 0..10, default 0 (unset/blank/garbage). */
export function resolveTrustedProxyHops(raw: string | undefined): number {
  return clampInt(raw, 0, 0, 10);
}

// Trusted reverse-proxy hops between the real client and the app.
// 0 (default) = no proxy, forwarding headers ignored; one reverse proxy = 1.
export const TRUSTED_PROXY_HOPS: number = resolveTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);

export type IpMode = "strict" | "lenient";

// The `hops`-th X-Forwarded-For entry counting from the right (hops=1 -> rightmost).
// Returns null when the chain is shorter than `hops` (untrustworthy -> fail closed).
export function selectFromXff(xff: string, hops: number): string | null {
  const tokens = xff.split(",").map((t) => t.trim()).filter(Boolean);
  const n = tokens.length;
  if (n === 0 || hops < 1 || n < hops) return null;
  return tokens[n - hops] ?? null;
}

// Parse an IPv4 dotted-quad to a 32-bit BigInt. Rejects leading-zero octets.
function v4ToBigInt(ip: string): { v: bigint; bits: 32 } | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p[0] === "0") return null; // non-canonical leading zero
    const num = Number(p);
    if (num > 255) return null;
    v = (v << 8n) | BigInt(num);
  }
  return { v, bits: 32 };
}

// Parse an IPv6 address (with `::` compression and optional embedded-v4 tail).
function v6ToBigInt(ip: string): { v: bigint; bits: 128 } | null {
  const s = ip.toLowerCase();
  if (s.indexOf("::") !== s.lastIndexOf("::")) return null; // at most one '::'
  const hasDouble = s.includes("::");
  const [lhs, rhs = ""] = hasDouble ? s.split("::") : [s, ""];
  const toHextets = (part: string): number[] | null => {
    if (part === "") return [];
    const segs = part.split(":");
    const out: number[] = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg.includes(".")) {
        if (i !== segs.length - 1) return null; // embedded v4 only at the tail
        const v4 = v4ToBigInt(seg);
        if (!v4) return null;
        out.push(Number((v4.v >> 16n) & 0xffffn));
        out.push(Number(v4.v & 0xffffn));
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(seg)) return null;
        out.push(parseInt(seg, 16));
      }
    }
    return out;
  };
  const left = toHextets(lhs);
  const right = toHextets(rhs);
  if (left === null || right === null) return null;
  let groups: number[];
  if (hasDouble) {
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null; // '::' must stand for >= 1 zero group
    groups = [...left, ...Array<number>(missing).fill(0), ...right];
  } else {
    groups = left;
  }
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (g < 0 || g > 0xffff) return null;
    v = (v << 16n) | BigInt(g);
  }
  return { v, bits: 128 };
}

// Parse an IP string to a BigInt + family. Shared by getClientIp and the
// allowlist CIDR matcher so both agree on what a valid address is.
export function ipToBigInt(ip: string): { v: bigint; bits: 32 | 128 } | null {
  return ip.includes(":") ? v6ToBigInt(ip) : v4ToBigInt(ip);
}

// Strip a port/brackets and validate. Returns a canonical-enough string (v6
// lowercased) or null for anything that is not a plausible IP.
export function normalizeIp(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end === -1) return null;
    s = s.slice(1, end); // drop [ ] and any :port after ]
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) {
    s = s.slice(0, s.lastIndexOf(":")); // IPv4:port -> IPv4
  }
  const parsed = ipToBigInt(s);
  if (!parsed) return null;
  return parsed.bits === 128 ? s.toLowerCase() : s;
}

// Name of the per-process header server.ts stamps with the TCP peer address
// (random, so clients can't forge it). Unset under plain `next dev`/`next start`.
function peerIpHeaderName(): string | null {
  const name = typeof process !== "undefined" ? process.env?.CRUCIBLE_PEER_IP_HEADER : undefined;
  return name && /^x-crucible-peer-[0-9a-f]{24}$/.test(name) ? name : null;
}

// Peer address as stamped by server.ts ("::ffff:1.2.3.4" -> "1.2.3.4").
function peerIp(get: (k: string) => string | null): string | null {
  const name = peerIpHeaderName();
  if (!name) return null;
  const raw = get(name);
  if (!raw) return null;
  const v = raw.trim().toLowerCase().startsWith("::ffff:") && raw.includes(".") ? raw.trim().slice(7) : raw;
  return normalizeIp(v);
}

// Derive the client IP from proxy headers.
//   strict  (allowlist/middleware): ONLY the trusted XFF token; no x-real-ip; null on ambiguity.
//   lenient (rate-limit):           trusted XFF token, then x-real-ip, then null.
//   hops = 0 (CE default):          no proxy is trusted, so forwarding headers are
//                                   ignored (x-real-ip is client-settable too); the
//                                   TCP peer address stamped by server.ts is used,
//                                   else null.
// `hops` defaults to the configured TRUSTED_PROXY_HOPS (overridable for tests).
export function getClientIp(
  req: Request | { headers: Headers } | null | undefined,
  mode: IpMode = "lenient",
  hops: number = TRUSTED_PROXY_HOPS,
): string | null {
  if (!req || !("headers" in req) || !req.headers) return null;
  const h = req.headers;
  const get = typeof h.get === "function" ? (k: string) => h.get(k) : () => null;
  // No trusted proxy: every forwarding header is client-controlled; only the
  // socket peer address (if server.ts stamped it) can be trusted.
  if (hops < 1) return peerIp(get);
  const xff = get("x-forwarded-for");
  let candidate: string | null = null;
  if (xff) {
    const sel = selectFromXff(xff, hops);
    if (sel) candidate = normalizeIp(sel);
  }
  if (candidate) return candidate;
  if (mode === "strict") return null; // no x-real-ip trust on the security-critical path
  const real = get("x-real-ip");
  if (real) {
    const rn = normalizeIp(real);
    if (rn) return rn;
  }
  return null;
}
