// SSRF guard for outbound webhook delivery.
//
// A webhook URL is operator-configured, but a compromised or careless config
// must not turn the app into a proxy into the internal network (cloud
// metadata at 169.254.169.254, the Postgres/Redis containers, localhost
// admin ports). Rules:
//   - http/https only
//   - every address the hostname resolves to must be public; the check runs
//     inside the socket's own DNS lookup, so a DNS-rebinding answer that
//     changes between "check" and "connect" cannot slip through
//   - redirects are never followed (a 3xx is a failed delivery)
// DELIVERY_WEBHOOK_ALLOW_PRIVATE=true disables the address check. It exists
// for LOCAL TESTING (a receiver on localhost / the compose network) only.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const blockList = new net.BlockList();
// IPv4 special-purpose ranges (RFC 6890 and friends).
for (const [addr, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blockList.addSubnet(addr, prefix, "ipv4");
}
// IPv6 special-purpose ranges.
for (const [addr, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
  // Transition / translation ranges. Each can carry an embedded IPv4 that a
  // relay or gateway would forward to (including private/loopback/metadata
  // targets), so the WHOLE range is refused rather than decoded:
  ["::", 96], // IPv4-compatible (deprecated, RFC 4291 §2.5.5.1)
  ["::ffff:0:0:0", 96], // IPv4-translated (RFC 2765)
  ["64:ff9b::", 96], // NAT64 well-known prefix (RFC 6052)
  ["64:ff9b:1::", 48], // NAT64 local-use prefix (RFC 8215)
  ["2001::", 32], // Teredo (RFC 4380)
  ["2002::", 16], // 6to4 (RFC 3056)
] as const) {
  blockList.addSubnet(addr, prefix, "ipv6");
}

/** Extract an embedded IPv4 from IPv4-mapped / -compatible / NAT64 IPv6 forms. */
function embeddedIpv4(ip6: string): string | null {
  const lower = ip6.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** True when `ip` is loopback, private, link-local, multicast or otherwise non-public. */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(bare)) return blockList.check(bare, "ipv4");
  if (net.isIPv6(bare)) {
    // Range check first: the transition ranges above are blocked outright,
    // whatever IPv4 they embed. (BlockList also applies the IPv4 rules to
    // IPv4-mapped ::ffff:a.b.c.d in any spelling.)
    if (blockList.check(bare, "ipv6")) return true;
    // Belt and braces for IPv4-mapped forms: decode and check as IPv4.
    const v4 = embeddedIpv4(bare);
    return v4 !== null && net.isIPv4(v4) && blockList.check(v4, "ipv4");
  }
  return true; // not an IP at all: refuse
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/** Static URL checks (scheme, IP-literal host). DNS is checked at connect time. */
export function assertSafeWebhookUrl(rawUrl: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfBlockedError(`Webhook URL scheme ${url.protocol} is not allowed (http/https only)`);
  }
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isBlockedAddress(host)) {
      throw new SsrfBlockedError(`Webhook host ${host} is a private/loopback/link-local address`);
    }
    if (host === "localhost" || host.endsWith(".localhost")) {
      throw new SsrfBlockedError("Webhook host localhost is not allowed");
    }
  }
  return url;
}

type LookupAddress = { address: string; family: number };
type Resolver = (
  hostname: string,
  options: { all: true },
  cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * A `lookup` for http(s).request that resolves every address and refuses the
 * connection if ANY of them is non-public (so a mixed public/private answer
 * cannot be used to reach the private one).
 */
export function guardedLookup(allowPrivate: boolean, resolver: Resolver = dns.lookup as unknown as Resolver) {
  return (
    hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    resolver(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      if (!addresses || addresses.length === 0) {
        return callback(Object.assign(new Error(`No addresses for ${hostname}`), { code: "ENOTFOUND" }), "", 4);
      }
      if (!allowPrivate) {
        const bad = addresses.find((a) => isBlockedAddress(a.address));
        if (bad) {
          return callback(
            new SsrfBlockedError(`Webhook host ${hostname} resolves to non-public address ${bad.address}`) as NodeJS.ErrnoException,
            "",
            4,
          );
        }
      }
      const wantAll = typeof options === "object" && options?.all === true;
      if (wantAll) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export interface PostResult {
  status: number;
  body: string;
}

export type HttpPost = (
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: { timeoutMs: number; allowPrivate: boolean },
) => Promise<PostResult>;

/** POST with the SSRF guard, a hard timeout, and no redirect following. */
export const guardedPost: HttpPost = (rawUrl, body, headers, opts) =>
  new Promise<PostResult>((resolve, reject) => {
    let url: URL;
    try {
      url = assertSafeWebhookUrl(rawUrl, opts.allowPrivate);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        lookup: guardedLookup(opts.allowPrivate) as unknown as net.LookupFunction,
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          // Keep only a small snippet of the response for diagnostics.
          if (size < 2048) chunks.push(c);
          size += c.length;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 2048) }));
        res.on("error", reject);
      },
    );
    // Hard wall-clock deadline (the socket `timeout` is an idle timeout only).
    const deadline = setTimeout(() => req.destroy(new Error(`Webhook timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs);
    req.on("timeout", () => req.destroy(new Error(`Webhook timed out after ${opts.timeoutMs}ms`)));
    req.on("error", (e) => {
      clearTimeout(deadline);
      reject(e);
    });
    req.on("close", () => clearTimeout(deadline));
    req.end(body);
  });
