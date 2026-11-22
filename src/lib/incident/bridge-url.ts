import { z } from "zod";

// war-room bridge (video-call) link validation. This is a FORMAT
// validator, NOT an SSRF guard: the manual link is only ever rendered into an
// <a href>, never fetched server-side. https: only — rejects javascript:,
// data:, vbscript:, file:, blob:, relative URLs, and anything new URL() can't
// parse, so a pasted link can't smuggle a script/URI-scheme payload into the
// war-room UI.

export function isValidBridgeUrl(raw: string): boolean {
  if (raw.length > 1000) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeBridgeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  return isValidBridgeUrl(trimmed) ? trimmed : null;
}

export const bridgeUrlSchema: z.ZodType<string> = z
  .string()
  .max(1000)
  .refine(isValidBridgeUrl, "Must be a valid https:// URL");
