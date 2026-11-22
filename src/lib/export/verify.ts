// Recipient-side verification of a case-file export (.cxz).
//
// Node-only and dependency-light on purpose (node:crypto + jszip, no app
// imports): `scripts/verify-export.ts` runs it standalone for external
// counsel / insurers / regulators, and the unit tests exercise the same code.
//
// Package format (see ./build.ts):
//   "CXZ1\n" + JSON header {magic, alg:"aes-256-gcm", kdf:"scrypt", N, r, p,
//   salt, iv, tag (base64)} + "\n" + AES-256-GCM ciphertext of a ZIP.
// The ZIP holds the case files, MANIFEST.json (canonical JSON listing every
// file's path/size/sha256) and SEAL (Ed25519 signature over MANIFEST.json's
// exact bytes, plus the signing public key).

import { createDecipheriv, createHash, createPublicKey, scryptSync, verify as cryptoVerify } from "node:crypto";
import JSZip from "jszip";

const CXZ_MAGIC = "CXZ1";

interface CxzHeader {
  magic: string;
  alg: string;
  kdf: string;
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
}

/** Thrown for a file that isn't a CXZ1 package or whose header is malformed. */
export class CxzFormatError extends Error {}

/** Thrown when AES-GCM authentication fails: wrong passphrase or a modified package. */
export class CxzDecryptError extends Error {}

function parseHeader(cxz: Buffer): { header: CxzHeader; ciphertext: Buffer } {
  const firstNl = cxz.indexOf(0x0a);
  const secondNl = firstNl < 0 ? -1 : cxz.indexOf(0x0a, firstNl + 1);
  if (firstNl < 0 || secondNl < 0 || cxz.subarray(0, firstNl).toString("utf8") !== CXZ_MAGIC) {
    throw new CxzFormatError("Not a recognized case-file package (missing CXZ1 header).");
  }
  let header: CxzHeader;
  try {
    header = JSON.parse(cxz.subarray(firstNl + 1, secondNl).toString("utf8")) as CxzHeader;
  } catch {
    throw new CxzFormatError("Case-file package header is not valid JSON.");
  }
  if (header.magic !== CXZ_MAGIC || header.alg !== "aes-256-gcm" || header.kdf !== "scrypt") {
    throw new CxzFormatError(`Unsupported package parameters (alg=${header.alg}, kdf=${header.kdf}).`);
  }
  for (const k of ["N", "r", "p"] as const) {
    if (!Number.isInteger(header[k]) || header[k] <= 0) throw new CxzFormatError(`Invalid scrypt parameter ${k}.`);
  }
  // The header is attacker-controlled (it is read BEFORE anything is
  // authenticated): bound the KDF cost so a crafted package can't make the
  // verifier allocate gigabytes or spin for minutes.
  const { N, r, p } = header;
  if (N < 2 || N > SCRYPT_LIMITS.maxN || (N & (N - 1)) !== 0) {
    throw new CxzFormatError(`Refusing scrypt N=${N} (must be a power of two, at most 2^20).`);
  }
  if (r > SCRYPT_LIMITS.maxR) throw new CxzFormatError(`Refusing scrypt r=${r} (at most ${SCRYPT_LIMITS.maxR}).`);
  if (p > SCRYPT_LIMITS.maxP) throw new CxzFormatError(`Refusing scrypt p=${p} (at most ${SCRYPT_LIMITS.maxP}).`);
  if (scryptMemBytes(N, r, p) > SCRYPT_LIMITS.maxMemBytes) {
    throw new CxzFormatError(`Refusing scrypt parameters N=${N}, r=${r}: memory cost exceeds 1 GiB.`);
  }
  if (typeof header.iv !== "string" || Buffer.from(header.iv, "base64").length !== GCM_IV_BYTES) {
    throw new CxzFormatError("Invalid AES-GCM IV (must be 12 bytes).");
  }
  if (typeof header.tag !== "string" || Buffer.from(header.tag, "base64").length !== GCM_TAG_BYTES) {
    throw new CxzFormatError("Invalid AES-GCM authentication tag (must be 16 bytes).");
  }
  if (typeof header.salt !== "string" || Buffer.from(header.salt, "base64").length < 16) {
    throw new CxzFormatError("Invalid scrypt salt (must be at least 16 bytes).");
  }
  return { header, ciphertext: cxz.subarray(secondNl + 1) };
}

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Upper bounds on the scrypt cost a package header may request. */
export const SCRYPT_LIMITS = { maxN: 2 ** 20, maxR: 16, maxP: 4, maxMemBytes: 1024 * 1024 * 1024 } as const;

/** Approximate scrypt working memory (Node's own estimate: 128·N·r + 128·r·p). */
function scryptMemBytes(N: number, r: number, p: number): number {
  return 128 * N * r + 128 * r * p;
}

/**
 * Decrypt a .cxz with its passphrase, returning the inner ZIP. Uses the scrypt
 * parameters recorded in the header (bounded by SCRYPT_LIMITS). Throws
 * CxzFormatError / CxzDecryptError.
 */
export function decryptCxz(cxz: Buffer, passphrase: string): Buffer {
  const { header, ciphertext } = parseHeader(cxz);
  // Bounded: at most SCRYPT_LIMITS.maxMemBytes plus 1 MiB headroom.
  const maxmem = scryptMemBytes(header.N, header.r, header.p) + 1024 * 1024;
  const key = scryptSync(passphrase, Buffer.from(header.salt, "base64"), 32, {
    N: header.N,
    r: header.r,
    p: header.p,
    maxmem,
  });
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"), {
      authTagLength: GCM_TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(header.tag, "base64"));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new CxzDecryptError("Decryption failed: wrong passphrase, or the package was modified.");
  }
}

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyReport {
  ok: boolean;
  checks: VerifyCheck[];
  /** Selected manifest facts for the report header (when the manifest parsed). */
  summary?: {
    tool?: string;
    format?: string;
    incidentId?: string;
    generatedAt?: string;
    mode?: string;
    ledgerHead?: string;
    ledgerValid?: boolean;
    ledgerStatus?: string;
    fileCount: number;
  };
  /** True when the signature was checked against a key the recipient supplied. */
  trustedKey: boolean;
}

/** Printed (and the CLI exits non-zero) when origin could not be established. */
export const UNTRUSTED_MESSAGE =
  "UNTRUSTED: signature valid for embedded key only (self-signed, origin unverified)";

interface ManifestFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

const ATTESTATION_FILES = new Set(["MANIFEST.json", "SEAL"]);
const LEDGER_GENESIS = "0".repeat(64);
/** The only ledger hash scheme this verifier accepts (see src/lib/ledger/append.ts). */
const LEDGER_HASH_SCHEME = "hmac-sha256/ledger-v1";
const HEX64 = /^[0-9a-f]{64}$/;

function normalizePem(pem: string): string {
  return pem.replace(/\r\n/g, "\n").trim();
}

/**
 * Normalize a recipient-supplied signing public key to SPKI PEM. Accepts a
 * PEM, a base64-encoded PEM (the same convention as EXPORT_SIGNING_PRIVATE_KEY),
 * or base64 DER SPKI. Throws unless it is an Ed25519 public key.
 */
export function parseTrustedPublicKey(input: string): string {
  const text = input.trim();
  if (!text) throw new Error("empty public key");
  let pem: string | null = null;
  if (text.includes("-----BEGIN")) {
    pem = text;
  } else {
    const raw = Buffer.from(text.replace(/\s+/g, ""), "base64");
    const asText = raw.toString("utf8");
    if (asText.includes("-----BEGIN")) pem = asText;
    else {
      try {
        pem = createPublicKey({ key: raw, format: "der", type: "spki" }).export({ type: "spki", format: "pem" }).toString();
      } catch {
        throw new Error("public key is not a PEM, base64 PEM, or base64 DER SPKI key");
      }
    }
  }
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new Error("public key could not be parsed");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`public key must be Ed25519 (got ${key.asymmetricKeyType ?? "unknown"})`);
  }
  return key.export({ type: "spki", format: "pem" }).toString();
}

/**
 * Offline ledger check. Entry hashes are keyed (HMAC with the issuing
 * install's secret) and cannot be recomputed here, so this verifies what CAN
 * be checked without that secret: contiguous seq 1..n, genesis prevHash,
 * prevHash[i] == entryHash[i-1], and that the last entryHash equals the
 * ledgerHead pinned by the signed manifest.
 */
function checkLedgerLinkage(ledger: unknown, ledgerHead: string, ledgerEntries: unknown): string | null {
  if (!Array.isArray(ledger)) return "ledger.json is not an array of entries.";
  let prev = LEDGER_GENESIS;
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i] as { seq?: unknown; prevHash?: unknown; entryHash?: unknown };
    if (e?.seq !== i + 1) return `entry ${i + 1}: sequence gap or reorder (seq=${String(e?.seq)}).`;
    if (e.prevHash !== prev) return `entry ${i + 1}: prevHash does not link to the previous entry.`;
    if (typeof e.entryHash !== "string" || !HEX64.test(e.entryHash)) return `entry ${i + 1}: malformed entryHash.`;
    prev = e.entryHash;
  }
  if (prev !== ledgerHead) return "the last entryHash does not equal the manifest's ledgerHead.";
  if (typeof ledgerEntries === "number" && ledgerEntries !== ledger.length) {
    return `the manifest lists ${ledgerEntries} ledger entries but ledger.json has ${ledger.length}.`;
  }
  return null;
}

/**
 * Verify a decrypted case-file ZIP: the SEAL's Ed25519 signature over
 * MANIFEST.json, every listed file's SHA-256 and size, and that the ZIP holds
 * nothing the manifest doesn't cover. Pass `trustedPublicKeyPem` (obtained
 * from the sender out of band) to prove ORIGIN; without it the embedded key
 * only proves the contents weren't changed after signing.
 */
export async function verifyCaseFileZip(
  zipBytes: Buffer,
  opts: { trustedPublicKeyPem?: string } = {},
): Promise<VerifyReport> {
  const checks: VerifyCheck[] = [];
  const trustedKey = !!opts.trustedPublicKeyPem;
  const fail = (name: string, detail: string): VerifyReport => {
    checks.push({ name, ok: false, detail });
    return { ok: false, checks, trustedKey };
  };

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBytes);
  } catch {
    return fail("Open ZIP", "The decrypted payload is not a valid ZIP archive.");
  }
  checks.push({ name: "Open ZIP", ok: true });

  const manifestEntry = zip.file("MANIFEST.json");
  const sealEntry = zip.file("SEAL");
  if (!manifestEntry || !sealEntry) {
    return fail("Attestation files present", "MANIFEST.json and/or SEAL is missing.");
  }
  checks.push({ name: "Attestation files present", ok: true, detail: "MANIFEST.json, SEAL" });

  const manifestBytes = await manifestEntry.async("nodebuffer");
  let manifest: { files?: ManifestFile[]; publicKeyPem?: string } & Record<string, unknown>;
  let seal: { algorithm?: string; signature?: string; signedFile?: string; publicKeyPem?: string };
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
    seal = JSON.parse((await sealEntry.async("nodebuffer")).toString("utf8"));
  } catch {
    return fail("Parse manifest and seal", "MANIFEST.json or SEAL is not valid JSON.");
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const summary: VerifyReport["summary"] = {
    tool: typeof manifest.tool === "string" ? manifest.tool : undefined,
    format: typeof manifest.format === "string" ? manifest.format : undefined,
    incidentId: typeof manifest.incidentId === "string" ? manifest.incidentId : undefined,
    generatedAt: typeof manifest.generatedAt === "string" ? manifest.generatedAt : undefined,
    mode: typeof manifest.mode === "string" ? manifest.mode : undefined,
    ledgerHead: typeof manifest.ledgerHead === "string" ? manifest.ledgerHead : undefined,
    ledgerValid: typeof manifest.ledgerValid === "boolean" ? manifest.ledgerValid : undefined,
    ledgerStatus: typeof manifest.ledgerStatus === "string" ? manifest.ledgerStatus : undefined,
    fileCount: files.length,
  };

  // 1. Signature over the manifest's exact bytes.
  const keyPem = opts.trustedPublicKeyPem ?? seal.publicKeyPem;
  if (seal.algorithm !== "ed25519" || !seal.signature || !keyPem) {
    checks.push({ name: "Signature", ok: false, detail: "SEAL is not an Ed25519 signature with a public key." });
  } else {
    let sigOk = false;
    try {
      sigOk = cryptoVerify(null, manifestBytes, createPublicKey(keyPem), Buffer.from(seal.signature, "base64"));
    } catch {
      sigOk = false;
    }
    checks.push({
      name: "Signature",
      ok: sigOk,
      detail: sigOk
        ? trustedKey
          ? "Ed25519 signature valid against the public key you supplied."
          : "Ed25519 signature valid against the key embedded in the package."
        : "Ed25519 signature does NOT match MANIFEST.json.",
    });
  }
  if (!trustedKey && seal.publicKeyPem && typeof manifest.publicKeyPem === "string") {
    const same = normalizePem(seal.publicKeyPem) === normalizePem(manifest.publicKeyPem);
    checks.push({
      name: "Embedded key consistency",
      ok: same,
      detail: same ? "SEAL and MANIFEST name the same signing key." : "SEAL and MANIFEST name different keys.",
    });
  }

  // 2. Every listed file is present with the listed size and SHA-256.
  const listed = new Set<string>();
  const bad: string[] = [];
  for (const f of files) {
    listed.add(f.path);
    const entry = zip.file(f.path);
    if (!entry) {
      bad.push(`${f.path}: missing`);
      continue;
    }
    const bytes = await entry.async("nodebuffer");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== f.sha256) bad.push(`${f.path}: SHA-256 mismatch`);
    else if (bytes.length !== f.sizeBytes) bad.push(`${f.path}: size mismatch`);
  }
  checks.push({
    name: "File hashes",
    ok: bad.length === 0 && files.length > 0,
    detail: files.length === 0 ? "The manifest lists no files." : bad.length === 0 ? `${files.length} file(s) match the manifest.` : bad.join("; "),
  });

  // 3. Nothing in the ZIP escapes the manifest (the seal wouldn't cover it).
  const extras = Object.values(zip.files)
    .filter((e) => !e.dir && !listed.has(e.name) && !ATTESTATION_FILES.has(e.name))
    .map((e) => e.name);
  checks.push({
    name: "No unlisted files",
    ok: extras.length === 0,
    detail: extras.length === 0 ? undefined : `Not covered by the manifest: ${extras.join(", ")}`,
  });

  // 4. Ledger chain linkage up to the signed ledgerHead (entry hashes are
  //    keyed and verifiable in-app only — see checkLedgerLinkage).
  if (typeof manifest.ledgerHead === "string") {
    const ledgerEntry = listed.has("ledger.json") ? zip.file("ledger.json") : null;
    let problem: string | null;
    if (!ledgerEntry) {
      problem = "ledger.json is missing or not covered by the manifest.";
    } else {
      try {
        const ledger = JSON.parse((await ledgerEntry.async("nodebuffer")).toString("utf8"));
        problem = checkLedgerLinkage(ledger, manifest.ledgerHead, manifest.ledgerEntries);
      } catch {
        problem = "ledger.json is not valid JSON.";
      }
    }
    checks.push({
      name: "Ledger chain linkage",
      ok: problem === null,
      detail:
        problem ??
        "seq, prevHash links and the final entryHash match the signed ledgerHead (keyed entry hashes are verified by the issuing install).",
    });

    // 5. The hash scheme must be one this verifier knows (fail closed on an
    //    unknown/missing scheme id), and the issuing install must have
    //    verified the keyed chain as intact at export time.
    const scheme = manifest.ledgerHashScheme;
    checks.push({
      name: "Ledger hash scheme",
      ok: scheme === LEDGER_HASH_SCHEME,
      detail:
        scheme === LEDGER_HASH_SCHEME
          ? `${LEDGER_HASH_SCHEME} (keyed; entry hashes verifiable by the issuing install only)`
          : `Unknown or missing ledger hash scheme ${JSON.stringify(scheme ?? null)}; expected ${LEDGER_HASH_SCHEME}.`,
    });
    const status = manifest.ledgerStatus;
    const issuerOk = manifest.ledgerValid === true && (status === undefined || status === "valid");
    checks.push({
      name: "Ledger verified by issuer",
      ok: issuerOk,
      detail: issuerOk
        ? "The issuing install verified every keyed entry hash and the signed chain head at export time."
        : `The issuing install did NOT verify the ledger as intact at export time (ledgerValid=${String(manifest.ledgerValid)}, ledgerStatus=${String(status)}).`,
    });
  }

  return { ok: checks.every((c) => c.ok), checks, summary, trustedKey };
}

/** Decrypt a .cxz and verify it. A wrong passphrase / bad format is a FAIL report, not a throw. */
export async function verifyCxz(
  cxz: Buffer,
  passphrase: string,
  opts: { trustedPublicKeyPem?: string } = {},
): Promise<{ report: VerifyReport; zip: Buffer | null }> {
  let zip: Buffer;
  try {
    zip = decryptCxz(cxz, passphrase);
  } catch (err) {
    return {
      report: {
        ok: false,
        checks: [{ name: "Decrypt", ok: false, detail: err instanceof Error ? err.message : String(err) }],
        trustedKey: !!opts.trustedPublicKeyPem,
      },
      zip: null,
    };
  }
  const report = await verifyCaseFileZip(zip, opts);
  report.checks.unshift({ name: "Decrypt", ok: true, detail: "AES-256-GCM authenticated with the passphrase." });
  return { report, zip };
}

/** Human-readable PASS/FAIL report. */
export function formatVerifyReport(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push(
    `Case-file verification: ${report.ok ? (report.trustedKey ? "PASS" : "PASS (UNTRUSTED ORIGIN)") : "FAIL"}`,
  );
  if (report.summary) {
    const s = report.summary;
    if (s.incidentId) lines.push(`  Incident:      ${s.incidentId}`);
    if (s.generatedAt) lines.push(`  Generated:     ${s.generatedAt}`);
    if (s.mode) lines.push(`  Mode:          ${s.mode}`);
    if (s.tool || s.format) lines.push(`  Format:        ${[s.tool, s.format].filter(Boolean).join(" / ")}`);
    if (s.ledgerHead) lines.push(`  Ledger head:   ${s.ledgerHead}${s.ledgerValid === false ? " (chain was NOT intact at export time)" : ""}`);
    if (s.ledgerStatus) lines.push(`  Ledger status: ${s.ledgerStatus} (as verified by the issuing install)`);
    lines.push(`  Files listed:  ${s.fileCount}`);
  }
  lines.push("");
  for (const c of report.checks) {
    lines.push(`  [${c.ok ? "PASS" : "FAIL"}] ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  }
  if (report.ok && !report.trustedKey) {
    lines.push("");
    lines.push(`  ${UNTRUSTED_MESSAGE}`);
    lines.push(
      "  The embedded key proves the contents are unchanged since signing, but anyone can re-seal a",
    );
    lines.push(
      "  package with their own key. To prove WHO signed it, get the sender's public key out of band and",
    );
    lines.push("  re-run with --public-key <file.pem | base64> (or set EXPORT_VERIFY_PUBLIC_KEY).");
  }
  return lines.join("\n");
}
