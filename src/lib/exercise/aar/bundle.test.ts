// @vitest-environment node
// Evidence bundle: built in memory with a generated key, verified, then
// tampered one byte at a time. Also checks that PDF and DOCX render.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { aarSectionsSchema } from "./schema";
import { signDocument } from "./sign";
import { keyIdFor } from "./keys";
import { canonicalize } from "./canonical";
import { assembleBundle } from "./bundle";
import { MAX_INFLATED_BYTES, checkPins, verifyBundle } from "./verify";
import { sha256Hex } from "./sign";
import { renderAarPdf } from "./pdf";
import { renderAarDocx } from "./docx";
import { documentBodyHash } from "./document";
import { fixtureDocument, fixtureSections } from "./test-fixture";
import type { AarRenderMeta } from "./labels";

function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(), keyId: keyIdFor(publicKey) };
}

const meta = (draft: boolean, sig?: AarRenderMeta["signature"]): AarRenderMeta => ({ instanceName: "Fixture Org", timezone: "America/New_York", draft, signature: sig ?? null });

async function freshBundle() {
  const key = makeKey();
  const doc = fixtureDocument();
  const envelope = signDocument(doc, key, new Date("2026-03-09T12:00:00Z"));
  const m = meta(false, { keyId: envelope.keyId, signedAt: envelope.signedAt, contentHash: envelope.contentHash });
  const [pdf, docx] = await Promise.all([renderAarPdf(doc, m), renderAarDocx(doc, m)]);
  const zip = await assembleBundle({ envelope, publicKeyPem: key.publicKeyPem, pdf, docx, timezone: m.timezone, manifestKey: key });
  return { zip, key, envelope };
}

async function tamper(zipBytes: Buffer, path: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(zipBytes);
  const bytes = Buffer.from(await zip.file(path)!.async("nodebuffer"));
  const at = Math.floor(bytes.length / 2);
  bytes[at] = bytes[at] ^ 0x01;
  zip.file(path, bytes);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("fixture", () => {
  it("parses as AAR sections", () => {
    expect(aarSectionsSchema.safeParse(fixtureSections()).success).toBe(true);
  });
});

describe("PDF and DOCX", () => {
  it("render a draft and a final without throwing", async () => {
    const doc = fixtureDocument();
    const pdf = await renderAarPdf(doc, meta(true));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const final = await renderAarPdf(doc, meta(false, { keyId: "abcd1234abcd1234", signedAt: doc.generatedAt, contentHash: "0".repeat(64) }));
    expect(final.length).toBeGreaterThan(1000);
    const docx = await renderAarDocx(doc, meta(true));
    const zip = await JSZip.loadAsync(docx);
    expect(zip.file("word/document.xml")).toBeTruthy();
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Appendix A. Improvement plan");
    expect(xml).toContain("Add legal to the first call tree.");
  }, 60_000);

  it("render an empty report", async () => {
    const doc = fixtureDocument();
    doc.aar.sections = { ...doc.aar.sections, analysis: [], decisionLog: [], clocks: [], controlMapping: [], roster: [], requiredRoles: [], parkingLot: [] };
    doc.actionItems = [];
    doc.signers = [];
    await expect(renderAarPdf(doc, meta(true))).resolves.toBeInstanceOf(Buffer);
    await expect(renderAarDocx(doc, meta(true))).resolves.toBeInstanceOf(Buffer);
  }, 60_000);
});

describe("signed document", () => {
  it("body hash ignores signers and generatedAt but covers action items", () => {
    const a = fixtureDocument();
    const b = { ...fixtureDocument(), signers: [], generatedAt: "2030-01-01T00:00:00.000Z" };
    expect(documentBodyHash(a)).toBe(documentBodyHash(b));
    const c = fixtureDocument();
    c.actionItems[0].status = "done";
    expect(documentBodyHash(c)).not.toBe(documentBodyHash(a));
  });
});

describe("evidence bundle", () => {
  it("verifies when untouched", async () => {
    const { zip, envelope } = await freshBundle();
    const r = await verifyBundle(zip);
    expect(r.reasons).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.keyId).toBe(envelope.keyId);
    expect(r.contentHash).toBe(envelope.contentHash);
  }, 60_000);

  it("carries the expected files and evidence", async () => {
    const { zip, envelope } = await freshBundle();
    const z = await JSZip.loadAsync(zip);
    const names = Object.keys(z.files).sort();
    expect(names).toEqual(
      [
        "README.txt",
        "aar.docx",
        "aar.pdf",
        "aar.signature.bin",
        "aar.signed-payload.json",
        "aar.signed.json",
        "decision-log.csv",
        "improvement-plan.csv",
        "findings.csv",
        "manifest.json",
        "manifest.sig",
        "manifest.sig.bin",
        "public-key.pem",
        "roster.csv",
        "evidence-quotes.json",
      ].sort(),
    );
    const readme = await z.file("README.txt")!.async("string");
    expect(readme).toContain(envelope.keyId);
    expect(readme).toContain("openssl pkeyutl -verify -pubin -inkey public-key.pem -rawin -in manifest.json -sigfile manifest.sig.bin");
    expect(readme).not.toMatch(/[\u2013\u2014]/);
    const roster = await z.file("roster.csv")!.async("string");
    expect(roster.split("\r\n")[0]).toContain("Attendance");
    expect(roster).toContain("Partial");
    const signed = await z.file("aar.signed.json")!.async("string");
    expect(signed).toBe(canonicalize(envelope));
    const quotes = JSON.parse(await z.file("evidence-quotes.json")!.async("string")) as Array<{ quote: string }>;
    expect(quotes.map((q) => q.quote)).toContain("Has anyone told legal yet?");
    const ip = await z.file("improvement-plan.csv")!.async("string");
    expect(ip).toContain("Add legal to the first call tree.");
  }, 60_000);

  it("fails after one byte changes in any file", async () => {
    const { zip } = await freshBundle();
    const names = Object.keys((await JSZip.loadAsync(zip)).files);
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const name of names) {
      const r = await verifyBundle(await tamper(zip, name));
      expect(r.ok, `tampered ${name} still passed`).toBe(false);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it("fails when a file is added or removed", async () => {
    const { zip } = await freshBundle();
    const z = await JSZip.loadAsync(zip);
    z.file("extra.txt", "hello");
    expect((await verifyBundle(await z.generateAsync({ type: "nodebuffer" }))).ok).toBe(false);
    const z2 = await JSZip.loadAsync(zip);
    z2.remove("roster.csv");
    expect((await verifyBundle(await z2.generateAsync({ type: "nodebuffer" }))).ok).toBe(false);
  }, 60_000);

  it("fails when re-signed with another key but the old public key stays", async () => {
    const { zip } = await freshBundle();
    const z = await JSZip.loadAsync(zip);
    const other = makeKey();
    z.file("public-key.pem", other.publicKeyPem);
    const r = await verifyBundle(await z.generateAsync({ type: "nodebuffer" }));
    expect(r.ok).toBe(false);
  }, 60_000);

  it("pins the signer: PASS only with the instance key", async () => {
    const { zip, key } = await freshBundle();
    const r = await verifyBundle(zip);
    expect(r.ok).toBe(true);
    expect(checkPins(r, [{ keyId: key.keyId }]).ok).toBe(true);
    expect(checkPins(r, [{ pem: key.publicKeyPem }]).ok).toBe(true);
    const other = makeKey();
    expect(checkPins(r, [{ keyId: other.keyId }]).ok).toBe(false);
    expect(checkPins(r, [{ pem: other.publicKeyPem }]).ok).toBe(false);
    expect(checkPins(r, []).ok).toBe(false);
    // A bundle re-signed end to end with another key verifies on its own but fails the pin.
    const forged = await JSZip.loadAsync(zip);
    const fake = makeKey();
    const doc = fixtureDocument();
    const env = signDocument(doc, fake, new Date("2026-03-09T12:00:00Z"));
    const pdf = await forged.file("aar.pdf")!.async("nodebuffer");
    const docx = await forged.file("aar.docx")!.async("nodebuffer");
    const forgedZip = await assembleBundle({ envelope: env, publicKeyPem: fake.publicKeyPem, pdf, docx, timezone: "UTC", manifestKey: fake });
    const fr = await verifyBundle(forgedZip);
    expect(fr.ok).toBe(true);
    expect(checkPins(fr, [{ keyId: key.keyId }]).ok).toBe(false);
  }, 60_000);

  it("verify-bundle.ts: UNPINNED without --key, PASS with the right key, FAIL with another", async () => {
    const { zip, key } = await freshBundle();
    const dir = mkdtempSync(path.join(tmpdir(), "aar-cli-"));
    try {
      const file = path.join(dir, "bundle.zip");
      writeFileSync(file, zip);
      const pem = path.join(dir, "key.pem");
      writeFileSync(pem, key.publicKeyPem);
      const cli = (...args: string[]) => spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/verify-bundle.ts", ...args], { encoding: "utf8" });
      const unpinned = cli(file);
      expect(unpinned.status).toBe(2);
      expect(unpinned.stdout).toMatch(/^UNPINNED: signature valid with the bundled key; pass --key to confirm the signer/);
      const pass = cli("--key", key.keyId, file);
      expect(pass.status, pass.stdout + pass.stderr).toBe(0);
      expect(pass.stdout).toMatch(/^PASS/);
      expect(cli("--key", pem, file).status).toBe(0);
      const wrong = cli("--key", makeKey().keyId, file);
      expect(wrong.status).toBe(1);
      expect(wrong.stdout).toMatch(/not a pinned key/);
      expect(cli("--key", "nope", file).status).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("refuses a bundle that would expand past the limit before inflating it", async () => {
    const z = new JSZip();
    z.file("big.bin", Buffer.alloc(MAX_INFLATED_BYTES + 1024));
    const bomb = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const r = await verifyBundle(bomb);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/expands to/);
  }, 60_000);

  it("verifies with OpenSSL alone, as README.txt says", async () => {
    const probe = spawnSync("openssl", ["version"], { encoding: "utf8" });
    if (probe.status !== 0) return; // OpenSSL not installed here; the verify script covers the same checks.
    const { zip } = await freshBundle();
    const dir = mkdtempSync(path.join(tmpdir(), "aar-bundle-"));
    try {
      const z = await JSZip.loadAsync(zip);
      for (const [name, entry] of Object.entries(z.files)) writeFileSync(path.join(dir, name), await entry.async("nodebuffer"));
      const run = (args: string[]) => execFileSync("openssl", args, { cwd: dir, encoding: "utf8" });
      expect(run(["pkeyutl", "-verify", "-pubin", "-inkey", "public-key.pem", "-rawin", "-in", "manifest.json", "-sigfile", "manifest.sig.bin"])).toMatch(/Signature Verified Successfully/);
      expect(run(["pkeyutl", "-verify", "-pubin", "-inkey", "public-key.pem", "-rawin", "-in", "aar.signed-payload.json", "-sigfile", "aar.signature.bin"])).toMatch(
        /Signature Verified Successfully/,
      );
      const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { files: Array<{ path: string; sha256: string }> };
      for (const f of manifest.files) expect(run(["dgst", "-sha256", f.path])).toContain(f.sha256);
      // One changed byte in the manifest fails the OpenSSL check.
      const m = readFileSync(path.join(dir, "manifest.json"));
      m[10] = m[10] ^ 0x01;
      writeFileSync(path.join(dir, "manifest.json"), m);
      const bad = spawnSync("openssl", ["pkeyutl", "-verify", "-pubin", "-inkey", "public-key.pem", "-rawin", "-in", "manifest.json", "-sigfile", "manifest.sig.bin"], { cwd: dir, encoding: "utf8" });
      expect(bad.status).not.toBe(0);
      expect(sha256Hex(m)).not.toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("rejects bytes that are not a zip", async () => {
    const r = await verifyBundle(Buffer.from("not a zip"));
    expect(r.ok).toBe(false);
  });
});

describe("report files", () => {
  it("print the confidentiality marking and the no-AI statement in the DOCX", async () => {
    const doc = fixtureDocument();
    const docx = await renderAarDocx(doc, { ...meta(false), marking: "Confidential" });
    const z = await JSZip.loadAsync(docx);
    const xml = Object.entries(z.files)
      .filter(([name]) => name.startsWith("word/") && name.endsWith(".xml"))
      .map(([, f]) => f);
    const text = (await Promise.all(xml.map((f) => f.async("string")))).join("\n");
    expect(text).toContain("No AI was used to write this report.");
    expect(text).toMatch(/CONFIDENTIAL|Confidential/);
    expect(text).not.toMatch(/AI models|AI endpoint|transcript used/i);
  }, 60_000);
});
