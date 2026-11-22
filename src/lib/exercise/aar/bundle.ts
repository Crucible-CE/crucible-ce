// Evidence bundle for a final AAR: one zip a third party can check offline
// with scripts/verify-bundle.ts, or with OpenSSL 3 alone (README.txt).
//
//   aar.pdf                      the PDF stored at finalize (exact bytes)
//   aar.docx                     editable render of the signed snapshot
//   aar.signed.json              the signed envelope, canonical JSON
//   aar.signed-payload.json      the exact bytes the envelope signature covers
//   aar.signature.bin            the envelope signature, raw 64 bytes
//   roster.csv, decision-log.csv, improvement-plan.csv
//   findings.csv                 every finding considered, with its decision and reason
//   evidence-quotes.json         evidence quotes from the analysis only
//   public-key.pem               the key that signed the envelope
//   manifest-key.pem             only when the manifest key differs (rotation)
//   README.txt                   what each file is and how to check it
//   manifest.json                canonical JSON {files:[{path,sha256,bytes}], keyId, manifestKeyId, contentHash, ...}
//   manifest.sig                 base64 Ed25519 over the exact bytes of manifest.json
//   manifest.sig.bin             the same signature, raw 64 bytes (for openssl pkeyutl)

import { createPublicKey, sign as edSign, type KeyObject } from "node:crypto";
import JSZip from "jszip";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { csvCell } from "@/lib/exercise/msel";
import { actionItemsCsv } from "@/lib/exercise/improvement/service";
import { canonicalize } from "./canonical";
import { sha256Hex, signingPayload, type SignedEnvelope } from "./sign";
import { evidenceQuotes, parseStoredEnvelope, type SignedAarDocument } from "./document";
import { keyIdFor, readSigningKey } from "./keys";
import { ATTENDANCE_TEXT, ROLE_TEXT, fmtTime, type AarRenderMeta } from "./labels";
import { ensureFinalPdf, renderMetaFor } from "./render";
import { decisionText, findingStatusOf, sourcesText } from "./findings";
import { FINDING_STATUS_LABELS } from "./schema";

export interface BundleManifest {
  schemaVersion: 1;
  aarId: string;
  version: number;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  /** Key that signed aar.signed.json. */
  keyId: string;
  /** Key that signed manifest.json. */
  manifestKeyId: string;
  contentHash: string;
  generatedAt: string;
}

export const MANIFEST_PATH = "manifest.json";
export const MANIFEST_SIG_PATH = "manifest.sig";
export const ENVELOPE_PATH = "aar.signed.json";
export const PUBLIC_KEY_PATH = "public-key.pem";
export const MANIFEST_KEY_PATH = "manifest-key.pem";
export const MANIFEST_SIG_BIN_PATH = "manifest.sig.bin";
export const PAYLOAD_PATH = "aar.signed-payload.json";
export const SIGNATURE_BIN_PATH = "aar.signature.bin";
export const README_PATH = "README.txt";

/** README.txt: the files and an OpenSSL-only way to check them. Plain text, CRLF-free. */
export function bundleReadme(args: { title: string; version: number; keyId: string; manifestKeyId: string; contentHash: string; manifestKeyFile: string }): string {
  const lines = [
    `Evidence bundle: ${args.title}, after-action report version ${args.version}.`,
    "",
    "Files",
    "  aar.pdf                  The final report as a PDF. The exact file stored when the report was signed.",
    "  aar.docx                 Editable Word copy of the same report. Not the record.",
    "  aar.signed.json          The signed record: the report document, key ID, signing time and Ed25519 signature.",
    "  aar.signed-payload.json  The exact bytes the record signature covers.",
    "  aar.signature.bin        The record signature, raw 64 bytes.",
    "  roster.csv               Participants with joined, left and attendance.",
    "  decision-log.csv         Decisions in scenario order.",
    "  improvement-plan.csv     The improvement plan.",
    "  findings.csv             Every finding considered, with its decision and reason.",
    "  evidence-quotes.json     Record quotes used as evidence.",
    `  public-key.pem           Public key that signed the record. Key ID ${args.keyId}.`,
    ...(args.manifestKeyFile === MANIFEST_KEY_PATH ? [`  manifest-key.pem         Public key that signed the manifest. Key ID ${args.manifestKeyId}.`] : []),
    "  manifest.json            Every file in this list with its SHA-256 and size.",
    "  manifest.sig             Signature over manifest.json, base64.",
    "  manifest.sig.bin         The same signature, raw 64 bytes.",
    "  README.txt               This file.",
    "",
    `Content hash of the signed document: ${args.contentHash}`,
    "",
    "What a valid signature shows",
    "  The files have not changed since the install's key signed them. Confirm the key belongs to the install:",
    "  compare the key ID with Org admin, Exercises, Signing keys, or download the public key there.",
    "",
    "Check with the verify script (Node.js, Crucible CE source or container image)",
    `  npx tsx scripts/verify-bundle.ts --key ${args.keyId}${args.manifestKeyId !== args.keyId ? ` --key ${args.manifestKeyId}` : ""} bundle.zip`,
    "  PASS means every check passed with the key you pinned.",
    "",
    "Check with OpenSSL 3 only",
    "  1. Unzip the bundle into an empty folder and open a shell there.",
    "  2. Key ID of a public key file (first 16 hex characters of the output):",
    "       openssl pkey -pubin -in public-key.pem -outform DER | openssl dgst -sha256",
    "     Use the public key file downloaded from the install in steps 3 and 4 when you can.",
    "  3. Manifest signature:",
    `       openssl pkeyutl -verify -pubin -inkey ${args.manifestKeyFile} -rawin -in manifest.json -sigfile manifest.sig.bin`,
    "     Expect: Signature Verified Successfully",
    "  4. Record signature:",
    "       openssl pkeyutl -verify -pubin -inkey public-key.pem -rawin -in aar.signed-payload.json -sigfile aar.signature.bin",
    "     Expect: Signature Verified Successfully",
    "  5. File hashes. For every entry in manifest.json run",
    "       openssl dgst -sha256 <path>",
    "     and compare with its sha256. Every listed file must be present and match.",
    "     The folder must hold no other files than the listed ones, manifest.json, manifest.sig and manifest.sig.bin.",
    "  aar.signed-payload.json is the signed record in canonical JSON: {document, keyId, signedAt}.",
    "",
  ];
  return lines.join("\n");
}

export function rosterCsv(doc: SignedAarDocument, tz: string): string {
  const header = ["Name", "Title", "Organization", "Team", "Exercise roles", "Guest", "No device", "Joined", "Left", "Attendance"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of doc.aar.sections.roster) {
    lines.push(
      [
        r.name,
        r.title ?? "",
        r.organization ?? "",
        r.team ?? "",
        r.roles.map((x) => ROLE_TEXT[x] ?? x).join("; "),
        r.guest ? "Yes" : "No",
        r.noDevice ? "Yes" : "No",
        r.joinedAt ? fmtTime(r.joinedAt, tz) : "",
        r.leftAt ? fmtTime(r.leftAt, tz) : "",
        r.attendance ? ATTENDANCE_TEXT[r.attendance] : "Not confirmed",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function decisionLogCsv(doc: SignedAarDocument, tz: string): string {
  const header = ["No.", "Scenario time", "Team", "Owner", "Kind", "Question", "Decision", "Split"];
  const lines = [header.map(csvCell).join(",")];
  for (const d of doc.aar.sections.decisionLog) {
    lines.push(
      [
        String(d.seq),
        d.scenarioTime ? fmtTime(d.scenarioTime, tz) : "",
        d.team ?? "",
        d.owner ?? "",
        d.kind,
        d.question ?? "",
        d.decision ?? "",
        Object.entries(d.split)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Every finding considered: status, sources, decision and reason. */
export function findingsCsv(doc: SignedAarDocument, tz: string): string {
  const header = ["Finding", "Objective", "Status", "Source", "Decision", "Reason", "Decided by", "Decided at"];
  const lines = [header.map(csvCell).join(",")];
  const s = doc.aar.sections;
  const rows = [
    ...s.analysis.flatMap((a) => a.afis.map((f) => ({ f, objective: a.objectiveText }))),
    ...(s.unassignedFindings ?? []).map((f) => ({ f, objective: "" })),
  ];
  for (const { f, objective } of rows) {
    const status = findingStatusOf(f);
    const d = f.decision ?? null;
    lines.push(
      [
        f.title,
        objective,
        FINDING_STATUS_LABELS[status],
        sourcesText(f.sources),
        d?.kind === "action" || (status === "accepted" && f.actionItemId) ? "Work item" : d?.kind === "no_action" ? "No action needed" : status === "rejected" ? "Rejected" : "",
        decisionText(d) || (status === "rejected" ? (f.rejectedReason ?? "") : ""),
        d?.byName ?? "",
        d?.at ? fmtTime(d.at, tz) : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export interface BundleInput {
  envelope: SignedEnvelope<SignedAarDocument>;
  /** PEM of the key that signed the envelope. */
  publicKeyPem: string;
  pdf: Uint8Array;
  docx: Uint8Array;
  timezone: string;
  /** Signs manifest.json. Usually the current instance key. */
  manifestKey: { privateKey: KeyObject; publicKeyPem: string };
  now?: Date;
}

/** Build the zip. Pure apart from the clock; used by the export route and tests. */
export async function assembleBundle(input: BundleInput): Promise<Buffer> {
  const doc = input.envelope.document;
  const enc = (s: string) => Buffer.from(s, "utf8");
  const manifestKeyId = keyIdFor(createPublicKey({ key: input.manifestKey.publicKeyPem, format: "pem" }));
  const files: Array<[string, Uint8Array]> = [
    ["aar.pdf", input.pdf],
    ["aar.docx", input.docx],
    [ENVELOPE_PATH, enc(canonicalize(input.envelope))],
    [PAYLOAD_PATH, enc(signingPayload(input.envelope.document, input.envelope.keyId, input.envelope.signedAt))],
    [SIGNATURE_BIN_PATH, Buffer.from(input.envelope.signature, "base64")],
    ["roster.csv", enc(rosterCsv(doc, input.timezone))],
    ["decision-log.csv", enc(decisionLogCsv(doc, input.timezone))],
    ["improvement-plan.csv", enc(actionItemsCsv(doc.actionItems))],
    ["findings.csv", enc(findingsCsv(doc, input.timezone))],
    ["evidence-quotes.json", enc(`${JSON.stringify(evidenceQuotes(doc.aar.sections), null, 2)}\n`)],
    [PUBLIC_KEY_PATH, enc(input.publicKeyPem)],
  ];
  if (manifestKeyId !== input.envelope.keyId) files.push([MANIFEST_KEY_PATH, enc(input.manifestKey.publicKeyPem)]);
  files.push([
    README_PATH,
    enc(
      bundleReadme({
        title: doc.exercise.title,
        version: doc.aar.version,
        keyId: input.envelope.keyId,
        manifestKeyId,
        contentHash: input.envelope.contentHash,
        manifestKeyFile: manifestKeyId !== input.envelope.keyId ? MANIFEST_KEY_PATH : PUBLIC_KEY_PATH,
      }),
    ),
  ]);

  const manifest: BundleManifest = {
    schemaVersion: 1,
    aarId: doc.aar.id,
    version: doc.aar.version,
    files: files
      .map(([path, bytes]) => ({ path, sha256: sha256Hex(bytes), bytes: bytes.byteLength }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    keyId: input.envelope.keyId,
    manifestKeyId,
    contentHash: input.envelope.contentHash,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
  const manifestBytes = enc(canonicalize(manifest));
  const sigBytes = edSign(null, manifestBytes, input.manifestKey.privateKey);
  const sig = sigBytes.toString("base64");

  const zip = new JSZip();
  const date = input.now ?? new Date();
  for (const [path, bytes] of files) zip.file(path, bytes, { date, binary: true });
  zip.file(MANIFEST_PATH, manifestBytes, { date, binary: true });
  zip.file(MANIFEST_SIG_PATH, sig, { date });
  zip.file(MANIFEST_SIG_BIN_PATH, sigBytes, { date, binary: true });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** Load a final AAR and build its bundle. */
export async function buildEvidenceBundle(
  aarId: string,
  render: { pdf: (doc: SignedAarDocument, meta: AarRenderMeta) => Promise<Buffer>; docx: (doc: SignedAarDocument, meta: AarRenderMeta) => Promise<Buffer> },
): Promise<{ zip: Buffer; envelope: SignedEnvelope<SignedAarDocument> }> {
  const aar = await db.afterActionReport.findUnique({ where: { id: aarId }, select: { status: true, canonical: true } });
  if (!aar) throw new ServiceError(404, "Report not found.");
  if (aar.status !== "final") throw new ServiceError(409, "Finalize the report to export the evidence bundle.");
  const envelope = parseStoredEnvelope(aar.canonical);
  if (!envelope) throw new ServiceError(500, "The signed report could not be read.");
  const keyRow = await db.signingKey.findUnique({ where: { keyId: envelope.keyId }, select: { publicKeyPem: true } });
  const current = readSigningKey();
  const publicKeyPem = keyRow?.publicKeyPem ?? (current?.keyId === envelope.keyId ? current.publicKeyPem : null);
  if (!publicKeyPem) throw new ServiceError(500, "The public key for this signature is missing.");
  if (!current) throw new ServiceError(503, "No signing key is set up. Set EXPORT_SIGNING_PRIVATE_KEY, then try again.");
  const meta: AarRenderMeta = await renderMetaFor(envelope);
  // The PDF is the file stored at finalize, byte for byte.
  const [pdf, docx] = await Promise.all([ensureFinalPdf(aarId).then((f) => f.bytes), render.docx(envelope.document, meta)]);
  const zip = await assembleBundle({
    envelope,
    publicKeyPem,
    pdf,
    docx,
    timezone: meta.timezone,
    manifestKey: { privateKey: current.privateKey, publicKeyPem: current.publicKeyPem },
  });
  return { zip, envelope };
}
