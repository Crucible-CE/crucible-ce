"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Newspaper, Plus, Pin, PinOff, Trash2, ExternalLink, Loader2, Link2 } from "lucide-react";
import { KeyIndicators } from "@/components/incident/key-indicators";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface IntelPost {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  tag: string;
  pinned: boolean;
  authorName: string | null;
  createdAt: string;
}

const TAGS = [
  { key: "reference", label: "Reference", color: "var(--mist-indigo)" },
  { key: "osint", label: "OSINT", color: "var(--mist-amber)" },
  { key: "ioc", label: "IOC", color: "var(--mist-danger)" },
  { key: "observation", label: "Observation", color: "var(--mist-success)" },
  { key: "media", label: "Media", color: "var(--color-muted-foreground)" },
] as const;

function tagMeta(tag: string) {
  return TAGS.find((t) => t.key === tag) ?? TAGS[0];
}

export default function IncidentIntelPage() {
  const params = useParams<{ id: string }>();
  const confirm = useConfirm();
  const { readOnly } = useIncidentShell();
  const incidentId = params.id;
  const [posts, setPosts] = useState<IntelPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [tag, setTag] = useState<string>("reference");
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/intel`);
    if (res.ok) setPosts((await res.json()).posts ?? []);
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!title.trim()) {
      toast.error("Add a title");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/incidents/${incidentId}/intel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), body: body.trim() || undefined, url: url.trim() || undefined, tag }),
    });
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setBody("");
      setUrl("");
      setTag("reference");
      setAdding(false);
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(apiErrorMessage(d, "Couldn't add. Try again."));
    }
  };

  const togglePin = async (p: IntelPost) => {
    const res = await fetch(`/api/incidents/${incidentId}/intel/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !p.pinned }),
    });
    if (res.ok) await load();
    else toast.error(apiErrorMessage(await res.json().catch(() => null), p.pinned ? "Couldn't unpin. Try again." : "Couldn't pin. Try again."));
  };

  const remove = async (p: IntelPost) => {
    const ok = await confirm({
      title: "Delete this note?",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/incidents/${incidentId}/intel/${p.id}`, { method: "DELETE" });
    if (res.ok) await load();
    else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't delete. Try again."));
  };

  const visible = filter === "all" ? posts : posts.filter((p) => p.tag === filter);

  return (
    <div className="space-y-4">
      <KeyIndicators incidentId={incidentId} />
      <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-[color:var(--mist-indigo)]" />
            <h2 className="text-sm font-semibold">Notes board</h2>
            <span className="text-[11px] text-[color:var(--color-muted-foreground)]">Notes, links, IOCs and observations.</span>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] px-3 py-1.5 text-[12px] font-medium text-white"
            >
              <Plus className="h-3.5 w-3.5" /> Add item
            </button>
          )}
        </div>

        {adding && !readOnly && (
          <div className="mt-3 space-y-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-[color:var(--mist-indigo)]/50"
            />
            <div className="flex items-center gap-2">
              <Link2 className="h-3.5 w-3.5 text-[color:var(--color-muted-foreground)]" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://… (optional)"
                className="flex-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none focus:border-[color:var(--mist-indigo)]/50"
              />
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Details (optional)"
              className="w-full resize-none rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none focus:border-[color:var(--mist-indigo)]/50"
            />
            <div className="flex items-center gap-2">
              <select value={tag} onChange={(e) => setTag(e.target.value)} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[12px]">
                {TAGS.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              <button type="button" disabled={busy} onClick={create} className="ml-auto rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
                Post
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button onClick={() => setFilter("all")} className={`rounded-full px-2.5 py-1 text-[11px] ${filter === "all" ? "bg-[color:var(--mist-indigo)] text-white" : "border border-[color:var(--color-border)]"}`}>
            All
          </button>
          {TAGS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] ${filter === t.key ? "text-white" : "border border-[color:var(--color-border)]"}`}
              style={filter === t.key ? { backgroundColor: t.color } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[color:var(--color-border)] py-12 text-center text-sm text-[color:var(--color-muted-foreground)]">
          No notes.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((p) => {
            const meta = tagMeta(p.tag);
            return (
              <div key={p.id} className={`rounded-[var(--radius-lg)] border bg-[color:var(--color-card)] p-3 ${p.pinned ? "border-[color:var(--mist-indigo)]/40" : "border-[color:var(--color-border)]"}`}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ backgroundColor: `${meta.color}20`, color: meta.color }}>
                    {meta.label}
                  </span>
                  {readOnly ? (
                    p.pinned && <span title="Pinned" className="text-[color:var(--mist-indigo)]"><Pin className="h-3.5 w-3.5 fill-current" /></span>
                  ) : (
                  <div className="flex items-center gap-1">
                    <button onClick={() => togglePin(p)} title={p.pinned ? "Unpin" : "Pin"} aria-label={p.pinned ? "Unpin" : "Pin"} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-indigo)]">
                      {p.pinned ? <Pin className="h-3.5 w-3.5 fill-current" /> : <PinOff className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => remove(p)} title="Delete" aria-label="Delete" className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  )}
                </div>
                <p className="text-[13px] font-medium">{p.title}</p>
                {p.body && <p className="mt-1 whitespace-pre-wrap text-[12px] text-[color:var(--color-muted-foreground)]">{p.body}</p>}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[color:var(--mist-indigo)] hover:underline">
                    <ExternalLink className="h-3 w-3" /> {(() => { try { return new URL(p.url).hostname; } catch { return "link"; } })()}
                  </a>
                )}
                <p className="mt-2 text-[10px] text-[color:var(--color-muted-foreground)]">
                  {p.authorName ?? "Unknown"} · {new Date(p.createdAt).toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
