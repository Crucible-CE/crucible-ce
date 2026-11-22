"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bell, Loader2, Lock, Moon, Send, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

type Channel = "in_app" | "push" | "email" | "sms";
// "push" stays in the type (the catalog and API carry it) but is not shown:
// mobile push is a Crucible Cloud feature and a no-op in CE (src/lib/push).
const CHANNELS: { key: Channel; label: string }[] = [
  { key: "in_app", label: "In-app" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
];

type Lock = "user_choice" | "force_on" | "force_off";
interface ChannelState { available: boolean; enabled: boolean; lock: Lock }
interface CategoryMatrix {
  code: string; group: string; label: string; description: string; urgency: string;
  channels: Record<Channel, ChannelState>;
}
interface UserSettings {
  timezone: string; quietHoursStart: number | null; quietHoursEnd: number | null;
  dndUntil: string | null; digestCadence: string;
  notificationPhone: string | null; notificationPhoneVerified?: boolean;
  notificationPhoneAllowedUnverified?: boolean; smsConfigured?: boolean;
}

/**
 * Phone ownership check for the saved number: "Send code" texts a 6-digit
 * code, the member types it back. Only a verified number (or one an
 * administrator overrode) is ever texted or called.
 */
function PhoneVerification({ saved, onVerified }: { saved: UserSettings; onVerified: () => void }) {
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);

  if (!saved.notificationPhone) return null;
  if (saved.notificationPhoneVerified) {
    return <span className="mt-1 block text-xs text-[color:var(--mist-ok)]">Verified.</span>;
  }
  if (saved.notificationPhoneAllowedUnverified) {
    return (
      <span className="mt-1 block text-xs text-[color:var(--mist-amber)]">
        Not verified. An administrator allowed SMS/voice to this number.
      </span>
    );
  }
  if (!saved.smsConfigured) {
    return (
      <span className="mt-1 block text-xs text-muted-foreground" data-testid="sms-not-configured">
        SMS is not set up on this server. An administrator can allow SMS/voice to this number.
      </span>
    );
  }

  const send = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/notifications/phone-verification", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) return void toast.error(apiErrorMessage(d, "Couldn't send the code. Try again."));
      if ((d as { alreadyVerified?: boolean } | null)?.alreadyVerified) return void onVerified();
      setCodeSent(true);
      toast.success("Code sent", { description: "It expires in 10 minutes." });
    } finally {
      setSending(false);
    }
  };
  const confirm = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/notifications/phone-verification/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) return void toast.error(apiErrorMessage(d, "Couldn't verify the code. Try again."));
      toast.success("Phone verified");
      setCode("");
      setCodeSent(false);
      onVerified();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-[color:var(--mist-amber)]">Not verified. SMS and voice pages are held until you verify.</span>
      <button type="button" onClick={send} disabled={sending} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs font-medium hover:bg-[color:var(--color-muted)] disabled:opacity-50">
        {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} {codeSent ? "Resend code" : "Send code"}
      </button>
      {codeSent && (
        <>
          <input
            aria-label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="w-24 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1 text-sm tracking-widest"
          />
          <button type="button" onClick={confirm} disabled={checking || code.length !== 6} className="inline-flex items-center gap-1 rounded-md bg-[color:var(--mist-indigo)] px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
            {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Verify
          </button>
        </>
      )}
    </div>
  );
}

const URGENCY_STYLE: Record<string, string> = {
  critical: "bg-[color:var(--mist-danger)]/15 text-[color:var(--mist-danger)]",
  high: "bg-[color:var(--mist-amber)]/15 text-[color:var(--mist-amber)]",
  normal: "bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]",
  low: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
};

function minToTime(m: number | null): string {
  if (m == null) return "";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function timeToMin(t: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export default function NotificationSettingsPage() {
  const [categories, setCategories] = useState<CategoryMatrix[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  // The settings as last saved on the server (verification applies to these).
  const [savedSettings, setSavedSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications/preferences");
    if (res.ok) {
      const d = await res.json();
      setCategories(d.categories);
      setSettings(d.settings);
      setSavedSettings(d.settings);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // After verification: refresh only the phone status, keeping unsaved edits.
  const refreshPhone = async () => {
    const res = await fetch("/api/notifications/preferences");
    if (!res.ok) return;
    const fresh = (await res.json()).settings as UserSettings;
    setSavedSettings(fresh);
    setSettings((cur) => (cur ? { ...cur, notificationPhoneVerified: fresh.notificationPhoneVerified, notificationPhoneAllowedUnverified: fresh.notificationPhoneAllowedUnverified } : cur));
  };

  const toggle = (code: string, ch: Channel) => {
    setCategories((cats) =>
      cats.map((c) => {
        if (c.code !== code) return c;
        const cell = c.channels[ch];
        if (!cell.available || cell.lock !== "user_choice") return c;
        return { ...c, channels: { ...c.channels, [ch]: { ...cell, enabled: !cell.enabled } } };
      }),
    );
    setDirty(true);
  };

  const patchSettings = (patch: Partial<UserSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const prefs = categories.flatMap((c) =>
      CHANNELS.filter(({ key }) => c.channels[key].available && c.channels[key].lock === "user_choice").map(({ key }) => ({
        categoryCode: c.code,
        channel: key,
        enabled: c.channels[key].enabled,
      })),
    );
    const res = await fetch("/api/notifications/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs, settings }),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json();
      setCategories(d.categories);
      setSettings(d.settings);
      setSavedSettings(d.settings);
      setDirty(false);
      toast.success("Notification settings saved");
    } else {
      const d = (await res.json().catch(() => ({}))) as { details?: { fieldErrors?: Record<string, string[]> } };
      const fieldMsg = d.details?.fieldErrors ? Object.values(d.details.fieldErrors).flat()[0] : undefined;
      toast.error(fieldMsg ?? "Couldn't save. Try again.");
    }
  };

  const sendTest = async () => {
    const res = await fetch("/api/notifications/test", { method: "POST" });
    if (res.ok) toast.success("Test sent", { description: "Check your in-app inbox." });
    else toast.error("Couldn't send the test. Try again.");
  };

  if (loading || !settings) {
    return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  const groups = [...new Set(categories.map((c) => c.group))];

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <div>
        <a href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Settings</a>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]"><Bell className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-semibold">Notifications</h1>
            <p className="text-sm text-muted-foreground">Choose channels for each kind of activity.</p>
          </div>
        </div>
      </div>

      {/* Matrix */}
      <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
        <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <div className="flex-1">Activity</div>
          {CHANNELS.map((c) => <div key={c.key} className="w-12 text-center">{c.label}</div>)}
        </div>
        {groups.map((group) => (
          <div key={group}>
            <div className="bg-[color:var(--color-muted)]/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
            {categories.filter((c) => c.group === group).map((c) => (
              <div key={c.code} className="flex items-center gap-2 border-t border-[color:var(--color-border)] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", URGENCY_STYLE[c.urgency])}>{c.urgency}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                </div>
                {CHANNELS.map(({ key }) => {
                  const cell = c.channels[key];
                  return (
                    <div key={key} className="flex w-12 justify-center">
                      {!cell.available ? (
                        <span className="text-muted-foreground/30" title="Not available" aria-label="Not available">-</span>
                      ) : cell.lock !== "user_choice" ? (
                        <span title={cell.lock === "force_on" ? "Required by your organization" : "Turned off by your organization"} className="inline-flex">
                          <Lock className={cn("h-3.5 w-3.5", cell.enabled ? "text-[color:var(--mist-emerald)]" : "text-muted-foreground/50")} />
                        </span>
                      ) : (
                        <button
                          onClick={() => toggle(c.code, key)}
                          role="switch"
                          aria-checked={cell.enabled}
                          className={cn(
                            "h-5 w-9 rounded-full transition-colors",
                            cell.enabled ? "bg-[color:var(--mist-indigo)]" : "bg-[color:var(--color-muted)]",
                          )}
                        >
                          <span className={cn("block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform", cell.enabled && "translate-x-[18px]")} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
        <p className="border-t border-[color:var(--color-border)] px-4 py-2 text-xs text-muted-foreground">
          <Lock className="mr-1 inline h-3 w-3" /> Set by your organization. Email and SMS need admin setup.
        </p>
      </div>

      {/* Quiet hours + digest */}
      <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Moon className="h-4 w-4" /> Quiet hours &amp; delivery</div>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="text-muted-foreground">Quiet from</span>
            <input type="time" value={minToTime(settings.quietHoursStart)} onChange={(e) => patchSettings({ quietHoursStart: timeToMin(e.target.value) })} className="mt-1 block w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Quiet until</span>
            <input type="time" value={minToTime(settings.quietHoursEnd)} onChange={(e) => patchSettings({ quietHoursEnd: timeToMin(e.target.value) })} className="mt-1 block w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">SMS is held during quiet hours, except critical pages.</p>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="text-muted-foreground">Low-priority digest</span>
            <select value={settings.digestCadence} onChange={(e) => patchSettings({ digestCadence: e.target.value })} className="mt-1 block w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm">
              <option value="off">Off (deliver individually)</option>
              <option value="hourly">Hourly summary</option>
              <option value="daily">Daily summary</option>
            </select>
          </label>
          <div className="col-span-2 text-sm">
            <label htmlFor="notification-phone" className="text-muted-foreground">Mobile number for SMS and voice</label>
            <input
              id="notification-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={settings.notificationPhone ?? ""}
              onChange={(e) => patchSettings({ notificationPhone: e.target.value })}
              placeholder="+15551234567"
              className="mt-1 block w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              International format (E.164). Leave empty to remove.
              {(settings.notificationPhone ?? "") !== (savedSettings?.notificationPhone ?? "") ? " Save to verify the new number." : ""}
            </span>
            {savedSettings && (settings.notificationPhone ?? "") === (savedSettings.notificationPhone ?? "") && (
              <PhoneVerification saved={savedSettings} onVerified={() => void refreshPhone()} />
            )}
          </div>
          <label className="text-sm">
            <span className="text-muted-foreground">Timezone</span>
            <input value={settings.timezone} onChange={(e) => patchSettings({ timezone: e.target.value })} placeholder="America/New_York" className="mt-1 block w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
          </label>
        </div>
      </div>

      {/* Test + Save (sticky) */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <button onClick={sendTest} className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] px-3 py-2 text-sm font-medium hover:bg-[color:var(--color-muted)]">
            <Send className="h-4 w-4" /> Send test
          </button>
          <button onClick={save} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--mist-indigo)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>
    </div>
  );
}
