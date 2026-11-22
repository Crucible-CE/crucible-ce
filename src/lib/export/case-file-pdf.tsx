import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { GatheredIncident } from "./gather";

// The human-readable dossier shipped inside every case file. It mirrors the
// machine-readable incident-data.json but is laid out for a lawyer/regulator to
// read cover-to-cover. Integrity (hashes, signature) lives in MANIFEST/SEAL —
// this PDF is one of the files those attest to.

const MODE_LABEL: Record<string, string> = {
  legal: "Legal hold / outside counsel",
  regulator: "Regulatory submission",
  internal: "Internal record",
};

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, fontSize: 9.5, fontFamily: "Helvetica", color: "#1a1f29", lineHeight: 1.45 },
  coverWrap: { flex: 1, justifyContent: "center" },
  eyebrow: { fontSize: 9, letterSpacing: 2, color: "#6b7280", fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  title: { fontSize: 24, fontFamily: "Helvetica-Bold", marginTop: 10, color: "#0a0c10" },
  coverMeta: { marginTop: 28, borderTopWidth: 1, borderTopColor: "#d1d5db", paddingTop: 16 },
  metaRow: { flexDirection: "row", marginBottom: 6 },
  metaKey: { width: 130, color: "#6b7280", fontFamily: "Helvetica-Bold" },
  metaVal: { flex: 1, color: "#1a1f29" },
  attest: { marginTop: 28, padding: 14, backgroundColor: "#f3f4f6", borderRadius: 4, fontSize: 8.5, color: "#374151" },
  attestMono: { fontFamily: "Courier", fontSize: 7.5, color: "#111827", marginTop: 4 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#0a0c10", marginBottom: 8, marginTop: 4 },
  sectionHead: { borderBottomWidth: 1.5, borderBottomColor: "#0a0c10", paddingBottom: 4, marginBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  count: { fontSize: 8.5, color: "#6b7280", fontFamily: "Helvetica-Bold" },
  entry: { marginBottom: 9, paddingBottom: 9, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  entryHead: { flexDirection: "row", justifyContent: "space-between" },
  entryTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, color: "#0a0c10", flex: 1, paddingRight: 8 },
  entryMeta: { fontSize: 8, color: "#6b7280" },
  body: { marginTop: 2, color: "#374151" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 4 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#6b7280", textTransform: "uppercase" },
  empty: { color: "#9ca3af", fontStyle: "italic", marginBottom: 6 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#9ca3af", borderTopWidth: 0.5, borderTopColor: "#e5e7eb", paddingTop: 6 },
});

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "None";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "None";
  return dt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
function s(v: unknown): string {
  if (v === null || v === undefined || v === "") return "None";
  return String(v);
}

function Footer({ mode }: { mode: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>Crucible CE incident case file · {MODE_LABEL[mode] ?? mode}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function SectionHead({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.h2}>{title}</Text>
      {count !== undefined ? <Text style={styles.count}>{count} {count === 1 ? "entry" : "entries"}</Text> : null}
    </View>
  );
}

export function CaseFileDocument({ data, orgName, requestedByName, ledgerHead, ledgerValid }: {
  data: GatheredIncident; orgName: string; requestedByName: string; ledgerHead: string; ledgerValid: boolean;
}) {
  const inc = data.incident as Record<string, unknown>;
  return (
    <Document title={`Incident case file: ${s(inc.title)}`} author="Crucible CE">
      {/* Cover */}
      <Page size="A4" style={styles.page}>
        <View style={styles.coverWrap}>
          <Text style={styles.eyebrow}>Incident case file</Text>
          <Text style={styles.title}>{s(inc.title)}</Text>
          <Text style={{ marginTop: 6, color: "#6b7280" }}>{orgName}</Text>

          <View style={styles.coverMeta}>
            {[
              ["Incident ID", s(inc.id)],
              ["Reference", s(inc.referenceCode ?? inc.shortId ?? inc.id)],
              ["Severity", s(inc.severity)],
              ["Status", s(inc.status)],
              ["Declared", fmt(inc.createdAt as string)],
              ["Export purpose", MODE_LABEL[data.exportMode] ?? data.exportMode],
              ["Generated", fmt(data.generatedAt)],
              ["Requested by", requestedByName],
            ].map(([k, v]) => (
              <View style={styles.metaRow} key={k}>
                <Text style={styles.metaKey}>{k}</Text>
                <Text style={styles.metaVal}>{v}</Text>
              </View>
            ))}
          </View>

          <View style={styles.attest}>
            <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 2 }}>Integrity attestation</Text>
            <Text>
              Generated from a tamper-evident, hash-chained ledger. At export the chain was recomputed
              from genesis and verified {ledgerValid ? "INTACT" : "BROKEN (SEE LEDGER)"}. MANIFEST.json lists a
              SHA-256 hash of every file in this package and is signed (Ed25519) in the SEAL file. Changing any
              file invalidates the seal. See VERIFY.md to verify independently.
            </Text>
            <Text style={{ marginTop: 6, color: "#6b7280" }}>Ledger chain-head (entryHash):</Text>
            <Text style={styles.attestMono}>{ledgerHead}</Text>
          </View>
          <Text style={{ marginTop: 12, fontSize: 8, color: "#b91c1c", fontFamily: "Helvetica-Bold" }}>
            CONFIDENTIAL. Handle accordingly.
          </Text>
        </View>
        <Footer mode={data.exportMode} />
      </Page>

      {/* Narrative + timeline */}
      <Page size="A4" style={styles.page}>
        <SectionHead title="Summary" />
        <Text style={[styles.body, { marginBottom: 14 }]}>{s(inc.description ?? inc.summary)}</Text>

        <SectionHead title="Timeline" count={data.timeline.length} />
        {data.timeline.length === 0 ? <Text style={styles.empty}>No timeline entries.</Text> : data.timeline.map((t, i) => (
          <View style={styles.entry} key={i} wrap={false}>
            <View style={styles.entryHead}>
              <Text style={styles.entryTitle}>{s(t.action)}</Text>
              <Text style={styles.entryMeta}>{fmt(t.at)}</Text>
            </View>
            {t.notes ? <Text style={styles.body}>{t.notes}</Text> : null}
            <Text style={styles.entryMeta}>{t.actor ? `By ${t.actor}` : "System"}</Text>
          </View>
        ))}
        <Footer mode={data.exportMode} />
      </Page>

      {/* Decisions + tasks */}
      <Page size="A4" style={styles.page}>
        <SectionHead title="Decisions" count={data.decisions.length} />
        {data.decisions.length === 0 ? <Text style={styles.empty}>No decisions logged.</Text> : data.decisions.map((d) => (
          <View style={styles.entry} key={d.id} wrap={false}>
            <View style={styles.entryHead}>
              <Text style={styles.entryTitle}>{d.title}</Text>
              <Text style={styles.entryMeta}>{fmt(d.at)}</Text>
            </View>
            {d.rationale ? <Text style={styles.body}>{d.rationale}</Text> : null}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
              <Text style={styles.entryMeta}>{d.decidedBy ? `Decided by ${d.decidedBy}` : "Not decided"} · {s(d.status)}</Text>
            </View>
          </View>
        ))}

        <View style={{ marginTop: 14 }}><SectionHead title="Tasks" count={data.tasks.length} /></View>
        {data.tasks.length === 0 ? <Text style={styles.empty}>No tasks recorded.</Text> : (
          <View>
            <View style={styles.tableRow}>
              <Text style={[styles.th, { flex: 3 }]}>Task</Text>
              <Text style={[styles.th, { flex: 1 }]}>Priority</Text>
              <Text style={[styles.th, { flex: 1 }]}>Status</Text>
              <Text style={[styles.th, { flex: 2 }]}>Assignee</Text>
            </View>
            {data.tasks.map((t) => (
              <View style={styles.tableRow} key={t.id} wrap={false}>
                <Text style={{ flex: 3, paddingRight: 4 }}>{s(t.title)}</Text>
                <Text style={{ flex: 1 }}>{s(t.priority)}</Text>
                <Text style={{ flex: 1 }}>{s(t.status)}</Text>
                <Text style={{ flex: 2 }}>{s(t.assignee)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ marginTop: 14 }}><SectionHead title="Playbooks" count={data.playbooks.length} /></View>
        {data.playbooks.length === 0 ? <Text style={styles.empty}>No playbooks attached.</Text> : data.playbooks.map((r, i) => (
          <View style={styles.entry} key={i}>
            <View style={styles.entryHead}>
              <Text style={styles.entryTitle}>{s(r.title)}</Text>
              <Text style={styles.entryMeta}>{r.steps.filter((st) => st.doneAt).length} of {r.steps.length} done</Text>
            </View>
            <Text style={styles.entryMeta}>Attached by {s(r.attachedBy)} · {fmt(r.attachedAt)} · document sha256 {s(r.documentSha256).slice(0, 16)}</Text>
            {r.steps.map((st, j) => (
              <Text style={styles.body} key={j} wrap={false}>
                {st.doneAt ? "[x]" : "[ ]"} {s(st.section)}: {s(st.text)}{st.doneAt ? ` (${s(st.doneBy)}, ${fmt(st.doneAt)})` : ""}
              </Text>
            ))}
          </View>
        ))}

        <Footer mode={data.exportMode} />
      </Page>

      {/* Evidence index */}
      <Page size="A4" style={styles.page}>
        <SectionHead title="Evidence index" count={data.evidence.length} />
        <Text style={[styles.entryMeta, { marginBottom: 8 }]}>
          Files are in /evidence/ in the package. Each SHA-256 below is also in MANIFEST.json.
        </Text>
        {data.evidence.length === 0 ? <Text style={styles.empty}>No evidence attached.</Text> : data.evidence.map((e) => (
          <View style={styles.entry} key={e.id} wrap={false}>
            <View style={styles.entryHead}>
              <Text style={styles.entryTitle}>{s(e.filename)}</Text>
              <Text style={styles.entryMeta}>{(e.sizeBytes / 1024).toFixed(0)} KB · {fmt(e.createdAt)}</Text>
            </View>
            {e.description ? <Text style={styles.body}>{e.description}</Text> : null}
            <Text style={styles.entryMeta}>{s(e.category)} · uploaded by {s(e.uploadedByName)}</Text>
            <Text style={[styles.attestMono, { marginTop: 2 }]}>sha256: {s(e.sha256)}</Text>
          </View>
        ))}
        <Footer mode={data.exportMode} />
      </Page>

      {/* Comms, pages, roster */}
      <Page size="A4" style={styles.page}>
        <SectionHead title="Stakeholder communications" count={data.comms.length} />
        {data.comms.length === 0 ? <Text style={styles.empty}>No stakeholder communications.</Text> : data.comms.map((c, i) => (
          <View style={styles.entry} key={i} wrap={false}>
            <View style={styles.entryHead}>
              <Text style={styles.entryTitle}>{s(c.stakeholder)}</Text>
              <Text style={styles.entryMeta}>{fmt(c.notifiedAt)}</Text>
            </View>
            <Text style={styles.entryMeta}>{s(c.channel)} · {s(c.status)}{c.notes ? ` · ${c.notes}` : ""}</Text>
          </View>
        ))}

        <View style={{ marginTop: 14 }}><SectionHead title="Pages" count={data.pages.length} /></View>
        {data.pages.length === 0 ? <Text style={styles.empty}>No pages sent.</Text> : data.pages.map((p, i) => (
          <View style={styles.entry} key={i} wrap={false}>
            <View style={styles.entryHead}>
              <Text style={styles.entryTitle}>{s(p.target)} · {s(p.priority)}</Text>
              <Text style={styles.entryMeta}>{fmt(p.at)} · {s(p.status)}</Text>
            </View>
            {p.message ? <Text style={styles.body}>{p.message}</Text> : null}
          </View>
        ))}

        <View style={{ marginTop: 14 }}><SectionHead title="Response roster" /></View>
        {data.roster.length === 0 && data.participants.length === 0 ? <Text style={styles.empty}>No roster recorded.</Text> : (
          <View>
            {data.roster.map((r, i) => (
              <View style={styles.tableRow} key={`r${i}`} wrap={false}>
                <Text style={{ flex: 2, fontFamily: "Helvetica-Bold" }}>{s(r.role)}</Text>
                <Text style={{ flex: 3 }}>{s(r.name)}</Text>
              </View>
            ))}
            {data.participants.map((p, i) => (
              <View style={styles.tableRow} key={`p${i}`} wrap={false}>
                <Text style={{ flex: 2 }}>{s(p.role)}</Text>
                <Text style={{ flex: 3 }}>{s(p.name)}{p.email ? ` · ${p.email}` : ""}</Text>
              </View>
            ))}
          </View>
        )}
        <Footer mode={data.exportMode} />
      </Page>

      {/* Review + ledger */}
      <Page size="A4" style={styles.page}>
        {data.postmortem ? (
          <View style={{ marginTop: 14 }}>
            <SectionHead title="Post-incident review" />
            <Text style={styles.body}>{s((data.postmortem as Record<string, unknown>).summary)}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 14 }}><SectionHead title="Ledger" count={data.ledger.length} /></View>
        <Text style={[styles.entryMeta, { marginBottom: 8 }]}>
          The full hash-chained ledger is included as ledger.json. Summary of recorded events:
        </Text>
        <View style={styles.tableRow}>
          <Text style={[styles.th, { width: 28 }]}>Seq</Text>
          <Text style={[styles.th, { flex: 2 }]}>Event</Text>
          <Text style={[styles.th, { flex: 2 }]}>Actor</Text>
          <Text style={[styles.th, { flex: 2 }]}>Time</Text>
        </View>
        {data.ledger.map((l) => (
          <View style={styles.tableRow} key={l.seq} wrap={false}>
            <Text style={{ width: 28 }}>{l.seq}</Text>
            <Text style={{ flex: 2 }}>{s(l.eventType)}</Text>
            <Text style={{ flex: 2 }}>{s(l.actor)}</Text>
            <Text style={{ flex: 2 }}>{fmt(l.at)}</Text>
          </View>
        ))}
        <Footer mode={data.exportMode} />
      </Page>
    </Document>
  );
}

export async function renderCaseFilePdf(args: {
  data: GatheredIncident; orgName: string; requestedByName: string; ledgerHead: string; ledgerValid: boolean;
}): Promise<Buffer> {
  return renderToBuffer(<CaseFileDocument {...args} />);
}
