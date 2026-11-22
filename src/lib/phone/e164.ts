// Phone numbers in E.164 (+<country><subscriber>, 8–15 digits) — the one form
// stored on escalation contacts / notification numbers and compared by the
// SMS/voice rate limits and the inbound-SMS "ACK" sender match. Without one
// canonical form, "+1 (555) 010-0001", "555-010-0001" and "+15550100001" are
// three different numbers to a rate limiter or a From lookup.
//
// No phone library dependency: a deliberately small, predictable normalizer.
//   "+44 20 7946 0958"   -> "+442079460958"
//   "0044 20 7946 0958"  -> "+442079460958"   (00 international prefix)
//   "(555) 010-0001"     -> "+15550100001"    (national, default country +1)
//   "1-555-010-0001"     -> "+15550100001"
//   "555-0100 ext 12"    -> null              (extensions are not dialable by SMS)
// The default country for national-format input is PHONE_DEFAULT_COUNTRY_CODE
// (digits only, default "1" = NANP).

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

export function defaultCountryCode(): string {
  const cc = (process.env.PHONE_DEFAULT_COUNTRY_CODE ?? "1").replace(/\D/g, "");
  return cc.length >= 1 && cc.length <= 3 ? cc : "1";
}

/** E.164 form of `raw`, or null when it cannot be read as a dialable number. */
export function toE164(raw: string | null | undefined, countryCode: string = defaultCountryCode()): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Letters (other than a leading "tel:") mean an extension / vanity text.
  const body = trimmed.replace(/^tel:/i, "");
  if (/[a-z]/i.test(body)) return null;

  const digits = body.replace(/\D/g, "");
  if (!digits) return null;

  let e164: string;
  if (body.startsWith("+")) {
    e164 = digits;
  } else if (digits.startsWith("00")) {
    e164 = digits.slice(2);
  } else if (countryCode === "1") {
    // NANP: 10-digit national, or 11 digits with the leading trunk "1".
    if (digits.length === 10) e164 = `1${digits}`;
    else if (digits.length === 11 && digits.startsWith("1")) e164 = digits;
    else return null;
  } else {
    // Other countries: national format carries a trunk "0" ("020 7946 0958")
    // -> drop it and prefix the country code; otherwise the digits already
    // start with a country code ("44 20 7946 0958" typed without the "+").
    e164 = digits.startsWith("0") ? `${countryCode}${digits.replace(/^0+/, "")}` : digits;
  }
  if (e164.startsWith("0")) return null;
  if (e164.length < MIN_DIGITS || e164.length > MAX_DIGITS) return null;
  return `+${e164}`;
}

/**
 * For storage: the E.164 form when readable, otherwise the trimmed input (so a
 * bulk import never silently drops data; such a number will not match or be
 * dialed until fixed). Empty -> null.
 */
export function phoneForStorage(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return toE164(trimmed) ?? trimmed;
}
