"use client";

// Control room for live and paused exercises: status, clocks, the one set of
// driver controls, regulatory clocks, the mode's ControlView, and the side
// tabs (observations, MSEL, roster, chat, feed).
//
// The header owns every exercise control: pause, Next inject, release,
// discard, close, +2 and +5 minutes, broadcast, ENDEX. Mode ControlViews show
// mode detail and mode settings only.

import { useCallback, useEffect, useRef, useState } from "react";
import { FastForward, Loader2, Megaphone, Pause, Play, Square, TimerReset, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldSelect } from "@/components/form/field-select";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { ChatPanel } from "./chat-panel";
import { ExportButtons } from "./export-buttons";
import { ExerciseClocks, RegulatoryClocks, timeboxLeftMs, timeboxWarning, useNow } from "./clocks";
import { FeedList } from "./feed-list";
import { ModeArea } from "./mode-area";
import { MselPanel } from "./msel-panel";
import { ObservationsPanel } from "./observations-panel";
import { RosterPanel } from "./roster-panel";
import type { UseExerciseState } from "./use-exercise-state";
import { POLICY_LABELS, STATUS_LABELS, type RosterEntry } from "./types";

function BroadcastDialog({
  open,
  onOpenChange,
  teams,
  send,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  teams: Array<{ id: string; name: string }>;
  send: (message: string, teamId: string | null) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    const ok = await send(message.trim(), teamId || null);
    setBusy(false);
    if (ok) {
      setMessage("");
      onOpenChange(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Broadcast</DialogTitle>
            <DialogDescription>Shows in the updates of everyone you pick.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="broadcast-message">Message</Label>
            <Textarea id="broadcast-message" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} required />
          </div>
          {teams.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="broadcast-team">To</Label>
              <FieldSelect
                id="broadcast-team"
                value={teamId}
                onChange={setTeamId}
                options={[{ value: "", label: "Everyone" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !message.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Warn once as the time box crosses 10 and then 5 minutes left. */
function useTimeboxWarning(leftMs: number | null): number | null {
  const warning = timeboxWarning(leftMs);
  const shown = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (warning === null || shown.current.has(warning)) return;
    shown.current.add(warning);
    toast.warning(`${warning} minutes left in the time box.`);
  }, [warning]);
  return warning;
}

export function ControlRoom({ exerciseId, s, timezone }: { exerciseId: string; s: UseExerciseState; timezone: string }) {
  const state = s.state!;
  const ex = state.exercise;
  const inject = state.currentInject ?? null;
  const now = useNow(s.serverOffsetMs);
  const confirm = useConfirm();
  const isDriver = state.viewer.isDriver;
  const evaluatorOnly = Boolean(state.me?.roles.includes("evaluator")) && !isDriver;
  const [busy, setBusy] = useState<string | null>(null);
  const [clockBusy, setClockBusy] = useState<string | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [tab, setTab] = useState(evaluatorOnly ? "observations" : "roster");
  const [removing, setRemoving] = useState<string | null>(null);
  const warning = useTimeboxWarning(timeboxLeftMs(ex, now));
  const stopWord = state.plan?.stopWord?.trim() ?? "";

  const control = useCallback(
    async (action: string, body: Record<string, unknown> = {}, success?: string): Promise<boolean> => {
      setBusy(action);
      const r = await api(`/api/exercises/${exerciseId}/control`, { body: { ...body, action }, fallback: "That did not work. Try again." });
      setBusy(null);
      s.refresh();
      if (!r.ok) {
        toast.error(r.error);
        return false;
      }
      if (success) toast.success(success);
      return true;
    },
    [exerciseId, s],
  );

  async function clockAction(key: string, action: "trigger" | "met" | "reset") {
    if (action === "reset") {
      const ok = await confirm({ title: "Reset this clock?", description: "Its start, deadline and met time are cleared.", confirmLabel: "Reset" });
      if (!ok) return;
    }
    setClockBusy(key);
    const r = await api(`/api/exercises/${exerciseId}/control`, { body: { action: "clock", clock: { key, action } }, fallback: "The clock did not change. Try again." });
    setClockBusy(null);
    s.refresh();
    if (!r.ok) toast.error(r.error);
    else toast.success(action === "trigger" ? "Clock started." : action === "met" ? "Clock marked met." : "Clock reset.");
  }

  async function endex() {
    const ok = await confirm({
      title: "End the exercise?",
      description: "The open inject closes and everyone moves to the debrief.",
      confirmLabel: "ENDEX",
      destructive: true,
    });
    if (ok) await control("endex", {}, "ENDEX.");
  }

  async function removeParticipant(p: RosterEntry) {
    const ok = await confirm({ title: `Remove ${p.displayName}?`, description: "They lose access right away.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    setRemoving(p.id);
    const r = await api(`/api/exercises/${exerciseId}/participants`, { method: "DELETE", body: { participantId: p.id }, fallback: "They were not removed. Try again." });
    setRemoving(null);
    if (!r.ok) toast.error(r.error);
    else toast.success(`${p.displayName} removed.`);
    s.refresh();
  }

  const live = ex.status === "live";
  const open = inject?.status === "open";
  const held = inject?.status === "held";
  const canAdvance = live && !held && (!open || ex.advancePolicy === "facilitator");
  const wide = tab === "msel";
  const clocks = state.clocks ?? [];

  return (
    <div className="space-y-4">
      <Card className="gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate font-display text-xl font-semibold tracking-tight">{ex.title}</h1>
          {stopWord && (
            <span className="text-[12.5px] text-[color:var(--color-muted-foreground)]" title="Anyone can say it to stop play for a real event.">
              Stop word <span className="rounded bg-[color:var(--color-muted)] px-1.5 py-0.5 font-mono font-semibold text-[color:var(--color-foreground)]">{stopWord}</span>
            </span>
          )}
          <Badge variant={live ? "accent" : "warning"}>{STATUS_LABELS[ex.status] ?? ex.status}</Badge>
          {ex.isPractice && <Badge variant="outline">Practice</Badge>}
          <span className="text-[12px] text-[color:var(--color-muted-foreground)]">{POLICY_LABELS[ex.advancePolicy]}</span>
          {!s.connected && <Badge variant="outline">Reconnecting</Badge>}
          <ExportButtons exerciseId={exerciseId} isControl={state.viewer.isControl} />
        </div>
        <ExerciseClocks exercise={ex} inject={inject} timezone={timezone} now={now} />
        {warning !== null && (
          <div role="status" className="flex items-center gap-2 rounded-md bg-[color:color-mix(in_srgb,var(--mist-warn),transparent_88%)] px-3 py-2 text-[13px] text-[color:var(--mist-warn)]">
            <TriangleAlert className="h-4 w-4" />
            {warning} minutes left in the time box.
          </div>
        )}
        {inject && (
          <p className="text-[13px]">
            <span className="text-[color:var(--color-muted-foreground)]">Inject {inject.seq}. </span>
            <span className="font-medium">{inject.title}</span>
            <Badge className="ml-2" variant={open ? "accent" : held ? "warning" : "secondary"}>
              {open ? "Open" : held ? "Waiting for release" : "Closed"}
            </Badge>
          </p>
        )}
        {isDriver && (
          <div className="flex flex-wrap gap-2">
            {live ? (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void control("pause", {}, "Paused.")}>
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            ) : (
              <Button size="sm" variant="accent" disabled={busy !== null} onClick={() => void control("resume", {}, "Resumed.")}>
                <Play className="h-4 w-4" />
                Resume
              </Button>
            )}
            {held ? (
              <>
                <Button size="sm" variant="accent" disabled={busy !== null || !live} onClick={() => void control("release", { injectId: inject!.id }, "Inject released.")}>
                  {busy === "release" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FastForward className="h-4 w-4" />}
                  Next inject
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void control("discard", { injectId: inject!.id }, "Inject discarded.")}>
                  <X className="h-4 w-4" />
                  Discard
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant={open ? "outline" : "accent"}
                disabled={!canAdvance || busy !== null}
                title={open && !canAdvance ? "Close the inject first." : undefined}
                onClick={() => void control("advance")}
              >
                {busy === "advance" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FastForward className="h-4 w-4" />}
                Next inject
              </Button>
            )}
            {open && (
              <>
                <Button size="sm" variant="outline" disabled={busy !== null || !live} onClick={() => void control("close", { injectId: inject!.id }, "Inject closed.")}>
                  <Square className="h-4 w-4" />
                  Close inject
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null || !live} onClick={() => void control("extend", { injectId: inject!.id, addMinutes: 2 }, "Added 2 minutes.")}>
                  <TimerReset className="h-4 w-4" />
                  +2 min
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null || !live} onClick={() => void control("extend", { injectId: inject!.id, addMinutes: 5 }, "Added 5 minutes.")}>
                  +5 min
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setBroadcastOpen(true)}>
              <Megaphone className="h-4 w-4" />
              Broadcast
            </Button>
            <Button size="sm" variant="destructive" className="sm:ml-auto" disabled={busy !== null} onClick={() => void endex()}>
              <Square className="h-4 w-4" />
              ENDEX
            </Button>
          </div>
        )}
        {clocks.length > 0 && (
          <div className="space-y-2 border-t border-[color:var(--color-border)] pt-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Regulatory clocks</h2>
            <RegulatoryClocks
              clocks={clocks}
              scenarioStartAt={ex.scenarioStartAt}
              timezone={timezone}
              onAction={isDriver ? (key, action) => void clockAction(key, action) : undefined}
              busyKey={clockBusy}
            />
          </div>
        )}
      </Card>

      <div className={cn("grid gap-4", !wide && "xl:grid-cols-[minmax(0,1fr)_420px]")}>
        <main className="min-w-0">
          <ModeArea view="ControlView" exerciseId={exerciseId} state={state} isGuest={false} refresh={s.refresh} />
        </main>
        <aside className="min-w-0">
          <Card dense className={cn(!wide && "xl:sticky xl:top-20")}>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full overflow-x-auto">
                <TabsTrigger value="observations">Observations</TabsTrigger>
                <TabsTrigger value="msel">MSEL</TabsTrigger>
                <TabsTrigger value="roster">Roster</TabsTrigger>
                <TabsTrigger value="chat">Chat</TabsTrigger>
                <TabsTrigger value="feed">Feed</TabsTrigger>
              </TabsList>
              <TabsContent value="observations" className="max-h-[70vh] overflow-y-auto pt-2">
                <ObservationsPanel exerciseId={exerciseId} tick={s.tick} timezone={timezone} currentInject={inject} />
              </TabsContent>
              <TabsContent value="msel" className="pt-2">
                <MselPanel exerciseId={exerciseId} tick={s.tick} timezone={timezone} />
              </TabsContent>
              <TabsContent value="roster" className="max-h-[70vh] overflow-y-auto pt-2">
                <RosterPanel
                  roster={state.roster}
                  teams={state.teams}
                  onRemove={isDriver ? (p) => void removeParticipant(p) : undefined}
                  busyId={removing}
                  manage={isDriver ? { exerciseId, onChanged: s.refresh } : undefined}
                />
              </TabsContent>
              <TabsContent value="chat" className="pt-2">
                <ChatPanel
                  exerciseId={exerciseId}
                  chatTick={s.chatTick}
                  isControl
                  myTeamId={state.me?.teamId ?? null}
                  teams={state.teams}
                  timezone={timezone}
                  canPost={Boolean(state.me)}
                  className="max-h-[70vh]"
                />
              </TabsContent>
              <TabsContent value="feed" className="max-h-[70vh] overflow-y-auto pt-2">
                <FeedList feed={state.feed ?? []} teams={state.teams} timezone={timezone} />
              </TabsContent>
            </Tabs>
          </Card>
        </aside>
      </div>

      <BroadcastDialog
        open={broadcastOpen}
        onOpenChange={setBroadcastOpen}
        teams={state.teams}
        send={(message, teamId) => control("broadcast", { message, teamId }, "Sent.")}
      />
    </div>
  );
}
