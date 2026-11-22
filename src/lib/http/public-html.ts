// A small self-contained HTML page for public token links that a mail client
// opens (confirm a subscription, unsubscribe, acknowledge a broadcast). No
// script at all; the page's one button posts back to the same URL, so mail
// scanners that prefetch links change nothing.

import { escapeHtml } from "@/lib/email/transport";

export function publicHtmlPage(title: string, body: string, status = 200): Response {
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#111;margin:0;padding:24px}main{max-width:480px;margin:10vh auto;background:#fff;border:1px solid #e3e5e8;border-radius:10px;padding:28px}h1{font-size:19px;margin:0 0 12px}p{font-size:14px;line-height:1.55;color:#333;white-space:pre-wrap}button{margin-top:16px;width:100%;padding:12px;font-size:15px;font-weight:600;color:#fff;background:#4f46e5;border:0;border-radius:8px;cursor:pointer}@media (prefers-color-scheme:dark){body{background:#0f1115;color:#eee}main{background:#171a21;border-color:#2a2f3a}p{color:#c9ccd3}}</style>
</head><body><main>${body}</main></body></html>`;
  return new Response(doc, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      // /api/* gets no page CSP from the middleware, so this page carries its own.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** A heading, a line of text, and an optional one-button form. */
export function publicMessage(heading: string, text: string, button?: string): string {
  return `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(text)}</p>${button ? `<form method="post"><button type="submit">${escapeHtml(button)}</button></form>` : ""}`;
}
