// ---------------------------------------------------------------------------
// Bot check for public unauthenticated endpoints: a honeypot field that must
// be empty (invisible to humans, bots fill it). CE registration is invite-only
// and every public endpoint is rate limited, so there is no third-party
// challenge (no CAPTCHA script, no outbound verification call).
//
// Usage:
//   const check = validateBotCheck({ honeypot: body.honeypot });
//   if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
// ---------------------------------------------------------------------------

export type BotCheckInput = {
  honeypot?: unknown;
};

export type BotCheckResult =
  | { ok: true }
  | { ok: false; reason: string; code: "honeypot" };

export function validateBotCheck(input: BotCheckInput): BotCheckResult {
  // Any non-empty value, or a non-string, means a bot filled the hidden field.
  if (input.honeypot === undefined) return { ok: true };
  if (typeof input.honeypot === "string" && input.honeypot.trim().length === 0) return { ok: true };
  return { ok: false, reason: "Bot check failed.", code: "honeypot" };
}
