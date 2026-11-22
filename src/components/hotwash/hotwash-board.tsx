"use client";

// Hotwash page body. Strengths and areas for improvement per objective, a
// parking lot, evaluator ratings, the participant feedback summary and the
// observation log. Drivers write; the rest of control reads. A projector view
// enlarges the board for the room.

import Link from "next/link";
import { useCallback, useState } from "react";
import { ArrowLeft, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldSelect } from "@/components/form/field-select";
import { api } from "@/components/exercise/api";
import { cn } from "@/lib/utils";
import { usePoll } from "./use-poll";
import { RatingsPanel } from "./ratings";
import { FeedbackSummaryPanel } from "./feedback-summary";
import { ObservationLog } from "./observation-log";

type Kind = "strength" | "afi" | "parking_lot";

interface Item {
  id: string;
  kind: Kind;
  objectiveId: string | null;
  text: string;
  author: string | null;
  byParticipantId: string | null;
  createdAt: string;
}

interface Listing {
  exercise: { id: string; title: string; status: string; isPractice: boolean; endedAt: string | null } | null;
  objectives: Array<{ id: string; seq: number; text: string }>;
  items: Item[];
  me: string | null;
  canWrite: boolean;
  canModerate: boolean;
  canRate: boolean;
}

const KIND_LABEL: Record<Kind, string> = { strength: "Strength", afi: "Area for improvement", parking_lot: "Parking lot" };

function QuickAdd({ objectives, onAdd, big }: { objectives: Listing["objectives"]; onAdd: (kind: Kind, objectiveId: string | null, text: string) => Promise<boolean>; big: boolean }) {
  const [kind, setKind] = useState<Kind>("strength");
  const [objectiveId, setObjectiveId] = useState<string>(objectives[0]?.id ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const ok = await onAdd(kind, kind === "parking_lot" ? null : objectiveId || null, text.trim());
    setBusy(false);
    if (ok) setText("");
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <Button key={k} type="button" size="sm" variant={kind === k ? "default" : "outline"} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {kind !== "parking_lot" && objectives.length > 0 && (
          <FieldSelect
            aria-label="Objective"
            value={objectiveId}
            onChange={setObjectiveId}
            options={[...objectives.map((o) => ({ value: o.id, label: `${o.seq}. ${o.text}` })), { value: "", label: "No objective" }]}
            className="h-10 sm:max-w-xs"
          />
        )}
        <Input
          aria-label="Item"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder={kind === "parking_lot" ? "Topic to take offline" : kind === "strength" ? "What worked" : "What to improve"}
          className={cn("h-10 flex-1", big && "text-lg")}
        />
        <Button type="submit" disabled={busy || !text.trim()} className="h-10">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Add
        </Button>
      </div>
    </form>
  );
}

function ItemRow({
  item,
  editable,
  big,
  onSave,
  onDelete,
}: {
  item: Item;
  editable: boolean;
  big: boolean;
  onSave: (text: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  if (editing) {
    return (
      <li className="space-y-1.5 rounded-md bg-[color:var(--color-muted)]/60 p-2">
        <Textarea aria-label="Edit item" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} />
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="xs"
            disabled={!text.trim()}
            onClick={async () => {
              if (await onSave(text.trim())) setEditing(false);
            }}
          >
            Save
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className={cn("group rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2", big ? "text-[18px] leading-snug" : "text-[13px]")}>
      <p className="whitespace-pre-wrap break-words">{item.text}</p>
      {(item.author || editable) && (
        <div className="mt-1 flex items-center gap-2 text-[11.5px] text-[color:var(--color-muted-foreground)]">
          {item.author && !big && <span>{item.author}</span>}
          {editable && (
            <span className="ml-auto flex gap-1">
              <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="xs" variant="ghost" className="text-[color:var(--mist-danger)]" onClick={onDelete}>
                Delete
              </Button>
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function Column({ title, items, children, big }: { title: string; items: Item[]; children: (i: Item) => React.ReactNode; big: boolean }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className={cn("font-semibold", big ? "text-lg" : "text-[13px]")}>
        {title} <span className="font-normal text-[color:var(--color-muted-foreground)]">{items.length}</span>
      </h3>
      {items.length === 0 ? <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">None yet.</p> : <ul className="space-y-1.5">{items.map(children)}</ul>}
    </div>
  );
}

export function HotwashBoard({ exerciseId, timezone }: { exerciseId: string; timezone: string }) {
  const confirm = useConfirm();
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [big, setBig] = useState(false);

  const load = useCallback(async () => {
    const r = await api<Listing>(`/api/exercises/${exerciseId}/hotwash`);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
  }, [exerciseId]);
  usePoll(load, 8000);

  async function add(kind: Kind, objectiveId: string | null, text: string): Promise<boolean> {
    const r = await api(`/api/exercises/${exerciseId}/hotwash`, { body: { kind, objectiveId, text }, fallback: "The item was not saved. Try again." });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    void load();
    return true;
  }

  async function save(id: string, text: string): Promise<boolean> {
    const r = await api(`/api/exercises/${exerciseId}/hotwash/${id}`, { method: "PATCH", body: { text }, fallback: "The change was not saved. Try again." });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    void load();
    return true;
  }

  async function remove(item: Item) {
    const ok = await confirm({ title: "Delete this item?", description: "The audit log keeps a copy.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const r = await api(`/api/exercises/${exerciseId}/hotwash/${item.id}`, { method: "DELETE", fallback: "The item was not deleted. Try again." });
    if (!r.ok) toast.error(r.error);
    void load();
  }

  if (!data) {
    if (error) return <p role="alert" className="py-10 text-center text-[13px] text-[color:var(--mist-danger)]">{error}</p>;
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }

  const ex = data.exercise;
  const editable = (i: Item) => data.canWrite && (data.canModerate || (data.me !== null && i.byParticipantId === data.me));
  const row = (i: Item) => <ItemRow key={i.id} item={i} big={big} editable={editable(i)} onSave={(t) => save(i.id, t)} onDelete={() => void remove(i)} />;
  const general = data.items.filter((i) => i.kind !== "parking_lot" && !i.objectiveId);
  const parking = data.items.filter((i) => i.kind === "parking_lot");

  const board = (
    <div className="space-y-4">
      {data.canWrite && (
        <Card dense>
          <QuickAdd objectives={data.objectives} onAdd={add} big={big} />
        </Card>
      )}
      {!data.canWrite && ex?.status === "ended" && <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">Read only. Facilitators and controllers add items.</p>}
      {data.objectives.map((o) => {
        const mine = data.items.filter((i) => i.objectiveId === o.id);
        return (
          <Card key={o.id} dense className="gap-3">
            <h2 className={cn("font-semibold", big ? "text-xl" : "text-[15px]")}>
              Objective {o.seq}. {o.text}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Column title="Strengths" items={mine.filter((i) => i.kind === "strength")} big={big}>
                {row}
              </Column>
              <Column title="Areas for improvement" items={mine.filter((i) => i.kind === "afi")} big={big}>
                {row}
              </Column>
            </div>
          </Card>
        );
      })}
      {general.length > 0 && (
        <Card dense className="gap-3">
          <h2 className={cn("font-semibold", big ? "text-xl" : "text-[15px]")}>No objective</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Column title="Strengths" items={general.filter((i) => i.kind === "strength")} big={big}>
              {row}
            </Column>
            <Column title="Areas for improvement" items={general.filter((i) => i.kind === "afi")} big={big}>
              {row}
            </Column>
          </div>
        </Card>
      )}
      <Card dense className="gap-3">
        <Column title="Parking lot" items={parking} big={big}>
          {row}
        </Column>
      </Card>
    </div>
  );

  return (
    <div className={cn("space-y-4", big && "fixed inset-0 z-40 overflow-y-auto bg-background p-6")}>
      <div className="flex flex-wrap items-center gap-3">
        {!big && (
          <Link href={`/exercises/${exerciseId}`} className="inline-flex items-center gap-1 text-[13px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
            <ArrowLeft className="h-4 w-4" />
            Exercise
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className={cn("truncate font-display font-semibold tracking-tight", big ? "text-3xl" : "text-2xl")}>Hotwash</h1>
          {ex && <p className="truncate text-[13px] text-[color:var(--color-muted-foreground)]">{ex.title}</p>}
        </div>
        {ex?.isPractice && <Badge variant="outline">Practice</Badge>}
        <Button size="sm" variant="outline" onClick={() => setBig((b) => !b)}>
          {big ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {big ? "Exit projector view" : "Projector view"}
        </Button>
      </div>
      {ex && ex.status !== "ended" && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">The hotwash opens after ENDEX.</p>}
      {big ? (
        board
      ) : (
        <Tabs defaultValue="hotwash">
          <TabsList className="w-full overflow-x-auto sm:w-fit">
            <TabsTrigger value="hotwash">Hotwash</TabsTrigger>
            <TabsTrigger value="ratings">Ratings</TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
            <TabsTrigger value="observations">Observations</TabsTrigger>
          </TabsList>
          <TabsContent value="hotwash" className="pt-2">
            {board}
          </TabsContent>
          <TabsContent value="ratings" className="pt-2">
            <RatingsPanel exerciseId={exerciseId} timezone={timezone} />
          </TabsContent>
          <TabsContent value="feedback" className="pt-2">
            <FeedbackSummaryPanel exerciseId={exerciseId} />
          </TabsContent>
          <TabsContent value="observations" className="pt-2">
            <ObservationLog exerciseId={exerciseId} timezone={timezone} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
