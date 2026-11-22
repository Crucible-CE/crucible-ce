// AAR as an editable Word document (docx). Same structure as the PDF.
// The DOCX is a working copy; the signed record is aar.signed.json.

import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { APPROVAL_STATEMENT, NO_AI_STATEMENT, controlResultLabel } from "./schema";
import type { SignedAarDocument } from "./document";
import {
  ATTENDANCE_TEXT,
  CLOCK_TEXT,
  POETE_TEXT,
  PRIORITY_TEXT,
  ROLE_TEXT,
  SECTION_TEXT,
  SIGNATURE_STATEMENT,
  STATUS_TEXT,
  fmtDay,
  fmtTime,
  modeWithType,
  provenanceText,
  type AarRenderMeta,
} from "./labels";
import { planLine, ratingLine } from "./pdf";
import { appendixRows, followUpText, reportAfis } from "./findings";

function h(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1, pageBreakBefore = false): Paragraph {
  return new Paragraph({ text, heading: level, pageBreakBefore });
}

function p(text: string, opts: { bold?: string; italics?: boolean } = {}): Paragraph {
  const runs: TextRun[] = [];
  if (opts.bold) runs.push(new TextRun({ text: opts.bold, bold: true }));
  runs.push(new TextRun({ text, italics: opts.italics }));
  return new Paragraph({ children: runs, spacing: { after: 80 } });
}

function bullets(items: string[]): Paragraph[] {
  return items.map((t) => new Paragraph({ text: t, bullet: { level: 0 } }));
}

function table(headers: string[], rows: string[][]): Table {
  const cell = (t: string, bold = false) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold, size: 18 })] })] });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((x) => cell(x, true)) }),
      ...rows.map((r) => new TableRow({ children: headers.map((_, i) => cell(r[i] ?? "")) })),
    ],
  });
}

export function buildAarDocx(doc: SignedAarDocument, meta: AarRenderMeta): Document {
  const s = doc.aar.sections;
  const o = s.overview;
  const tz = meta.timezone;
  const marking = meta.marking ?? "";
  const prev = doc.aar.previousVersion;
  const meeting = doc.aar.meeting;
  const children: Array<Paragraph | Table> = [];

  // Cover
  children.push(
    new Paragraph({ children: [new TextRun({ text: doc.exercise.title, bold: true, size: 48 })], spacing: { before: 2400, after: 200 } }),
    new Paragraph({ children: [new TextRun({ text: "After-Action Report and Improvement Plan", size: 28 })], spacing: { after: 400 } }),
    ...(marking ? [new Paragraph({ children: [new TextRun({ text: marking.toUpperCase(), bold: true, color: "991B1B" })] })] : []),
    p(meta.instanceName, { bold: "Organization: " }),
    p(modeWithType(doc.exercise.mode), { bold: "Exercise type: " }),
    p(fmtTime(doc.exercise.startedAt, tz), { bold: "Started: " }),
    p(fmtTime(doc.exercise.endedAt, tz), { bold: "Ended: " }),
    p(String(doc.aar.version), { bold: "Version: " }),
    p(meta.draft ? "Draft" : "Final", { bold: "Status: " }),
  );
  if (o.sponsor) children.push(p(o.sponsor, { bold: "Sponsor: " }));
  if (prev) {
    children.push(p(`v${prev.version} (hash ${(prev.contentHash ?? "not recorded").slice(0, 16)}). Reason: ${prev.reason || "Not recorded"}`, { bold: "Amends: " }));
  }

  // Overview
  children.push(h("Exercise overview", HeadingLevel.HEADING_1, true));
  children.push(
    table(
      ["Item", "Detail"],
      [
        ["Exercise name", o.name],
        ["Exercise type", modeWithType(doc.exercise.mode)],
        ["Dates", `${fmtTime(o.startedAt, tz)} to ${fmtTime(o.endedAt, tz)}`],
        ["Duration", o.durationMin !== null ? `${o.durationMin} min` : "Not recorded"],
        ["Scope", o.scope || "Not recorded"],
        ["Mission areas", o.missionAreas.join(", ") || "Not recorded"],
        ["Threat or hazard", o.hazard || "Not recorded"],
        ["Sponsor", o.sponsor || "Not recorded"],
        ["Participating organizations", o.participatingOrganizations.join(", ") || "Not recorded"],
        ["Points of contact", o.pointsOfContact.join("; ") || "Not recorded"],
        ["Source document", o.sourceDocument ? `${o.sourceDocument.title} (sha256 ${o.sourceDocument.sha256.slice(0, 16)})` : "None"],
        ["Plans exercised", o.plansExercised.map(planLine).join("; ") || "Not recorded"],
        ["After-action meeting", meeting?.heldAt ? fmtTime(meeting.heldAt, tz) : "Not recorded"],
        ["Meeting attendees", meeting?.attendees || "Not recorded"],
        ["Improvement plan agreed", meeting?.improvementPlanAgreedAt ? fmtTime(meeting.improvementPlanAgreedAt, tz) : "Not recorded"],
      ],
    ),
  );
  children.push(h("Requirements this exercise is meant to satisfy", HeadingLevel.HEADING_2));
  children.push(
    ...(o.requirements.length
      ? bullets(o.requirements.map((r) => `${r.framework} ${r.controlId}${r.title ? ` ${r.title}` : ""}`))
      : [p("None set in the exercise plan.", { italics: true })]),
  );
  if (o.scenarioSummary) children.push(h("Scenario", HeadingLevel.HEADING_2), p(o.scenarioSummary));
  children.push(h("Objectives", HeadingLevel.HEADING_2), ...bullets(s.analysis.map((a, i) => `${i + 1}. ${a.objectiveText}`)));
  children.push(h("Executive summary"), p(s.executiveSummary || "Not written."));

  // Analysis
  children.push(h("Analysis of capabilities", HeadingLevel.HEADING_1, true));
  if (!s.analysis.length) children.push(p("No objectives recorded.", { italics: true }));
  s.analysis.forEach((a, i) => {
    children.push(h(`Objective ${i + 1}. ${a.objectiveText}`, HeadingLevel.HEADING_2));
    if (a.capabilityKeys.length) children.push(p(a.capabilityKeys.join(", "), { bold: "Capabilities: " }));
    children.push(p(ratingLine(a), { bold: "Rating: " }));
    if (a.ratingRationale) children.push(p(a.notEvaluated ? `Reason: ${a.ratingRationale}` : a.ratingRationale));
    children.push(h("Strengths", HeadingLevel.HEADING_3));
    children.push(...(a.strengths.length ? bullets(a.strengths.map((x) => x.text)) : [p("None recorded.", { italics: true })]));
    children.push(h("Areas for improvement", HeadingLevel.HEADING_3));
    const afis = reportAfis(a.afis);
    if (!afis.length) children.push(p("None recorded.", { italics: true }));
    for (const f of afis) {
      children.push(new Paragraph({ children: [new TextRun({ text: f.title, bold: true })], spacing: { before: 120 } }));
      children.push(p(f.observation, { bold: "Observation. " }), p(f.analysis, { bold: "Analysis. " }), p(f.recommendation, { bold: "Recommendation. " }));
      if (f.references.length) children.push(p(f.references.map((r) => r.label || r.ref).join("; "), { bold: "References: " }));
      if (followUpText(f)) children.push(p(followUpText(f), { italics: true }));
      const quotes = f.evidence.filter((e) => e.quote);
      if (quotes.length) children.push(...bullets(quotes.map((e) => `"${e.quote}"${e.speakerRole ? ` (${e.speakerRole})` : ""}`)));
    }
  });

  // Decision log, clocks, control mapping
  children.push(h("Decision log", HeadingLevel.HEADING_1, true));
  children.push(
    s.decisionLog.length
      ? table(
          ["No.", "Scenario time", "Team", "Owner", "Question", "Decision"],
          s.decisionLog.map((d) => [String(d.seq), d.scenarioTime ? fmtTime(d.scenarioTime, tz) : "", d.team ?? "", d.owner ?? "", d.question ?? "", d.decision ?? ""]),
        )
      : p("No decisions recorded.", { italics: true }),
  );
  children.push(h("Regulatory clocks"));
  children.push(
    s.clocks.length
      ? table(
          ["Clock", "Status", "Deadline", "Outcome"],
          s.clocks.map((c) => [c.label, CLOCK_TEXT[c.status] ?? c.status, c.deadlineAt ? fmtTime(c.deadlineAt, tz) : "", c.statement]),
        )
      : p("No regulatory clocks in this exercise.", { italics: true }),
  );
  children.push(h("Control mapping"));
  children.push(
    s.controlMapping.length
      ? table(
          ["Framework", "Control", "Title", "Result"],
          s.controlMapping.map((c) => [c.framework, c.controlId, c.title, controlResultLabel(c)]),
        )
      : p("No controls mapped.", { italics: true }),
  );

  // Appendices
  children.push(h("Appendix A. Improvement plan", HeadingLevel.HEADING_1, true));
  children.push(
    doc.actionItems.length
      ? table(
          ["Capability", "Area for improvement", "Corrective action", "POETE", "Responsible org", "POC", "Start", "Due", "Status", "Priority"],
          doc.actionItems.map((a) => [
            [a.capabilityKey, a.capabilityName].filter(Boolean).join(" "),
            a.afi,
            a.correctiveAction,
            a.poete ? (POETE_TEXT[a.poete] ?? a.poete) : "",
            a.responsibleOrg ?? "",
            a.poc ?? "",
            fmtDay(a.startDate),
            fmtDay(a.dueDate),
            STATUS_TEXT[a.status] ?? a.status,
            PRIORITY_TEXT[a.priority] ?? a.priority,
          ]),
        )
      : p("No work items.", { italics: true }),
  );
  children.push(h("Appendix B. Participants", HeadingLevel.HEADING_1, true));
  children.push(
    s.roster.length
      ? table(
          ["Name", "Title", "Organization", "Team", "Exercise roles", "Joined", "Left", "Attendance"],
          s.roster.map((r) => [
            `${r.name}${r.guest ? " (guest)" : ""}${r.noDevice ? " (no device)" : ""}`,
            r.title ?? "",
            r.organization ?? "",
            r.team ?? "",
            r.roles.map((x) => ROLE_TEXT[x] ?? x).join(", "),
            r.joinedAt ? fmtTime(r.joinedAt, tz) : "",
            r.leftAt ? fmtTime(r.leftAt, tz) : "",
            r.attendance ? ATTENDANCE_TEXT[r.attendance] : "Not confirmed",
          ]),
        )
      : p("No roster recorded.", { italics: true }),
  );
  children.push(h("Appendix C. Required roles"));
  children.push(
    s.requiredRoles.length
      ? table(["Role", "Present"], s.requiredRoles.map((r) => [r.role, r.present ? "Present" : "Absent"]))
      : p("No required roles set in policy.", { italics: true }),
  );
  children.push(h("Appendix D. Findings not accepted"));
  const appendix = appendixRows(s);
  children.push(
    appendix.length
      ? table(
          ["Finding", "Objective", "Status", "Source", "Reason", "Decided by"],
          appendix.map((r) => [r.title, r.objective, r.status, r.sources, r.reason, [r.by, r.at ? fmtTime(r.at, tz) : ""].filter(Boolean).join(", ")]),
        )
      : p("None. Every finding considered is in the report.", { italics: true }),
  );
  if (s.parkingLot.length) children.push(h("Parking lot", HeadingLevel.HEADING_2), ...bullets(s.parkingLot));

  children.push(h("Methodology"));
  children.push(
    p(s.methodology.text || "Not written."),
    p(NO_AI_STATEMENT),
    p("Ratings are for objectives and capabilities, not people.", { italics: true }),
  );
  if (doc.aar.provenance?.length) {
    children.push(h("Section origins", HeadingLevel.HEADING_2));
    children.push(table(["Section", "Origin"], doc.aar.provenance.map((x) => [SECTION_TEXT[x.section] ?? x.section, provenanceText(x)])));
  }

  children.push(h("Signatures", HeadingLevel.HEADING_1, true));
  if (!doc.signers.length) children.push(p("Not signed.", { italics: true }));
  for (const sg of doc.signers) {
    children.push(new Paragraph({ children: [new TextRun({ text: sg.role === "facilitator" ? "Facilitator" : "Sponsor", bold: true })], spacing: { before: 160 } }));
    children.push(p(`${sg.name}${sg.title ? `, ${sg.title}` : ""}`), p(sg.approval ?? APPROVAL_STATEMENT), p(`Signed ${fmtTime(sg.signedAt, tz)}`));
    if (sg.accountName) children.push(p(sg.accountName, { bold: "Signing account: " }));
    if (sg.enteredBy) children.push(p(`Entered by ${sg.enteredBy.name} for a sponsor with no account.`, { italics: true }));
  }
  if (meta.signature) {
    children.push(
      p(SIGNATURE_STATEMENT),
      p(meta.signature.keyId, { bold: "Key ID: " }),
      p(meta.signature.contentHash, { bold: "Content hash: " }),
      p("This Word file is an editable copy. The signed record is aar.signed.json.", { italics: true }),
    );
  } else {
    children.push(p("Draft. Signatures are added at finalize.", { italics: true }));
  }

  return new Document({
    creator: "Crucible CE",
    title: `${doc.exercise.title} After-Action Report`,
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  ...(marking ? [new TextRun({ text: `${marking.toUpperCase()} | `, bold: true, color: "991B1B", size: 16 })] : []),
                  new TextRun({ text: meta.draft ? `${meta.instanceName} | Draft` : meta.instanceName, size: 16 }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ["Page ", PageNumber.CURRENT], size: 16 })] })],
          }),
        },
        children,
      },
    ],
  });
}

export async function renderAarDocx(doc: SignedAarDocument, meta: AarRenderMeta): Promise<Buffer> {
  return Packer.toBuffer(buildAarDocx(doc, meta));
}

