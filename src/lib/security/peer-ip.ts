// TCP-peer-address stamping for the custom server (server.ts). Node only.
//
// server.ts hands the real socket peer address to route handlers under a
// header NAME that is random per process (x-crucible-peer-<24 hex>) and
// publishes the name in process.env.CRUCIBLE_PEER_IP_HEADER, where
// src/lib/security/client-ip.ts (getClientIp at TRUSTED_PROXY_HOPS=0) reads
// it. A client can't forge a header it can't name; any client-sent header in
// the x-crucible-peer- namespace is dropped anyway, so even a lucky guess or a
// leaked name is overwritten, never trusted.
//
// Also: warn ONCE when a request carries X-Forwarded-For while
// TRUSTED_PROXY_HOPS=0. That is the signature of a reverse proxy in front of
// an app that was not told about it: every client then shares the proxy's
// address, so one rate-limit bucket (sign-in, setup, password reset) serves
// the whole install.

import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

const PEER_PREFIX = "x-crucible-peer-";

export interface PeerIpStamper {
  headerName: string;
  /** Strip spoofed peer headers, stamp the real peer address, maybe warn. */
  stamp(req: IncomingMessage): void;
}

export function createPeerIpStamper(opts: {
  trustedProxyHops: number;
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
}): PeerIpStamper {
  const headerName = `${PEER_PREFIX}${randomBytes(12).toString("hex")}`;
  (opts.env ?? process.env).CRUCIBLE_PEER_IP_HEADER = headerName;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  let warned = false;

  return {
    headerName,
    stamp(req) {
      for (const key of Object.keys(req.headers)) {
        if (key.startsWith(PEER_PREFIX)) delete req.headers[key];
      }
      if (req.socket.remoteAddress) req.headers[headerName] = req.socket.remoteAddress;
      if (!warned && opts.trustedProxyHops === 0 && req.headers["x-forwarded-for"] !== undefined) {
        warned = true;
        warn(
          "[server] A request arrived with X-Forwarded-For but TRUSTED_PROXY_HOPS=0. " +
            "If Crucible runs behind a reverse proxy, set TRUSTED_PROXY_HOPS=1 (one per appending proxy): " +
            "until then every client shares the proxy's address and therefore ONE rate-limit bucket " +
            "(sign-in, setup, password reset). See docs/reverse-proxy.md. " +
            "If clients connect directly, ignore this: the header is client-supplied and not trusted.",
        );
      }
    },
  };
}
