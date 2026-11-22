"use client";

// "Onboarding" checklist: two tracks (Organization setup for administrators,
// Your setup for everyone), each a progress bar and a list of step cards with
// a call to action. Completion comes from the server (derived from real data);
// the only writes here are the in-place actions: send a test page, start or
// reset the training incident, start the practice sim, skip / un-skip an
// optional step, and bring the Ops Room card back.

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck,
  Bell,
  BellRing,
  BookOpen,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  GraduationCap,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  Play,
  RadioTower,
  RotateCcw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Swords,
  Timer,
  UserCog,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { StepAction, StepView, TrackView } from "@/lib/onboarding/steps";

const ICONS: Record<string, LucideIcon> = {
  BadgeCheck,
  Bell,
  BellRing,
  BookOpen,
  Building2,
  CalendarClock,
  GraduationCap,
  KeyRound,
  Swords,
  Mail,
  Phone,
  RadioTower,
  Send,
  ShieldCheck,
  Smartphone,
  Timer,
  UserCog,
  UserPlus,
};

type Tab = "org" | "you";

const ACTION_ICONS: Record<StepAction, LucideIcon> = { test_page: Send, training_incident: Play, training_reset: RotateCcw, practice_sim: Play };

const SIGNING_COMMANDS = `openssl genpkey -algorithm ed25519 -out export-signing.pem
base64 < export-signing.pem | tr -d '\\n'   # value for EXPORT_SIGNING_PRIVATE_KEY`;

async function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

function Progress({ track }: { track: TrackView }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-[color:var(--color-card)] p-4 shadow-[var(--elevation-1)]">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="font-semibold tabular-nums" data-testid={`progress-${track.key}`}>
          {track.done}
          <span className="text-[color:var(--color-muted-foreground)]">/{track.total} complete</span>
        </span>
        <span className="tabular-nums text-[color:var(--color-muted-foreground)]">{track.pct}%</span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-muted)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={track.pct}
        aria-label={track.key === "org" ? "Organization setup progress" : "Your setup progress"}
      >
        <div className="h-full rounded-full bg-[color:var(--mist-indigo)] transition-all" style={{ width: `${track.pct}%` }} />
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "indigo" | "muted" | "ok"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone === "indigo" && "bg-[color:var(--mist-indigo)]/12 text-[color:var(--mist-indigo)]",
        tone === "muted" && "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
        tone === "ok" && "bg-[color:var(--mist-ok)]/15 text-[color:var(--mist-ok)]",
      )}
    >
      {children}
    </span>
  );
}

function ActionIcon({ action }: { action: StepAction }) {
  const Icon = ACTION_ICONS[action] ?? Send;
  return <Icon className="h-3.5 w-3.5" />;
}

function StepCard({
  step,
  index,
  busy,
  onAction,
  onSkip,
}: {
  step: StepView;
  index: number;
  busy: string | null;
  onAction: (step: StepView) => void;
  onSkip: (step: StepView, skip: boolean) => void;
}) {
  const Icon = ICONS[step.icon] ?? Sparkles;
  const done = step.status === "complete";
  const skipped = step.status === "skipped";
  const unavailable = step.status === "unavailable";
  const resolved = done || skipped || unavailable;
  const isBusy = busy === step.key;
  const primaryClass = cn(
    "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-[12.5px] font-semibold",
    resolved
      ? "bg-[color:var(--color-muted)] text-[color:var(--color-foreground)] hover:bg-[color:var(--mist-paper-2)]"
      : "bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)] hover:bg-[color:var(--mist-navy-hi)]",
  );

  return (
    <li
      id={step.key}
      data-testid={`step-${step.key}`}
      data-status={step.status}
      className={cn("scroll-mt-24 rounded-[var(--radius-lg)] bg-[color:var(--color-card)] p-4 shadow-[var(--elevation-1)]", resolved && "opacity-80")}
    >
      <div className="flex items-start gap-3.5">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)]",
            done
              ? "bg-[color:var(--mist-ok)]/15 text-[color:var(--mist-ok)]"
              : resolved
                ? "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]"
                : "bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]",
          )}
        >
          {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10.5px] font-semibold tabular-nums text-[color:var(--color-muted-foreground)]">{index + 1}</span>
            <h3 className={cn("text-[14px] font-semibold", done && "text-[color:var(--color-muted-foreground)]")}>{step.label}</h3>
            {done && <Badge tone="ok">Done</Badge>}
            {step.optional && !done && <Badge tone="muted">{skipped ? "Skipped" : "Optional"}</Badge>}
            {unavailable && <Badge tone="muted">Not available</Badge>}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[color:var(--color-muted-foreground)]">{step.description}</p>
          {step.detail && (
            <p className="mt-1.5 text-[12px] font-medium text-[color:var(--color-foreground)]/80" data-testid={`detail-${step.key}`}>
              {step.detail}
            </p>
          )}

          {step.key === "signing_key" && !done && (
            <pre className="mt-3 max-w-full overflow-x-auto rounded-[var(--radius-md)] bg-[color:var(--color-muted)] p-3 font-mono text-[11.5px] leading-relaxed">
              {SIGNING_COMMANDS}
            </pre>
          )}
          {step.key === "signing_key" && !done && (
            <p className="mt-1.5 text-[11.5px] text-[color:var(--color-muted-foreground)]">
              Set <code className="font-mono">EXPORT_SIGNING_PRIVATE_KEY</code> to the output and restart. See{" "}
              <code className="font-mono">docs/case-file-exports.md</code>.
            </p>
          )}

          {!unavailable && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {step.cta?.href && (
                <Link href={step.cta.href} className={primaryClass}>
                  {done ? "Review" : step.cta.label}
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              )}
              {step.cta?.action && (
                <button type="button" onClick={() => onAction(step)} disabled={isBusy} className={cn(primaryClass, isBusy && "opacity-60")}>
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ActionIcon action={step.cta.action} />}
                  {done && step.cta.action === "test_page" ? "Send another" : step.cta.label}
                </button>
              )}
              {step.secondary && (!done || step.secondary.action === "training_reset") && (
                <button
                  type="button"
                  onClick={() => onAction({ ...step, cta: { label: step.secondary!.label, action: step.secondary!.action } })}
                  disabled={isBusy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--color-card)] px-3 text-[12.5px] font-semibold shadow-[var(--elevation-0)] hover:bg-[color:var(--color-muted)] disabled:opacity-60"
                >
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ActionIcon action={step.secondary.action} />}
                  {step.secondary.label}
                </button>
              )}
              {step.optional && !done && (
                <button
                  type="button"
                  onClick={() => onSkip(step, !skipped)}
                  disabled={isBusy}
                  className="text-[12px] font-medium text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
                >
                  {skipped ? "Undo skip" : "Skip"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function Track({
  track,
  title,
  intro,
  busy,
  onAction,
  onSkip,
}: {
  track: TrackView;
  title: string;
  intro: string;
  busy: string | null;
  onAction: (step: StepView) => void;
  onSkip: (step: StepView, skip: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="headline">{title}</h2>
        <p className="max-w-2xl text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]">{intro}</p>
      </div>
      <Progress track={track} />
      <ol className="space-y-3">
        {track.steps.map((s, i) => (
          <StepCard key={s.key} step={s} index={i} busy={busy} onAction={onAction} onSkip={onSkip} />
        ))}
      </ol>
      {track.complete && (
        <div className="rounded-[var(--radius-lg)] border border-[color:var(--mist-ok)]/30 bg-[color:var(--mist-ok)]/10 p-4 text-[13px]" data-testid={`complete-${track.key}`}>
          <span className="font-semibold">All steps done.</span>
        </div>
      )}
    </div>
  );
}

export function OnboardingTracks({
  org,
  user,
  initialTab,
  cardHidden,
}: {
  org: TrackView | null;
  user: TrackView;
  initialTab: Tab;
  cardHidden: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>(org ? initialTab : "you");
  const [busy, setBusy] = useState<string | null>(null);

  const onAction = useCallback(
    async (step: StepView) => {
      const action = step.cta?.action;
      if (action === "training_incident" || action === "practice_sim") {
        setBusy(step.key);
        try {
          const res = await postJson(action === "training_incident" ? "/api/onboarding/training/provision" : "/api/onboarding/practice-sim");
          const d = (await res.json().catch(() => null)) as { error?: string; incidentId?: string; exerciseId?: string } | null;
          if (!res.ok) {
            toast.error(d?.error ?? "That did not start. Try again.");
            return;
          }
          router.push(action === "training_incident" ? `/incidents/${d?.incidentId}` : `/exercises/${d?.exerciseId}`);
        } finally {
          setBusy(null);
        }
        return;
      }
      if (action === "training_reset") {
        const ok = await confirm({ title: "Reset the training incident?", description: "Your work in it is deleted.", confirmLabel: "Reset", destructive: true });
        if (!ok) return;
        setBusy(step.key);
        try {
          const res = await postJson("/api/onboarding/training/reset");
          if (res.ok) toast.success("Training incident reset");
          else toast.error("The reset did not go through. Try again.");
          router.refresh();
        } finally {
          setBusy(null);
        }
        return;
      }
      if (action !== "test_page") return;
      setBusy(step.key);
      try {
        const res = await postJson("/api/onboarding/test-page");
        const d = (await res.json().catch(() => null)) as {
          error?: string;
          testPage?: { channels: { channel: string; status: string; error?: string | null }[] };
        } | null;
        if (!res.ok) {
          toast.error(d?.error ?? "Couldn't send the test page. Try again.");
          return;
        }
        const sent = (d?.testPage?.channels ?? []).filter((c) => c.status === "sent").map((c) => c.channel);
        toast.success("Test page sent", {
          description: sent.length
            ? `Sent by ${sent.join(" and ")}. Acknowledge it from the link or the Ops Room.`
            : "Not sent by email or SMS. Acknowledge it in the Ops Room.",
        });
        router.refresh();
      } finally {
        setBusy(null);
      }
    },
    [router, confirm],
  );

  const onSkip = useCallback(
    async (step: StepView, skip: boolean) => {
      setBusy(step.key);
      try {
        const res = await postJson("/api/onboarding/state", { action: skip ? "skip" : "unskip", step: step.key });
        if (!res.ok) toast.error("Couldn't update the step. Try again.");
        router.refresh();
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const showCard = async () => {
    await postJson("/api/onboarding/state", { action: "show_card" });
    router.refresh();
  };

  const TabButton = ({ id, label, t }: { id: Tab; label: string; t: TrackView }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] font-semibold transition-colors",
        tab === id ? "bg-[color:var(--mist-indigo)] text-white" : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]",
      )}
    >
      {label}
      <span className={cn("text-[11px] font-normal tabular-nums", tab === id ? "text-white/80" : "")}>
        {t.done}/{t.total}
      </span>
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {org ? (
          <div className="inline-flex gap-1 rounded-[var(--radius-lg)] bg-[color:var(--color-card)] p-1 shadow-[var(--elevation-1)]">
            <TabButton id="org" label="Organization setup" t={org} />
            <TabButton id="you" label="Your setup" t={user} />
          </div>
        ) : (
          <span />
        )}
        {cardHidden && (
          <button
            type="button"
            onClick={() => void showCard()}
            className="text-[12px] font-medium text-[color:var(--mist-indigo)] hover:underline"
          >
            Show the Onboarding card in the Ops Room
          </button>
        )}
      </div>

      {tab === "org" && org ? (
        <Track
          track={org}
          title="Organization setup"
          intro="Set up paging for your organization."
          busy={busy}
          onAction={(s) => void onAction(s)}
          onSkip={(s, k) => void onSkip(s, k)}
        />
      ) : (
        <Track
          track={user}
          title="Your setup"
          intro="Set up how pages reach you, then practice."
          busy={busy}
          onAction={(s) => void onAction(s)}
          onSkip={(s, k) => void onSkip(s, k)}
        />
      )}
    </div>
  );
}
