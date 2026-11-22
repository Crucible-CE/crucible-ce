"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FileArchive, Loader2, ShieldCheck, Lock, Download, Copy, Check, AlertTriangle, KeyRound, FileText } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

type Mode = "legal" | "regulator" | "internal";

interface ExportRow {
  id: string; mode: Mode; status: string; packageHash: string | null; ledgerHead: string | null;
  sizeBytes: number | null; requestedByName: string | null; error: string | null;
  createdAt: string; completedAt: string | null;
}

const MODES: { key: Mode; label: string; blurb: string }[] = [
  { key: "legal", label: "Legal hold / counsel", blurb: "For outside counsel or a legal hold." },
  { key: "regulator", label: "Regulatory submission", blurb: "For a regulator or other authority." },
  { key: "internal", label: "Internal record", blurb: "For your own records." },
];

function fmtBytes(n: number | null): string {
  if (!n) return "size unknown";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "date unknown";
  return new Date(iso).toLocaleString();
}

export default function CaseFilePage() {
  const { id: incidentId } = useParams<{ id: string }>();
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [signingConfigured, setSigningConfigured] = useState(true);
  const [mode, setMode] = useState<Mode>("legal");
  const [generating, setGenerating] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; passphrase: string; hash: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [zipFor, setZipFor] = useState<string | null>(null);
  const [zipPass, setZipPass] = useState("");
  const [zipBusy, setZipBusy] = useState(false);

  // Decrypted .zip: the server decrypts with the passphrase sent in a header
  // (never a query string, so it stays out of logs and history), and we save
  // the bytes via a blob URL.
  const downloadZip = async (exportId: string, passphrase: string) => {
    if (!passphrase.trim()) { toast.error("Enter the passphrase."); return; }
    setZipBusy(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/export/${exportId}/download?format=zip`, {
        headers: { "x-export-passphrase": passphrase.trim() },
        cache: "no-store",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast.error(apiErrorMessage(d, "Couldn't decrypt the package. Check the passphrase."));
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `casefile-${exportId.slice(0, 8)}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setZipFor(null);
      setZipPass("");
    } catch {
      toast.error("Couldn't decrypt the package. Check the passphrase.");
    } finally {
      setZipBusy(false);
    }
  };

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/export`);
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    if (res.ok) {
      const d = await res.json();
      setRows(d.exports ?? []);
      setSigningConfigured(d.signingConfigured !== false);
    }
    setLoading(false);
  }, [incidentId]);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    setReveal(null);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) throw new Error(apiErrorMessage(d, "Couldn't generate the case file. Try again."));
      setReveal({ id: d.id, passphrase: d.passphrase, hash: d.packageHash });
      toast.success("Case file sealed", { description: d.ledgerValid ? "Ledger verified." : "Ledger verification failed." });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate the case file. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const copyPass = () => {
    if (!reveal) return;
    void navigator.clipboard.writeText(reveal.passphrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return <div className="flex items-center gap-2 p-8 text-sm text-[color:var(--color-muted-foreground)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  if (forbidden) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-[color:var(--color-muted-foreground)]" />
        <h2 className="mt-3 text-base font-semibold">Restricted</h2>
        <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">You need the <span className="font-mono">incidents.export</span> permission (Org admin).</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]">
          <FileArchive className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Case file</h1>
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
            Export the incident as a signed, encrypted, tamper-evident package.
          </p>
        </div>
      </header>

      {!signingConfigured && (
        <div className="flex items-start gap-2 rounded-lg border border-[color:var(--mist-amber)]/40 bg-[color:var(--mist-amber)]/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-[color:var(--mist-amber)]" />
          <span>No signing key. Set <span className="font-mono">EXPORT_SIGNING_PRIVATE_KEY</span> to enable exports.</span>
        </div>
      )}

      {/* Generate */}
      <section className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5">
        <h2 className="text-sm font-semibold">New case file</h2>
        <div className="mt-3 space-y-2">
          {MODES.map((m) => (
            <label key={m.key} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${mode === m.key ? "border-[color:var(--mist-indigo)] bg-[color:var(--mist-indigo)]/5" : "border-[color:var(--color-border)] hover:border-[color:var(--color-muted-foreground)]/40"}`}>
              <input type="radio" name="mode" checked={mode === m.key} onChange={() => setMode(m.key)} className="mt-0.5" />
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-xs text-[color:var(--color-muted-foreground)]">{m.blurb}</div>
              </div>
            </label>
          ))}
        </div>
        <button
          onClick={generate}
          disabled={generating || !signingConfigured}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-[color:var(--mist-indigo)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {generating ? "Sealing…" : "Generate & seal"}
        </button>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--color-muted-foreground)]">
          <Lock className="h-3 w-3" /> Encrypted with a one-time passphrase and signed so changes are detectable.
        </p>
      </section>

      {/* One-time reveal */}
      {reveal && (
        <section className="rounded-lg border border-[color:var(--mist-indigo)] bg-[color:var(--mist-indigo)]/5 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--mist-indigo)]">
            <KeyRound className="h-4 w-4" /> Decryption passphrase (shown once)
          </div>
          <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
            Save it now. It isn&apos;t stored and can&apos;t be recovered.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-2 font-mono text-sm tracking-wider">{reveal.passphrase}</code>
            <button onClick={copyPass} className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] px-3 py-2 text-sm">
              {copied ? <Check className="h-4 w-4 text-[color:var(--mist-emerald)]" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/api/incidents/${incidentId}/export/${reveal.id}/download`} className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-foreground)] px-3 py-2 text-sm font-medium text-[color:var(--color-background)]">
              <Download className="h-4 w-4" /> Download encrypted package (.cxz)
            </a>
            <button
              type="button"
              onClick={() => void downloadZip(reveal.id, reveal.passphrase)}
              disabled={zipBusy}
              className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {zipBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download decrypted .zip
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)]">
            Send the .cxz and the passphrase separately. To verify, run <code className="font-mono">npm run verify-export</code> or follow VERIFY.md in the package.
          </p>
          <p className="mt-2 break-all text-[10px] text-[color:var(--color-muted-foreground)]">Package SHA-256: <span className="font-mono">{reveal.hash}</span></p>
        </section>
      )}

      {/* History */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Export history</h2>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[color:var(--color-border)] p-6 text-center text-sm text-[color:var(--color-muted-foreground)]">
            No case files.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3">
                <FileText className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {MODES.find((m) => m.key === r.mode)?.label ?? r.mode}
                    <StatusPill status={r.status} />
                  </div>
                  <div className="truncate text-xs text-[color:var(--color-muted-foreground)]">
                    {fmtDate(r.completedAt ?? r.createdAt)} · {r.requestedByName ?? "Unknown"} · {fmtBytes(r.sizeBytes)}
                    {r.error ? ` · ${r.error}` : ""}
                  </div>
                </div>
                {r.status === "ready" && zipFor === r.id && (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => { e.preventDefault(); void downloadZip(r.id, zipPass); }}
                  >
                    <input
                      type="password"
                      autoFocus
                      autoComplete="off"
                      value={zipPass}
                      onChange={(e) => setZipPass(e.target.value)}
                      placeholder="Passphrase"
                      aria-label="Export passphrase"
                      className="h-7 w-44 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 font-mono text-xs"
                    />
                    <button type="submit" disabled={zipBusy || !zipPass.trim()} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1.5 text-xs font-medium disabled:opacity-50">
                      {zipBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} .zip
                    </button>
                    <button type="button" onClick={() => { setZipFor(null); setZipPass(""); }} className="px-1 text-xs text-[color:var(--color-muted-foreground)]">Cancel</button>
                  </form>
                )}
                {r.status === "ready" && zipFor !== r.id && (
                  <div className="flex items-center gap-1.5">
                    <a href={`/api/incidents/${incidentId}/export/${r.id}/download`} className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[color:var(--color-muted)]">
                      <Download className="h-3.5 w-3.5" /> .cxz
                    </a>
                    <button
                      type="button"
                      onClick={() => { setZipFor(r.id); setZipPass(""); }}
                      title="Download decrypted .zip (needs passphrase)"
                      aria-label="Download decrypted .zip"
                      className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[color:var(--color-muted)]"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> .zip
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready: "bg-[color:var(--mist-emerald)]/15 text-[color:var(--mist-emerald)]",
    running: "bg-[color:var(--mist-amber)]/15 text-[color:var(--mist-amber)]",
    failed: "bg-[color:var(--mist-danger)]/15 text-[color:var(--mist-danger)]",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[status] ?? "bg-[color:var(--color-muted)]"}`}>{status}</span>;
}
