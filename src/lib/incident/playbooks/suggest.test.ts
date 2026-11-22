import { describe, expect, it } from "vitest";
import { rankPlaybookDocuments, type PlaybookDocCandidate } from "./suggest";

const doc = (id: string, title: string, text = "", headings: string[] = []): PlaybookDocCandidate => ({ id, title, text, scope: "local", collection: null, headings });

const DOCS = [
  doc("rw", "Ransomware and extortion response", "Covers encryption of file servers. T1486 data encrypted for impact.", ["Contain", "Recover"]),
  doc("bec", "Business email compromise and wire fraud", "Invoice fraud and phishing of finance staff.", ["Call the bank"]),
  doc("idp", "Identity provider compromise", "Help desk social engineering and MFA resets.", ["Revoke sessions"]),
  doc("bcp", "Business continuity: site loss", "Fire or flood at a site.", ["Relocate staff"]),
];

describe("rankPlaybookDocuments", () => {
  it("puts the category match first and leaves unrelated documents out", () => {
    const ranked = rankPlaybookDocuments({ title: "File servers down", category: "ransomware" }, DOCS);
    expect(ranked[0].id).toBe("rw");
    expect(ranked[0].reasons[0]).toBe("Title matches ransomware");
    expect(ranked.map((r) => r.id)).not.toContain("bcp");
  });

  it("matches a category word in the text when the title does not have it", () => {
    const ranked = rankPlaybookDocuments({ title: "Finance mailbox", category: "phishing" }, DOCS);
    expect(ranked[0].id).toBe("bec");
  });

  it("scores ATT&CK tags the document mentions", () => {
    const ranked = rankPlaybookDocuments({ title: "Unknown", category: null, tags: ["T1486", "not-a-technique"] }, DOCS);
    expect(ranked.map((r) => r.id)).toEqual(["rw"]);
    expect(ranked[0].reasons).toEqual(["Mentions T1486"]);
  });

  it("uses shared keywords from the incident title and description", () => {
    const ranked = rankPlaybookDocuments({ title: "Identity provider outage", description: "Sessions look odd", category: "other" }, DOCS);
    expect(ranked[0].id).toBe("idp");
    expect(rankPlaybookDocuments({ title: "", category: null }, DOCS)).toEqual([]);
  });
});
