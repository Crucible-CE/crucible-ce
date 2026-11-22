"use client";

import { useCallback, useEffect, useState } from "react";
import { Video, Users, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { isValidBridgeUrl } from "@/lib/incident/bridge-url";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Present { userId: string; userName: string | null; lastSeenAt: string }

// Live war-room bridge link + presence ("who's in the room"). Heartbeats while
// the chat is open. Paste a Teams/Zoom/Meet https:// link.
export function WarRoomBridge({ incidentId }: { incidentId: string }) {
  const { readOnly } = useIncidentShell();
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);
  const [present, setPresent] = useState<Present[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const loadBridge = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}`);
    if (res.ok) setBridgeUrl((await res.json()).bridgeUrl ?? null);
  }, [incidentId]);

  useEffect(() => {
    void loadBridge();
    let active = true;
    const beat = async () => {
      await fetch(`/api/incidents/${incidentId}/presence`, { method: "POST" }).catch(() => {});
      const res = await fetch(`/api/incidents/${incidentId}/presence`).catch(() => null);
      if (res?.ok && active) setPresent((await res.json()).present);
    };
    void beat();
    const t = setInterval(beat, 45_000);
    return () => { active = false; clearInterval(t); };
  }, [incidentId, loadBridge]);

  const saveBridge = async (url: string | null) => {
    // Client-side https-only guard so an invalid link never reaches the server
    // (which also rejects it). null clears the bridge.
    if (url !== null && !isValidBridgeUrl(url)) {
      toast.error("Enter a valid https:// meeting link");
      return; // keep the editor open
    }
    const res = await fetch(`/api/incidents/${incidentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bridgeUrl: url }) });
    if (res.ok) { setBridgeUrl(url); setEditing(false); } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't save the bridge link. Try again."));
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2">
      {/* Bridge */}
      <div className="flex items-center gap-2">
        <Video className="h-4 w-4 text-[color:var(--mist-indigo)]" />
        {editing && !readOnly ? (
          <span className="flex items-center gap-1">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Bridge URL" className="w-48 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1 text-xs" />
            <button onClick={() => saveBridge(draft.trim() || null)} className="rounded bg-[color:var(--mist-indigo)] px-2 py-1 text-xs text-white">Save</button>
            <button onClick={() => setEditing(false)} aria-label="Cancel"><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
          </span>
        ) : bridgeUrl ? (
          <span className="flex items-center gap-2">
            <a href={bridgeUrl} target="_blank" rel="noreferrer noopener" className="rounded-md bg-[color:var(--mist-indigo)] px-2.5 py-1 text-xs font-medium text-white">Join bridge</a>
            {!readOnly && <button onClick={() => { setDraft(bridgeUrl); setEditing(true); }} className="text-[11px] text-muted-foreground hover:underline">Edit</button>}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {readOnly ? "No bridge" : "No bridge ·"}
            {!readOnly && <button onClick={() => { setDraft(""); setEditing(true); }} className="inline-flex items-center gap-0.5 text-[color:var(--mist-indigo)] hover:underline"><Plus className="h-3 w-3" /> Add link</button>}
          </span>
        )}
      </div>

      {/* Presence */}
      <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>{present.length} in the room</span>
        <div className="flex -space-x-1.5">
          {present.slice(0, 5).map((p) => (
            <span key={p.userId} title={p.userName ?? "User"} className="flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--color-card)] bg-[color:var(--mist-indigo)]/20 text-[10px] font-bold text-[color:var(--mist-indigo)]">
              {(p.userName ?? "?").slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
