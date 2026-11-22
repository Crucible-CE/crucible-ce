// Inbound Twilio webhook validation (status callbacks, inbound SMS, voice
// Gather). X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + sorted
// key/value pairs of the POST form)). The URL is the PUBLIC one Twilio called
// (PUBLIC_URL + path + query), not the internal request URL, because the app
// usually sits behind a TLS proxy.

import { createHmac } from "node:crypto";
import { secureEqual } from "@/lib/security/secure-compare";

export function twilioExpectedSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export type TwilioValidation =
  | { ok: true; params: Record<string, string> }
  | { ok: false; status: 200 | 403; reason: string };

/**
 * Validate a Twilio POST. `pathWithQuery` is the route's public path (e.g.
 * "/api/public/twilio/inbound" or "/api/public/twilio/voice?t=..."). Returns
 * 200-not-ok when the app isn't configured for callbacks (so Twilio stops
 * retrying) and 403 on a bad signature.
 */
export async function validateTwilioRequest(req: Request, pathWithQuery: string): Promise<TwilioValidation> {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const publicBase = process.env.PUBLIC_URL?.trim();
  if (!authToken || !publicBase) return { ok: false, status: 200, reason: "not configured" };

  const form = await req.formData().catch(() => null);
  if (!form) return { ok: false, status: 403, reason: "malformed body" };
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;

  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = `${publicBase.replace(/\/+$/, "")}${pathWithQuery}`;
  if (!signature || !secureEqual(signature, twilioExpectedSignature(url, params, authToken))) {
    return { ok: false, status: 403, reason: "invalid signature" };
  }
  return { ok: true, params };
}

export function twimlResponse(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
