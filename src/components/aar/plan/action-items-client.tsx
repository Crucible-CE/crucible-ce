"use client";

// /action-items: every improvement plan row across exercises. Open, overdue
// and done tabs, filters, inline status with closure evidence, CSV export,
// and the objectives carried to the next exercise. With mine (readers): the
// items where the user is the point of contact, status and closure evidence only.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { usePromptDialog } from "@/components/ui/prompt-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldSelect } from "@/components/form/field-select";
import { api } from "@/components/exercise/api";
import { BLANK_DRAFT, ItemDialog, POETE_LABEL, PRIORITY_LABEL, PRIORITY_OPTIONS, StatusSelect, day, draftBody, draftFromItem, type ActionItem, type ItemDraft } from "./shared";

type Tab = "open" | "overdue" | "done" | "all";

interface Suggestion {
  id: string;
  text: string;
  capabilityKey: string | null;
  sourceExerciseId: string | null;
  sourceExerciseTitle: string | null;
  createdAt: string;
}

export interface ActionItemsOptions {
  exercises: Array<{ id: string; title: string }>;
  capabilities: Array<{ id: string; key: string; name: string }>;
}

function Inner({ options, mine }: { options: ActionItemsOptions; mine: boolean }) {
  const promptText = usePromptDialog();
  const [tab, setTab] = useState<Tab>("open");
  const [exerciseId, setExerciseId] = useState("");
  const [capabilityId, setCapabilityId] = useState("");
  const [priority, setPriority] = useState("");
  const [items, setItems] = useState<ActionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ActionItem | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ status: tab });
    if (mine) q.set("mine", "1");
    if (exerciseId) q.set("exerciseId", exerciseId);
    if (capabilityId) q.set("capabilityId", capabilityId);
    if (priority) q.set("priority", priority);
    return q.toString();
  }, [tab, exerciseId, capabilityId, priority, mine]);

  const load = useCallback(async () => {
    const r = await api<{ items: ActionItem[] }>(`/api/action-items?${query}`);
    if (r.ok) {
      setItems(r.data.items);
      setError(null);
    } else setError(r.error);
  }, [query]);

  const loadSuggestions = useCallback(async () => {
    const r = await api<{ suggestions: Suggestion[] }>(`/api/action-items/suggested`);
    if (r.ok) setSuggestions(r.data.suggestions);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!mine) void loadSuggestions();
  }, [loadSuggestions, mine]);

  const editInitial = useMemo(() => (editing ? draftFromItem(editing) : BLANK_DRAFT), [editing]);
  const editOptions = useMemo(
    () => ({
      objectives: editing?.objectiveId ? [{ id: editing.objectiveId, seq: 0, text: editing.objectiveText ?? "Objective" }] : [],
      capabilities: options.capabilities,
    }),
    [editing, options.capabilities],
  );

  async function saveEdit(d: ItemDraft): Promise<boolean> {
    if (!editing) return false;
    const r = await api(`/api/action-items/${editing.id}`, { method: "PATCH", body: draftBody(d), fallback: "The change was not saved. Try again." });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    void load();
    return true;
  }

  async function updateEvidence(item: ActionItem) {
    const ev = await promptText({ title: "Closure evidence", label: "What shows the progress or the result?", required: true, multiline: true, confirmLabel: "Save" });
    if (ev === null) return;
    const r = await api(`/api/action-items/${item.id}`, { method: "PATCH", body: { closureEvidence: ev }, fallback: "The evidence was not saved. Try again." });
    if (!r.ok) toast.error(r.error);
    void load();
  }

  async function removeSuggestion(id: string) {
    const r = await api(`/api/action-items/suggested`, { method: "DELETE", body: { id }, fallback: "The suggestion was not removed. Try again." });
    if (!r.ok) toast.error(r.error);
    void loadSuggestions();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="overdue">Overdue</TabsTrigger>
            <TabsTrigger value="done">Done</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <FieldSelect
          aria-label="Exercise"
          value={exerciseId}
          onChange={setExerciseId}
          options={[{ value: "", label: "All exercises" }, ...options.exercises.map((e) => ({ value: e.id, label: e.title }))]}
          className="h-9 w-auto max-w-[240px]"
        />
        {!mine && (
          <FieldSelect
            aria-label="Capability"
            value={capabilityId}
            onChange={setCapabilityId}
            options={[{ value: "", label: "All capabilities" }, ...options.capabilities.map((c) => ({ value: c.id, label: `${c.key} ${c.name}` }))]}
            className="h-9 w-auto max-w-[240px]"
          />
        )}
        <FieldSelect
          aria-label="Priority"
          value={priority}
          onChange={setPriority}
          options={[{ value: "", label: "Any priority" }, ...PRIORITY_OPTIONS]}
          className="h-9 w-auto"
        />
        {!mine && (
          <a
            href={`/api/action-items/export?${query}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium hover:bg-[color:var(--color-muted)]"
          >
            <Download className="h-4 w-4" />
            CSV
          </a>
        )}
      </div>

      <Card dense>
        {!items ? (
          error ? (
            <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">
              {error}
            </p>
          ) : (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />
            </div>
          )
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[color:var(--color-muted-foreground)]">No work items match.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[1000px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-[color:var(--color-muted-foreground)]">
                  <th className="py-1.5 pr-2 font-medium">Corrective action</th>
                  <th className="py-1.5 pr-2 font-medium">Area for improvement</th>
                  <th className="py-1.5 pr-2 font-medium">Exercise</th>
                  <th className="py-1.5 pr-2 font-medium">Capability</th>
                  <th className="py-1.5 pr-2 font-medium">POETE</th>
                  <th className="py-1.5 pr-2 font-medium">POC</th>
                  <th className="py-1.5 pr-2 font-medium">Due</th>
                  <th className="py-1.5 pr-2 font-medium">Priority</th>
                  <th className="py-1.5 pr-2 font-medium">Status</th>
                  <th className="py-1.5 font-medium">Closure evidence</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t border-[color:var(--color-border)] align-top">
                    <td className="max-w-[240px] py-2 pr-2">
                      {i.correctiveAction}
                      {!i.locked && !mine && (
                        <Button size="xs" variant="ghost" className="ml-1" onClick={() => setEditing(i)}>
                          Edit
                        </Button>
                      )}
                    </td>
                    <td className="max-w-[200px] py-2 pr-2">{i.afi}</td>
                    <td className="max-w-[160px] py-2 pr-2">
                      {i.exerciseId && !mine ? (
                        <Link href={`/exercises/${i.exerciseId}/aar`} className="text-[color:var(--mist-indigo)] hover:underline">
                          {i.exerciseTitle}
                        </Link>
                      ) : (
                        (i.exerciseTitle ?? "")
                      )}
                    </td>
                    <td className="py-2 pr-2">{i.capabilityKey ?? ""}</td>
                    <td className="py-2 pr-2">{i.poete ? POETE_LABEL[i.poete] : ""}</td>
                    <td className="py-2 pr-2">{i.poc ?? ""}</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">
                      {day(i.dueDate)}
                      {i.overdue && (
                        <Badge variant="destructive" className="ml-1">
                          Overdue
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-2">{PRIORITY_LABEL[i.priority] ?? i.priority}</td>
                    <td className="py-2 pr-2">
                      <StatusSelect item={i} owner={mine} onChanged={() => void load()} />
                    </td>
                    <td className="max-w-[200px] py-2">
                      {i.status === "rejected" ? (i.rejectedReason ?? "") : (i.closureEvidence ?? "")}
                      {mine && i.status !== "rejected" && (
                        <Button size="xs" variant="ghost" className="ml-1" onClick={() => void updateEvidence(i)}>
                          Update evidence
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!mine && (
        <Card dense className="gap-2">
          <h2 className="text-[15px] font-semibold">Suggested objectives for the next exercise</h2>
          {suggestions.length === 0 ? (
            <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">None. Carry an open area for improvement from an after-action report.</p>
          ) : (
            <ul className="space-y-1.5">
              {suggestions.map((s) => (
                <li key={s.id} className="flex items-start gap-2 rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <p>{s.text}</p>
                    <p className="text-[11.5px] text-[color:var(--color-muted-foreground)]">
                      {[s.capabilityKey, s.sourceExerciseTitle].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button size="xs" variant="ghost" onClick={() => void removeSuggestion(s.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ItemDialog
        open={editing !== null}
        title="Edit action"
        initial={editInitial}
        options={editOptions}
        submitLabel="Save"
        onClose={() => setEditing(null)}
        onSubmit={saveEdit}
      />
    </div>
  );
}

export function ActionItemsClient({ options, mine = false }: { options: ActionItemsOptions; mine?: boolean }) {
  return (
    <ConfirmDialogProvider>
      <Inner options={options} mine={mine} />
    </ConfirmDialogProvider>
  );
}
