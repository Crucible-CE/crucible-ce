// @vitest-environment node
// Recipient-side verifier: decrypt a real CXZ1 package (made by the same
// encryptPackage the app uses), check the Ed25519 seal and the manifest hashes.
import { describe, it, expect, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import JSZip from "jszip";

// build.ts pulls in the DB/PDF/storage stack at import time; only its
// encryptPackage is used here.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ledger/append", () => ({ appendLedger: vi.fn(), verifyLedger: vi.fn(), verifyLedgerAnchored: vi.fn(), LEDGER_GENESIS_HASH: "0" }));
vi.mock("@/lib/evidence/storage", () => ({ readEvidence: vi.fn() }));
vi.mock("./storage", () => ({ writeExportPackage: vi.fn() }));
vi.mock("./gather", () => ({ gatherIncident: vi.fn() }));
vi.mock("./case-file-pdf", () => ({ renderCaseFilePdf: vi.fn() }));

import { encryptPackage, decryptPackage } from "./build";
import {
  decryptCxz,
  verifyCaseFileZip,
  verifyCxz,
  formatVerifyReport,
  parseTrustedPublicKey,
  CxzDecryptError,
  CxzFormatError,
  UNTRUSTED_MESSAGE,
} from "./verify";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("ed25519");
const otherPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// A linked 3-entry ledger (entry hashes are opaque offline; only linkage is checked).
function makeLedger() {
  const h = (n: number) => sha(Buffer.from(`entry-${n}`));
  const genesis = "0".repeat(64);
  return [1, 2, 3].map((seq) => ({ seq, eventType: "note_added", prevHash: seq === 1 ? genesis : h(seq - 1), entryHash: h(seq) }));
}

type LedgerRow = ReturnType<typeof makeLedger>[number];

async function makeZip(
  opts: { tamperFile?: boolean; extraFile?: boolean; tamperManifest?: boolean; ledger?: LedgerRow[]; ledgerHead?: string; scheme?: string | null; ledgerStatus?: string } = {},
) {
  const ledger = opts.ledger ?? makeLedger();
  const files = [
    { path: "incident-data.json", bytes: Buffer.from('{"title":"Phish"}') },
    { path: "ledger.json", bytes: Buffer.from(JSON.stringify(ledger, null, 2)) },
    { path: "evidence/e1__log.txt", bytes: Buffer.from("evidence bytes") },
  ];
  const manifest = {
    tool: "Crucible CE",
    format: "incident-case-file/1",
    incidentId: "inc-1",
    ledgerHead: opts.ledgerHead ?? makeLedger()[2].entryHash,
    ledgerValid: (opts.ledgerStatus ?? "valid") === "valid",
    ledgerEntries: ledger.length,
    ledgerHashScheme: opts.scheme === undefined ? "hmac-sha256/ledger-v1" : opts.scheme ?? undefined,
    ledgerStatus: opts.ledgerStatus ?? "valid",
    publicKeyPem,
    files: files.map((f) => ({ path: f.path, sizeBytes: f.bytes.length, sha256: sha(f.bytes) })),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  const signature = sign(null, manifestBytes, privateKey).toString("base64");
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, opts.tamperFile && f.path.startsWith("evidence/") ? Buffer.from("EVIL") : f.bytes);
  zip.file("MANIFEST.json", opts.tamperManifest ? Buffer.from(JSON.stringify({ ...manifest, incidentId: "inc-2" })) : manifestBytes);
  zip.file("SEAL", JSON.stringify({ algorithm: "ed25519", signature, signedFile: "MANIFEST.json", publicKeyPem }));
  if (opts.extraFile) zip.file("smuggled.txt", "not in the manifest");
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("decryptCxz", () => {
  it("round-trips encryptPackage (and build.ts decryptPackage delegates to it)", async () => {
    const zip = await makeZip();
    const cxz = encryptPackage(zip, "ABCDE-FGHJK-MNPQR-STUVW");
    expect(decryptCxz(cxz, "ABCDE-FGHJK-MNPQR-STUVW").equals(zip)).toBe(true);
    expect(decryptPackage(cxz, "ABCDE-FGHJK-MNPQR-STUVW").equals(zip)).toBe(true);
  });

  it("rejects a wrong passphrase", async () => {
    const cxz = encryptPackage(await makeZip(), "right");
    expect(() => decryptCxz(cxz, "wrong")).toThrow(CxzDecryptError);
  });

  it("rejects a modified ciphertext", async () => {
    const cxz = encryptPackage(await makeZip(), "pw");
    cxz[cxz.length - 1] ^= 0xff;
    expect(() => decryptCxz(cxz, "pw")).toThrow(CxzDecryptError);
  });

  it("rejects a non-CXZ file", () => {
    expect(() => decryptCxz(Buffer.from("PK\u0003\u0004 not a cxz"), "pw")).toThrow(CxzFormatError);
  });
});

describe("verifyCxz / verifyCaseFileZip", () => {
  it("PASSes an untouched package", async () => {
    const { report, zip } = await verifyCxz(encryptPackage(await makeZip(), "pw"), "pw");
    expect(report.ok).toBe(true);
    expect(zip).not.toBeNull();
    expect(report.summary?.incidentId).toBe("inc-1");
    expect(report.summary?.fileCount).toBe(3);
    expect(formatVerifyReport(report)).toMatch(/^Case-file verification: PASS/);
  });

  it("FAILs (not throws) on a wrong passphrase", async () => {
    const { report, zip } = await verifyCxz(encryptPackage(await makeZip(), "pw"), "nope");
    expect(report.ok).toBe(false);
    expect(zip).toBeNull();
    expect(report.checks[0]).toMatchObject({ name: "Decrypt", ok: false });
  });

  it("FAILs when a file no longer matches its manifest hash", async () => {
    const report = await verifyCaseFileZip(await makeZip({ tamperFile: true }));
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "File hashes")).toMatchObject({ ok: false });
  });

  it("FAILs when the manifest was edited after signing", async () => {
    const report = await verifyCaseFileZip(await makeZip({ tamperManifest: true }));
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "Signature")).toMatchObject({ ok: false });
  });

  it("FAILs on a file the manifest doesn't cover", async () => {
    const report = await verifyCaseFileZip(await makeZip({ extraFile: true }));
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "No unlisted files")).toMatchObject({ ok: false });
  });

  it("checks origin against a trusted key when one is supplied", async () => {
    const zip = await makeZip();
    expect((await verifyCaseFileZip(zip, { trustedPublicKeyPem: publicKeyPem })).ok).toBe(true);
    const wrongSigner = await verifyCaseFileZip(zip, { trustedPublicKeyPem: otherPem });
    expect(wrongSigner.ok).toBe(false);
    expect(wrongSigner.trustedKey).toBe(true);
  });
});

// Rewrite a CXZ1 header field (the header is unauthenticated until GCM runs).
function withHeader(cxz: Buffer, patch: Record<string, unknown>): Buffer {
  const first = cxz.indexOf(0x0a);
  const second = cxz.indexOf(0x0a, first + 1);
  const header = { ...JSON.parse(cxz.subarray(first + 1, second).toString("utf8")), ...patch };
  return Buffer.concat([Buffer.from(`CXZ1\n${JSON.stringify(header)}\n`), cxz.subarray(second + 1)]);
}

describe("L2/L11 header hardening", () => {
  it("rejects a truncated (short) GCM tag", async () => {
    const cxz = encryptPackage(await makeZip(), "pw");
    const first = cxz.indexOf(0x0a);
    const second = cxz.indexOf(0x0a, first + 1);
    const tag = Buffer.from(JSON.parse(cxz.subarray(first + 1, second).toString()).tag, "base64");
    expect(tag.length).toBe(16);
    for (const len of [4, 8, 12]) {
      expect(() => decryptCxz(withHeader(cxz, { tag: tag.subarray(0, len).toString("base64") }), "pw")).toThrow(
        CxzFormatError,
      );
    }
  });

  it.each([
    [{ N: 2 ** 21 }, /N=/],
    [{ N: 3000 }, /power of two/],
    [{ r: 17 }, /r=17/],
    [{ p: 5 }, /p=5/],
    [{ N: 2 ** 20, r: 16 }, /1 GiB/],
  ])("rejects excessive scrypt params %o before running the KDF", async (patch, msg) => {
    const cxz = encryptPackage(await makeZip(), "pw");
    expect(() => decryptCxz(withHeader(cxz, patch), "pw")).toThrow(msg);
  });

  it("rejects a malformed IV", async () => {
    const cxz = encryptPackage(await makeZip(), "pw");
    expect(() => decryptCxz(withHeader(cxz, { iv: Buffer.alloc(8).toString("base64") }), "pw")).toThrow(/IV/);
  });
});

describe("offline ledger linkage", () => {
  it("FAILs when a ledger entry's prevHash no longer links", async () => {
    const ledger = makeLedger();
    ledger[1].prevHash = "f".repeat(64);
    const report = await verifyCaseFileZip(await makeZip({ ledger }));
    expect(report.checks.find((c) => c.name === "Ledger chain linkage")).toMatchObject({ ok: false });
    expect(report.ok).toBe(false);
  });

  it("FAILs when the last entry is not the signed ledgerHead (tail dropped)", async () => {
    const ledger = makeLedger().slice(0, 2);
    const report = await verifyCaseFileZip(await makeZip({ ledger }));
    expect(report.checks.find((c) => c.name === "Ledger chain linkage")?.ok).toBe(false);
  });

  it("FAILs on a seq gap", async () => {
    const ledger = makeLedger();
    ledger[2].seq = 7;
    const report = await verifyCaseFileZip(await makeZip({ ledger }));
    expect(report.checks.find((c) => c.name === "Ledger chain linkage")?.ok).toBe(false);
  });

  it("an empty ledger links when the head is genesis", async () => {
    const report = await verifyCaseFileZip(await makeZip({ ledger: [], ledgerHead: "0".repeat(64) }));
    expect(report.checks.find((c) => c.name === "Ledger chain linkage")?.ok).toBe(true);
    expect(report.ok).toBe(true);
  });
});

describe("pinned-key trust", () => {
  it("reports UNTRUSTED when only the embedded key was used", async () => {
    const report = await verifyCaseFileZip(await makeZip());
    expect(report.ok).toBe(true);
    expect(report.trustedKey).toBe(false);
    const text = formatVerifyReport(report);
    expect(text).toContain(UNTRUSTED_MESSAGE);
    expect(text).toMatch(/^Case-file verification: PASS \(UNTRUSTED ORIGIN\)/);
  });

  it("no UNTRUSTED warning with a pinned key", async () => {
    const report = await verifyCaseFileZip(await makeZip(), { trustedPublicKeyPem: publicKeyPem });
    expect(formatVerifyReport(report)).not.toContain("UNTRUSTED");
  });

  it("parseTrustedPublicKey accepts PEM, base64 PEM and base64 DER SPKI; rejects non-Ed25519", () => {
    const der = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const b64pem = Buffer.from(publicKeyPem).toString("base64");
    for (const input of [publicKeyPem, b64pem, der]) {
      expect(parseTrustedPublicKey(input).trim()).toBe(publicKeyPem.trim());
    }
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => parseTrustedPublicKey(rsa)).toThrow(/Ed25519/);
    expect(() => parseTrustedPublicKey("not a key")).toThrow();
  });
});

describe("ledger scheme + issuer status (fail closed)", () => {
  it("FAILs on an unknown ledger hash scheme", async () => {
    const report = await verifyCaseFileZip(await makeZip({ scheme: "sha256/unkeyed-v0" }));
    expect(report.checks.find((c) => c.name === "Ledger hash scheme")?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  it("FAILs when the scheme id is missing", async () => {
    const report = await verifyCaseFileZip(await makeZip({ scheme: null }));
    expect(report.checks.find((c) => c.name === "Ledger hash scheme")?.ok).toBe(false);
  });

  it.each(["tampered", "head_unsigned", "something-new"])("FAILs when the issuer reported ledgerStatus=%s", async (ledgerStatus) => {
    const report = await verifyCaseFileZip(await makeZip({ ledgerStatus }));
    expect(report.checks.find((c) => c.name === "Ledger verified by issuer")?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });
});
