"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/exercise/time";
import { api } from "./api";

interface Message {
  id: string;
  channel: string;
  teamId: string | null;
  teamName: string | null;
  author: string;
  isGuest: boolean;
  body: string;
  at: string;
  mine: boolean;
}

type Channel = "all" | "team" | "control";

export function ChatPanel({
  exerciseId,
  chatTick,
  isControl,
  myTeamId,
  teams,
  timezone,
  canPost = true,
  className,
}: {
  exerciseId: string;
  chatTick: number;
  isControl: boolean;
  myTeamId: string | null;
  teams: Array<{ id: string; name: string }>;
  timezone: string;
  canPost?: boolean;
  className?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channel, setChannel] = useState<Channel>("all");
  const [teamId, setTeamId] = useState<string | null>(myTeamId ?? teams[0]?.id ?? null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const load = useCallback(async () => {
    const r = await api<{ messages: Message[] }>(`/api/play/${exerciseId}/chat`);
    if (r.ok) setMessages(r.data.messages);
  }, [exerciseId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load, chatTick]);

  const channels: Array<{ key: Channel; label: string }> = [
    { key: "all", label: "Everyone" },
    ...(myTeamId || isControl ? [{ key: "team" as const, label: "Team" }] : []),
    ...(isControl ? [{ key: "control" as const, label: "Control" }] : []),
  ];

  const effectiveTeam = isControl ? teamId : myTeamId;
  const shown = useMemo(
    () => messages.filter((m) => m.channel === channel && (channel !== "team" || m.teamId === effectiveTeam)),
    [messages, channel, effectiveTeam],
  );

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, channel]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    const r = await api(`/api/play/${exerciseId}/chat`, {
      body: { body: text, channel, ...(channel === "team" && isControl ? { teamId } : {}) },
      fallback: "The message was not sent. Try again.",
    });
    setSending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setBody("");
    void load();
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Chat channel">
        {channels.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={channel === c.key}
            onClick={() => setChannel(c.key)}
            className={cn(
              "rounded-full px-3 py-1 text-[12.5px] font-medium",
              channel === c.key
                ? "bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]"
                : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]",
            )}
          >
            {c.label}
          </button>
        ))}
        {channel === "team" && isControl && teams.length > 0 && (
          <select
            aria-label="Team"
            value={teamId ?? ""}
            onChange={(e) => setTeamId(e.target.value || null)}
            className="h-8 rounded-md border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-2 text-[12.5px]"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <ol ref={listRef} className="min-h-[160px] flex-1 space-y-2 overflow-y-auto pr-1" aria-live="polite" aria-label="Messages">
        {shown.length === 0 && <li className="py-6 text-center text-[13px] text-[color:var(--color-muted-foreground)]">No messages yet.</li>}
        {shown.map((m) => (
          <li key={m.id} className={cn("max-w-[90%] rounded-md px-3 py-2 text-[13px]", m.mine ? "ml-auto bg-[color:var(--mist-indigo-soft)]" : "bg-[color:var(--color-muted)]")}>
            <div className="flex items-baseline gap-2 text-[11.5px] text-[color:var(--color-muted-foreground)]">
              <span className="truncate font-medium text-[color:var(--color-foreground)]">{m.author}</span>
              {m.isGuest && <span>Guest</span>}
              <time className="ml-auto shrink-0 font-mono tabular-nums" dateTime={m.at}>
                {formatClock(new Date(m.at), timezone)}
              </time>
            </div>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          </li>
        ))}
      </ol>

      {canPost && (
        <form onSubmit={send} className="flex gap-2">
          <Input
            aria-label="Message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            placeholder="Write a message"
            className="h-10"
          />
          <Button type="submit" size="icon" className="size-10" disabled={sending || !body.trim()} aria-label="Send">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      )}
      {error && <p role="alert" className="text-[12.5px] text-[color:var(--mist-danger)]">{error}</p>}
    </div>
  );
}
