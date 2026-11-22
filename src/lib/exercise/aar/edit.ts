// Section edits, the edit log and per-section origin. Pure.
//
//   const next = applySectionEdit(sections, "analysis", "0.afis.1.title", "Notify the insurer sooner");
//   const log = appendEditLog(editLog, { section: "analysis", path: "analysis.0.afis.1.title", origin: "human", byUserId });

import { ZodError } from "zod";
import { AAR_SECTION_KEYS, aarSectionsSchema, editLogEntrySchema, type AarSectionKey, type AarSections, type EditLogEntry } from "./schema";

export class AarEditError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AarEditError";
  }
}

export function isSectionKey(v: unknown): v is AarSectionKey {
  return typeof v === "string" && (AAR_SECTION_KEYS as readonly string[]).includes(v);
}

/** Read the stored edit log, dropping entries that do not parse. */
export function readEditLog(raw: unknown): EditLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: EditLogEntry[] = [];
  for (const e of raw) {
    const r = editLogEntrySchema.safeParse(e);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Stored sections, or null when they are missing or invalid. */
export function readSections(raw: unknown): AarSections | null {
  const r = aarSectionsSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function appendEditLog(log: EditLogEntry[], entry: Omit<EditLogEntry, "at"> & { at?: string }): EditLogEntry[] {
  const e = editLogEntrySchema.parse({ ...entry, at: entry.at ?? new Date().toISOString() });
  return [...log, e];
}

export type SectionOrigin = "human" | "system";

/**
 * Origin of each section: the origin of its latest edit log entry. A system
 * entry with a path (a narrow refresh such as evaluator ratings or
 * attendance) does not change the origin; a whole-section rebuild does.
 */
export function sectionOrigins(log: EditLogEntry[]): Record<AarSectionKey, SectionOrigin | null> {
  const out = Object.fromEntries(AAR_SECTION_KEYS.map((k) => [k, null])) as Record<AarSectionKey, SectionOrigin | null>;
  for (const e of log) {
    if (e.origin === "system" && e.path && out[e.section] !== null) continue;
    out[e.section] = e.origin;
  }
  return out;
}

export function isHumanEdited(log: EditLogEntry[], section: AarSectionKey): boolean {
  return sectionOrigins(log)[section] === "human";
}

/** Sections a refresh from the record may replace: system origin, plus forced ones. */
export function sectionsToRegenerate(
  log: EditLogEntry[],
  opts: { sections?: readonly AarSectionKey[] | null; force?: boolean } = {},
): AarSectionKey[] {
  const wanted = opts.sections && opts.sections.length ? opts.sections : AAR_SECTION_KEYS;
  const origins = sectionOrigins(log);
  return wanted.filter((k) => opts.force || origins[k] !== "human");
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/** "0.afis.1.title" -> ["0","afis","1","title"]. A leading section name is dropped. */
export function parsePath(section: AarSectionKey, path: string | null | undefined): string[] {
  if (!path) return [];
  let segs = path.split(".").filter((s) => s !== "");
  if (segs[0] === section) segs = segs.slice(1);
  if (segs.length > 8) throw new AarEditError(400, "That path is too deep.");
  for (const s of segs) {
    if (FORBIDDEN_SEGMENTS.has(s) || !/^[A-Za-z0-9_]{1,40}$/.test(s)) throw new AarEditError(400, "That path is not valid.");
  }
  return segs;
}

function issuesText(e: ZodError): string {
  const first = e.issues[0];
  if (!first) return "The change is not valid.";
  return `The change is not valid at ${first.path.join(".") || "the root"}. ${first.message}.`;
}

/**
 * Set a value at section[.path] and validate the whole sections object.
 * Arrays accept an index up to their length (append). Throws AarEditError(400).
 */
export function applySectionEdit(sections: AarSections, section: AarSectionKey, path: string | null | undefined, value: unknown): AarSections {
  if (!isSectionKey(section)) throw new AarEditError(400, "Unknown section.");
  const segs = parsePath(section, path);
  const copy = structuredClone(sections) as Record<string, unknown>;
  if (segs.length === 0) {
    copy[section] = value;
  } else {
    let cur: unknown = copy[section];
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (Array.isArray(cur)) {
        if (!/^\d+$/.test(seg)) throw new AarEditError(400, "That path is not valid.");
        cur = cur[Number(seg)];
      } else if (cur && typeof cur === "object") {
        if (!Object.prototype.hasOwnProperty.call(cur, seg)) throw new AarEditError(400, "That path does not exist.");
        cur = (cur as Record<string, unknown>)[seg];
      } else {
        throw new AarEditError(400, "That path does not exist.");
      }
      if (cur === undefined || cur === null) throw new AarEditError(400, "That path does not exist.");
    }
    const last = segs[segs.length - 1];
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(last) || Number(last) > cur.length) throw new AarEditError(400, "That path does not exist.");
      cur[Number(last)] = value;
    } else if (cur && typeof cur === "object") {
      if (!Object.prototype.hasOwnProperty.call(cur, last)) throw new AarEditError(400, "That path does not exist.");
      (cur as Record<string, unknown>)[last] = value;
    } else {
      throw new AarEditError(400, "That path does not exist.");
    }
  }
  const parsed = aarSectionsSchema.safeParse(copy);
  if (!parsed.success) throw new AarEditError(400, issuesText(parsed.error));
  return parsed.data;
}

/** "analysis" or "analysis.0.afis.1.title", within the edit log's 120 characters. */
export function logPath(section: AarSectionKey, path?: string | null): string | undefined {
  const segs = parsePath(section, path);
  return segs.length ? `${section}.${segs.join(".")}`.slice(0, 120) : undefined;
}

/**
 * Why a human section edit is refused, or null. Ratings, rating sources,
 * "Not evaluated", evaluator rationales, the objective list
 * and control mapping results come from the record and never change through
 * a section edit. Pure.
 */
export function protectedFieldChange(before: AarSections, after: AarSections): string | null {
  const ids = (s: AarSections) => s.analysis.map((a) => a.objectiveId).join("|");
  if (ids(before) !== ids(after)) return "Objectives come from the exercise. Change them in the exercise setup.";
  for (let i = 0; i < before.analysis.length; i++) {
    const a = before.analysis[i];
    const b = after.analysis[i];
    if (a.rating !== b.rating || a.ratingSource !== b.ratingSource || a.notEvaluated !== b.notEvaluated) {
      return "Ratings change on the ratings page, not in the report text.";
    }
    if (a.ratingSource === "evaluator" && a.ratingRationale !== b.ratingRationale) return "The evaluator's rationale changes on the ratings page.";
  }
  const cm = (s: AarSections) => s.controlMapping.map((c) => `${c.framework}:${c.controlId}:${c.status}`).join("|");
  if (cm(before) !== cm(after)) return "The control mapping follows the findings. Edit the findings instead.";
  return null;
}
