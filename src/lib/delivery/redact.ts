// Delivery `error` text can carry phone numbers, email addresses and raw
// provider response bodies. Viewers who may not edit the incident (no
// incidents.edit) get a coarse, safe category instead of the raw text.

const CATEGORIES: [RegExp, string][] = [
  [/^rate limited/i, "rate limited"],
  [/not configured/i, "not configured"],
  [/not verified/i, "phone not verified"],
  [/^no (phone|email|app|paired)/i, "no address on file"],
  [/recipient no longer active/i, "recipient no longer active"],
  [/timed out|timeout/i, "provider timeout"],
];

export function redactDeliveryError(error: string | null | undefined): string | null {
  if (!error) return null;
  for (const [re, label] of CATEGORIES) if (re.test(error)) return label;
  return "delivery error";
}
