import { createHash, randomBytes, scryptSync, createCipheriv } from "crypto";
import JSZip from "jszip";
import { db } from "@/lib/db";
import { canonicalJson, sha256Hex } from "@/lib/crypto/hash";
import { appendLedger, verifyLedgerAnchored, LEDGER_GENESIS_HASH } from "@/lib/ledger/append";
import { readEvidence } from "@/lib/evidence/storage";
import { writeExportPackage } from "./storage";
import { gatherIncident, type ExportMode } from "./gather";
import { renderCaseFilePdf } from "./case-file-pdf";
import { signData, getPublicKeyPem, isSigningConfigured } from "./signing";
import { decryptCxz } from "./verify";

// ---------------------------------------------------------------------------
// Package encryption (.cxz)
//
// The case file is a ZIP. We wrap it in an authenticated envelope: a scrypt-
// derived AES-256-GCM ciphertext prefixed by a small JSON header. Confidential-
// ity comes from the passphrase; integrity/authenticity of the *contents* comes
// from the Ed25519 SEAL inside the ZIP, which survives independent of transport.
// ---------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
}

export function encryptPackage(zip: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(zip), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = JSON.stringify({
    magic: "CXZ1", alg: "aes-256-gcm", kdf: "scrypt", ...SCRYPT,
    salt: salt.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64"),
  });
  return Buffer.concat([Buffer.from(`CXZ1\n${header}\n`, "utf8"), ciphertext]);
}

// Single implementation shared with the recipient-side verifier
// (scripts/verify-export.ts) so the two can never disagree on the format.
export function decryptPackage(cxz: Buffer, passphrase: string): Buffer {
  return decryptCxz(cxz, passphrase);
}

// A human-friendly, unambiguous passphrase: 4 groups of 5 (no 0/O/1/I/L).
const PW_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generatePassphrase(): string {
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) {
    if (i > 0 && i % 5 === 0) out += "-";
    out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
  }
  return out;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

const VERIFY_MD = (publicKeyPem: string) => `# Verifying this Incident Case File

This package is tamper-evident. Anyone can confirm it has not been altered
since it was sealed, using only the files inside it and a standard SHA-256 /
Ed25519 tool. No connection to Crucible CE is required.

## What's inside
- \`incident-report.pdf\`: the readable report
- \`incident-data.json\`: the same record as JSON
- \`ledger.json\`: the full hash-chained event ledger
- \`evidence/\`: every evidence file
- \`MANIFEST.json\`: a SHA-256 hash of every file above, plus metadata
- \`SEAL\`: an Ed25519 signature over MANIFEST.json
- \`VERIFY.md\`: this file

## How to verify (3 steps)
1. **Files match the manifest.** For each entry in \`MANIFEST.json\` -> \`files\`,
   compute the SHA-256 of that file and confirm it equals the listed \`sha256\`.
2. **The manifest is sealed.** \`SEAL\` -> \`signature\` is an Ed25519 signature
   (base64) over the exact bytes of \`MANIFEST.json\`. Verify it against the
   public key below. If it validates, the manifest and every file it lists
   are authentic and unmodified.
3. **The ledger is linked.** \`ledger.json\` is a hash chain: entries are
   numbered \`seq\` 1..n, the first \`prevHash\` is the genesis hash (64 zeros),
   every later \`prevHash\` equals the previous entry's \`entryHash\`, and the
   last \`entryHash\` equals \`ledgerHead\` in \`MANIFEST.json\`.

Any single changed byte in any file breaks step 1 or 2.

Each \`entryHash\` is a keyed HMAC-SHA256 (scheme \`ledgerHashScheme\`) computed
with a secret held by the issuing Crucible install, so it cannot be recomputed
outside that install and can't be forged by anyone with only database
access. The issuing install re-verified every entry hash at export
time; the result is \`ledgerValid\` / \`ledgerStatus\` in the signed manifest.
Offline, you verify the signature, the file hashes and the chain linkage.

## Signing public key (Ed25519, SPKI PEM)
\`\`\`
${publicKeyPem.trim()}
\`\`\`
`;

export interface BuildResult {
  passphrase: string;
  packageHash: string;
  ledgerHead: string;
  ledgerValid: boolean;
  sizeBytes: number;
}

/**
 * Build, seal, encrypt, store, and ledger-log a case file for an export row
 * that already exists in `running` state. Returns the one-time passphrase.
 * On any failure the row is marked `failed` and the error is rethrown.
 */
export async function buildExport(exportId: string): Promise<BuildResult> {
  const row = await db.incidentExport.findUnique({ where: { id: exportId } });
  if (!row) throw new Error("Export row not found");

  try {
    if (!isSigningConfigured()) throw new Error("EXPORT_SIGNING_PRIVATE_KEY is not configured");
    const publicKeyPem = getPublicKeyPem();
    if (!publicKeyPem) throw new Error("Couldn't derive the signing public key");

    const mode = row.mode as ExportMode;
    const data = await gatherIncident(row.incidentId, row.organizationId, mode);
    if (!data) throw new Error("Incident not found");

    const org = await db.organization.findUnique({ where: { id: row.organizationId }, select: { name: true } });
    // In-app, keyed check (needs MASTER_KEK): every entry's HMAC, the head
    // anchor and its signature. The offline recipient cannot repeat this — it
    // relies on the signed manifest pinning ledgerHead + ledger.json linkage.
    const verify = await verifyLedgerAnchored(db, row.incidentId);
    const ledgerHead = data.ledger.length ? data.ledger[data.ledger.length - 1].entryHash : LEDGER_GENESIS_HASH;

    const pdf = await renderCaseFilePdf({
      data,
      orgName: org?.name ?? "Organization",
      requestedByName: row.requestedByName ?? "Administrator",
      ledgerHead,
      ledgerValid: verify.valid,
    });

    // Assemble package contents (everything except MANIFEST/SEAL, which attest the rest).
    // Use JSON.stringify (not canonicalJson) for the human/machine data files:
    // it serializes Dates to ISO via toJSON, whereas canonicalJson — built for
    // deterministic hashing of plain values — would flatten Dates to {}.
    const files: { path: string; bytes: Buffer }[] = [
      { path: "incident-report.pdf", bytes: pdf },
      { path: "incident-data.json", bytes: Buffer.from(JSON.stringify(data, null, 2), "utf8") },
      { path: "ledger.json", bytes: Buffer.from(JSON.stringify(data.ledger, null, 2), "utf8") },
    ];

    for (const e of data.evidence) {
      try {
        const buf = await readEvidence(row.organizationId, row.incidentId, e.id);
        files.push({ path: `evidence/${e.id}__${safeName(e.filename)}`, bytes: buf });
      } catch {
        // Evidence blob missing on disk — record a placeholder so the manifest
        // still accounts for it rather than silently dropping it.
        files.push({ path: `evidence/${e.id}__MISSING.txt`, bytes: Buffer.from(`Evidence blob ${e.id} (${e.filename}) was not present in storage at export time.`, "utf8") });
      }
    }
    files.push({ path: "VERIFY.md", bytes: Buffer.from(VERIFY_MD(publicKeyPem), "utf8") });

    const manifest = {
      tool: "Crucible CE",
      format: "incident-case-file/1",
      generatedAt: data.generatedAt,
      mode,
      incidentId: row.incidentId,
      organizationId: row.organizationId,
      requestedBy: row.requestedByName ?? null,
      ledgerHead,
      ledgerValid: verify.valid,
      ledgerStatus: verify.status,
      ledgerEntries: data.ledger.length,
      // Entry hashes are keyed (HMAC with an install secret) — verifiable
      // in-app only. Offline, ledger.json is checked for prevHash linkage up
      // to ledgerHead, which this signed manifest pins.
      ledgerHashScheme: "hmac-sha256/ledger-v1",
      // Fingerprint of the ledger HMAC key the chain was verified under.
      ledgerKeyId: verify.keyId ?? null,
      signatureAlgorithm: "ed25519",
      publicKeyPem,
      files: files.map((f) => ({ path: f.path, sizeBytes: f.bytes.length, sha256: createHash("sha256").update(f.bytes).digest("hex") })),
    };
    const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
    const signature = signData(manifestBytes);
    if (!signature) throw new Error("Failed to sign manifest");
    const seal = { algorithm: "ed25519", signature, signedFile: "MANIFEST.json", publicKeyPem };

    // Zip it all.
    const zip = new JSZip();
    for (const f of files) zip.file(f.path, f.bytes);
    zip.file("MANIFEST.json", manifestBytes);
    zip.file("SEAL", Buffer.from(JSON.stringify(seal, null, 2), "utf8"));
    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    // Encrypt + store.
    const passphrase = generatePassphrase();
    const cxz = encryptPackage(zipBuf, passphrase);
    const packageHash = sha256Hex(cxz.toString("base64"));
    const storagePath = await writeExportPackage(row.organizationId, row.incidentId, row.id, cxz);

    await db.$transaction(async (tx) => {
      await tx.incidentExport.update({
        where: { id: row.id },
        data: { status: "ready", packageHash, ledgerHead, storagePath, sizeBytes: cxz.length, completedAt: new Date() },
      });
      await appendLedger(tx, {
        incidentId: row.incidentId,
        organizationId: row.organizationId,
        eventType: "incident_exported",
        actorUserId: row.requestedById,
        actorLabel: row.requestedByName,
        payload: { exportId: row.id, mode, packageHash, ledgerHead, fileCount: manifest.files.length },
      });
    });

    return { passphrase, packageHash, ledgerHead, ledgerValid: verify.valid, sizeBytes: cxz.length };
  } catch (err) {
    await db.incidentExport.update({
      where: { id: exportId },
      data: { status: "failed", error: err instanceof Error ? err.message : String(err), completedAt: new Date() },
    }).catch(() => {});
    throw err;
  }
}
