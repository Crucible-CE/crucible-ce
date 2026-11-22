import { describe, it, expect } from "vitest";
import {
  FILE_RESPONSE_CSP,
  contentDisposition,
  fileResponse,
  fileResponseHeaders,
  isInlineSafeMimeType,
  safeStoredMimeType,
  sanitizeFilename,
  sniffMimeType,
} from "./file-response";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = new TextEncoder().encode("GIF89a....");
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const PDF = new TextEncoder().encode("%PDF-1.7\n...");
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("inline allowlist", () => {
  it("allows only passive types", () => {
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "Text/Plain; charset=utf-8"]) {
      expect(isInlineSafeMimeType(t)).toBe(true);
    }
    for (const t of ["application/pdf", "text/html", "image/svg+xml", "application/javascript", "text/javascript", "application/xml", "text/xml", "application/xhtml+xml", "", null, undefined]) {
      expect(isInlineSafeMimeType(t)).toBe(false);
    }
  });
});

describe("fileResponseHeaders", () => {
  const securityHeaders = (h: Record<string, string>) => {
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toBe(FILE_RESPONSE_CSP);
    expect(FILE_RESPONSE_CSP).toBe("sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  };

  it.each(["text/html", "image/svg+xml", "application/javascript", "text/xml"])(
    "forces %s to an octet-stream attachment even when inline is requested",
    (mime) => {
      const h = fileResponseHeaders({ filename: "x.html", contentType: mime, inline: true });
      expect(h["Content-Type"]).toBe("application/octet-stream");
      expect(h["Content-Disposition"].startsWith("attachment;")).toBe(true);
      securityHeaders(h);
    },
  );

  it("serves png inline when requested; pdf is always an attachment", () => {
    const png = fileResponseHeaders({ filename: "shot.png", contentType: "image/png", inline: true });
    expect(png["Content-Type"]).toBe("image/png");
    expect(png["Content-Disposition"].startsWith("inline;")).toBe(true);
    securityHeaders(png);

    const pdf = fileResponseHeaders({ filename: "r.pdf", contentType: "application/pdf", inline: true });
    expect(pdf["Content-Disposition"].startsWith("attachment;")).toBe(true);
    expect(pdf["Content-Type"]).toBe("application/octet-stream");
    // A server-generated PDF keeps its type but is still an attachment.
    const gen = fileResponseHeaders({ filename: "r.pdf", contentType: "application/pdf", inline: true, trustedContentType: true });
    expect(gen["Content-Type"]).toBe("application/pdf");
    expect(gen["Content-Disposition"].startsWith("attachment;")).toBe(true);
  });

  it("defaults to attachment for safe types when inline is not requested", () => {
    const h = fileResponseHeaders({ filename: "shot.png", contentType: "image/png" });
    expect(h["Content-Disposition"].startsWith("attachment;")).toBe(true);
  });

  it("pins the charset on text/plain", () => {
    const h = fileResponseHeaders({ filename: "a.txt", contentType: "text/plain; charset=utf-7", inline: true });
    expect(h["Content-Type"]).toBe("text/plain; charset=utf-8");
  });

  it("keeps a trusted generated type but still forces attachment + security headers", () => {
    const h = fileResponseHeaders({ filename: "m.csv", contentType: "text/csv; charset=utf-8", trustedContentType: true, inline: true });
    expect(h["Content-Type"]).toBe("text/csv; charset=utf-8");
    expect(h["Content-Disposition"].startsWith("attachment;")).toBe(true);
    securityHeaders(h);
  });

  it("extra headers cannot override the security headers", () => {
    const h = fileResponseHeaders({
      filename: "a.html",
      contentType: "text/html",
      headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src *", "X-Evidence-Sha256": "abc" },
    });
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Security-Policy"]).toBe(FILE_RESPONSE_CSP);
    expect(h["X-Evidence-Sha256"]).toBe("abc");
    expect(h["Cache-Control"]).toBe("no-store");
  });
});

describe("filename handling", () => {
  it("strips header-breaking characters", () => {
    expect(sanitizeFilename('evil"\r\nSet-Cookie: a=b.html')).toBe("evil_Set-Cookie_ a=b.html");
    expect(sanitizeFilename("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(sanitizeFilename("")).toBe("download");
    expect(sanitizeFilename(null)).toBe("download");
  });

  it("emits an ASCII fallback plus RFC 5987 filename*", () => {
    const cd = contentDisposition("attachment", "résumé (final).pdf");
    expect(cd).toBe(`attachment; filename="r_sum_ (final).pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%28final%29.pdf`);
    expect(cd).not.toMatch(/[\r\n]/);
  });
});

describe("upload type sniffing", () => {
  it("recognizes allowlisted magic bytes", () => {
    expect(sniffMimeType(PNG)).toBe("image/png");
    expect(sniffMimeType(JPEG)).toBe("image/jpeg");
    expect(sniffMimeType(GIF)).toBe("image/gif");
    expect(sniffMimeType(WEBP)).toBe("image/webp");
    expect(sniffMimeType(PDF)).toBe("application/pdf");
    expect(sniffMimeType(HTML)).toBeNull();
  });

  it("ignores the client-declared type", () => {
    expect(safeStoredMimeType(HTML, "text/html")).toBe("application/octet-stream");
    expect(safeStoredMimeType(SVG, "image/svg+xml")).toBe("application/octet-stream");
    expect(safeStoredMimeType(HTML, "image/png")).toBe("application/octet-stream");
    expect(safeStoredMimeType(PNG, "text/html")).toBe("image/png");
    expect(safeStoredMimeType(PDF, "")).toBe("application/pdf");
  });

  it("keeps text/plain only for text-looking bytes", () => {
    expect(safeStoredMimeType(new TextEncoder().encode("hello log line\n"), "text/plain")).toBe("text/plain");
    expect(safeStoredMimeType(new Uint8Array([0x68, 0x00, 0x69]), "text/plain")).toBe("application/octet-stream");
    expect(safeStoredMimeType(new TextEncoder().encode("a,b\n1,2"), "text/csv")).toBe("application/octet-stream");
  });
});

describe("fileResponse", () => {
  it("builds a response with body, length and headers", async () => {
    const res = fileResponse(PNG, { filename: "a.png", contentType: "image/png", inline: true, headers: { "X-Attachment-Integrity": "verified" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-attachment-integrity")).toBe("verified");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("serves an uploaded html file as a download", () => {
    const res = fileResponse(HTML, { filename: "x.html", contentType: "text/html", inline: true });
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });
});
