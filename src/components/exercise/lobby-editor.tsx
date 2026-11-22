"use client";

// Lobby editor: everything a driver sets before STARTEX. Each section saves
// on its own through PATCH /api/exercises/{id} (or the participants API).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CheckCircle2, Loader2, Plus, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldSelect } from "@/components/form/field-select";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { cn } from "@/lib/utils";
import type { LobbySetup } from "@/lib/exercise/lobby";
import { PLAN_MISSION_AREAS } from "@/lib/exercise/schemas";
import { FRAMEWORKS, listControls } from "@/lib/exercise/content/frameworks";
import { zoneLabel } from "@/lib/exercise/time";
import { api } from "./api";
import { ExportButtons } from "./export-buttons";
import { settingsFor } from "./mode-settings";
import { MselPanel } from "./msel-panel";
import { ALL_ROLES, GUEST_ROLES, RolePicker } from "./role-picker";
import { POLICY_LABELS, STATUS_LABELS } from "./types";
import { InviteSection } from "./invite-section";
import { SaveBar, Section, fromZoneInput, toZoneInput, useDraft, type Patch } from "./lobby-parts";

type Setup = LobbySetup;

// ---------------------------------------------------------------------------

export function LobbyEditor({ exerciseId, tick, onChanged }: { exerciseId: string; tick: number; onChanged: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<Setup>(`/api/exercises/${exerciseId}`);
    if (r.ok) {
      setSetup(r.data);
      setError(null);
    } else setError(r.error);
  }, [exerciseId]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const patch = useCallback(
    async (body: Record<string, unknown>, success = "Saved."): Promise<boolean> => {
      const r = await api(`/api/exercises/${exerciseId}`, { method: "PATCH", body, fallback: "The change was not saved. Try again." });
      if (!r.ok) {
        toast.error(r.error);
        return false;
      }
      toast.success(success);
      await load();
      onChanged();
      return true;
    },
    [exerciseId, load, onChanged],
  );

  if (error && !setup) return <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>;
  if (!setup) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <DetailsSection setup={setup} patch={patch} />
        <InviteSection setup={setup} patch={patch} exerciseId={exerciseId} reload={load} />
        <PlanSection setup={setup} patch={patch} />
        {setup.caps.teams && <TeamsSection setup={setup} patch={patch} />}
        <ModeSettingsSection setup={setup} patch={patch} />
        <ParticipantsSection setup={setup} exerciseId={exerciseId} reload={load} onChanged={onChanged} />
        <ObjectivesSection setup={setup} patch={patch} />
        <ClocksSection setup={setup} patch={patch} />
        <Section title="MSEL" description="The planned injects with expected actions and decisions.">
          <MselPanel exerciseId={exerciseId} tick={tick} timezone={setup.timezone} readOnly />
        </Section>
      </div>
      <div className="space-y-6">
        <div className="flex justify-end"><ExportButtons exerciseId={exerciseId} isControl /></div>
        <StartPanel setup={setup} exerciseId={exerciseId} reload={load} onChanged={onChanged} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------


function DetailsSection({ setup, patch }: { setup: Setup; patch: Patch }) {
  const ex = setup.exercise;
  const source = useMemo(
    () => ({
      title: ex.title,
      timeboxMin: ex.timeboxMin ? String(ex.timeboxMin) : "",
      scenarioStartAt: toZoneInput(ex.scenarioStartAt, setup.timezone),
      advancePolicy: ex.advancePolicy,
    }),
    [ex.title, ex.timeboxMin, ex.scenarioStartAt, ex.advancePolicy, setup.timezone],
  );
  const [d, setD, dirty, reset] = useDraft(source);
  const [busy, setBusy] = useState(false);
  // The template run time plus a quarter hour, when the time box is empty.
  const target = (ex.config as { targetDurationMin?: unknown } | null)?.targetDurationMin;
  const suggested = typeof target === "number" && target > 0 ? Math.min(1440, target + 15) : null;
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || ex.timeboxMin || !suggested) return;
    prefilled.current = true;
    setD((prev) => ({ ...prev, timeboxMin: String(suggested) }));
  }, [ex.timeboxMin, suggested, setD]);
  const zone = zoneLabel(new Date(), setup.timezone);

  async function save() {
    const timebox = d.timeboxMin.trim() ? Number(d.timeboxMin) : null;
    if (timebox !== null && (!Number.isInteger(timebox) || timebox < 5 || timebox > 1440)) {
      toast.error("Use a time box from 5 to 1440 minutes.");
      return;
    }
    setBusy(true);
    const ok = await patch({
      title: d.title,
      timeboxMin: timebox,
      scenarioStartAt: d.scenarioStartAt ? fromZoneInput(d.scenarioStartAt, setup.timezone) : null,
      advancePolicy: d.advancePolicy,
    });
    setBusy(false);
    if (ok) reset();
  }

  return (
    <Section title="Details" description={`${ex.modeLabel}${ex.templateTitle ? `, from ${ex.templateTitle}` : ""}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="lobby-title">Title</Label>
          <Input id="lobby-title" value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lobby-timebox">Time box in minutes</Label>
          <Input
            id="lobby-timebox"
            inputMode="numeric"
            value={d.timeboxMin}
            placeholder="No limit"
            onChange={(e) => setD({ ...d, timeboxMin: e.target.value.replace(/[^0-9]/g, "") })}
          />
          {suggested && !ex.timeboxMin && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Suggested from the template. Save to keep it.</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="lobby-scenario-start">Scenario start, {zone}</Label>
          <Input
            id="lobby-scenario-start"
            type="datetime-local"
            value={d.scenarioStartAt}
            onChange={(e) => setD({ ...d, scenarioStartAt: e.target.value })}
          />
          <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
            {setup.clocks.length > 0 ? "Required. Regulatory clocks count from it." : "Empty means the time you press Start."}
          </p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="lobby-policy">Next inject</Label>
          <FieldSelect
            id="lobby-policy"
            value={d.advancePolicy}
            onChange={(v) => setD({ ...d, advancePolicy: v })}
            options={setup.caps.advance.map((p) => ({ value: p, label: POLICY_LABELS[p] ?? p }))}
          />
        </div>
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={reset} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

const PLAN_FIELDS: Array<{ key: keyof Setup["plan"]; label: string; rows?: number; max: number; hint?: string }> = [
  { key: "sponsor", label: "Sponsor", max: 200 },
  { key: "scope", label: "Scope", rows: 2, max: 2000 },
  { key: "hazard", label: "Threat or hazard", rows: 2, max: 1000 },
  { key: "groundRules", label: "Ground rules", rows: 3, max: 4000 },
  { key: "assumptions", label: "Assumptions and artificialities", rows: 3, max: 4000 },
  { key: "stopWord", label: "Stop word", max: 60, hint: "Anyone can say it to pause play for a real event." },
  { key: "noFaultStatement", label: "No-fault statement", rows: 2, max: 2000 },
];

type PlanDraft = Setup["plan"];

/** Mission areas this exercise covers (HSEEP). */
function MissionAreas({ d, setD }: { d: PlanDraft; setD: (v: PlanDraft) => void }) {
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-[13px] font-medium">Mission areas</legend>
      <div className="flex flex-wrap gap-3">
        {PLAN_MISSION_AREAS.map((m) => (
          <label key={m} className="flex items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              checked={d.missionAreas.includes(m)}
              onChange={(e) => setD({ ...d, missionAreas: e.target.checked ? [...d.missionAreas, m] : d.missionAreas.filter((x) => x !== m) })}
            />
            {m}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Framework requirements (controls) this exercise is meant to satisfy. */
function Requirements({ d, setD, suggested }: { d: PlanDraft; setD: (v: PlanDraft) => void; suggested: Setup["planSuggestions"]["requirements"] }) {
  const [fw, setFw] = useState<string>(FRAMEWORKS[0]?.id ?? "");
  const [control, setControl] = useState("");
  const controls = useMemo(() => listControls(fw), [fw]);
  const title = (f: string, c: string) => listControls(f).find((x) => x.controlId === c)?.title ?? "";
  const add = () => {
    if (!control || d.requirements.some((r) => r.framework === fw && r.controlId === control)) return;
    setD({ ...d, requirements: [...d.requirements, { framework: fw, controlId: control }] });
    setControl("");
  };
  return (
    <div className="space-y-2 sm:col-span-2" data-testid="plan-requirements">
      <Label>Requirements this exercise is meant to satisfy</Label>
      {d.requirements.length === 0 && suggested.length > 0 && (
        <Button type="button" size="xs" variant="outline" onClick={() => setD({ ...d, requirements: suggested })}>
          Use the schedule entry requirements ({suggested.length})
        </Button>
      )}
      <ul className="space-y-1">
        {d.requirements.map((r) => (
          <li key={`${r.framework}:${r.controlId}`} className="flex items-center gap-2 text-[13px]">
            <span className="min-w-0 flex-1">
              <span className="font-mono text-[12px]">
                {r.framework} {r.controlId}
              </span>{" "}
              {title(r.framework, r.controlId)}
            </span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${r.framework} ${r.controlId}`}
              onClick={() => setD({ ...d, requirements: d.requirements.filter((x) => x !== r) })}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <FieldSelect
          aria-label="Framework"
          value={fw}
          onChange={(v) => {
            setFw(v);
            setControl("");
          }}
          options={FRAMEWORKS.map((f) => ({ value: f.id, label: f.label }))}
          className="sm:w-56"
        />
        <FieldSelect
          aria-label="Control"
          value={control}
          onChange={setControl}
          options={[{ value: "", label: "Pick a control" }, ...controls.map((c) => ({ value: c.controlId, label: `${c.controlId} ${c.title}`.slice(0, 90) }))]}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!control || d.requirements.length >= 50}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
    </div>
  );
}

/** Plans, policies and procedures this exercise tests. */
function PlansExercised({ d, setD, suggested }: { d: PlanDraft; setD: (v: PlanDraft) => void; suggested: Setup["planSuggestions"]["plansExercised"] }) {
  const rows = d.plansExercised;
  const update = (i: number, patch: Partial<PlanDraft["plansExercised"][number]>) =>
    setD({ ...d, plansExercised: rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-2 sm:col-span-2" data-testid="plan-plans">
      <Label>Plans exercised</Label>
      {rows.length === 0 && suggested.length > 0 && (
        <Button type="button" size="xs" variant="outline" onClick={() => setD({ ...d, plansExercised: suggested })}>
          Use the source document
        </Button>
      )}
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <Input aria-label="Plan title" placeholder="Title" maxLength={300} value={r.title} onChange={(e) => update(i, { title: e.target.value })} />
          <Input aria-label="Plan version" placeholder="Version" maxLength={60} value={r.version} onChange={(e) => update(i, { version: e.target.value })} />
          <Input aria-label="Plan date" placeholder="Date" maxLength={40} value={r.date} onChange={(e) => update(i, { date: e.target.value })} />
          <Input aria-label="Plan owner" placeholder="Owner" maxLength={200} value={r.owner} onChange={(e) => update(i, { owner: e.target.value })} />
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove plan" onClick={() => setD({ ...d, plansExercised: rows.filter((_, k) => k !== i) })}>
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={rows.length >= 20}
        onClick={() => setD({ ...d, plansExercised: [...rows, { title: "", version: "", date: "", owner: "", sha256: null }] })}
      >
        <Plus className="h-3.5 w-3.5" />
        Add plan
      </Button>
    </div>
  );
}

function PlanSection({ setup, patch }: { setup: Setup; patch: Patch }) {
  const [d, setD, dirty, reset] = useDraft(setup.plan);
  const sponsorOptions = useMemo(
    () => [
      { value: "", label: "Facilitators and administrators only" },
      ...setup.participants.filter((p) => p.userId && !p.roles.includes("player")).map((p) => ({ value: p.userId!, label: p.displayName })),
    ],
    [setup.participants],
  );
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    // The start time saves from the invite section; leave it out so an older copy never overwrites it.
    const { startsAt: _startsAt, ...rest } = d;
    const ok = await patch({ plan: { ...rest, plansExercised: d.plansExercised.filter((p) => p.title.trim()) } });
    setBusy(false);
    if (ok) reset();
  }
  return (
    <Section title="Plan">
      <div className="grid gap-4 sm:grid-cols-2">
        {PLAN_FIELDS.map((f) => (
          <div key={f.key} className={cn("space-y-2", f.rows && "sm:col-span-2")}>
            <Label htmlFor={`plan-${f.key}`}>{f.label}</Label>
            {f.rows ? (
              <Textarea
                id={`plan-${f.key}`}
                rows={f.rows}
                maxLength={f.max}
                value={String(d[f.key] ?? "")}
                onChange={(e) => setD({ ...d, [f.key]: e.target.value })}
              />
            ) : (
              <Input id={`plan-${f.key}`} maxLength={f.max} value={String(d[f.key] ?? "")} onChange={(e) => setD({ ...d, [f.key]: e.target.value })} />
            )}
            {f.hint && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">{f.hint}</p>}
          </div>
        ))}
        {setup.caps.teams && (
          <div className="flex items-center justify-between gap-4 sm:col-span-2">
            <div>
              <Label htmlFor="plan-team-choice">Guests pick a team</Label>
              <p className="text-[12px] text-[color:var(--color-muted-foreground)]">When off, guests go to the smallest team.</p>
            </div>
            <Switch id="plan-team-choice" checked={d.guestTeamChoice} onCheckedChange={(on) => setD({ ...d, guestTeamChoice: on })} />
          </div>
        )}
        <MissionAreas d={d} setD={setD} />
        <Requirements d={d} setD={setD} suggested={setup.planSuggestions.requirements} />
        <PlansExercised d={d} setD={setD} suggested={setup.planSuggestions.plansExercised} />
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="plan-sponsor-account">Sponsor account</Label>
          <FieldSelect id="plan-sponsor-account" value={d.sponsorUserId ?? ""} onChange={(v) => setD({ ...d, sponsorUserId: v || null })} options={sponsorOptions} />
          <p className="text-[12px] text-[color:var(--color-muted-foreground)]">This account may sign the report as sponsor.</p>
        </div>
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={reset} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

function TeamsSection({ setup, patch }: { setup: Setup; patch: Patch }) {
  const source = useMemo(() => setup.teams.map((t) => ({ id: t.id as string | undefined, name: t.name })), [setup.teams]);
  const [d, setD, dirty, reset] = useDraft(source);
  const [busy, setBusy] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of setup.participants) if (p.teamId) m.set(p.teamId, (m.get(p.teamId) ?? 0) + 1);
    return m;
  }, [setup.participants]);

  async function save() {
    if (d.some((t) => !t.name.trim())) {
      toast.error("Name every team.");
      return;
    }
    setBusy(true);
    const ok = await patch({ teams: d.map((t) => ({ ...(t.id ? { id: t.id } : {}), name: t.name.trim() })) });
    setBusy(false);
    if (ok) reset();
  }

  return (
    <Section
      title="Teams"
      action={
        <Button size="sm" variant="outline" disabled={d.length >= 10} onClick={() => setD([...d, { id: undefined, name: `Team ${d.length + 1}` }])}>
          <Plus className="h-4 w-4" />
          Add team
        </Button>
      }
    >
      {d.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No teams yet.</p>}
      <ul className="space-y-2">
        {d.map((t, i) => (
          <li key={t.id ?? `new-${i}`} className="flex items-center gap-2">
            <Input aria-label={`Team ${i + 1} name`} value={t.name} maxLength={60} onChange={(e) => setD(d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <span className="w-20 shrink-0 text-right text-[12px] text-[color:var(--color-muted-foreground)]">
              {t.id ? `${counts.get(t.id) ?? 0} people` : "New"}
            </span>
            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${t.name}`} onClick={() => setD(d.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={reset} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

function ParticipantsSection({ setup, exerciseId, reload, onChanged }: { setup: Setup; exerciseId: string; reload: () => Promise<void>; onChanged: () => void }) {
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; email: string; title: string | null }>>([]);
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [roles, setRoles] = useState<string[]>(["player"]);
  const [teamId, setTeamId] = useState("");
  const [dm, setDm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const teamOptions = [{ value: "", label: "No team" }, ...setup.teams.map((t) => ({ value: t.id, label: t.name }))];

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await api<{ users: typeof results }>(`/api/exercises/${exerciseId}/participants?q=${encodeURIComponent(q)}`);
      if (!cancelled && r.ok) setResults(r.data.users);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, exerciseId, setup.participants.length]);

  async function call(method: string, body: Record<string, unknown>, success: string, key: string) {
    setBusy(key);
    const r = await api(`/api/exercises/${exerciseId}/participants`, { method, body, fallback: "The change was not saved. Try again." });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(success);
    await reload();
    onChanged();
    return true;
  }

  async function add() {
    if (!pick) return;
    if (roles.length === 0) {
      toast.error("Pick at least one role.");
      return;
    }
    const ok = await call("POST", { userId: pick.id, roles, teamId: teamId || null, isDecisionMaker: dm }, `${pick.name} added.`, "add");
    if (ok) {
      setPick(null);
      setQ("");
      setDm(false);
    }
  }

  async function remove(p: Setup["participants"][number]) {
    const ok = await confirm({ title: `Remove ${p.displayName}?`, description: "They lose access to this exercise right away.", confirmLabel: "Remove", destructive: true });
    if (ok) await call("DELETE", { participantId: p.id }, `${p.displayName} removed.`, p.id);
  }

  return (
    <Section title="Participants" description="Roles apply to this exercise only.">
      <div className="space-y-3 rounded-md bg-[color:var(--color-muted)]/60 p-3">
        {pick ? (
          <div className="flex items-center gap-2">
            <Badge variant="accent">{pick.name}</Badge>
            <Button size="icon-xs" variant="ghost" aria-label="Pick someone else" onClick={() => setPick(null)}>
              <X />
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
              <Input aria-label="Find a user" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a user by name or email" className="pl-9" />
            </div>
            {results.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
                {results.map((u) => (
                  <li key={u.id}>
                    <button type="button" className="w-full px-3 py-2 text-left text-[13px] hover:bg-[color:var(--color-muted)]" onClick={() => setPick({ id: u.id, name: u.name })}>
                      <span className="font-medium">{u.name}</span> <span className="text-[color:var(--color-muted-foreground)]">{u.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {q && results.length === 0 && <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">No matching users.</p>}
          </div>
        )}
        <RolePicker value={roles} onChange={setRoles} label="Roles for the new participant" />
        <div className="flex flex-wrap items-center gap-3">
          {setup.caps.teams && <FieldSelect aria-label="Team" value={teamId} onChange={setTeamId} options={teamOptions} className="h-9 w-48" />}
          <label className="flex items-center gap-2 text-[12.5px]">
            <Switch checked={dm} onCheckedChange={setDm} aria-label="Decision maker" />
            Decision maker
          </label>
          <Button size="sm" className="ml-auto" onClick={() => void add()} disabled={!pick || busy === "add"}>
            {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}
            Add
          </Button>
        </div>
      </div>

      <ul className="space-y-2">
        {setup.participants.map((p) => (
          <li key={p.id} className="space-y-2 rounded-md border border-[color:var(--color-border)] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.displayName}</span>
              {p.isGuest && <Badge variant="secondary">Guest</Badge>}
              {p.email && <span className="text-[12px] text-[color:var(--color-muted-foreground)]">{p.email}</span>}
              <Button size="xs" variant="ghost" className="ml-auto" disabled={busy === p.id} onClick={() => void remove(p)} aria-label={`Remove ${p.displayName}`}>
                Remove
              </Button>
            </div>
            <RolePicker
              value={p.roles}
              allowed={p.isGuest ? GUEST_ROLES : ALL_ROLES}
              label={`Roles for ${p.displayName}`}
              onChange={(next) => {
                if (next.length === 0) {
                  toast.error("Keep at least one role.");
                  return;
                }
                void call("PATCH", { participantId: p.id, roles: next }, "Roles saved.", p.id);
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              {setup.caps.teams && (
                <FieldSelect
                  aria-label={`Team for ${p.displayName}`}
                  value={p.teamId ?? ""}
                  onChange={(v) => void call("PATCH", { participantId: p.id, teamId: v || null }, "Team saved.", p.id)}
                  options={teamOptions}
                  className="h-9 w-48"
                />
              )}
              <label className="flex items-center gap-2 text-[12.5px]">
                <Switch
                  checked={p.isDecisionMaker}
                  aria-label={`Decision maker ${p.displayName}`}
                  onCheckedChange={(on) => void call("PATCH", { participantId: p.id, isDecisionMaker: on }, "Saved.", p.id)}
                />
                Decision maker
              </label>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Mode settings
// ---------------------------------------------------------------------------

function ModeSettingsSection({ setup, patch }: { setup: Setup; patch: Patch }) {
  const [busy, setBusy] = useState<string | null>(null);
  const config = (setup.exercise.config ?? {}) as Record<string, unknown>;
  const settings = settingsFor(setup.exercise.mode, config);
  if (settings.length === 0) return null;
  async function save(key: string, value: unknown) {
    setBusy(key);
    await patch({ config: { [key]: value } }, "Setting saved.");
    setBusy(null);
  }
  return (
    <Section title="Mode settings">
      <div className="space-y-3">
        {settings.map((st) =>
          st.kind === "switch" ? (
            <div key={st.key} className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={`mode-${st.key}`}>{st.label}</Label>
                {st.hint && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">{st.hint}</p>}
              </div>
              <Switch id={`mode-${st.key}`} checked={Boolean(config[st.key])} disabled={busy !== null} onCheckedChange={(on) => void save(st.key, on)} />
            </div>
          ) : (
            <div key={st.key} className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={`mode-${st.key}`}>{st.label}</Label>
                {st.hint && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">{st.hint}</p>}
              </div>
              <FieldSelect
                  id={`mode-${st.key}`}
                  value={config[st.key] === null || config[st.key] === undefined ? "" : String(config[st.key])}
                  disabled={busy !== null}
                  onChange={(v) => void save(st.key, st.kind === "number-select" ? (v === "" ? null : Number(v)) : v)}
                  options={st.options}
                  className="h-9 w-48"
                />
            </div>
          ),
        )}
        {setup.exercise.mode === "document" && <CloudSeam feature="sop-analysis" />}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

function ObjectivesSection({ setup, patch }: { setup: Setup; patch: Patch }) {
  const source = useMemo(
    () =>
      setup.objectives.map((o) => ({ id: o.id as string | undefined, text: o.text, capabilityIds: o.capabilityIds, templateInjectIds: o.templateInjectIds })),
    [setup.objectives],
  );
  const injectTitle = useMemo(() => new Map(setup.templateInjects.map((t) => [t.id, `${t.seq}. ${t.title}`])), [setup.templateInjects]);
  const [d, setD, dirty, reset] = useDraft(source);
  const [busy, setBusy] = useState(false);
  const capName = useMemo(() => new Map(setup.capabilities.map((c) => [c.id, `${c.key} ${c.name}`])), [setup.capabilities]);

  const update = (i: number, v: Partial<(typeof d)[number]>) => setD(d.map((o, j) => (j === i ? { ...o, ...v } : o)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.length) return;
    const next = [...d];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setD(next);
  };

  async function save() {
    if (d.some((o) => !o.text.trim())) {
      toast.error("Write every objective or remove the empty one.");
      return;
    }
    setBusy(true);
    const ok = await patch({
      objectives: d.map((o) => ({
        ...(o.id ? { id: o.id } : {}),
        text: o.text.trim(),
        capabilityIds: o.capabilityIds,
        ...(setup.templateInjects.length ? { templateInjectIds: o.templateInjectIds } : {}),
      })),
    });
    setBusy(false);
    if (ok) reset();
  }

  return (
    <Section
      title="Objectives"
      action={
        <Button size="sm" variant="outline" disabled={d.length >= 20} onClick={() => setD([...d, { id: undefined, text: "", capabilityIds: [], templateInjectIds: [] }])}>
          <Plus className="h-4 w-4" />
          Add objective
        </Button>
      }
    >
      {d.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No objectives yet. The after-action report rates each one.</p>}
      <ol className="space-y-3">
        {d.map((o, i) => (
          <li key={o.id ?? `new-${i}`} className="space-y-2 rounded-md border border-[color:var(--color-border)] p-3">
            <div className="flex items-start gap-2">
              <span className="pt-2 font-mono text-[12px] text-[color:var(--color-muted-foreground)]">{i + 1}.</span>
              <Textarea aria-label={`Objective ${i + 1}`} rows={2} maxLength={1000} value={o.text} onChange={(e) => update(i, { text: e.target.value })} />
              <div className="flex flex-col gap-1">
                <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === d.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label={`Remove objective ${i + 1}`} onClick={() => setD(d.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pl-5">
              {o.capabilityIds.map((cid) => (
                <Badge key={cid} variant="accent" className="gap-1">
                  {capName.get(cid) ?? "Capability"}
                  <button type="button" aria-label="Remove capability" onClick={() => update(i, { capabilityIds: o.capabilityIds.filter((x) => x !== cid) })}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <FieldSelect
                aria-label={`Add a capability to objective ${i + 1}`}
                value=""
                onChange={(v) => v && update(i, { capabilityIds: [...o.capabilityIds, v] })}
                options={[
                  { value: "", label: "Add a capability" },
                  ...setup.capabilities.filter((c) => !o.capabilityIds.includes(c.id)).map((c) => ({ value: c.id, label: `${c.key} ${c.name}` })),
                ]}
                className="h-8 w-56 text-[12.5px]"
              />
            </div>
            {setup.templateInjects.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pl-5" aria-label={`Injects for objective ${i + 1}`}>
                {o.templateInjectIds.map((tid) => (
                  <Badge key={tid} variant="secondary" className="gap-1">
                    {injectTitle.get(tid) ?? "Inject"}
                    <button type="button" aria-label="Unlink inject" onClick={() => update(i, { templateInjectIds: o.templateInjectIds.filter((x) => x !== tid) })}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <FieldSelect
                  aria-label={`Link an inject to objective ${i + 1}`}
                  value=""
                  onChange={(v) => v && update(i, { templateInjectIds: [...o.templateInjectIds, v] })}
                  options={[
                    { value: "", label: "Link an inject" },
                    ...setup.templateInjects.filter((t) => !o.templateInjectIds.includes(t.id)).map((t) => ({ value: t.id, label: `${t.seq}. ${t.title}` })),
                  ]}
                  className="h-8 w-56 text-[12.5px]"
                />
              </div>
            )}
          </li>
        ))}
      </ol>
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={reset} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Regulatory clocks
// ---------------------------------------------------------------------------

function ClocksSection({ setup, patch }: { setup: Setup; patch: Patch }) {
  const [busy, setBusy] = useState(false);
  const current = setup.clocks.map((c) => ({ id: c.id, key: c.key, label: c.label, durationHours: c.durationHours, businessDays: c.businessDays }));
  const unused = setup.clockPresets.filter((p) => !setup.clocks.some((c) => c.key === p.key));
  const save = async (next: typeof current, msg: string) => {
    setBusy(true);
    await patch({ clocks: next }, msg);
    setBusy(false);
  };
  return (
    <Section title="Regulatory clocks" description="A clock starts when play reaches its trigger.">
      {setup.clocks.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No clocks.</p>}
      <ul className="space-y-2">
        {setup.clocks.map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-md border border-[color:var(--color-border)] px-3 py-2 text-[13px]">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{c.label}</div>
              <div className="text-[12px] text-[color:var(--color-muted-foreground)]">
                {c.businessDays ? `${c.businessDays} business days` : `${c.durationHours} hours`}
              </div>
            </div>
            <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={`Remove ${c.label}`} onClick={() => void save(current.filter((x) => x.id !== c.id), "Clock removed.")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      {unused.length > 0 && (
        <FieldSelect
          aria-label="Add a regulatory clock"
          value=""
          disabled={busy || setup.clocks.length >= 10}
          onChange={(key) => {
            const p = unused.find((x) => x.key === key);
            if (p) void save([...current, { id: undefined as unknown as string, key: p.key, label: p.label, durationHours: p.durationHours, businessDays: p.businessDays }], "Clock added.");
          }}
          options={[{ value: "", label: "Add a clock" }, ...unused.map((p) => ({ value: p.key, label: p.label }))]}
          className="h-9"
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Readiness and start
// ---------------------------------------------------------------------------

interface Check {
  label: string;
  ok: boolean;
  hint: string;
  /** Blocks STARTEX when not ok. */
  required?: boolean;
}

/** The readiness checklist. Required checks block Start; the rest are warnings. */
function readinessChecks(setup: Setup): Check[] {
  const ex = setup.exercise;
  const players = setup.participants.filter((p) => p.roles.includes("player"));
  const guestHint = ex.guestJoin ? "Guests can still join after start." : "Add a player or turn on join by code.";
  const checks: Check[] = [];
  if (setup.caps.teams && setup.teams.length > 0) {
    for (const t of setup.teams) {
      checks.push({ label: `${t.name} has a player`, ok: players.some((p) => p.teamId === t.id), hint: guestHint });
    }
  } else {
    checks.push({ label: "At least one player", ok: players.length > 0, hint: guestHint });
  }
  checks.push({
    label: "At least one evaluator",
    ok: setup.participants.some((p) => p.roles.includes("evaluator")),
    hint: "Add an evaluator to record observations.",
  });
  if (setup.clocks.length > 0) {
    checks.push({ label: "Scenario start set", ok: Boolean(ex.scenarioStartAt), hint: "Set it in Details. Regulatory clocks count from it.", required: true });
  }
  checks.push({ label: "Objectives set", ok: setup.objectives.length > 0, hint: "The report rates each objective." });
  if (setup.objectives.length > 0 && setup.templateInjects.length > 0) {
    checks.push({
      label: "Objectives linked to injects",
      ok: setup.objectives.every((o) => o.templateInjectIds.length > 0),
      hint: "Link each objective to the injects that test it.",
    });
  }
  checks.push({ label: "Injects ready", ok: ex.templateInjectCount > 0 || ex.mode === "document", hint: "The template has no injects." });
  return checks;
}

function StartPanel({ setup, exerciseId, reload, onChanged }: { setup: Setup; exerciseId: string; reload: () => Promise<void>; onChanged: () => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const ex = setup.exercise;
  const checks = readinessChecks(setup);
  const blocked = checks.filter((c) => c.required && !c.ok);

  async function control(action: string, success?: string): Promise<boolean> {
    setBusy(action);
    const r = await api(`/api/exercises/${exerciseId}/control`, { body: { action }, fallback: "That did not work. Try again." });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    if (success) toast.success(success);
    await reload();
    onChanged();
    return true;
  }

  async function start() {
    const ok = await confirm({ title: "Start the exercise?", description: "Setup locks and the first inject goes out.", confirmLabel: "Start" });
    if (ok) await control("start", "STARTEX.");
  }

  async function abandon() {
    const ok = await confirm({ title: "Abandon this exercise?", description: "It cannot be started again.", confirmLabel: "Abandon", destructive: true });
    if (ok && (await control("abandon"))) router.push("/exercises");
  }

  return (
    <Card className="gap-4 xl:sticky xl:top-20">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Start</h2>
        <Badge variant={ex.status === "lobby" ? "accent" : "outline"}>{STATUS_LABELS[ex.status] ?? ex.status}</Badge>
      </div>
      <ul className="space-y-2.5">
        {checks.map((c) => (
          <li key={c.label} className="flex gap-2 text-[13px]">
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--mist-ok)]" />
            ) : (
              <TriangleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", c.required ? "text-[color:var(--mist-danger)]" : "text-[color:var(--mist-warn)]")} />
            )}
            <div>
              <div className="font-medium">{c.label}</div>
              {!c.ok && <div className="text-[12px] text-[color:var(--color-muted-foreground)]">{c.hint}</div>}
            </div>
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        {ex.status === "draft" ? (
          <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => void control("open_lobby", "Lobby open.")}>
            Open lobby
          </Button>
        ) : (
          <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => void control("close_lobby", "Lobby closed.")}>
            Close lobby
          </Button>
        )}
        <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
          {ex.status === "draft" ? "Open the lobby so people can join and wait for the start." : "People can join now."}
        </p>
        <Button variant="accent" className="w-full" disabled={busy !== null || blocked.length > 0} onClick={() => void start()}>
          {busy === "start" && <Loader2 className="h-4 w-4 animate-spin" />}
          Start exercise
        </Button>
        {blocked.length > 0 && <p className="text-[12px] text-[color:var(--mist-danger)]">Fix the items marked red to start.</p>}
      </div>
      <Button variant="ghost" size="sm" className="text-[color:var(--mist-danger)]" disabled={busy !== null} onClick={() => void abandon()}>
        Abandon exercise
      </Button>
    </Card>
  );
}
