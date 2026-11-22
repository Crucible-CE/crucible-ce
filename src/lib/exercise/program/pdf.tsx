/** @jsxRuntime automatic */
// Program report PDF and the one-page executive summary PDF.

import { Document, Page, Text, View, renderPdf } from "@/lib/exercise/react-pdf";
import { Bullets, P, PageChrome, Table, pdfStyles } from "@/lib/exercise/aar/pdf";
import { MODE_TEXT, PRIORITY_TEXT, fmtDay } from "@/lib/exercise/aar/labels";
import { AGING_BUCKETS, type ProgramReport } from "./report";

const CADENCE_TEXT: Record<string, string> = { current: "Current", due_soon: "Due soon", overdue: "Overdue", never: "Never tested" };

function ProgramReportDocument({ r }: { r: ProgramReport }) {
  const title = `Program report ${fmtDay(r.window.from)} to ${fmtDay(r.window.to)}`;
  return (
    <Document title={title} author={r.instanceName} creator="Crucible CE" producer="Crucible CE">
      <Page size="LETTER" style={pdfStyles.page}>
        <PageChrome left={`${r.instanceName} | ${title}`} draft={false} marking={r.marking} />
        <Text style={pdfStyles.h1}>Exercise program report</Text>
        <P style={pdfStyles.muted}>
          {r.instanceName}. Window {fmtDay(r.window.from)} to {fmtDay(r.window.to)}. Generated {fmtDay(r.generatedAt)}.
        </P>

        <Text style={pdfStyles.h2}>Exercises</Text>
        {r.exercises.length ? (
          <Table
            columns={[
              { label: "Exercise", width: 38 },
              { label: "Type", width: 14 },
              { label: "Ended", width: 13 },
              { label: "Participants", width: 12 },
              { label: "Report", width: 11 },
              { label: "Open items", width: 12 },
            ]}
            rows={r.exercises.map((e) => [
              e.title,
              MODE_TEXT[e.mode] ?? e.mode,
              fmtDay(e.endedAt),
              String(e.participants),
              e.aarStatus ? `${e.aarStatus} v${e.aarVersion}` : "None",
              String(e.openItems),
            ])}
          />
        ) : (
          <P style={pdfStyles.muted}>No exercises ended in this window.</P>
        )}

        <Text style={pdfStyles.h2}>Reports past due</Text>
        {r.aarOverdue.length ? (
          <Table
            columns={[
              { label: "Exercise", width: 50 },
              { label: "Ended", width: 16 },
              { label: "Days", width: 10 },
              { label: "Missing", width: 24 },
            ]}
            rows={r.aarOverdue.map((x) => [x.title, fmtDay(x.endedAt), String(x.days), x.missing === "draft" ? "No draft after 30 days" : "No final after 90 days"])}
          />
        ) : (
          <P style={pdfStyles.muted}>No report is past due.</P>
        )}

        <Text style={pdfStyles.h2}>Cadence</Text>
        {r.cadence.length ? (
          <Table
            columns={[
              { label: "Requirement", width: 46 },
              { label: "Every", width: 10 },
              { label: "Last tested", width: 15 },
              { label: "Due", width: 15 },
              { label: "Status", width: 14 },
            ]}
            rows={r.cadence.map((c) => [
              c.controlId ? `${c.frameworkLabel} ${c.controlId}${c.controlTitle ? ` ${c.controlTitle}` : ""}` : c.frameworkLabel,
              `${c.months} mo`,
              fmtDay(c.lastTested) || "Never",
              fmtDay(c.dueAt),
              CADENCE_TEXT[c.status] ?? c.status,
            ])}
          />
        ) : (
          <P style={pdfStyles.muted}>No cadence set for the enabled frameworks.</P>
        )}

        <Text style={pdfStyles.h2}>Controls tested</Text>
        {r.controls.length ? (
          <Table
            columns={[
              { label: "Framework", width: 22 },
              { label: "Control", width: 14 },
              { label: "Title", width: 40 },
              { label: "Last tested", width: 12 },
              { label: "Result", width: 12 },
            ]}
            rows={r.controls.map((c) => [c.frameworkLabel, c.controlId, c.title, fmtDay(c.lastTested), c.result === "gap" ? "Gap found" : "Tested"])}
          />
        ) : (
          <P style={pdfStyles.muted}>No final reports map controls of the enabled frameworks.</P>
        )}

        <Text style={pdfStyles.h2}>Required roles, last 12 months</Text>
        {r.roles.length ? (
          <Table
            columns={[
              { label: "Role", width: 50 },
              { label: "Exercises present", width: 25 },
              { label: "Last present", width: 25 },
            ]}
            rows={r.roles.map((x) => [x.role, `${x.present} of ${x.total}`, fmtDay(x.lastPresentAt) || "Never"])}
          />
        ) : (
          <P style={pdfStyles.muted}>No required roles set in policy.</P>
        )}

        <Text style={pdfStyles.h2}>Work items</Text>
        <Table
          columns={[
            { label: "Open", width: 20 },
            { label: "Overdue", width: 20 },
            { label: "Open high priority", width: 20 },
            { label: "Done", width: 20 },
            { label: "Rejected", width: 20 },
          ]}
          rows={[[String(r.actionItems.open), String(r.actionItems.overdue), String(r.actionItems.openHigh), String(r.actionItems.done), String(r.actionItems.rejected)]]}
        />
        <Text style={pdfStyles.h3}>Findings in final reports</Text>
        <Table
          columns={[
            { label: "Accepted", width: 25 },
            { label: "With a work item", width: 25 },
            { label: "No action needed", width: 25 },
            { label: "Rejected", width: 25 },
          ]}
          rows={[[String(r.findings.accepted), String(r.findings.actionItems), String(r.findings.noAction), String(r.findings.rejected)]]}
        />
        <Text style={pdfStyles.h3}>Remediation aging (open items)</Text>
        <Table
          columns={AGING_BUCKETS.map((b) => ({ label: b.label, width: 25 }))}
          rows={[AGING_BUCKETS.map((b) => String(r.actionItems.aging[b.key] ?? 0))]}
        />
        <Text style={pdfStyles.h2}>Signing keys</Text>
        {r.signingKeys.length ? (
          <Table
            columns={[
              { label: "Key ID", width: 40 },
              { label: "Created", width: 30 },
              { label: "Retired", width: 30 },
            ]}
            rows={r.signingKeys.map((k) => [k.keyId, fmtDay(k.createdAt), k.retiredAt ? fmtDay(k.retiredAt) : "In use"])}
          />
        ) : (
          <P style={pdfStyles.muted}>No signing key is registered yet.</P>
        )}
        {r.overdueItems.length ? (
          <>
            <Text style={pdfStyles.h3}>Overdue items</Text>
            <Table
              columns={[
                { label: "Corrective action", width: 44 },
                { label: "POC", width: 16 },
                { label: "Due", width: 12 },
                { label: "Priority", width: 10 },
                { label: "Exercise", width: 18 },
              ]}
              rows={r.overdueItems.map((i) => [i.correctiveAction, i.poc ?? "", fmtDay(i.dueDate), PRIORITY_TEXT[i.priority] ?? i.priority, i.exerciseTitle ?? ""])}
            />
          </>
        ) : null}
      </Page>
    </Document>
  );
}

function ExecSummaryDocument({ r }: { r: ProgramReport }) {
  const overdue = r.cadence.filter((c) => c.status === "overdue" || c.status === "never");
  const dueSoon = r.cadence.filter((c) => c.status === "due_soon");
  return (
    <Document title="Exercise program summary" author={r.instanceName} creator="Crucible CE" producer="Crucible CE">
      <Page size="LETTER" style={pdfStyles.page}>
        <PageChrome left={r.instanceName} draft={false} marking={r.marking} />
        <Text style={pdfStyles.h1}>Exercise program summary</Text>
        <P style={pdfStyles.muted}>
          {r.instanceName}. Window {fmtDay(r.window.from)} to {fmtDay(r.window.to)}. Generated {fmtDay(r.generatedAt)}.
        </P>
        <View style={pdfStyles.box}>
          <P>
            <Text style={pdfStyles.label}>Last exercise </Text>
            {r.lastTestedAt ? fmtDay(r.lastTestedAt) : "None on record"}
          </P>
          <P>
            <Text style={pdfStyles.label}>Exercises in window </Text>
            {String(r.exercises.length)}
          </P>
          <P>
            <Text style={pdfStyles.label}>Participants in window </Text>
            {String(r.participantsInWindow)}
          </P>
          <P>
            <Text style={pdfStyles.label}>Open high-priority work items </Text>
            {String(r.actionItems.openHigh)}
          </P>
          <P>
            <Text style={pdfStyles.label}>Overdue work items </Text>
            {String(r.actionItems.overdue)}
          </P>
          <P>
            <Text style={pdfStyles.label}>Cadence </Text>
            {r.cadence.length
              ? `${r.cadence.length - overdue.length - dueSoon.length} current, ${dueSoon.length} due soon, ${overdue.length} overdue or never tested`
              : "No cadence set"}
          </P>
        </View>
        <Text style={pdfStyles.h2}>Cadence status</Text>
        {r.cadence.length ? <Bullets items={r.cadence.map((c) => `${c.sentence}. ${CADENCE_TEXT[c.status]}.`)} /> : <P style={pdfStyles.muted}>No cadence set.</P>}
        <P style={pdfStyles.muted}>Ratings in the underlying reports describe capabilities, not people.</P>
      </Page>
    </Document>
  );
}

export async function renderProgramReportPdf(r: ProgramReport): Promise<Buffer> {
  return renderPdf(<ProgramReportDocument r={r} />);
}

export async function renderExecSummaryPdf(r: ProgramReport): Promise<Buffer> {
  return renderPdf(<ExecSummaryDocument r={r} />);
}
