"use client";

// Invite participants: join by code with the link, code and QR code, a
// full-screen view for projecting, the start time, a calendar file and
// email invites (or a mailto link when the server has no SMTP).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, Copy, Loader2, Mail, Monitor, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { LobbySetup } from "@/lib/exercise/lobby";
import { INVITE_NOTE_MAX, MAX_INVITES, inviteMailto, parseInviteEmails } from "@/lib/exercise/invite";
import { formatInZone, zoneLabel } from "@/lib/exercise/time";
import { api } from "./api";
import { QrCode } from "./qr-code";
import { SaveBar, Section, fromZoneInput, toZoneInput, useDraft, type Patch } from "./lobby-parts";

const hint = "text-[12px] text-[color:var(--color-muted-foreground)]";

function copy(text: string, done: string) {
  if (!navigator.clipboard) {
    toast.error("Copy is not available in this browser.");
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error("Copy is not available in this browser."),
  );
}

/** True when a join link points at the host machine (localhost or a loopback address). */
export function isLocalLink(link: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "[::1]" || /^127\./.test(host) || host === "0.0.0.0";
  } catch {
    return false;
  }
}

export function InviteSection({ setup, patch, exerciseId, reload }: { setup: LobbySetup; patch: Patch; exerciseId: string; reload: () => Promise<void> }) {
  const ex = setup.exercise;
  const [rotating, setRotating] = useState(false);
  const [screen, setScreen] = useState(false);
  const closeScreen = useCallback(() => setScreen(false), []);
  const code = ex.guestJoin ? ex.joinCode : null;
  const link = code ? (ex.joinUrl ?? (typeof window !== "undefined" ? `${window.location.origin}/join/${code}` : "")) : "";

  async function rotate() {
    setRotating(true);
    const r = await api<{ code: string }>(`/api/exercises/${exerciseId}/join-code`, { method: "POST", fallback: "The code did not change. Try again." });
    setRotating(false);
    if (!r.ok) toast.error(r.error);
    else {
      toast.success("New code ready. The old one no longer works.");
      await reload();
    }
  }

  return (
    <Section title="Invite participants" description="Share the link or the code. People pick their team when they join.">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="lobby-guest-join">Join by code</Label>
          <p className={hint}>People without an account join as guests. Signed-in people join with their account.</p>
        </div>
        <Switch
          id="lobby-guest-join"
          checked={ex.guestJoin}
          onCheckedChange={(on) => void patch({ guestJoin: on }, on ? "Join by code is on." : "Join by code is off.")}
        />
      </div>

      {code && isLocalLink(link) && (
        <p role="status" className="rounded-md border border-[color:var(--mist-warn)] px-3 py-2 text-[12.5px]">
          These links point to this computer, so others cannot open them. Set PUBLIC_URL to the address participants use and restart.
        </p>
      )}

      {code && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 space-y-3">
            <code data-testid="join-code" className="block font-mono text-4xl font-semibold tracking-[0.25em]">
              {code}
            </code>
            <p data-testid="join-link" className="break-all font-mono text-[12.5px] text-[color:var(--color-muted-foreground)]">
              {link}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => copy(link, "Link copied.")}>
                <Copy className="h-4 w-4" />
                Copy link
              </Button>
              <Button size="sm" variant="outline" onClick={() => copy(code, "Code copied.")}>
                <Copy className="h-4 w-4" />
                Copy code
              </Button>
              <Button size="sm" variant="outline" onClick={() => setScreen(true)}>
                <Monitor className="h-4 w-4" />
                Show on screen
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void rotate()} disabled={rotating}>
                <RefreshCw className={cn("h-4 w-4", rotating && "animate-spin")} />
                New code
              </Button>
            </div>
            {ex.joinCodeLocked && (
              <p role="alert" className="text-[12.5px] text-[color:var(--mist-danger)]">
                Too many failed joins locked this code. Make a new one.
              </p>
            )}
            {ex.status === "draft" && <p className="text-[12.5px] text-[color:var(--mist-warn)]">The code works once the lobby is open.</p>}
          </div>
          <div className="shrink-0 self-center rounded-md border border-[color:var(--color-border)] bg-white p-2 sm:self-start">
            <QrCode value={link} size={148} label="QR code of the join link" />
          </div>
        </div>
      )}

      <StartTime setup={setup} patch={patch} />
      <CalendarInvite setup={setup} exerciseId={exerciseId} />
      {code && <EmailInvites setup={setup} exerciseId={exerciseId} link={link} code={code} />}
      {screen && code && <JoinScreen title={ex.title} code={code} link={link} onClose={closeScreen} />}
    </Section>
  );
}

function StartTime({ setup, patch }: { setup: LobbySetup; patch: Patch }) {
  const source = useMemo(() => toZoneInput(setup.plan.startsAt, setup.timezone), [setup.plan.startsAt, setup.timezone]);
  const [value, setValue, dirty, reset] = useDraft(source);
  const [busy, setBusy] = useState(false);
  const zone = zoneLabel(new Date(), setup.timezone);

  async function save() {
    setBusy(true);
    const ok = await patch({ plan: { startsAt: value ? fromZoneInput(value, setup.timezone) : null } });
    setBusy(false);
    if (ok) reset();
  }

  return (
    <div className="space-y-2 border-t border-[color:var(--color-border)] pt-4">
      <Label htmlFor="invite-starts-at">Start time, {zone}</Label>
      <Input id="invite-starts-at" type="datetime-local" className="sm:w-72" value={value} onChange={(e) => setValue(e.target.value)} />
      <p className={hint}>
        {!setup.plan.startsAt && setup.invite.startAt ? "Empty uses the scenario start." : "Invites and the calendar file use this time."}
      </p>
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={reset} />
    </div>
  );
}

function CalendarInvite({ setup, exerciseId }: { setup: LobbySetup; exerciseId: string }) {
  const ready = Boolean(setup.invite.startAt);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {ready ? (
        <Button asChild size="sm" variant="outline">
          <a href={`/api/exercises/${exerciseId}/invite.ics`} download>
            <CalendarPlus className="h-4 w-4" />
            Download calendar invite
          </a>
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled>
          <CalendarPlus className="h-4 w-4" />
          Download calendar invite
        </Button>
      )}
      {!ready && <p className={hint}>Set a start time first.</p>}
    </div>
  );
}

function EmailInvites({ setup, exerciseId, link, code }: { setup: LobbySetup; exerciseId: string; link: string; code: string }) {
  const [emails, setEmails] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = setup.invite.emailEnabled;
  const parsed = emails.trim() ? parseInviteEmails(emails) : null;
  const startLabel = setup.invite.startAt ? formatInZone(new Date(setup.invite.startAt), setup.timezone) : null;
  const text = { title: setup.exercise.title, startLabel, joinUrl: link, code, note };

  async function send() {
    const p = parseInviteEmails(emails);
    if (!p.ok) return setError(p.error);
    setError(null);
    setBusy(true);
    const r = await api<{ sent: number; failed: number }>(`/api/exercises/${exerciseId}/invites`, {
      body: { emails, ...(note.trim() ? { note: note.trim() } : {}) },
      fallback: "The invites were not sent. Try again.",
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (r.data.failed > 0) toast.error(`${r.data.sent} sent. ${r.data.failed} could not be sent.`);
    else toast.success(r.data.sent === 1 ? "1 invite sent." : `${r.data.sent} invites sent.`);
    if (r.data.sent > 0) {
      setEmails("");
      setNote("");
    }
  }

  return (
    <div className="space-y-3 border-t border-[color:var(--color-border)] pt-4">
      <div className="space-y-2">
        <Label htmlFor="invite-emails">Email invites</Label>
        <Textarea
          id="invite-emails"
          rows={3}
          value={emails}
          placeholder="name@example.com, one per line or separated by commas"
          onChange={(e) => {
            setEmails(e.target.value);
            setError(null);
          }}
        />
        <p className={hint}>Up to {MAX_INVITES} addresses. Addresses are not stored.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-note">Note</Label>
        <Textarea id="invite-note" rows={2} maxLength={INVITE_NOTE_MAX} value={note} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-[color:var(--mist-danger)]">
          {error}
        </p>
      )}
      {enabled ? (
        <Button size="sm" onClick={() => void send()} disabled={busy || !emails.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send invites
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12.5px] text-[color:var(--mist-warn)]">Email is not set up on this server.</p>
          <Button asChild size="sm" variant="outline">
            <a href={inviteMailto(parsed?.ok ? parsed.emails : [], text)}>
              <Mail className="h-4 w-4" />
              Open in email app
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

/** Full-screen join view for projecting: big code, the link and the QR code. */
function JoinScreen({ title, code, link, onClose }: { title: string; code: string; link: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    // Fullscreen is a bonus: the overlay already covers the page.
    void el?.requestFullscreen?.().catch(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onFs = () => {
      if (!document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Join screen"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 overflow-auto bg-white p-8 text-black outline-none"
    >
      <Button variant="outline" size="sm" className="absolute right-4 top-4" onClick={onClose}>
        <X className="h-4 w-4" />
        Close
      </Button>
      <h2 className="text-center text-3xl font-semibold">{title}</h2>
      <QrCode value={link} size={320} label="QR code of the join link" />
      <p className="text-center text-xl">Join at</p>
      <p className="break-all text-center font-mono text-2xl">{link}</p>
      <p className="text-center text-xl">Code</p>
      <p className="font-mono text-7xl font-semibold tracking-[0.25em]">{code}</p>
    </div>
  );
}
