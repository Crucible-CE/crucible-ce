// Text matching used to check that a module's source excerpt is quoted word
// for word from the document. Pure.

/** List markers at line start: bullets, numbers, letters and checkboxes. */
export const LIST_MARKER_RE = /^[ \t]*(?:[-*+•‣◦⁃∙▪●·]|\(?\d{1,3}[.)]|\(?[a-z]\))[ \t]+(?:\[[ xX]\][ \t]+)?/gim;

/** Lowercase, straight quotes, dashes as hyphens, no list markers, collapsed whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(LIST_MARKER_RE, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/­/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Strip wrapping quotes and leading or trailing ellipses around a quote. */
export function cleanQuote(s: string): string {
  return s
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, "")
    .trim();
}

/**
 * Like containsQuote, but against a pre-normalized haystack (normalize a long
 * document once, then check many quotes).
 */
export function containsQuoteIn(normalizedHaystack: string, quote: string, minChars = 8): boolean {
  const q = normalizeForMatch(cleanQuote(quote));
  if (q.length < minChars) return false;
  return normalizedHaystack.includes(q);
}

