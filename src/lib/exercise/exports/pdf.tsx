/** @jsxRuntime automatic */
// Situation Manual and Controller/Evaluator handbook PDFs (@react-pdf/renderer).
// Server only. Text only: nothing from the exercise is rendered as markup.

import type { ReactNode } from "react";
import { Document, Page, Text, View, renderPdf, styles } from "@/lib/exercise/react-pdf";
import type { ExportPerson, HandbookData, SitManData } from "./data";
import { confidentialityMarking } from "@/lib/exercise/program/policy";

const s = styles({
  page: { paddingTop: 58, paddingBottom: 54, paddingHorizontal: 50, fontSize: 9.5, fontFamily: "Helvetica", color: "#1d2433", lineHeight: 1.35 },
  header: { position: "absolute", top: 22, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#6b7280" },
  banner: { position: "absolute", top: 34, left: 50, right: 50, fontSize: 8, fontFamily: "Helvetica-Bold", color: "#b91c1c", textAlign: "center" },
  // top, not bottom: react-pdf placed a bottom-anchored fixed view on the last page only.
  // Every page is LETTER portrait (792 pt tall), so 760 is 32 pt above the bottom edge.
  footer: { position: "absolute", top: 760, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#6b7280" },
  coverTitle: { fontSize: 24, lineHeight: 1.2, fontFamily: "Helvetica-Bold", marginTop: 150, marginBottom: 12 },
  coverSub: { fontSize: 13, marginBottom: 24, color: "#374151" },
  coverFact: { fontSize: 10, marginBottom: 4 },
  coverWarn: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#b91c1c", marginTop: 24 },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 8, marginTop: 4 },
  h2: { fontSize: 11.5, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 2 },
  p: { marginBottom: 4 },
  muted: { color: "#6b7280" },
  bold: { fontFamily: "Helvetica-Bold" },
  bullet: { flexDirection: "row", marginBottom: 2 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1 },
  table: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: "#9ca3af", marginTop: 4, marginBottom: 8 },
  tr: { flexDirection: "row" },
  th: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#9ca3af", padding: 3, fontFamily: "Helvetica-Bold", backgroundColor: "#f3f4f6", fontSize: 8 },
  td: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#9ca3af", padding: 3, fontSize: 8 },
  box: { borderWidth: 0.5, borderColor: "#9ca3af", padding: 8, marginBottom: 8 },
  secretBox: { borderWidth: 1, borderColor: "#b91c1c", padding: 8, marginBottom: 8 },
  secretLabel: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#b91c1c", marginBottom: 3 },
  lines: { height: 120, borderWidth: 0.5, borderColor: "#9ca3af", marginBottom: 8 },
});

/** Drop control characters the PDF text layer cannot show. */
function t(v: string | null | undefined): string {
  return (v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function P({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={muted ? [s.p, s.muted] : s.p}>{children}</Text>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((x, i) => (
        <View key={i} style={s.bullet} wrap={false}>
          <Text style={s.bulletDot}>-</Text>
          <Text style={s.bulletText}>{t(x)}</Text>
        </View>
      ))}
    </View>
  );
}

function Block({ title, text, empty }: { title: string; text: string | null | undefined; empty?: string }) {
  if (!text?.trim() && !empty) return null;
  return (
    <View>
      <Text style={s.h2}>{title}</Text>
      <P muted={!text?.trim()}>{text?.trim() ? t(text) : empty}</P>
    </View>
  );
}

function Table({ head, rows, widths }: { head: string[]; rows: string[][]; widths: number[] }) {
  return (
    <View style={s.table}>
      <View style={s.tr} fixed>
        {head.map((h, i) => (
          <Text key={i} style={[s.th, { width: `${widths[i]}%` }]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={s.tr} wrap={false}>
          {r.map((c, i) => (
            <Text key={i} style={[s.td, { width: `${widths[i]}%` }]}>
              {t(c)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Chrome({ d, label, secret, marking = "" }: { d: SitManData | HandbookData; label: string; secret: boolean; marking?: string }) {
  return (
    <>
      <View style={s.header} fixed>
        <Text>{t(d.instanceName)}</Text>
        {marking ? <Text style={{ fontFamily: "Helvetica-Bold", color: "#991b1b" }}>{t(marking.toUpperCase())}</Text> : null}
        <Text>{t(`${d.exercise.title}. ${label}`)}</Text>
      </View>
      {secret && (
        <Text style={s.banner} fixed>
          Controller and evaluator only. Do not share with players.
        </Text>
      )}
      <View style={s.footer} fixed>
        <Text>{d.exercise.isPractice ? "Practice exercise" : "For exercise use only"}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </>
  );
}

function contactRows(people: ExportPerson[]): string[][] {
  return people.map((p) => [p.name, p.roles.join(", "), [p.title, p.organization].filter(Boolean).join(", "), p.email ?? ""]);
}

function Cover({ d, label, secret }: { d: SitManData | HandbookData; label: string; secret: boolean }) {
  const e = d.exercise;
  return (
    <View>
      <Text style={s.coverTitle}>{t(e.title)}</Text>
      <Text style={s.coverSub}>{label}</Text>
      <Text style={s.coverFact}>{t(d.instanceName)}</Text>
      <Text style={s.coverFact}>Type: {e.modeLabel}</Text>
      <Text style={s.coverFact}>STARTEX: {e.startex ?? "Set by the facilitator"}</Text>
      {e.durationMin ? <Text style={s.coverFact}>Duration: {e.durationMin} minutes</Text> : null}
      <Text style={s.coverFact}>Generated: {d.generatedAt.slice(0, 10)}</Text>
      {secret && <Text style={s.coverWarn}>Controller and evaluator only. This handbook holds the scenario, expected actions and intended answers.</Text>}
    </View>
  );
}

/** Sections shared by both documents. */
function Common({ d }: { d: SitManData | HandbookData }) {
  const e = d.exercise;
  return (
    <View>
      <Text style={s.h1}>Exercise overview</Text>
      <Block title="Purpose" text={d.purpose} />
      <Block title="Scope" text={d.scope} empty="Not set." />
      <Text style={s.h2}>Objectives</Text>
      {d.objectives.length ? (
        d.objectives.map((o) => (
          <View key={o.seq} style={s.p}>
            <Text>
              <Text style={s.bold}>{o.seq}. </Text>
              {t(o.text)}
            </Text>
            {o.capabilities.length > 0 && <Text style={s.muted}>Capabilities: {t(o.capabilities.join("; "))}</Text>}
          </View>
        ))
      ) : (
        <P muted>No objectives set.</P>
      )}
      {d.capabilities.length > 0 && (
        <View>
          <Text style={s.h2}>Capabilities</Text>
          <Bullets items={d.capabilities.map((c) => `${c.name} (${c.key}, ${c.framework})`)} />
        </View>
      )}
      <Block title="Ground rules" text={d.groundRules} />
      <Block title="Assumptions and artificialities" text={d.assumptions} empty="None listed." />
      <Block title="No-fault statement" text={d.noFault} />
      <Block title="Stop word" text={d.stopWord ? `${d.stopWord}. Say it to stop play for a real event.` : null} empty="Not set. Ask the facilitator." />

      <Text style={s.h2}>Schedule</Text>
      <Table
        head={["Item", "Value"]}
        widths={[30, 70]}
        rows={[
          ["STARTEX", e.startex ?? "Set by the facilitator"],
          ["Duration", e.durationMin ? `${e.durationMin} minutes` : "Open"],
          ["Scenario clock starts", e.scenarioStart ?? "Not set"],
          ["Time zone", d.timezone],
        ]}
      />

      <Text style={s.h2}>Participant teams</Text>
      {d.teams.length ? (
        d.teams.map((team) => (
          <View key={team.name} style={s.p}>
            <Text style={s.bold}>{t(team.name)}</Text>
            <Text style={s.muted}>{team.members.length ? t(team.members.map((m) => (m.title ? `${m.name} (${m.title})` : m.name)).join(", ")) : "No members yet."}</Text>
          </View>
        ))
      ) : (
        <P muted>This exercise has no teams.</P>
      )}

      <Text style={s.h1} break>
        Scenario
      </Text>
      <Block title="Overview" text={d.scenario} empty="The facilitator briefs the scenario at STARTEX." />
    </View>
  );
}

function Modules({ modules }: { modules: SitManData["modules"] }) {
  if (!modules) return <P muted>Scenario updates are released during play.</P>;
  return (
    <View>
      <Text style={s.h2}>Modules</Text>
      {modules.length === 0 && <P muted>No modules yet.</P>}
      {modules.map((m) => (
        <View key={m.seq} style={s.p} wrap={false}>
          <Text style={s.bold}>
            Module {m.seq}. {t(m.title)}
          </Text>
          {m.questions.length > 0 && <Bullets items={m.questions} />}
        </View>
      ))}
    </View>
  );
}

function Contacts({ people }: { people: ExportPerson[] }) {
  return (
    <View>
      <Text style={s.h2}>Contacts</Text>
      {people.length ? <Table head={["Name", "Role", "Title", "Email"]} widths={[25, 20, 30, 25]} rows={contactRows(people)} /> : <P muted>No contacts listed.</P>}
    </View>
  );
}

export function SituationManualDoc({ d, marking = "" }: { d: SitManData; marking?: string }) {
  const label = "Situation Manual";
  return (
    <Document title={`${d.exercise.title}. ${label}`} creator="Crucible CE" producer="Crucible CE">
      <Page size="LETTER" style={s.page}>
        <Chrome d={d} label={label} secret={false} marking={marking} />
        <Cover d={d} label={label} secret={false} />
      </Page>
      <Page size="LETTER" style={s.page}>
        <Chrome d={d} label={label} secret={false} marking={marking} />
        <Common d={d} />
        <Modules modules={d.modules} />
        <Contacts people={d.contacts} />
      </Page>
    </Document>
  );
}

function Secret({ children }: { children: ReactNode }) {
  return (
    <View style={s.secretBox}>
      <Text style={s.secretLabel}>Controller and evaluator only</Text>
      {children}
    </View>
  );
}

export function HandbookDoc({ d, marking = "" }: { d: HandbookData; marking?: string }) {
  const label = "Controller and Evaluator Handbook";
  return (
    <Document title={`${d.exercise.title}. ${label}`} creator="Crucible CE" producer="Crucible CE">
      <Page size="LETTER" style={s.page}>
        <Chrome d={d} label={label} secret marking={marking} />
        <Cover d={d} label={label} secret />
      </Page>
      <Page size="LETTER" style={s.page}>
        <Chrome d={d} label={label} secret marking={marking} />
        <Common d={d} />
        <Modules modules={d.modules} />
        <Block title="Sponsor" text={d.sponsor} empty="Not set." />
        <Block title="Hazard" text={d.hazard} empty="Not set." />
        <Contacts people={d.contacts} />

        <Text style={s.h1} break>
          Master Scenario Events List
        </Text>
        {d.msel.length ? (
          <Table
            head={["#", "Planned", "Scenario time", "Title", "Teams", "Objectives", "ATT&CK", "Status"]}
            widths={[5, 15, 13, 24, 13, 9, 12, 9]}
            rows={d.msel.map((r) => [String(r.seq), r.when, r.scenarioTime ?? "", r.title, r.teams.join(", "), r.objectives.join(", "), r.techniques.join(", "), r.status])}
          />
        ) : (
          <P muted>No injects planned yet.</P>
        )}

        <Text style={s.h1} break>
          Injects
        </Text>
        {d.injects.map((i) => (
          <View key={i.seq} style={{ marginBottom: 10 }}>
            <Text style={s.h2}>
              {i.seq}. {t(i.title)}
            </Text>
            <P muted>
              {t([`Planned: ${i.when}`, i.scenarioTime ? `Scenario time: ${i.scenarioTime}` : null, `Teams: ${i.teams.join(", ")}`].filter(Boolean).join(". "))}
            </P>
            {i.objectives.length > 0 && <P muted>Objectives: {t(i.objectives.join("; "))}</P>}
            <Secret>
              {i.narratives.map((n, k) => (
                <View key={k} style={s.p}>
                  <Text style={s.h3}>{t(n.label)}</Text>
                  <Text>{t(n.text)}</Text>
                </View>
              ))}
              {i.questions.length > 0 && (
                <View>
                  <Text style={s.h3}>Questions</Text>
                  {i.questions.map((q, k) => (
                    <View key={k} style={s.p}>
                      <Text>
                        <Text style={s.bold}>{t(q.team)}</Text>
                        {q.owner ? ` (${t(q.owner)})` : ""}. {t(q.text)}
                      </Text>
                      {q.options.length > 0 && <Bullets items={q.options.map((o) => `${o.id.toUpperCase()}. ${o.text}`)} />}
                    </View>
                  ))}
                </View>
              )}
              {i.intended.length > 0 && (
                <View>
                  <Text style={s.h3}>Intended option per team and path</Text>
                  <Table head={["Team", "Path", "Intended option", "Why"]} widths={[18, 14, 38, 30]} rows={i.intended.map((x) => [x.team, x.path, x.option, x.why ?? ""])} />
                </View>
              )}
              {i.deliverable && (
                <View>
                  <Text style={s.h3}>Written task</Text>
                  <Text>{t(i.deliverable)}</Text>
                </View>
              )}
              {i.expectedActions.length > 0 && (
                <View>
                  <Text style={s.h3}>Expected actions</Text>
                  <Bullets items={i.expectedActions} />
                </View>
              )}
              {i.controllerNotes && (
                <View>
                  <Text style={s.h3}>Controller notes</Text>
                  <Text>{t(i.controllerNotes)}</Text>
                </View>
              )}
              {i.techniques.length > 0 && (
                <View>
                  <Text style={s.h3}>MITRE ATT&CK techniques</Text>
                  <Bullets items={i.techniques} />
                </View>
              )}
              {i.narratives.length + i.questions.length + i.expectedActions.length === 0 && <P muted>No detail for this inject.</P>}
            </Secret>
          </View>
        ))}
        {d.injects.length === 0 && <P muted>No injects yet.</P>}

        <Text style={s.h1} break>
          Exercise Evaluation Guide
        </Text>
        <Text style={s.h2}>Rating legend</Text>
        <Table head={["Rating", "Meaning"]} widths={[15, 85]} rows={d.ratingLegend.map((r) => [r.rating, r.label])} />
        {d.eeg.map((o) => (
          <View key={o.seq} break={o.seq > 1 || undefined}>
            <Text style={s.h2}>
              Objective {o.seq}. {t(o.text)}
            </Text>
            {o.capabilities.length > 0 && <P muted>Capabilities: {t(o.capabilities.join("; "))}</P>}
            {o.injects.length > 0 && <P muted>Tested by: {t(o.injects.join("; "))}</P>}
            <Text style={s.h3}>Critical tasks</Text>
            {o.criticalTasks.length ? (
              <Table head={["Task", "Observed", "Rating"]} widths={[70, 15, 15]} rows={o.criticalTasks.map((x) => [x, "", ""])} />
            ) : (
              <P muted>No expected actions are linked to this objective.</P>
            )}
            <Text style={s.h3}>Observations</Text>
            <View style={s.lines} />
            <Text style={s.h3}>Rating (P, S, M or U) and rationale</Text>
            <View style={[s.lines, { height: 60 }]} />
            <Text style={s.muted}>Evaluator name and date</Text>
          </View>
        ))}
        {d.eeg.length === 0 && <P muted>Add objectives in the lobby to get evaluation pages.</P>}
      </Page>
    </Document>
  );
}

/** The instance confidentiality marking goes in every page header. */
export async function renderSituationManual(d: SitManData, marking?: string): Promise<Buffer> {
  return renderPdf(<SituationManualDoc d={d} marking={marking ?? (await confidentialityMarking())} />);
}

export async function renderHandbook(d: HandbookData, marking?: string): Promise<Buffer> {
  return renderPdf(<HandbookDoc d={d} marking={marking ?? (await confidentialityMarking())} />);
}
