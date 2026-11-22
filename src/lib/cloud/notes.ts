// Cloud notes: one quiet line where Crucible Cloud does a manual CE step with
// AI. The copy, the /cloud card each note links to, and who may see them.
//
// Rules:
//   - only at these places, next to a working manual step, never a control;
//   - facilitator and administrator views only (never players, guests, the
//     presenter or projector view, exports or emails);
//   - each user can dismiss a note; administrators can hide all notes;
//   - CE records nothing about who saw a note.
//
// A roadmap note is for an AI step Cloud does not have yet. Its link always
// reads "Coming soon in Cloud", even when a trial link is set.

interface CloudNote {
  text: string;
  /** The id of the /cloud card the note links to. */
  anchor: string;
  roadmap?: true;
}

export const CLOUD_NOTES = {
  "crisissim-generate": { text: "Cloud builds a full scenario from your organization profile.", anchor: "ai-crisis-sim" },
  "playbook-prepare": { text: "Cloud turns the document into modules, questions and criteria.", anchor: "ai-playbook" },
  "sop-analysis": { text: "Cloud checks answers against your SOP.", anchor: "ai-playbook" },
  "strategic-injects": { text: "Cloud writes the next inject from how teams answered.", anchor: "ai-strategic-inject", roadmap: true },
  "ai-grading": { text: "Cloud grades answers against the criteria with quoted evidence.", anchor: "ai-grading" },
  "ai-grading-deliverables": { text: "Cloud grades deliverables against the criteria with quoted evidence.", anchor: "ai-grading", roadmap: true },
  "aar-drafting": { text: "Cloud drafts strengths, areas for improvement and the summary from the exercise record.", anchor: "ai-aar-draft" },
  "transcript-matching": { text: "Cloud matches a meeting transcript to the report and proposes work items with quotes.", anchor: "ai-transcript", roadmap: true },
  "exo-next-actions": { text: "Cloud suggests next actions from your playbooks.", anchor: "exo" },
  "sitrep-drafting": { text: "Cloud drafts the SITREP from the incident record.", anchor: "exo" },
  "handover-drafting": { text: "Cloud drafts the handover from the incident record.", anchor: "exo" },
  "postmortem-drafting": { text: "Cloud drafts the postmortem from the incident record.", anchor: "exo" },
  "comms-drafting": { text: "Cloud drafts stakeholder messages from the incident facts.", anchor: "exo" },
  "document-analysis": { text: "Cloud finds gaps in your documents and drafts new ones.", anchor: "ai-posture" },
  "threat-assessment": { text: "Cloud assesses likely threats from your organization profile.", anchor: "ai-posture" },
} as const satisfies Record<string, CloudNote>;

export type CloudNoteKey = keyof typeof CLOUD_NOTES;
export const CLOUD_NOTE_KEYS = Object.keys(CLOUD_NOTES) as CloudNoteKey[];

export function isCloudNoteKey(v: unknown): v is CloudNoteKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(CLOUD_NOTES, v);
}

/** CE account roles that see notes: administrators, exercise directors and contributors. */
const NOTE_ROLES = new Set(["administrator", "exercise_director", "contributor"]);

export function roleSeesCloudNotes(ceRole: string | null | undefined): boolean {
  return Boolean(ceRole && NOTE_ROLES.has(ceRole));
}

/** The trial sign-up link, read on the server. Null when it is not set or not an http(s) URL. */
export function cloudTrialUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.CLOUD_TRIAL_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** What the client needs to draw notes for one viewer. */
export interface CloudNotesState {
  /** False hides every note (wrong role, or the organization turned notes off). */
  enabled: boolean;
  dismissed: CloudNoteKey[];
  /** True when CLOUD_TRIAL_URL is set: links read "Try free for 1 week", except on roadmap notes. */
  trial: boolean;
}

export const CLOUD_NOTES_OFF: CloudNotesState = { enabled: false, dismissed: [], trial: false };

export function isRoadmapNote(key: CloudNoteKey): boolean {
  const note: CloudNote = CLOUD_NOTES[key];
  return note.roadmap === true;
}

/** Link text and target for a note. Notes always link to the matching /cloud card. */
export function cloudNoteLink(key: CloudNoteKey, trial: boolean): { href: string; label: string } {
  const label = trial && !isRoadmapNote(key) ? "Try free for 1 week" : "Coming soon in Cloud";
  return { href: `/cloud#${CLOUD_NOTES[key].anchor}`, label };
}
