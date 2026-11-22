/** @jsxRuntime automatic */
// One-page executive dashboard PDF, in the program summary style, with the
// organization's confidentiality marking.

import { Document, Page, Text, renderPdf } from "@/lib/exercise/react-pdf";
import { P, PageChrome, Table, pdfStyles } from "@/lib/exercise/aar/pdf";
import { MODE_TEXT, fmtDay } from "@/lib/exercise/aar/labels";
import { AGING_BUCKETS } from "./report";
import { SEVERITIES, minutesText, type ExecutiveDashboard } from "./executive";

const CADENCE_TEXT: Record<string, string> = { current: "Current", due_soon: "Due soon", overdue: "Overdue", never: "Never tested" };
/** Cadence rows that fit on the page. The program report lists every row. */
const CADENCE_ROWS = 5;
const SEVERITY_TEXT: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

function ExecutiveDocument({ d }: { d: ExecutiveDashboard }) {
  const r = d.readiness;
  return (
    <Document title="Executive dashboard" author={d.instanceName} creator="Crucible CE" producer="Crucible CE">
      <Page size="LETTER" style={pdfStyles.page}>
        <PageChrome left={d.instanceName} draft={false} marking={d.marking} />
        <Text style={pdfStyles.h1}>Executive dashboard</Text>
        <P style={pdfStyles.muted}>
          {d.instanceName}. Last 12 months to {fmtDay(d.window.to)}. Generated {fmtDay(d.generatedAt)}.
        </P>

        <Text style={pdfStyles.h2}>{`Readiness score ${r.score} of 100`}</Text>
        <Table
          columns={[
            { label: "Component", width: 24 },
            { label: "Weight", width: 10 },
            { label: "Score", width: 10 },
            { label: "Why", width: 56 },
          ]}
          rows={r.components.map((c) => [c.label, String(c.weight), c.score === null ? "Not counted" : String(c.score), c.explanation])}
        />

        <Text style={pdfStyles.h2}>Incidents</Text>
        <P>{`Open by severity: ${SEVERITIES.map((x) => `${d.incidents.bySeverity[x] ?? 0} ${SEVERITY_TEXT[x].toLowerCase()}`).join(", ")}.`}</P>
        <Table
          columns={[
            { label: "Open", width: 20 },
            { label: "Past an SLA", width: 20 },
            { label: `MTTA, ${d.incidents.windowDays} days`, width: 30 },
            { label: `MTTR, ${d.incidents.windowDays} days`, width: 30 },
          ]}
          rows={[[String(d.incidents.open), String(d.incidents.slaBreached), minutesText(d.incidents.mttaMinutes), minutesText(d.incidents.mttrMinutes)]]}
        />

        <Text style={pdfStyles.h2}>Exercise program</Text>
        <P>
          {`${d.program.exercises} exercises in 12 months`}
          {d.program.exercises ? `: ${Object.entries(d.program.byMode).map(([m, n]) => `${n} ${MODE_TEXT[m] ?? m}`).join(", ")}.` : "."}
        </P>
        {d.program.cadence.length ? (
          <Table
            columns={[
              { label: "Requirement", width: 52 },
              { label: "Last tested", width: 16 },
              { label: "Due", width: 16 },
              { label: "Status", width: 16 },
            ]}
            rows={d.program.cadence.slice(0, CADENCE_ROWS).map((c) => [
              c.controlId ? `${c.frameworkLabel} ${c.controlId}` : c.frameworkLabel,
              fmtDay(c.lastTested) || "Never",
              fmtDay(c.dueAt),
              CADENCE_TEXT[c.status] ?? c.status,
            ])}
          />
        ) : (
          <P style={pdfStyles.muted}>No cadence set for the enabled frameworks.</P>
        )}
        {d.program.cadence.length > CADENCE_ROWS ? <P style={pdfStyles.muted}>{`${d.program.cadence.length - CADENCE_ROWS} more in the program report.`}</P> : null}
        {d.program.roles.length ? (
          <P>{`Required roles: ${d.program.roles.map((x) => `${x.role} ${x.present} of ${x.total}`).join(", ")}.`}</P>
        ) : null}

        <Text style={pdfStyles.h2}>Improvement plan</Text>
        <Table
          columns={[{ label: "Open", width: 20 }, { label: "Overdue", width: 20 }, { label: "High priority", width: 20 }, ...AGING_BUCKETS.slice(2).map((b) => ({ label: b.label, width: 20 }))]}
          rows={[[String(d.improvement.open), String(d.improvement.overdue), String(d.improvement.openHigh), ...AGING_BUCKETS.slice(2).map((b) => String(d.improvement.aging[b.key] ?? 0))]]}
        />
        <P>
          {`Accepted findings: ${d.improvement.findings.accepted}. With a work item: ${d.improvement.findings.actionItems}. No action needed: ${d.improvement.findings.noAction}.`}
        </P>
        <P style={pdfStyles.muted}>The score is rule-based. Incidents do not change it.</P>
      </Page>
    </Document>
  );
}

export async function renderExecutivePdf(d: ExecutiveDashboard): Promise<Buffer> {
  return renderPdf(<ExecutiveDocument d={d} />);
}
