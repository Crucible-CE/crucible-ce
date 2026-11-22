// Minimal signed-webhook receiver for the e2e suite. Verifies each POST with
// the documented scheme (docs/delivery-providers.md):
//   X-Crucible-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
// and records the result. GET /received lists everything; DELETE /received clears.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const SECRET = process.env.WEBHOOK_SECRET ?? "";
const PORT = Number(process.env.PORT ?? 8080);
const received = [];

function verify(rawBody, header, toleranceSec = 300) {
  if (!SECRET || !header) return false;
  let t = null;
  const v1 = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && /^\d+$/.test(v ?? "")) t = Number(v);
    else if (k === "v1" && v) v1.push(v);
  }
  if (t === null || v1.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", SECRET).update(`${t}.${rawBody}`).digest("hex"));
  return v1.some((sig) => {
    const b = Buffer.from(sig);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (req.method === "GET" && req.url === "/health") return res.end("ok");
    if (req.url === "/received") {
      if (req.method === "DELETE") received.length = 0;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(received));
    }
    if (req.method === "POST") {
      const signature = req.headers["x-crucible-signature"] ?? null;
      const valid = verify(raw, Array.isArray(signature) ? signature[0] : signature);
      let body = null;
      try { body = JSON.parse(raw); } catch { /* recorded as raw */ }
      received.push({ at: new Date().toISOString(), path: req.url, valid, signature, headers: req.headers, raw, body });
      res.statusCode = valid ? 200 : 401;
      return res.end(valid ? "ok" : "bad signature");
    }
    res.statusCode = 404;
    res.end();
  });
}).listen(PORT, () => console.log(`[webhook-receiver] listening on :${PORT}`));
