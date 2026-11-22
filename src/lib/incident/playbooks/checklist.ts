// Turn a playbook document into a checklist: its steps, grouped by section.
// Pure; used when a playbook is attached to an incident (the steps are copied
// into the run, so the document itself never changes).
//
// A section starts at a heading:
//   - a Markdown heading                     "## 7. Contain"
//   - in a document with no Markdown headings, a numbered heading
//     ("3.2 Notification") or an ALL CAPS line, as section detection does
//     for uploads (lib/exercise/ingest/sections).
// A step is:
//   - a numbered list item                    "1. Isolate the host" / "2) ..."
//   - a task list item                        "- [ ] Rotate keys"
//   - a bold step id paragraph                "**C1. Isolate.** Use EDR to ..."
//                                             "**D2.** Pull the audit trail ..."
//   - a bold decision point                   "**Decision point C-A: cut egress?** ..."
// Fenced code, tables and plain bullets are not steps. Sections without steps
// are left out. Indented lines under a list item are its detail.

export interface ChecklistStep {
  text: string;
  detail: string | null;
  kind: "step" | "decision";
}

export interface ChecklistSection {
  heading: string;
  steps: ChecklistStep[];
}

const MAX_TEXT = 240;
const MAX_DETAIL = 2000;
const MAX_STEPS = 400;

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const NUM_HEADING = /^((?:\d{1,3}\.){1,5}\d{1,3})\.?\s+([A-Z][^\n]*)$/;
const NUM_ITEM = /^(\s{0,3})(\d{1,3})[.)]\s+(.+)$/;
const TASK_ITEM = /^\s{0,3}[-*+]\s+\[[ xX]\]\s+(.+)$/;
const BOLD_LEAD = /^\*\*(.+?)\*\*\s*(.*)$/;
const STEP_ID = /^([A-Z]{1,3}-?\d{1,3}(?:\.\d{1,3})?)\.?(?:\s+(.*))?$/;
const DECISION = /^decision point\b/i;

function clean(s: string): string {
  return s
    .replace(/\*\*|__/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function firstSentence(s: string): string {
  const m = /^(.+?[.?!])(\s|$)/.exec(s);
  return (m ? m[1] : s).trim();
}

function isCapsHeading(t: string): boolean {
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && t.length <= 80 && letters === letters.toUpperCase() && /[A-Z]{2,}/.test(t) && !/[.;,]$/.test(t);
}

/** A bold-led paragraph as a step, or null when the bold text is not a step id or decision point. */
export function boldStep(paragraph: string): ChecklistStep | null {
  const m = BOLD_LEAD.exec(paragraph.trim());
  if (!m) return null;
  const bold = clean(m[1]);
  const rest = clean(m[2]);
  const full = clean(`${m[1]} ${m[2]}`);
  if (DECISION.test(bold)) {
    return { text: clip(bold.replace(/[.:]$/, ""), MAX_TEXT), detail: rest ? clip(rest, MAX_DETAIL) : null, kind: "decision" };
  }
  const id = STEP_ID.exec(bold);
  if (!id) return null;
  const title = (id[2] ?? "").trim();
  let text: string;
  if (title && /[.?!]$/.test(title)) text = `${id[1]}. ${title.replace(/\.$/, "")}`;
  else text = `${id[1]}. ${firstSentence(clean(`${title} ${m[2]}`)).replace(/\.$/, "")}`.trim();
  return { text: clip(text, MAX_TEXT), detail: clip(full, MAX_DETAIL), kind: "step" };
}

export function parseChecklist(text: string): ChecklistSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const hasMd = lines.some((l) => MD_HEADING.test(l.trim()));
  const sections: ChecklistSection[] = [];
  let current: ChecklistSection = { heading: "Steps", steps: [] };
  let total = 0;
  let inFence = false;
  let paragraph: string[] = [];
  let lastItem: ChecklistStep | null = null;

  const push = (step: ChecklistStep) => {
    if (total >= MAX_STEPS) return;
    current.steps.push(step);
    total++;
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      const step = boldStep(paragraph.join(" "));
      if (step) push(step);
    }
    paragraph = [];
  };
  const startSection = (heading: string) => {
    flushParagraph();
    lastItem = null;
    if (current.steps.length) sections.push(current);
    current = { heading: clip(clean(heading), 120), steps: [] };
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const t = line.trim();
    if (/^```/.test(t) || /^~~~/.test(t)) {
      flushParagraph();
      inFence = !inFence;
      lastItem = null;
      continue;
    }
    if (inFence) continue;

    if (!t) {
      flushParagraph();
      continue;
    }

    const md = MD_HEADING.exec(t);
    if (md) {
      startSection(md[2]);
      continue;
    }
    if (!hasMd) {
      const num = NUM_HEADING.exec(t);
      if ((num && t.split(/\s+/).length <= 13 && !/[.;:,]$/.test(num[2])) || isCapsHeading(t)) {
        startSection(t);
        continue;
      }
    }

    if (t.startsWith("|")) {
      flushParagraph();
      lastItem = null;
      continue;
    }

    const num = NUM_ITEM.exec(line);
    const task = num ? null : TASK_ITEM.exec(line);
    if (num || task) {
      flushParagraph();
      const body = clean(num ? num[3] : task![1]);
      if (body) {
        const step: ChecklistStep = { text: clip(body, MAX_TEXT), detail: body.length > MAX_TEXT ? clip(body, MAX_DETAIL) : null, kind: DECISION.test(body) ? "decision" : "step" };
        push(step);
        lastItem = step;
      }
      continue;
    }

    // An indented continuation line belongs to the list item above it.
    if (lastItem && /^\s{2,}\S/.test(line) && !/^\s*[-*+]\s/.test(line)) {
      const more = clean(t);
      lastItem.detail = clip(lastItem.detail ? `${lastItem.detail} ${more}` : `${lastItem.text} ${more}`, MAX_DETAIL);
      continue;
    }
    lastItem = null;

    if (/^\s*[-*+]\s/.test(line)) {
      flushParagraph();
      continue;
    }
    paragraph.push(t);
  }
  flushParagraph();
  if (current.steps.length) sections.push(current);
  return sections;
}

/** Step count of a parsed checklist. */
export function checklistSize(sections: ChecklistSection[]): number {
  return sections.reduce((n, s) => n + s.steps.length, 0);
}
