import { createHash, createHmac, createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canonicalJson } from "@/lib/crypto/hash";
import { deriveMasterSubkey } from "@/lib/crypto/org-crypto";
import { getPublicKeyPem, publicKeyFingerprint, signData, signingKeyId } from "@/lib/export/signing";

/** prevHash of the first entry in every incident chain. */
export const LEDGER_GENESIS_HASH = "0".repeat(64);

export type LedgerEventType =
  | "declared"
  | "status_changed"
  | "decision_made"
  | "task_updated"
  | "task_assigned"
  | "task_acknowledged"
  | "task_status_changed"
  | "task_commented"
  | "task_attachment_added"
  | "role_assigned"
  | "notification_sent"
  | "page_sent"
  | "page_acked"
  | "page_delivery"
  | "page_cancelled"
  | "evidence_added"
  | "incident_locked"
  | "incident_unlocked"
  | "incident_deleted"
  | "participant_added"
  | "participant_removed"
  | "note_added"
  | "incident_exported"
  | "false_positive_marked"
  | "incident_closed"
  | "closure_gate_overridden"
  | "incident_reopened"
  | "action_proposed"
  | "action_approved"
  | "action_rejected"
  | "indicator_added"
  | "indicator_deleted"
  | "indicator_restored"
  | "asset_deleted"
  | "asset_restored"
  | "response_action_deleted"
  | "response_action_restored"
  | "status_update_published"
  | "sitrep_published"
  | "status_update_edited"
  | "status_update_unpublished"
  | "incident_linked"
  | "corrective_action_created"
  | "handover_accepted"
  | "guest_invited"
  | "guest_revoked"
  | "status_page_published"
  | "status_page_unpublished"
  | "status_page_update_posted"
  | "status_page_update_removed"
  | "playbook_attached"
  | "playbook_removed"
  | "playbook_step_done"
  | "playbook_step_reopened";

interface AppendLedgerArgs {
  incidentId: string;
  organizationId: string;
  eventType: LedgerEventType;
  payload: Prisma.InputJsonValue;
  actorUserId?: string | null;
  actorLabel?: string | null;
}

/**
 * Minimal client surface the helpers need — works with the base client, an
 * interactive `$transaction` client, and the in-memory test fake. `incident`
 * and `$executeRaw` are optional: the real clients have them (enabling
 * advisory-lock serialization and head anchoring); the test fake does not and
 * exercises the bounded-retry path with no anchor writes.
 */
type LedgerClient = Pick<PrismaClient, "incidentLedgerEntry"> & {
  incident?: { update: PrismaClient["incident"]["update"] };
  $executeRaw?: PrismaClient["$executeRaw"];
};

// ---------------------------------------------------------------------------
// Entry hashing (M5)
//
//   entryHash = hex(HMAC-SHA256(K_ledger, canonicalLedgerEntry(fields)))
//   K_ledger  = HKDF-SHA256(MASTER_KEK, salt "crucible-ce", info "ledger-v1")
//
// Every stored field is committed to — prevHash, seq, incidentId,
// organizationId, eventType, actorUserId, actorLabel, payload, createdAt — so
// editing ANY of them breaks the chain. Keying the hash means someone with
// database write access but without MASTER_KEK cannot rewrite a row and then
// recompute the downstream hashes to hide the edit.
//
// Consequence: entry hashes are verifiable IN-APP only (the verifier needs
// MASTER_KEK). Exported case files are verified offline through the signed
// manifest, which pins the ledger head, plus prevHash LINKAGE of ledger.json;
// see docs/case-file-exports.md.
// ---------------------------------------------------------------------------

/** HKDF info for the ledger entry-hash HMAC key (derived from MASTER_KEK). */
export const LEDGER_HMAC_INFO = "ledger-v1";

/** Domain tag baked into the canonical encoding of every keyed entry. */
const LEDGER_ENTRY_DOMAIN = "crucible-ledger-entry-v1";

/** The stored fields an entry hash commits to. */
export interface LedgerHashFields {
  prevHash: string;
  seq: number;
  incidentId: string;
  organizationId: string;
  eventType: string;
  actorUserId: string | null;
  actorLabel: string | null;
  payload: unknown;
  /** Exactly the stored createdAt, as ISO-8601 (ms precision). */
  createdAtIso: string;
}

/**
 * Canonical, unambiguous encoding of every stored field: a JSON array (no
 * delimiter-injection between fields is possible) with the payload in
 * sorted-key canonical form.
 */
export function canonicalLedgerEntry(f: LedgerHashFields): string {
  return JSON.stringify([
    LEDGER_ENTRY_DOMAIN,
    f.prevHash,
    f.seq,
    f.incidentId,
    f.organizationId,
    f.eventType,
    f.actorUserId ?? null,
    f.actorLabel ?? null,
    JSON.parse(canonicalJson(f.payload ?? null)),
    f.createdAtIso,
  ]);
}

/**
 * Keyed entry hash. Throws when MASTER_KEK is unset: the ledger fails closed
 * rather than silently writing unkeyed hashes.
 */
export function computeEntryHash(f: LedgerHashFields): string {
  return createHmac("sha256", deriveMasterSubkey(LEDGER_HMAC_INFO))
    .update(canonicalLedgerEntry(f), "utf8")
    .digest("hex");
}

/**
 * Public fingerprint of the ledger HMAC key (first 16 hex chars of a domain-
 * separated sha256 of the derived key; reveals nothing usable about the key).
 * Stored on every entry as `keyId` so verification can report "written under a
 * different MASTER_KEK" (key_mismatch) distinctly from tampering.
 */
export function ledgerKeyId(): string {
  return createHash("sha256")
    .update("crucible-ledger-key-id|", "utf8")
    .update(deriveMasterSubkey(LEDGER_HMAC_INFO))
    .digest("hex")
    .slice(0, 16);
}

// There is deliberately NO fallback to any other (e.g. unkeyed SHA-256)
// formula: accepting one would let an attacker recompute the WHOLE chain with
// it and pass verification (a downgrade). The only accepted scheme is the one
// above; the version lives inside the hashed bytes (LEDGER_ENTRY_DOMAIN) and
// the HKDF info, so an entry made under any other version or key simply fails
// to verify (fail closed).

/**
 * Normalize a payload to what Postgres jsonb hands back (Dates → ISO strings,
 * undefined keys dropped) so the hash computed at append time matches the one
 * recomputed from the stored row.
 */
function normalizePayload(payload: Prisma.InputJsonValue): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(payload ?? null)) as Prisma.InputJsonValue;
}

/** Exact bytes the Ed25519 head signature (Incident.ledgerHeadSig) covers. */
export function ledgerHeadSigningInput(incidentId: string, seq: number, entryHash: string): Buffer {
  return Buffer.from(`${incidentId}|${seq}|${entryHash}`, "utf8");
}

/** True only for the (incidentId, seq) unique-constraint race — safe to retry. */
function isUniqueSeqViolation(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code !== "P2002") return false;
  const target = JSON.stringify(err.meta?.target ?? "");
  // Prisma reports the fields or the constraint name; both mention seq.
  return target.includes("seq") || target.includes("incidentId");
}

/**
 * Ed25519 signature over the anchored head plus the signing key's fingerprint
 * (both null when signing is unconfigured).
 */
function signHead(incidentId: string, seq: number, entryHash: string): { sig: string | null; keyId: string | null } {
  const keyId = signingKeyId();
  if (!keyId) return { sig: null, keyId: null };
  return { sig: signData(ledgerHeadSigningInput(incidentId, seq, entryHash)), keyId };
}

/**
 * Append one entry to an incident's tamper-evident ledger.
 *
 * MUST be called inside a `$transaction`. Concurrency is handled two ways:
 * a per-incident Postgres advisory xact lock (primary — serializes concurrent
 * appends for the same incident; auto-releases at tx end and is re-entrant,
 * so multiple appends inside one tx don't deadlock), plus a bounded retry on
 * the `@@unique([incidentId, seq])` violation (backstop, and the only
 * mechanism on clients without `$executeRaw`, e.g. the unit-test fake).
 *
 * entryHash is the keyed HMAC described above. createdAt is set explicitly in
 * the insert (JS ms precision, which Timestamptz(6) stores exactly) so the
 * hashed ISO string is byte-identical to the one read back.
 *
 * Each append also anchors the chain head on the Incident row
 * (ledgerSeq/ledgerHead/ledgerHeadSig/ledgerHeadAt) in the SAME transaction,
 * so tail truncation is detectable by verifyLedgerAnchored even though the
 * per-row chain alone cannot reveal missing tail entries. The head is always
 * Ed25519-signed when EXPORT_SIGNING_PRIVATE_KEY is configured.
 *
 * This is the ONLY write path for the ledger. There are no update/delete paths.
 */
export async function appendLedger(
  tx: LedgerClient,
  args: AppendLedgerArgs
): Promise<{ seq: number; entryHash: string }> {
  // 1) Serialize concurrent appends for THIS incident (no-op on the test fake).
  if (typeof tx.$executeRaw === "function") {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${args.incidentId}, 0))`;
  }

  const payload = normalizePayload(args.payload);
  const actorUserId = args.actorUserId ?? null;
  const actorLabel = args.actorLabel ?? null;
  const keyId = ledgerKeyId();

  const writeOnce = async () => {
    const last = await tx.incidentLedgerEntry.findFirst({
      where: { incidentId: args.incidentId },
      orderBy: { seq: "desc" },
      select: { seq: true, entryHash: true },
    });

    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.entryHash ?? LEDGER_GENESIS_HASH;
    const createdAt = new Date();
    const entryHash = computeEntryHash({
      prevHash,
      seq,
      incidentId: args.incidentId,
      organizationId: args.organizationId,
      eventType: args.eventType,
      actorUserId,
      actorLabel,
      payload,
      createdAtIso: createdAt.toISOString(),
    });

    await tx.incidentLedgerEntry.create({
      data: {
        incidentId: args.incidentId,
        organizationId: args.organizationId,
        seq,
        actorUserId,
        actorLabel,
        eventType: args.eventType,
        payloadJson: payload,
        prevHash,
        entryHash,
        keyId,
        createdAt,
      },
    });

    return { seq, entryHash, createdAt };
  };

  // 2) Bounded retry on a seq race (only reachable without the advisory lock).
  const MAX_TRIES = 5;
  let out: { seq: number; entryHash: string; createdAt: Date };
  for (let attempt = 1; ; attempt++) {
    try {
      out = await writeOnce();
      break;
    } catch (e) {
      if (isUniqueSeqViolation(e) && attempt < MAX_TRIES) continue;
      throw e;
    }
  }

  // 3) Anchor the head on the incident IN THE SAME TX (atomic with the entry).
  if (tx.incident && typeof tx.incident.update === "function") {
    const head = signHead(args.incidentId, out.seq, out.entryHash);
    await tx.incident.update({
      where: { id: args.incidentId },
      data: {
        ledgerSeq: out.seq,
        ledgerHead: out.entryHash,
        ledgerHeadSig: head.sig,
        ledgerHeadKeyId: head.keyId,
        ledgerHeadAt: out.createdAt,
      },
    });
  }

  return { seq: out.seq, entryHash: out.entryHash };
}

/**
 * Overall verdict. Only "valid" has valid=true.
 * - "tampered": a row was altered/deleted/reordered/inserted (any entry whose
 *   hash is not the keyed HMAC under the key it claims), the head anchor
 *   disagrees or is missing while entries exist, a previously exported head
 *   vanished, or the head signature does not verify under its own key.
 * - "key_mismatch": entries (or the head signature) were written under a
 *   DIFFERENT key than this server holds: MASTER_KEK or
 *   EXPORT_SIGNING_PRIVATE_KEY changed. The record cannot be verified with the
 *   current keys. That alone is not proof of tampering, but it is not a pass.
 * - "head_unsigned": the anchored head records a signing key (ledgerHeadKeyId)
 *   but carries no signature (stripped). FAILS verification.
 * - "valid": every entry is keyed-HMAC verified and the head is consistent
 *   (and signature-verified whenever it was signed). A head written before any
 *   signing key was configured is valid with an "unsigned (pre-signing)"
 *   warning.
 */
export type LedgerStatus = "valid" | "head_unsigned" | "key_mismatch" | "tampered";

/** Result of checking Incident.ledgerHeadSig. */
export type HeadSignatureStatus =
  | "valid"
  | "invalid"
  /** The head records a signing key id, but no signature: stripped. */
  | "missing"
  /** Unsigned head written before a signing key was configured (keyId null). Valid, with a warning. */
  | "pre_signing"
  /** Signed by a different key than the configured one (key rotated). */
  | "key_mismatch"
  /** No signing key configured and no signature present. */
  | "not_configured"
  /** A signature is present but no key is configured to check it against. */
  | "unverifiable"
  /** No anchored head yet (incident without ledger entries). */
  | "no_anchor";

export interface LedgerVerifyResult {
  valid: boolean;
  status: LedgerStatus;
  brokenAtSeq: number | null;
  reason: string | null;
  entryCount: number;
  /** Computed chain head equals the head anchored on the Incident row. */
  headMatches?: boolean;
  /** Entries exist but the Incident row carries no head anchor (wiped). */
  headMissing?: boolean;
  /** A previously exported ledger head is missing from the chain (tail truncated). */
  truncationSuspected?: boolean;
  /** Ed25519 head-signature check (verifyLedgerAnchored only). */
  headSignature?: HeadSignatureStatus;
  /** Fingerprint of this server's ledger HMAC key (compare with entries' keyId). */
  keyId?: string;
  /** Non-fatal findings worth surfacing (e.g. a signed head with no key configured to check it). */
  warnings: string[];
}

/**
 * Recompute an incident's chain from genesis and report the first break.
 * A break means a row was altered (any field), deleted, reordered, or
 * inserted out of band. Requires MASTER_KEK (keyed hashes). An entry whose
 * hash does not verify AND whose stored keyId differs from this server's key
 * is reported as key_mismatch (MASTER_KEK changed), not tampered.
 * NOTE: the pure chain walk cannot detect tail truncation — use
 * verifyLedgerAnchored for that.
 */
export async function verifyLedger(
  db: LedgerClient,
  incidentId: string
): Promise<LedgerVerifyResult> {
  const entries = await db.incidentLedgerEntry.findMany({
    where: { incidentId },
    orderBy: { seq: "asc" },
    select: {
      seq: true,
      incidentId: true,
      organizationId: true,
      eventType: true,
      actorUserId: true,
      actorLabel: true,
      payloadJson: true,
      prevHash: true,
      entryHash: true,
      keyId: true,
      createdAt: true,
    },
  });
  const currentKeyId = ledgerKeyId();

  let prevHash = LEDGER_GENESIS_HASH;
  const broken = (seq: number, reason: string, status: LedgerStatus = "tampered"): LedgerVerifyResult => ({
    valid: false,
    status,
    brokenAtSeq: seq,
    reason,
    entryCount: entries.length,
    keyId: currentKeyId,
    warnings: [],
  });

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i + 1) return broken(e.seq, "sequence gap or reorder");
    if (e.incidentId !== incidentId) return broken(e.seq, "entry belongs to a different incident");
    if (e.prevHash !== prevHash) return broken(e.seq, "prevHash mismatch");

    const fields: LedgerHashFields = {
      prevHash: e.prevHash,
      seq: e.seq,
      incidentId: e.incidentId,
      organizationId: e.organizationId,
      eventType: e.eventType,
      actorUserId: e.actorUserId,
      actorLabel: e.actorLabel,
      payload: e.payloadJson,
      createdAtIso: e.createdAt.toISOString(),
    };
    // Keyed scheme ONLY — no fallback formula (see computeEntryHash).
    if (computeEntryHash(fields) !== e.entryHash) {
      if (e.keyId && e.keyId !== currentKeyId) {
        return broken(
          e.seq,
          `key_mismatch: entry #${e.seq} was written under ledger key ${e.keyId}, but this server's key is ${currentKeyId} (MASTER_KEK has changed). ` +
            "The chain cannot be verified with the current key; restore the original MASTER_KEK to verify it. This alone is not evidence of tampering.",
          "key_mismatch",
        );
      }
      return broken(e.seq, "entryHash mismatch (not the keyed ledger-v1 HMAC: a field was altered or the chain was rewritten)");
    }
    prevHash = e.entryHash;
  }

  return { valid: true, status: "valid", brokenAtSeq: null, reason: null, entryCount: entries.length, keyId: currentKeyId, warnings: [] };
}

/** Client surface for anchored verification (adds the anchor + export reads). */
type AnchoredVerifyClient = LedgerClient & {
  incident: { findUnique: PrismaClient["incident"]["findUnique"] };
  incidentExport: { findMany: PrismaClient["incidentExport"]["findMany"] };
};

type HeadAnchor = {
  ledgerSeq: number | null;
  ledgerHead: string | null;
  ledgerHeadSig: string | null;
  ledgerHeadKeyId?: string | null;
};

function checkHeadSignature(incidentId: string, anchor: HeadAnchor | null): HeadSignatureStatus {
  if (!anchor?.ledgerHead) return "no_anchor";
  const pem = getPublicKeyPem();
  const headKeyId = anchor.ledgerHeadKeyId ?? null;
  if (!anchor.ledgerHeadSig) {
    // A head that records a signing key but has no signature was stripped.
    if (headKeyId) return "missing";
    return pem ? "pre_signing" : "not_configured";
  }
  if (!pem) return "unverifiable";
  if (headKeyId && headKeyId !== publicKeyFingerprint(pem)) return "key_mismatch";
  try {
    const ok = cryptoVerify(
      null,
      ledgerHeadSigningInput(incidentId, anchor.ledgerSeq ?? 0, anchor.ledgerHead),
      createPublicKey(pem),
      Buffer.from(anchor.ledgerHeadSig, "base64"),
    );
    return ok ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

/**
 * Full integrity check: keyed chain recompute + head-anchor comparison +
 * head-signature check + prior-export cross-check.
 *
 * - headMatches: the recomputed head equals Incident.ledgerSeq/ledgerHead. A
 *   mismatch means the tail was truncated (or the anchor was tampered — either
 *   way the record is not trustworthy).
 * - headMissing: ledger entries exist but the incident carries no anchor. Every
 *   append writes the anchor in the same transaction, so a missing anchor means
 *   it was wiped: tampered, never valid.
 * - headSignature: Incident.ledgerHeadSig verified (Ed25519, the export
 *   signing key) over `incidentId|ledgerSeq|ledgerHead`. "invalid" → tampered;
 *   "key_mismatch" (ledgerHeadKeyId is not the configured key) → key_mismatch;
 *   "missing" (keyId recorded, signature gone) → head_unsigned; "pre_signing"
 *   (no keyId, no sig: written before a key was configured) → valid + warning.
 * - truncationSuspected: every previously exported head
 *   (IncidentExport.ledgerHead) must appear as some entry's entryHash in the
 *   current chain. An exported head absent from the chain proves entries that
 *   existed at export time are gone — catches an attacker who truncated AND
 *   re-pointed the anchor consistently.
 */
export async function verifyLedgerAnchored(
  db: AnchoredVerifyClient,
  incidentId: string
): Promise<LedgerVerifyResult> {
  const base = await verifyLedger(db, incidentId);

  const incident = (await db.incident.findUnique({
    where: { id: incidentId },
    select: { ledgerSeq: true, ledgerHead: true, ledgerHeadSig: true, ledgerHeadKeyId: true },
  })) as HeadAnchor | null;

  const entries = await db.incidentLedgerEntry.findMany({
    where: { incidentId },
    orderBy: { seq: "asc" },
    select: { seq: true, entryHash: true },
  });
  const lastEntry = entries[entries.length - 1] ?? null;
  const computedHead = lastEntry?.entryHash ?? LEDGER_GENESIS_HASH;
  const computedSeq = lastEntry?.seq ?? 0;

  // Entries without an anchor: the anchor was wiped (appendLedger always
  // writes it atomically with the entry). An incident with NO entries and no
  // anchor is simply an empty ledger.
  const headMissing = entries.length > 0 && !incident?.ledgerHead;
  const headMatches =
    !headMissing &&
    (!incident?.ledgerHead || (incident.ledgerSeq === computedSeq && incident.ledgerHead === computedHead));

  const headSignature = checkHeadSignature(incidentId, incident ?? null);

  const exportHeads = await db.incidentExport.findMany({
    where: { incidentId, ledgerHead: { not: null } },
    select: { ledgerHead: true },
  });
  const knownHashes = new Set(entries.map((e) => e.entryHash));
  const truncationSuspected = exportHeads.some(
    (e) =>
      e.ledgerHead !== null &&
      e.ledgerHead !== LEDGER_GENESIS_HASH &&
      !knownHashes.has(e.ledgerHead)
  );

  const warnings = [...base.warnings];
  if (headSignature === "unverifiable") {
    warnings.push("the anchored ledger head is signed but no signing key is configured to check it");
  }
  if (headSignature === "pre_signing") {
    warnings.push(
      "unsigned (pre-signing): the ledger head was written before EXPORT_SIGNING_PRIVATE_KEY was configured; it is signed on the next ledger entry",
    );
  }

  const tampered =
    base.status === "tampered" || headMissing || !headMatches || truncationSuspected || headSignature === "invalid";
  const status: LedgerStatus = tampered
    ? "tampered"
    : base.status === "key_mismatch" || headSignature === "key_mismatch"
      ? "key_mismatch"
      : headSignature === "missing"
        ? "head_unsigned"
        : "valid";

  let reason: string | null = null;
  if (base.status === "tampered") reason = base.reason;
  else if (headMissing) reason = "head_missing: ledger entries exist but the incident's head anchor is missing (the anchor was wiped)";
  else if (!headMatches) reason = "chain head does not match anchored head (possible tail truncation)";
  else if (truncationSuspected) reason = "a previously exported ledger head is missing from the chain (tail truncated)";
  else if (headSignature === "invalid") reason = "anchored ledger head signature does not verify (anchor altered)";
  else if (base.reason) reason = base.reason;
  else if (headSignature === "key_mismatch") {
    reason =
      `key_mismatch: the ledger head was signed by key ${incident?.ledgerHeadKeyId ?? "?"}, but the configured EXPORT_SIGNING_PRIVATE_KEY is ${signingKeyId() ?? "?"} (the signing key has changed). ` +
      "Restore the original key to check this signature; the head is re-signed with the current key on the next ledger entry. This alone is not evidence of tampering.";
  } else if (headSignature === "missing") {
    reason = "anchored ledger head is unsigned although it records a signing key (signature stripped)";
  }

  return {
    ...base,
    valid: status === "valid",
    status,
    headMatches,
    headMissing,
    truncationSuspected,
    headSignature,
    warnings,
    reason,
  };
}
