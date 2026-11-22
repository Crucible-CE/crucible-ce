// Section detection for source documents (playbooks, plans, SOPs).
//
// A heading is one of:
//   - a markdown heading            "## Escalation"            level = #s
//   - a numbered heading            "3.2 Notification"         level = depth
//                                   (short, no closing period)
//   - an ALL CAPS line              "INCIDENT RESPONSE PLAN"   level 1
//
// Each section runs from its heading to the next heading of the same or a
// higher level (so a level 1 section contains its subsections). Offsets are
// character offsets into the input text.

export interface DocSection {
  id: string;
  heading: string;
  level: number;
  /** Offset of the heading line. */
  start: number;
  /** Offset where the section ends (exclusive). */
  end: number;
}

const MAX_HEADING_CHARS = 120;
const MAX_NUMBERED_WORDS = 12;

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function detectHeading(line: string): { heading: string; level: number } | null {
  const t = line.trim();
  if (!t || t.length > MAX_HEADING_CHARS) return null;

  const md = /^(#{1,6})\s+(.+?)\s*#*$/.exec(t);
  if (md) return { heading: md[2].trim(), level: md[1].length };

  const num = /^((?:\d{1,3}\.){0,5}\d{1,3})\.?\s+([A-Z][^\n]*)$/.exec(t);
  if (num) {
    const text = num[2].trim();
    const words = text.split(/\s+/).length;
    if (!/[.;:,]$/.test(text) && words <= MAX_NUMBERED_WORDS) {
      return { heading: `${num[1]} ${text}`, level: Math.min(6, num[1].split(".").length) };
    }
  }

  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && t.length <= 80 && letters === letters.toUpperCase() && !/[.;,]$/.test(t)) {
    // At least one word of 2+ letters, and not just an acronym list ending a sentence.
    if (/[A-Z]{2,}/.test(t)) return { heading: t, level: 1 };
  }
  return null;
}

export function detectSections(text: string): DocSection[] {
  const found: { heading: string; level: number; start: number }[] = [];
  let offset = 0;
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    else if (!inFence) {
      const h = detectHeading(line.replace(/\r$/, ""));
      if (h) found.push({ ...h, start: offset });
    }
    offset += line.length + 1;
  }

  const sections: DocSection[] = found.map((h, i) => {
    let end = text.length;
    for (let j = i + 1; j < found.length; j++) {
      if (found[j].level <= h.level) {
        end = found[j].start;
        break;
      }
    }
    return { id: `s${i + 1}-${slug(h.heading) || "section"}`, heading: h.heading, level: h.level, start: h.start, end };
  });

  if (sections.length === 0 && text.trim() !== "") {
    return [{ id: "s1-document", heading: "Document", level: 1, start: 0, end: text.length }];
  }
  return sections;
}

/** The text of one section. */
export function sectionText(text: string, section: Pick<DocSection, "start" | "end">): string {
  return text.slice(section.start, section.end);
}
