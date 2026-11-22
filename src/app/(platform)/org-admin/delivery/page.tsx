"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, Loader2, Lock, CheckCircle2, CircleDashed, Plug, AlertTriangle, RadioTower } from "lucide-react";
import { toast } from "sonner";

interface ProviderRow {
  id: string;
  displayName: string;
  channels: string[];
  source: "builtin" | "plugin";
  configured: boolean;
  notConfiguredReason?: string | null;
  file: string | null;
  carriesPages: boolean;
}

interface DeliveryInfo {
  providers: ProviderRow[];
  pluginErrors: { file: string; error: string }[];
  pluginsDir: string;
  settings: {
    activeEmailTransport: string | null;
    retryBackoffMinutes: number[];
    recipientHourlyLimit: number;
    orgHourlyLimit: number;
    numberCeilingHourlyLimit: number;
    twilioCallbacks: boolean;
    inboundSmsAck: boolean;
    webhookAllowPrivate: boolean;
  };
  me: { name: string | null; email: string | null; phone: string | null };
}

const card = "rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]";

export default function DeliverySettingsPage() {
  const [info, setInfo] = useState<DeliveryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/delivery");
    if (res.status === 403) setForbidden(true);
    else if (res.ok) setInfo(await res.json());
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const sendTest = async (p: ProviderRow) => {
    setTesting(p.id);
    try {
      const res = await fetch("/api/admin/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: p.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't send the test. Try again.");
        return;
      }
      const r = data.result as { status: string; error?: string; providerRef?: string };
      if (r.status === "sent") toast.success(`${p.displayName}: sent${r.providerRef ? ` (${r.providerRef})` : ""}`);
      else if (r.status === "skipped") toast.warning(`${p.displayName}: skipped${r.error ? `, ${r.error}` : ""}`);
      else toast.error(`${p.displayName}: failed${r.error ? `, ${r.error}` : ""}`);
    } finally {
      setTesting(null);
    }
  };

  if (loading) return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (forbidden || !info) {
    return (
      <div className={`mx-auto max-w-lg p-8 text-center ${card}`}>
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-3 text-base font-semibold">Restricted</h2>
        <p className="mt-1 text-sm text-muted-foreground">Requires the <span className="font-mono">admin.access</span> permission.</p>
      </div>
    );
  }

  const s = info.settings;
  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]"><RadioTower className="h-5 w-5" /></div>
        <div>
          <h1 className="text-lg font-semibold">Delivery settings</h1>
          <p className="text-sm text-muted-foreground">
            Channels that carry pages. Set providers with environment variables or plugins (docs/delivery-providers.md).
          </p>
        </div>
      </div>

      <div className={`overflow-x-auto ${card}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2">Provider</th>
              <th className="px-3 py-2">Channels</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Test</th>
            </tr>
          </thead>
          <tbody>
            {info.providers.map((p) => (
              <tr key={p.id} className="border-b border-[color:var(--color-border)] last:border-0">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5 font-medium">
                    {p.source === "plugin" && <Plug className="h-3.5 w-3.5 text-[color:var(--mist-indigo)]" aria-label="Plugin" />}
                    {p.displayName}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {p.id}
                    {p.file ? ` · ${p.file}` : ""}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-[12px]">{p.channels.join(", ")}</td>
                <td className="px-3 py-2.5 text-[12px]">
                  {p.configured ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Configured
                      {!p.carriesPages && <span className="text-muted-foreground"> (standby)</span>}
                    </span>
                  ) : (
                    <span className="inline-flex flex-col gap-0.5">
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleDashed className="h-3.5 w-3.5" /> Not configured</span>
                      {p.notConfiguredReason && (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">{p.notConfiguredReason}</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => void sendTest(p)}
                    disabled={!p.configured || testing !== null}
                    title={p.configured ? "Send a test to yourself" : "Set up this provider first"}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
                  >
                    {testing === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Send test
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Tests go to you: {info.me.email ?? "no email"} · {info.me.phone ?? "no phone (set a notification phone or link yourself to an escalation matrix contact)"}.
      </p>

      {info.pluginErrors.length > 0 && (
        <div className={`p-4 ${card}`}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-600 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> Plugins that didn&apos;t load</div>
          <ul className="space-y-1 text-[12px]">
            {info.pluginErrors.map((e) => (
              <li key={e.file}><span className="font-mono">{e.file}</span>: {e.error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={`grid gap-x-6 gap-y-2 p-4 text-[12px] sm:grid-cols-2 ${card}`}>
        <div><span className="text-muted-foreground">Email carried by:</span> {s.activeEmailTransport ?? "none (set SMTP_HOST or RESEND_API_KEY)"}</div>
        <div><span className="text-muted-foreground">Retries after failure:</span> {s.retryBackoffMinutes.length ? s.retryBackoffMinutes.map((m) => `${m}m`).join(", ") : "off"}</div>
        <div><span className="text-muted-foreground">SMS / voice per number per hour (each):</span> {s.recipientHourlyLimit}, max {s.numberCeilingHourlyLimit} (escalations and critical pages exempt)</div>
        <div><span className="text-muted-foreground">SMS / voice per org per hour (each):</span> {s.orgHourlyLimit}</div>
        <div><span className="text-muted-foreground">Twilio callbacks + press-1 ack:</span> {s.twilioCallbacks ? "on (https PUBLIC_URL)" : "off (needs https PUBLIC_URL)"}</div>
        <div><span className="text-muted-foreground">Reply-ACK by SMS:</span> {s.inboundSmsAck ? "on" : "off (TWILIO_INBOUND_ACK)"}</div>
        <div className="sm:col-span-2"><span className="text-muted-foreground">Plugins directory:</span> <span className="font-mono">{info.pluginsDir}</span></div>
        {s.webhookAllowPrivate && (
          <div className="sm:col-span-2 text-amber-600 dark:text-amber-400">DELIVERY_WEBHOOK_ALLOW_PRIVATE is on. Webhooks can reach private addresses. Use for local testing only.</div>
        )}
      </div>
    </div>
  );
}
