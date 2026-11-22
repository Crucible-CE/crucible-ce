// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_INVITES, inviteBody, inviteMailto, inviteStart, inviteSubject, isValidEmail, joinLink, parseInviteEmails, publicBaseUrl } from "./invite";

describe("parseInviteEmails", () => {
  it("splits on commas, semicolons and newlines, trims and dedupes", () => {
    const r = parseInviteEmails(" a@example.com,b@example.org\nA@Example.com; <c@sub.example.co.uk>\n\n");
    expect(r).toEqual({ ok: true, emails: ["a@example.com", "b@example.org", "c@sub.example.co.uk"] });
  });

  it("refuses an empty list", () => {
    expect(parseInviteEmails(" ,\n ")).toEqual({ ok: false, error: "Enter at least one email address." });
  });

  it("names the first bad address", () => {
    const r = parseInviteEmails("ok@example.com, not-an-email");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not-an-email is not a valid email address.");
  });

  it(`caps the list at ${MAX_INVITES}`, () => {
    const many = Array.from({ length: MAX_INVITES + 1 }, (_, i) => `p${i}@example.com`).join("\n");
    expect(parseInviteEmails(many)).toEqual({ ok: false, error: `Use ${MAX_INVITES} addresses or fewer.` });
    const exact = Array.from({ length: MAX_INVITES }, (_, i) => `p${i}@example.com`).join(",");
    const r = parseInviteEmails(exact);
    expect(r.ok && r.emails.length).toBe(MAX_INVITES);
  });

  it("rejects header and envelope tricks", () => {
    const bad = ["a@b", "a@@b.com", "a b@c.com", "a@b.com\r\nBcc: x@y.com", '"q"@b.com', "a@-b.com", "a..b@c.com", ".a@b.com", "a@b.c0m", `${"x".repeat(65)}@b.com`];
    for (const v of bad) expect(isValidEmail(v), v).toBe(false);
    for (const v of ["first.last+tag@example.com", "o'neil@example.ie", "x@xn--bcher-kva.example"]) expect(isValidEmail(v), v).toBe(true);
  });
});

describe("join link and start", () => {
  it("uses PUBLIC_URL as an origin", () => {
    expect(publicBaseUrl({ PUBLIC_URL: "https://ttx.example.com/some/path" })).toBe("https://ttx.example.com");
    expect(publicBaseUrl({ PUBLIC_URL: "javascript:alert(1)" })).toBeNull();
    expect(publicBaseUrl({})).toBeNull();
    expect(joinLink("https://ttx.example.com/", "ABCD2345")).toBe("https://ttx.example.com/join/ABCD2345");
  });

  it("prefers the start time and falls back to a future scenario start only", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(inviteStart("2026-11-01T14:00:00Z", "2027-01-01T00:00:00Z", now)?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(inviteStart(null, "2026-10-21T09:00:00Z", now)?.toISOString()).toBe("2026-10-21T09:00:00.000Z");
    expect(inviteStart(null, "2024-03-01T09:00:00Z", now)).toBeNull();
    expect(inviteStart(null, null, now)).toBeNull();
  });
});

describe("invite text", () => {
  const text = {
    title: "Ransomware drill",
    startLabel: "2026-11-01 10:00 EDT",
    joinUrl: "https://ttx.example.com/join/ABCD2345",
    code: "ABCD2345",
    note: "Bring your laptop.",
  };

  it("names the title, start, link, code and note", () => {
    const body = inviteBody(text);
    expect(body).toContain("Ransomware drill");
    expect(body).toContain("Start: 2026-11-01 10:00 EDT");
    expect(body).toContain("Join: https://ttx.example.com/join/ABCD2345");
    expect(body).toContain("Code: ABCD2345");
    expect(body).toContain("Bring your laptop.");
    expect(body).not.toMatch(/[–—]/);
    expect(inviteBody({ ...text, startLabel: null, note: "" })).not.toContain("Start:");
  });

  it("keeps the subject on one line", () => {
    expect(inviteSubject("A\r\nBcc: x@y.com")).toBe("Invitation: A Bcc: x@y.com");
  });

  it("builds a mailto with the same text and every address in Bcc", () => {
    const href = inviteMailto(["a@example.com", "b@example.com"], text);
    expect(href.startsWith("mailto:?bcc=a%40example.com%2Cb%40example.com&subject=")).toBe(true);
    const body = new URLSearchParams(href.slice("mailto:?".length)).get("body");
    expect(body).toBe(inviteBody(text));
  });
});
