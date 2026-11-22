"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatClock, scenarioLabel } from "@/lib/exercise/time";
import { getTechniqueFullName } from "@/lib/exercise/content/mitre";
import { api } from "./api";
import { CLOSE_TRIGGER_LABELS } from "./types";

interface Row {
  kind: "delivered" | "planned";
  injectId: string | null;
  seq: number;
  title: string;
  status: string;
  scenarioTime: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  closeTrigger: string | null;
  scheduledOffsetMin: number | null;
  scheduledAt: string | null;
  decisions: Array<{ team: string; question: string; owner: string | null; best: string | null }>;
  targetTeams: string[];
  objectives: Array<{ id: string; seq: number; text: string }>;
  expectedActions: string[];
  controllerNotes: string | null;
  techniques?: string[];
}

const STATUS_VARIANT: Record<string, "accent" | "secondary" | "outline" | "warning"> = {
  open: "accent",
  held: "warning",
  closed: "secondary",
  planned: "outline",
};

function scheduledText(r: Row, timezone: string): string {
  if (r.scheduledAt) return formatClock(new Date(r.scheduledAt), timezone);
  if (r.scheduledOffsetMin !== null) return `+${r.scheduledOffsetMin} min`;
  return "";
}

function NotesCell({ exerciseId, row }: { exerciseId: string; row: Row }) {
  const [value, setValue] = useState(row.controllerNotes ?? "");
  const [saved, setSaved] = useState(row.controllerNotes ?? "");
  useEffect(() => {
    setValue(row.controllerNotes ?? "");
    setSaved(row.controllerNotes ?? "");
  }, [row.controllerNotes]);
  if (!row.injectId) return <span className="text-[color:var(--color-muted-foreground)]">Not delivered</span>;
  async function save() {
    if (value === saved) return;
    const r = await api(`/api/exercises/${exerciseId}/injects/${row.injectId}`, {
      method: "PATCH",
      body: { controllerNotes: value },
      fallback: "The note was not saved. Try again.",
    });
    if (!r.ok) toast.error(r.error);
    else setSaved(value);
  }
  return (
    <textarea
      aria-label={`Controller notes for inject ${row.seq}`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      maxLength={4000}
      rows={2}
      placeholder="Add a note"
      className="w-full min-w-[160px] resize-y rounded-md border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-2 py-1 text-[12.5px]"
    />
  );
}

export function MselPanel({ exerciseId, tick, timezone, readOnly = false }: { exerciseId: string; tick: number; timezone: string; readOnly?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [scenarioStartAt, setScenarioStartAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ rows: Row[]; scenarioStartAt: string | null }>(`/api/exercises/${exerciseId}/msel`);
    if (r.ok) {
      setRows(r.data.rows);
      setScenarioStartAt(r.data.scenarioStartAt);
      setError(null);
    } else setError(r.error);
  }, [exerciseId]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button asChild size="sm" variant="outline">
          <a href={`/api/exercises/${exerciseId}/msel?format=csv`} download>
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </Button>
      </div>
      {error && <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>}
      {rows && rows.length === 0 && <p className="py-6 text-center text-[13px] text-[color:var(--color-muted-foreground)]">No injects yet.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-[color:var(--color-border)]">
          <table className="w-full min-w-[1180px] text-left text-[12.5px]">
            <thead className="bg-[color:var(--color-muted)] text-[11.5px] text-[color:var(--color-muted-foreground)]">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Scheduled</th>
                <th className="px-3 py-2 font-medium">Scenario time</th>
                <th className="px-3 py-2 font-medium">Delivered</th>
                <th className="px-3 py-2 font-medium">Closed</th>
                <th className="px-3 py-2 font-medium">Teams</th>
                <th className="px-3 py-2 font-medium">Inject</th>
                <th className="px-3 py-2 font-medium">Objectives</th>
                <th className="px-3 py-2 font-medium">Expected actions</th>
                <th className="px-3 py-2 font-medium">Decisions</th>
                {!readOnly && <th className="px-3 py-2 font-medium">Controller notes</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.injectId ?? r.seq}`} className="border-t border-[color:var(--color-border)] align-top">
                  <td className="px-3 py-2 font-mono tabular-nums">{r.seq}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{scheduledText(r, timezone)}</td>
                  <td className="px-3 py-2">{scenarioLabel(r.scenarioTime, scenarioStartAt, timezone) ?? ""}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{r.deliveredAt ? formatClock(new Date(r.deliveredAt), timezone) : ""}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono tabular-nums">{r.closedAt ? formatClock(new Date(r.closedAt), timezone) : ""}</div>
                    {r.closeTrigger && <div className="text-[11.5px] text-[color:var(--color-muted-foreground)]">{CLOSE_TRIGGER_LABELS[r.closeTrigger] ?? r.closeTrigger}</div>}
                  </td>
                  <td className="px-3 py-2">{r.targetTeams.join(", ")}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.title}</div>
                    <Badge className="mt-1" variant={STATUS_VARIANT[r.status] ?? "outline"}>
                      {r.status === "planned" ? "Planned" : r.status === "held" ? "Held" : r.status === "open" ? "Open" : "Closed"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {r.objectives.length ? (
                      <ul className="space-y-1">
                        {r.objectives.map((o) => (
                          <li key={o.id}>
                            {o.seq}. {o.text}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.expectedActions.length ? (
                      <ul className="list-disc space-y-1 pl-4">
                        {r.expectedActions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    ) : null}
                    {r.techniques?.length ? (
                      <p className="mt-1.5 text-[11.5px] text-[color:var(--color-muted-foreground)]">
                        ATT&amp;CK:{" "}
                        {r.techniques.map((t, i) => (
                          <span key={t} title={getTechniqueFullName(t)} className="font-mono">
                            {i ? ", " : ""}
                            {t}
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.decisions.length ? (
                      <ul className="space-y-1.5">
                        {r.decisions.map((d, i) => (
                          <li key={i}>
                            <div className="font-medium">
                              {d.team}
                              {d.owner ? <span className="font-normal text-[color:var(--color-muted-foreground)]">, {d.owner}</span> : null}
                            </div>
                            <div>{d.question}</div>
                            {d.best && <div className="text-[11.5px] text-[color:var(--mist-ok)]">Best. {d.best}</div>}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  {!readOnly && (
                    <td className="px-3 py-2">
                      <NotesCell exerciseId={exerciseId} row={r} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
