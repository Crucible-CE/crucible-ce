/** @jsxRuntime automatic */
// AAR PDF (HSEEP layout) with @react-pdf/renderer. Server only.
//
// Cover, exercise overview, executive summary, analysis of capabilities per
// objective (rating, strengths, AFIs), decision log, regulatory clocks,
// control mapping, Appendix A improvement plan, Appendix B participants,
// Appendix C required roles, Appendix D findings not accepted (with the
// reason), methodology and AI disclosure, signatures. The analysis prints
// accepted findings only.
// Drafts carry "Draft" on every page.

import type { ReactNode } from "react";
import { Document, Page, Text, View, renderPdf, styles, type Style } from "@/lib/exercise/react-pdf";
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
import { APPROVAL_STATEMENT, NO_AI_STATEMENT, NOT_EVALUATED_LABEL, RATING_LABELS, controlResultLabel, type ObjectiveAnalysis, type Rating } from "./schema";
import type { SignedAarDocument } from "./document";
import { appendixRows, followUpText, reportAfis } from "./findings";

export type { AarRenderMeta } from "./labels";

// US Letter is 612 x 792 pt. The footer is placed with top, measured from the
// page height, because react-pdf did not repeat a bottom-anchored fixed view
// on every page. Every page here is LETTER; pass landscape for rotated pages.
const LETTER_PT = { short: 612, long: 792 };
const FOOTER_FROM_BOTTOM = 32;
export function footerTop(landscape: boolean): number {
  return (landscape ? LETTER_PT.short : LETTER_PT.long) - FOOTER_FROM_BOTTOM;
}

export const pdfStyles = styles({
  page: { paddingTop: 54, paddingBottom: 54, paddingHorizontal: 50, fontSize: 9.5, fontFamily: "Helvetica", color: "#1d2433", lineHeight: 1.35 },
  header: { position: "absolute", top: 22, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#6b7280" },
  marking: { fontFamily: "Helvetica-Bold", color: "#991b1b", textTransform: "uppercase" },
  draftMark: { color: "#b45309", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", top: footerTop(false), left: 50, right: 50, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#6b7280" },
  coverTitle: { fontSize: 24, fontFamily: "Helvetica-Bold", marginTop: 160, marginBottom: 14, lineHeight: 1.25 },
  coverSub: { fontSize: 13, marginBottom: 24, color: "#374151" },
  coverFact: { fontSize: 10, marginBottom: 4 },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 8, marginTop: 4 },
  h2: { fontSize: 11.5, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 2 },
  p: { marginBottom: 4 },
  muted: { color: "#6b7280" },
  label: { fontFamily: "Helvetica-Bold" },
  bullet: { flexDirection: "row", marginBottom: 2 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1 },
  table: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: "#9ca3af", marginTop: 4, marginBottom: 8 },
  tr: { flexDirection: "row" },
  th: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#9ca3af", padding: 3, fontFamily: "Helvetica-Bold", backgroundColor: "#f3f4f6", fontSize: 8 },
  td: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#9ca3af", padding: 3, fontSize: 8 },
  box: { borderWidth: 0.5, borderColor: "#9ca3af", padding: 8, marginBottom: 8 },
  mono: { fontFamily: "Courier", fontSize: 8 },
});

export function P({ children, style }: { children: ReactNode; style?: Style }) {
  return <Text style={style ? [pdfStyles.p, style] : pdfStyles.p}>{children}</Text>;
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((t, i) => (
        <View key={i} style={pdfStyles.bullet} wrap={false}>
          <Text style={pdfStyles.bulletDot}>-</Text>
          <Text style={pdfStyles.bulletText}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

export function Table({ columns, rows }: { columns: Array<{ label: string; width: number }>; rows: string[][] }) {
  return (
    <View style={pdfStyles.table}>
      <View style={pdfStyles.tr} fixed>
        {columns.map((c, i) => (
          <Text key={i} style={[pdfStyles.th, { width: `${c.width}%` }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={pdfStyles.tr} wrap={false}>
          {columns.map((c, ci) => (
            <Text key={ci} style={[pdfStyles.td, { width: `${c.width}%` }]}>
              {r[ci] ?? ""}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function PageChrome({ left, draft, landscape = false, marking = "" }: { left: string; draft: boolean; landscape?: boolean; marking?: string }) {
  return (
    <>
      <View style={pdfStyles.header} fixed>
        <Text>{left}</Text>
        {marking ? <Text style={pdfStyles.marking}>{marking}</Text> : null}
        {draft ? <Text style={pdfStyles.draftMark}>Draft</Text> : <Text> </Text>}
      </View>
      <View style={landscape ? [pdfStyles.footer, { top: footerTop(true) }] : pdfStyles.footer} fixed>
        <Text>{draft ? "Draft. Not signed." : "Signed report"}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </>
  );
}

/** "S. Performed with some challenges (evaluator)", "Not evaluated (evaluator)" or "Not rated". */
export function ratingLine(a: Pick<ObjectiveAnalysis, "rating" | "ratingSource" | "notEvaluated">): string {
  const by = a.ratingSource === "evaluator" ? " (evaluator)" : "";
  if (a.notEvaluated) return `${NOT_EVALUATED_LABEL}${by}`;
  if (!a.rating) return "Not rated";
  return `${a.rating}. ${RATING_LABELS[a.rating as Rating] ?? a.rating}${by}`;
}

/** "Plan title, v2, 2026-01-05, owner IT, sha256 ab12..." */
export function planLine(d: { title: string; version: string; date: string; owner: string; sha256: string | null }): string {
  return [d.title, d.version ? `v${d.version.replace(/^v/i, "")}` : null, d.date || null, d.owner ? `owner ${d.owner}` : null, d.sha256 ? `sha256 ${d.sha256.slice(0, 16)}` : null]
    .filter(Boolean)
    .join(", ");
}

export function AarPdfDocument({ doc, meta }: { doc: SignedAarDocument; meta: AarRenderMeta }) {
  const s = doc.aar.sections;
  const o = s.overview;
  const tz = meta.timezone;
  const chrome = `${doc.exercise.title} | After-action report v${doc.aar.version}`;
  const signers = doc.signers;
  const marking = meta.marking ?? "";
  const appendix = appendixRows(s);
  const prev = doc.aar.previousVersion;
  const meeting = doc.aar.meeting;
  return (
    <Document title={`${doc.exercise.title} After-Action Report`} author={meta.instanceName} creator="Crucible CE" producer="Crucible CE">
      <Page size="LETTER" style={pdfStyles.page}>
        <PageChrome left={meta.instanceName} draft={meta.draft} marking={marking} />
        <Text style={pdfStyles.coverTitle}>{doc.exercise.title}</Text>
        <Text style={pdfStyles.coverSub}>After-Action Report and Improvement Plan</Text>
        <Text style={pdfStyles.coverFact}>Organization: {meta.instanceName}</Text>
        {marking ? <Text style={[pdfStyles.coverFact, pdfStyles.marking]}>{marking}</Text> : null}
        <Text style={pdfStyles.coverFact}>Exercise type: {modeWithType(doc.exercise.mode)}</Text>
        <Text style={pdfStyles.coverFact}>Started: {fmtTime(doc.exercise.startedAt, tz)}</Text>
        <Text style={pdfStyles.coverFact}>Ended: {fmtTime(doc.exercise.endedAt, tz)}</Text>
        <Text style={pdfStyles.coverFact}>Version: {doc.aar.version}</Text>
        <Text style={pdfStyles.coverFact}>Status: {meta.draft ? "Draft" : "Final"}</Text>
        {o.sponsor ? <Text style={pdfStyles.coverFact}>Sponsor: {o.sponsor}</Text> : null}
        {prev ? (
          <Text style={pdfStyles.coverFact}>
            Amends v{prev.version} (hash {(prev.contentHash ?? "not recorded").slice(0, 16)}). Reason: {prev.reason || "Not recorded"}
          </Text>
        ) : null}
      </Page>

      <Page size="LETTER" style={pdfStyles.page}>
        <PageChrome left={chrome} draft={meta.draft} marking={marking} />
        <Text style={pdfStyles.h1}>Exercise overview</Text>
        <Table
          columns={[
            { label: "Item", width: 28 },
            { label: "Detail", width: 72 },
          ]}
          rows={[
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
          ]}
        />
        <Text style={pdfStyles.h2}>Requirements this exercise is meant to satisfy</Text>
        {o.requirements.length ? (
          <Bullets items={o.requirements.map((r) => `${r.framework} ${r.controlId}${r.title ? ` ${r.title}` : ""}`)} />
        ) : (
          <P style={pdfStyles.muted}>None set in the exercise plan.</P>
        )}
        {o.scenarioSummary ? (
          <>
            <Text style={pdfStyles.h2}>Scenario</Text>
            <P>{o.scenarioSummary}</P>
          </>
        ) : null}
        <Text style={pdfStyles.h2}>Objectives</Text>
        <Bullets items={s.analysis.map((a, i) => `${i + 1}. ${a.objectiveText}`)} />

        <Text style={pdfStyles.h1}>Executive summary</Text>
        <P>{s.executiveSummary || "Not written."}</P>
      </Page>

      <Page size="LETTER" style={pdfStyles.page}>
        <PageChrome left={chrome} draft={meta.draft} marking={marking} />
        <Text style={pdfStyles.h1}>Analysis of capabilities</Text>
        {s.analysis.length === 0 ? <P style={pdfStyles.muted}>No objectives recorded.</P> : null}
        {s.analysis.map((a, i) => (
          <View key={a.objectiveId}>
            <Text style={pdfStyles.h2}>
              Objective {i + 1}. {a.objectiveText}
            </Text>
            {a.capabilityKeys.length ? <P style={pdfStyles.muted}>Capabilities: {a.capabilityKeys.join(", ")}</P> : null}
            <P>
              <Text style={pdfStyles.label}>Rating: </Text>
              {ratingLine(a)}
            </P>
            {a.ratingRationale ? <P>{a.notEvaluated ? `Reason: ${a.ratingRationale}` : a.ratingRationale}</P> : null}
            <Text style={pdfStyles.h3}>Strengths</Text>
            {a.strengths.length ? <Bullets items={a.strengths.map((x) => x.text)} /> : <P style={pdfStyles.muted}>None recorded.</P>}
            <Text style={pdfStyles.h3}>Areas for improvement</Text>
            {reportAfis(a.afis).length === 0 ? <P style={pdfStyles.muted}>None recorded.</P> : null}
            {reportAfis(a.afis).map((f) => (
              <View key={f.id} style={pdfStyles.box}>
                <Text style={pdfStyles.label}>{f.title}</Text>
                <P>
                  <Text style={pdfStyles.label}>Observation. </Text>
                  {f.observation}
                </P>
                <P>
                  <Text style={pdfStyles.label}>Analysis. </Text>
                  {f.analysis}
                </P>
                <P>
                  <Text style={pdfStyles.label}>Recommendation. </Text>
                  {f.recommendation}
                </P>
                {f.references.length ? <P style={pdfStyles.muted}>References: {f.references.map((r) => r.label || r.ref).join("; ")}</P> : null}
                {followUpText(f) ? <P style={pdfStyles.muted}>{followUpText(f)}</P> : null}
                {f.evidence.filter((e) => e.quote).length ? (
                  <Bullets items={f.evidence.filter((e) => e.quote).map((e) => `"${e.quote}"${e.speakerRole ? ` (${e.speakerRole})` : ""}`)} />
                ) : null}
              </View>
            ))}
          </View>
        ))}
      </Page>

      <Page size="LETTER" style={pdfStyles.page}>
        <PageChrome left={chrome} draft={meta.draft} marking={marking} />
        <Text style={pdfStyles.h1}>Decision log</Text>
        {s.decisionLog.length ? (
          <Table
            columns={[
              { label: "No.", width: 6 },
              { label: "Scenario time", width: 15 },
              { label: "Team", width: 13 },
              { label: "Owner", width: 14 },
              { label: "Question", width: 26 },
              { label: "Decision", width: 26 },
            ]}
            rows={s.decisionLog.map((d) => [String(d.seq), d.scenarioTime ? fmtTime(d.scenarioTime, tz) : "", d.team ?? "", d.owner ?? "", d.question ?? "", d.decision ?? ""])}
          />
        ) : (
          <P style={pdfStyles.muted}>No decisions recorded.</P>
        )}
        <Text style={pdfStyles.h1}>Regulatory clocks</Text>
        {s.clocks.length ? (
          <Table
            columns={[
              { label: "Clock", width: 25 },
              { label: "Status", width: 12 },
              { label: "Deadline", width: 18 },
              { label: "Outcome", width: 45 },
            ]}
            rows={s.clocks.map((c) => [c.label, CLOCK_TEXT[c.status] ?? c.status, c.deadlineAt ? fmtTime(c.deadlineAt, tz) : "", c.statement])}
          />
        ) : (
          <P style={pdfStyles.muted}>No regulatory clocks in this exercise.</P>
        )}
        <Text style={pdfStyles.h1}>Control mapping</Text>
        {s.controlMapping.length ? (
          <Table
            columns={[
              { label: "Framework", width: 18 },
              { label: "Control", width: 14 },
              { label: "Title", width: 48 },
              { label: "Result", width: 20 },
            ]}
            rows={s.controlMapping.map((c) => [c.framework, c.controlId, c.title, controlResultLabel(c)])}
          />
        ) : (
          <P style={pdfStyles.muted}>No controls mapped.</P>
        )}
      </Page>

      <Page size="LETTER" orientation="landscape" style={pdfStyles.page}>
        <PageChrome left={chrome} draft={meta.draft} landscape marking={marking} />
        <Text style={pdfStyles.h1}>Appendix A. Improvement plan</Text>
        {doc.actionItems.length ? (
          <Table
            columns={[
              { label: "Capability", width: 10 },
              { label: "Area for improvement", width: 16 },
              { label: "Corrective action", width: 18 },
              { label: "POETE", width: 7 },
              { label: "Responsible org", width: 10 },
              { label: "POC", width: 9 },
              { label: "Start", width: 7 },
              { label: "Due", width: 7 },
              { label: "Status", width: 7 },
              { label: "Priority", width: 9 },
            ]}
            rows={doc.actionItems.map((a) => [
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
            ])}
          />
        ) : (
          <P style={pdfStyles.muted}>No work items.</P>
        )}
      </Page>

      <Page size="LETTER" style={pdfStyles.page}>
        <PageChrome left={chrome} draft={meta.draft} marking={marking} />
        <Text style={pdfStyles.h1}>Appendix B. Participants</Text>
        {s.roster.length ? (
          <Table
            columns={[
              { label: "Name", width: 15 },
              { label: "Title", width: 13 },
              { label: "Organization", width: 12 },
              { label: "Team", width: 9 },
              { label: "Exercise roles", width: 13 },
              { label: "Joined", width: 13 },
              { label: "Left", width: 13 },
              { label: "Attendance", width: 12 },
            ]}
            rows={s.roster.map((r) => [
              `${r.name}${r.guest ? " (guest)" : ""}${r.noDevice ? " (no device)" : ""}`,
              r.title ?? "",
              r.organization ?? "",
              r.team ?? "",
              r.roles.map((x) => ROLE_TEXT[x] ?? x).join(", "),
              r.joinedAt ? fmtTime(r.joinedAt, tz) : "",
              r.leftAt ? fmtTime(r.leftAt, tz) : "",
              r.attendance ? ATTENDANCE_TEXT[r.attendance] : "Not confirmed",
            ])}
          />
        ) : (
          <P style={pdfStyles.muted}>No roster recorded.</P>
        )}
        <Text style={pdfStyles.h1}>Appendix C. Required roles</Text>
        {s.requiredRoles.length ? (
          <Table
            columns={[
              { label: "Role", width: 70 },
              { label: "Present", width: 30 },
            ]}
            rows={s.requiredRoles.map((r) => [r.role, r.present ? "Present" : "Absent"])}
          />
        ) : (
          <P style={pdfStyles.muted}>No required roles set in policy.</P>
        )}
        <Text style={pdfStyles.h1}>Appendix D. Findings not accepted</Text>
        {appendix.length ? (
          <Table
            columns={[
              { label: "Finding", width: 26 },
              { label: "Objective", width: 16 },
              { label: "Status", width: 9 },
              { label: "Source", width: 11 },
              { label: "Reason", width: 22 },
              { label: "Decided by", width: 16 },
            ]}
            rows={appendix.map((r) => [r.title, r.objective, r.status, r.sources, r.reason, [r.by, r.at ? fmtTime(r.at, tz) : ""].filter(Boolean).join(", ")])}
          />
        ) : (
          <P style={pdfStyles.muted}>None. Every finding considered is in the report.</P>
        )}
        {s.parkingLot.length ? (
          <>
            <Text style={pdfStyles.h2}>Parking lot</Text>
            <Bullets items={s.parkingLot} />
          </>
        ) : null}
        <Text style={pdfStyles.h1}>Methodology</Text>
        <P>{s.methodology.text || "Not written."}</P>
        <P>{NO_AI_STATEMENT}</P>
        <P style={pdfStyles.muted}>Ratings are for objectives and capabilities, not people.</P>
        {doc.aar.provenance?.length ? (
          <>
            <Text style={pdfStyles.h2}>Section origins</Text>
            <Table
              columns={[
                { label: "Section", width: 40 },
                { label: "Origin", width: 60 },
              ]}
              rows={doc.aar.provenance.map((p) => [SECTION_TEXT[p.section] ?? p.section, provenanceText(p)])}
            />
          </>
        ) : null}
      </Page>

      <Page size="LETTER" style={pdfStyles.page}>
        <PageChrome left={chrome} draft={meta.draft} marking={marking} />
        <Text style={pdfStyles.h1}>Signatures</Text>
        {signers.length === 0 ? <P style={pdfStyles.muted}>Not signed.</P> : null}
        {signers.map((sg) => (
          <View key={sg.role} style={pdfStyles.box} wrap={false}>
            <Text style={pdfStyles.label}>{sg.role === "facilitator" ? "Facilitator" : "Sponsor"}</Text>
            <P>
              {sg.name}
              {sg.title ? `, ${sg.title}` : ""}
            </P>
            <P>{sg.approval ?? APPROVAL_STATEMENT}</P>
            <P style={pdfStyles.muted}>Signed {fmtTime(sg.signedAt, tz)}</P>
            {sg.accountName ? <P style={pdfStyles.muted}>Signing account: {sg.accountName}</P> : null}
            {sg.enteredBy ? <P style={pdfStyles.muted}>Entered by {sg.enteredBy.name} for a sponsor with no account.</P> : null}
          </View>
        ))}
        {meta.signature ? (
          <View style={pdfStyles.box} wrap={false}>
            <P>{SIGNATURE_STATEMENT}</P>
            <P>
              <Text style={pdfStyles.label}>Key ID </Text>
              <Text style={pdfStyles.mono}>{meta.signature.keyId}</Text>
            </P>
            <P>
              <Text style={pdfStyles.label}>Content hash </Text>
              <Text style={pdfStyles.mono}>{meta.signature.contentHash}</Text>
            </P>
            <P style={pdfStyles.muted}>Ed25519 over the canonical JSON in aar.signed.json. Check it with scripts/verify-bundle.ts.</P>
          </View>
        ) : (
          <P style={pdfStyles.muted}>Draft. Signatures are added at finalize.</P>
        )}
      </Page>
    </Document>
  );
}

export async function renderAarPdf(doc: SignedAarDocument, meta: AarRenderMeta): Promise<Buffer> {
  return renderPdf(<AarPdfDocument doc={doc} meta={meta} />);
}
