"use client";

// The guest view of one incident: summary, chat and evidence. Guests are not
// on the socket, so chat polls every 5 seconds for the newer messages only.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface Summary {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  category: string | null;
  declaredAt: string | null;
  createdAt: string;
}
interface Message { id: string; userId: string; userName: string; message: string; createdAt: string }
interface Evidence { id: string; filename: string; sizeBytes: number; sha256: string; uploadedByName: string | null; createdAt: string }
interface GuestInfo { displayName: string; principalId: string; canUpload: boolean; expiresAt: string }

const POLL_MS = 5_000;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function GuestRoom({ token }: { token: string }) {
  const base = `/api/public/incident-guest/${token}`;
  const [incident, setIncident] = useState<Summary | null>(null);
  const [guest, setGuest] = useState<GuestInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [invalid, setInvalid] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const cursor = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadMain = useCallback(
    async (delta: boolean) => {
      const after = delta ? cursor.current : null;
      try {
        const res = await fetch(after ? `${base}?after=${encodeURIComponent(after)}` : base, { cache: "no-store" });
        if (res.status === 401) {
          setInvalid(true);
          return;
        }
        if (!res.ok) return;
        const d = await res.json();
        setIncident(d.incident);
        setGuest(d.guest);
        if (d.nextCursor) cursor.current = d.nextCursor;
        const rows: Message[] = d.messages ?? [];
        if (after) {
          if (rows.length) setMessages((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]);
        } else setMessages(rows);
      } catch {
        // transient; the next poll retries
      }
    },
    [base],
  );

  const loadEvidence = useCallback(async () => {
    try {
      const res = await fetch(`${base}/evidence`, { cache: "no-store" });
      if (res.ok) setEvidence((await res.json()).evidence ?? []);
    } catch {
      // transient
    }
  }, [base]);

  useEffect(() => {
    void loadMain(false);
    void loadEvidence();
    const t = setInterval(() => void loadMain(true), POLL_MS);
    return () => clearInterval(t);
  }, [loadMain, loadEvidence]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${base}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      if (res.status === 401) return setInvalid(true);
      if (!res.ok) {
        toast.error("Couldn't send. Try again.");
        return;
      }
      const msg: Message = await res.json();
      setDraft("");
      setMessages((prev) => (prev.some((p) => p.id === msg.id) ? prev : [...prev, msg]));
      cursor.current = msg.id;
    } finally {
      setSending(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${base}/evidence`, { method: "POST", body: form });
      if (res.status === 401) return setInvalid(true);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(typeof d.error === "string" ? d.error : "Couldn't upload. Try again.");
        return;
      }
      toast.success("File uploaded");
      void loadEvidence();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (invalid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[color:var(--color-background)] p-6">
        <div className="max-w-md rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[color:var(--mist-danger)]" aria-hidden />
          <h1 className="mb-2 text-lg font-semibold">This link is not valid</h1>
          <p className="text-sm text-[color:var(--color-muted-foreground)]">Ask your contact for a new link.</p>
        </div>
      </main>
    );
  }

  if (!incident || !guest) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" aria-label="Loading" />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-4 px-4 py-6">
      <header className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]">Guest access</p>
        <h1 className="mt-1 text-xl font-semibold" data-testid="guest-incident-title">{incident.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
          <span className="rounded border border-[color:var(--color-border)] px-2 py-0.5 capitalize">Severity: {incident.severity}</span>
          <span className="rounded border border-[color:var(--color-border)] px-2 py-0.5 capitalize">Status: {incident.status}</span>
          {incident.category && <span className="rounded border border-[color:var(--color-border)] px-2 py-0.5">{incident.category.replace(/_/g, " ")}</span>}
        </div>
        {incident.description && <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]">{incident.description}</p>}
        <p className="mt-3 text-[12px] text-[color:var(--color-muted-foreground)]">
          You are {guest.displayName}. This link works until {fmtTime(guest.expiresAt)}.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="flex h-[60vh] flex-col rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
          <h2 className="border-b border-[color:var(--color-border)] px-4 py-2.5 text-sm font-semibold">Chat</h2>
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <p className="text-center text-[13px] text-[color:var(--color-muted-foreground)]">No messages yet.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={m.userId === guest.principalId ? "text-right" : ""}>
                  <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                    {m.userName} · {fmtTime(m.createdAt)}
                  </p>
                  <p className="inline-block max-w-[85%] whitespace-pre-wrap rounded-md bg-[color:var(--color-muted)] px-3 py-1.5 text-left text-[13px]">{m.message}</p>
                </div>
              ))
            )}
          </div>
          <form
            className="flex gap-2 border-t border-[color:var(--color-border)] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={4000}
              placeholder="Message the team"
              aria-label="Message the team"
              className="h-9 min-w-0 flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-sm"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[color:var(--color-primary)] px-3 text-sm font-medium text-[color:var(--color-primary-foreground)] disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden /> Send
            </button>
          </form>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
          <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-4 py-2.5">
            <h2 className="text-sm font-semibold">Evidence</h2>
            {guest.canUpload && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  aria-label="Upload a file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1 text-[12px] font-medium disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Paperclip className="h-3.5 w-3.5" aria-hidden />} Upload
                </button>
              </>
            )}
          </div>
          <ul className="divide-y divide-[color:var(--color-border)]">
            {evidence.length === 0 ? (
              <li className="p-4 text-center text-[13px] text-[color:var(--color-muted-foreground)]">No evidence yet.</li>
            ) : (
              evidence.map((e) => (
                <li key={e.id} className="px-4 py-2.5">
                  <p className="truncate text-[13px] font-medium">{e.filename}</p>
                  <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                    {fmtSize(e.sizeBytes)} · {e.uploadedByName ?? "Unknown"} · {fmtTime(e.createdAt)}
                  </p>
                  <p className="truncate font-mono text-[10px] text-[color:var(--color-muted-foreground)]" title={e.sha256}>SHA-256 {e.sha256}</p>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
