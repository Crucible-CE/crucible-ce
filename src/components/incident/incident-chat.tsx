"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Send, Loader2, MessagesSquare } from "lucide-react";
import { useIncidentSocket, SOCKET_EVENTS } from "@/lib/socket/client";
import type { ChatMessagePayload } from "@/lib/socket/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useIncidentShell } from "./incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Msg {
  id: string;
  userId: string;
  userName: string;
  message: string;
  createdAt: string;
  _pending?: boolean;
}

function sortByTime(a: Msg, b: Msg) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function renderWithMentions(text: string): React.ReactNode {
  return text.split(/(@[a-zA-Z0-9._-]+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="font-semibold text-[color:var(--mist-indigo)]">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

// Live war-room chat for an incident. Persisted server-side (auditable) and
// pushed in real time via the incident socket room, with a polling fallback so
// it works even if the socket drops.
export function IncidentChat({
  incidentId,
  heightClass = "h-[68vh]",
}: {
  incidentId: string;
  heightClass?: string;
}) {
  const { data: session } = useSession();
  const myId = session?.user?.id ?? "";
  const { socket, isConnected } = useIncidentSocket(incidentId);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const { readOnly, lockReadOnly } = useIncidentShell();
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(0);
  // last-seen message id — the 5s poll fetches only the strictly-newer
  // delta instead of re-shipping the whole page.
  const cursorRef = useRef<string | null>(null);

  const fetchHistory = useCallback(
    async (mode: "cold" | "delta" = "delta") => {
      try {
        const after = mode === "delta" ? cursorRef.current : null;
        const url = after
          ? `/api/incidents/${incidentId}/chat?after=${encodeURIComponent(after)}`
          : `/api/incidents/${incidentId}/chat`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const server: Msg[] = data.messages ?? [];
        if (data.nextCursor) cursorRef.current = data.nextCursor;
        if (after && server.length === 0) return; // empty delta: nothing to merge
        setMessages((prev) => {
          const pending = prev.filter(
            (m) =>
              m._pending &&
              !server.some((s) => s.userId === m.userId && s.message === m.message),
          );
          const merged = new Map<string, Msg>();
          // Delta merges INTO existing state; a cold load replaces it.
          if (after) for (const m of prev.filter((m) => !m._pending)) merged.set(m.id, m);
          for (const m of server) merged.set(m.id, m);
          for (const m of pending) merged.set(m.id, m);
          return Array.from(merged.values()).sort(sortByTime);
        });
      } catch {
        // non-fatal
      } finally {
        setLoading(false);
      }
    },
    [incidentId],
  );

  useEffect(() => {
    cursorRef.current = null;
    void fetchHistory("cold");
  }, [fetchHistory]);

  // Polling fallback (covers socket gaps / reconnects) — incremental.
  useEffect(() => {
    const t = window.setInterval(() => void fetchHistory("delta"), 5000);
    return () => window.clearInterval(t);
  }, [fetchHistory]);

  // Realtime.
  useEffect(() => {
    if (!socket) return;
    function onChat(p: ChatMessagePayload) {
      if (p.incidentId !== incidentId) return;
      cursorRef.current = p.id; // socket delivered it — next delta needn't refetch it
      setMessages((prev) => {
        if (prev.some((m) => m.id === p.id)) return prev;
        const confirmed: Msg = {
          id: p.id,
          userId: p.userId,
          userName: p.userName,
          message: p.message,
          createdAt: p.createdAt,
        };
        const idx = prev.findIndex(
          (m) => m._pending && m.userId === p.userId && m.message === p.message,
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = confirmed;
          return next.sort(sortByTime);
        }
        return [...prev, confirmed].sort(sortByTime);
      });
    }
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, onChat);
    return () => {
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE, onChat);
    };
  }, [socket, incidentId]);

  useEffect(() => {
    // Scroll only the chat's OWN container (never scrollIntoView — that walks up
    // and scrolls every ancestor, which dragged the whole war-room page to the
    // bottom). And only when messages actually GREW (the 5s poll rebuilds the
    // array each tick) and the reader is already near the bottom — so we never
    // yank the view while they're reading history.
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > prevCount.current;
    const first = prevCount.current === 0 && messages.length > 0;
    prevCount.current = messages.length;
    if (!grew) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (first || nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const tempId = `pending-${Date.now()}-${Math.random()}`;
    setSending(true);
    setInput("");
    setMessages((prev) =>
      [
        ...prev,
        {
          id: tempId,
          userId: myId,
          userName: session?.user?.name ?? "You",
          message: text,
          createdAt: new Date().toISOString(),
          _pending: true,
        },
      ].sort(sortByTime),
    );
    try {
      const res = await fetch(`/api/incidents/${incidentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        const saved = await res.json();
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== tempId);
          if (without.some((m) => m.id === saved.id)) return without;
          return [
            ...without,
            {
              id: saved.id,
              userId: saved.userId,
              userName: saved.userName,
              message: saved.message,
              createdAt: saved.createdAt,
            },
          ].sort(sortByTime);
        });
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't send. Try again."));
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <section className={`flex ${heightClass} flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)]`}>
      <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-4 py-2.5">
        <MessagesSquare className="h-4 w-4 text-[color:var(--mist-indigo)]" />
        <h2 className="text-sm font-semibold">Chat</h2>
        <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-[color:var(--color-muted-foreground)]">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isConnected ? "bg-[color:var(--mist-ok)]" : "bg-[color:var(--color-muted-foreground)]/40",
            )}
          />
          {isConnected ? "Live" : "Reconnecting…"}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-muted-foreground)]" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-[color:var(--color-muted-foreground)]">
            No messages.
          </p>
        ) : (
          messages.map((m) => {
            const isMe = m.userId === myId;
            return (
              <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                <div className="mb-0.5 flex items-center gap-1.5">
                  {!isMe && (
                    <span className="text-[10.5px] font-semibold text-[color:var(--mist-indigo)]">
                      {m.userName}
                    </span>
                  )}
                  <span className="text-[10px] text-[color:var(--color-muted-foreground)]">
                    {formatTime(m.createdAt)}
                  </span>
                </div>
                <div
                  className={cn(
                    "max-w-[80%] break-words rounded-[var(--radius-md)] px-3 py-1.5 text-[13px]",
                    m._pending && "opacity-50",
                    isMe
                      ? "bg-[color:var(--mist-indigo-soft)] text-[color:var(--color-foreground)]"
                      : "border border-[color:var(--color-border)] bg-[color:var(--color-background)]",
                  )}
                >
                  {renderWithMentions(m.message)}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-[color:var(--color-border)] px-3 py-1 text-center text-[10px] uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
        Messages are recorded as evidence
      </div>

      {readOnly ? (
        <div className="border-t border-[color:var(--color-border)] p-3 text-center text-[11.5px] text-[color:var(--color-muted-foreground)]">
          {lockReadOnly
            ? "Locked. You can read the chat but not post."
            : "Read-only. Your role can't post."}
        </div>
      ) : (
      <div className="flex items-center gap-2 border-t border-[color:var(--color-border)] p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message the team"
          className="h-9 flex-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[13px] outline-none focus:border-[color:var(--mist-indigo)]"
        />
        <button
          type="button"
          onClick={() => void send()}
          aria-label="Send"
          disabled={!input.trim() || sending}
          className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[color:var(--mist-indigo)] text-white disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      )}
    </section>
  );
}
