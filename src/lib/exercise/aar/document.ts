// The signed AAR document. Its canonical JSON (RFC 8785) is what the instance
// key signs at finalize. It carries the full HSEEP sections (roster, decision
// log, evidence quotes), every improvement plan row, and the signer
// identities.
//
// For a final version, buildSignedDocument returns the stored snapshot (the
// document inside AfterActionReport.canonical), never a rebuild: live action
// item tracking after finalize does not change what was signed.

import { z } from "zod";
import { db, type DbClient } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { AAR_SECTION_KEYS, APPROVAL_STATEMENT, aarSectionsSchema, type AarSectionKey, type AarSections } from "./schema";
import { readEditLog } from "./edit";
import { canonicalize } from "./canonical";
import { sha256Hex, type SignedEnvelope } from "./sign";
import { evidenceAfiId } from "@/lib/exercise/improvement/afis";

export const SIGNER_ROLES = ["facilitator", "sponsor"] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

export interface SignerEntry {
  role: SignerRole;
  name: string;
  title: string | null;
  signedAt: string;
  /** The signing user's account, or null when entered on the sponsor's behalf. */
  userId: string | null;
  /** Name on the signing account, recorded next to the typed name. Null when entered on the sponsor's behalf. */
  accountName?: string | null;
  /** What the signer approved (APPROVAL_STATEMENT). Part of the signed content. */
  approval?: string;
  /** Set when a facilitator entered the sponsor's signature because the sponsor has no account. */
  enteredBy?: { userId: string; name: string };
}

/** Per-section provenance from the edit log: built from the record, or written or edited by a person. */
export interface SectionProvenance {
  section: AarSectionKey;
  humanEdited: boolean;
  fromRecord: boolean;
  lastEditAt: string | null;
}

/** Provenance summary for every section. Pure. */
export function provenanceSummary(editLog: unknown): SectionProvenance[] {
  const log = readEditLog(editLog);
  return AAR_SECTION_KEYS.map((section) => {
    const mine = log.filter((e) => e.section === section);
    return {
      section,
      humanEdited: mine.some((e) => e.origin === "human"),
      fromRecord: mine.some((e) => e.origin === "system" && !e.path),
      lastEditAt: mine.at(-1)?.at ?? null,
    };
  });
}

/** What a signer entry carries for a stored AarSignature row. */
export function signerEntryFor(
  row: { role: string; name: string; title: string | null; signedAt: Date; userId: string | null },
  accountName: string | null,
  enteredBy?: { userId: string; name: string },
): SignerEntry {
  return {
    role: row.role as SignerRole,
    name: row.name,
    title: row.title,
    signedAt: row.signedAt.toISOString(),
    userId: row.userId,
    accountName: row.userId ? accountName : null,
    approval: APPROVAL_STATEMENT,
    ...(enteredBy ? { enteredBy } : {}),
  };
}

export interface SignedActionItem {
  id: string;
  capabilityId: string | null;
  capabilityKey: string | null;
  capabilityName: string | null;
  objectiveId: string | null;
  objectiveText: string | null;
  afiId: string | null;
  afi: string;
  correctiveAction: string;
  poete: string | null;
  responsibleOrg: string | null;
  poc: string | null;
  pocEmail: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  closureEvidence: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

export interface SignedAarDocument {
  schemaVersion: 1;
  exercise: { id: string; title: string; mode: string; startedAt: string | null; endedAt: string | null };
  aar: {
    id: string;
    version: number;
    previousId: string | null;
    sections: AarSections;
    /** Amendments: the version this one replaces, its signed hash and the reason. */
    previousVersion?: { id: string; version: number; contentHash: string | null; reason: string } | null;
    /** After-action meeting record. */
    meeting?: { heldAt: string | null; attendees: string; improvementPlanAgreedAt: string | null };
    /** Per-section provenance (from the record, human edited) from the edit log. */
    provenance?: SectionProvenance[];
  };
  actionItems: SignedActionItem[];
  signers: SignerEntry[];
  generatedAt: string;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Hash of the document without signers and generatedAt: what each signer approved. */
export function documentBodyHash(doc: SignedAarDocument): string {
  const body: Record<string, unknown> = { ...doc };
  delete body.signers;
  delete body.generatedAt;
  return sha256Hex(canonicalize(body));
}

/** Facilitator first, then sponsor. */
export function orderSigners<T extends { role: string }>(rows: T[]): T[] {
  const rank = (r: string) => (r === "facilitator" ? 0 : r === "sponsor" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a.role) - rank(b.role));
}

export async function loadActionItemsForAar(
  aar: { id: string; exerciseId: string },
  client: DbClient = db,
): Promise<SignedActionItem[]> {
  const rows = await client.actionItem.findMany({
    where: { OR: [{ aarId: aar.id }, { exerciseId: aar.exerciseId, aarId: null }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { capability: { select: { key: true, name: true } }, objective: { select: { text: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    capabilityId: r.capabilityId,
    capabilityKey: r.capability?.key ?? null,
    capabilityName: r.capability?.name ?? null,
    objectiveId: r.objectiveId,
    objectiveText: r.objective?.text ?? null,
    afiId: evidenceAfiId(r.evidence),
    afi: r.afi,
    correctiveAction: r.correctiveAction,
    poete: r.poete,
    responsibleOrg: r.responsibleOrg,
    poc: r.poc,
    pocEmail: r.pocEmail,
    startDate: iso(r.startDate),
    dueDate: iso(r.dueDate),
    status: r.status,
    priority: r.priority,
    closureEvidence: r.closureEvidence,
    rejectedReason: r.rejectedReason,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Build the document from the current rows. Signers come from AarSignature
 * rows unless `signers` is passed (finalize passes the full list, including
 * the signature being added).
 */
export async function buildLiveDocument(
  aarId: string,
  opts: { client?: DbClient; signers?: SignerEntry[]; now?: Date } = {},
): Promise<SignedAarDocument> {
  const client = opts.client ?? db;
  const aar = await client.afterActionReport.findUnique({
    where: { id: aarId },
    include: {
      exercise: { select: { id: true, title: true, mode: true, startedAt: true, endedAt: true } },
      signatures: { include: { user: { select: { name: true } } } },
      previous: { select: { id: true, version: true, contentHash: true } },
    },
  });
  if (!aar) throw new ServiceError(404, "Report not found.");
  const parsed = aarSectionsSchema.safeParse(aar.sections);
  if (!parsed.success) throw new ServiceError(409, "The report sections could not be read. Fix the draft first.");
  const signers = opts.signers ?? orderSigners(aar.signatures).map((s) => signerEntryFor(s, s.user?.name ?? null));
  return {
    schemaVersion: 1,
    exercise: {
      id: aar.exercise.id,
      title: aar.exercise.title,
      mode: aar.exercise.mode,
      startedAt: iso(aar.exercise.startedAt),
      endedAt: iso(aar.exercise.endedAt),
    },
    aar: {
      id: aar.id,
      version: aar.version,
      previousId: aar.previousId,
      sections: parsed.data,
      previousVersion: aar.previous
        ? { id: aar.previous.id, version: aar.previous.version, contentHash: aar.previous.contentHash, reason: aar.amendReason ?? "" }
        : null,
      meeting: { heldAt: iso(aar.aamAt), attendees: aar.aamAttendees ?? "", improvementPlanAgreedAt: iso(aar.ipAgreedAt) },
      provenance: provenanceSummary(aar.editLog),
    },
    actionItems: await loadActionItemsForAar(aar, client),
    signers,
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
}

const envelopeShape = z.object({
  document: z.record(z.string(), z.unknown()),
  keyId: z.string(),
  signedAt: z.string(),
  algorithm: z.literal("Ed25519"),
  contentHash: z.string(),
  signature: z.string(),
});

/** Parse the stored envelope (AfterActionReport.canonical). Null when absent or broken. */
export function parseStoredEnvelope(canonical: string | null | undefined): SignedEnvelope<SignedAarDocument> | null {
  if (!canonical) return null;
  try {
    const r = envelopeShape.safeParse(JSON.parse(canonical));
    return r.success ? (r.data as unknown as SignedEnvelope<SignedAarDocument>) : null;
  } catch {
    return null;
  }
}

/**
 * The canonical document for an AAR: the signed snapshot for a final version,
 * otherwise a fresh build from the current rows.
 */
export async function buildSignedDocument(aarId: string, client: DbClient = db): Promise<SignedAarDocument> {
  const aar = await client.afterActionReport.findUnique({ where: { id: aarId }, select: { status: true, canonical: true } });
  if (!aar) throw new ServiceError(404, "Report not found.");
  if (aar.status === "final") {
    const env = parseStoredEnvelope(aar.canonical);
    if (!env) throw new ServiceError(500, "The signed report could not be read.");
    return env.document;
  }
  return buildLiveDocument(aarId, { client });
}

/** Evidence quotes from the analysis section, for evidence-quotes.json. */
export function evidenceQuotes(sections: AarSections): Array<{
  objectiveId: string;
  findingId: string;
  findingKind: "strength" | "afi";
  kind: string;
  sourceId: string;
  quote: string;
  at: string | null;
  speakerRole: string | null;
}> {
  const out: ReturnType<typeof evidenceQuotes> = [];
  for (const a of sections.analysis) {
    const push = (findingId: string, findingKind: "strength" | "afi", ev: AarSections["analysis"][number]["strengths"][number]["evidence"]) => {
      for (const e of ev) {
        if (!e.quote) continue;
        out.push({
          objectiveId: a.objectiveId,
          findingId,
          findingKind,
          kind: e.kind,
          sourceId: e.sourceId,
          quote: e.quote,
          at: e.at ?? null,
          speakerRole: e.speakerRole ?? null,
        });
      }
    };
    for (const s of a.strengths) push(s.id, "strength", s.evidence);
    for (const f of a.afis) push(f.id, "afi", f.evidence);
  }
  return out;
}
