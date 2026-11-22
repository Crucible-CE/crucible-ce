"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Crosshair, Loader2, Plus, Trash2, ShieldAlert, Check, X, Copy,
  ClipboardList, ChevronDown, ChevronRight, Sparkles, AlertTriangle, User, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toDatetimeLocalValue, toIsoOrNull } from "@/lib/datetime/local";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePromptDialog } from "@/components/ui/prompt-dialog";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Asset { id: string; name: string; assetType: string; identifier: string | null; criticality: string; status: string; dataClassification: string | null; owner: string | null; containedAt: string | null; notes: string | null }
interface Action {
  id: string; phase: string; title: string; description: string | null; status: string; highRisk: boolean;
  approvalStatus: string; approvedByName: string | null; rejectedReason: string | null;
  assignedToId: string | null; dueAt: string | null; assetIdsJson: unknown;
}
interface Indicator { id: string; indicatorType: string; value: string; status: string }
interface Participant { id: string; name: string }

const ASSET_TYPES = ["host", "account", "service", "data_store", "network", "application", "other"];
const CRITICALITY = ["critical", "high", "medium", "low"];
const ASSET_STATUS = ["affected", "investigating", "contained", "eradicated", "clean"];
const DATA_CLASS = ["none", "pii", "phi", "pci", "financial", "ip", "confidential"];
const REGULATED = ["pii", "phi", "pci", "financial"];
const CONTAINED = ["contained", "eradicated", "clean"];
const ASSET_STATUS_COLOR: Record<string, string> = {
  affected: "var(--mist-danger)", investigating: "var(--mist-amber)", contained: "var(--mist-indigo)", eradicated: "var(--mist-indigo)", clean: "var(--mist-emerald)",
};
const DATA_CLASS_LABEL: Record<string, string> = { pii: "PII", phi: "PHI", pci: "PCI", financial: "Financial", ip: "IP", confidential: "Confidential", none: "None" };
const PHASES = [
  { key: "containment", label: "Containment" },
  { key: "eradication", label: "Eradication" },
  { key: "recovery", label: "Recovery" },
];
const TEMPLATES: Record<string, string[]> = {
  containment: ["Isolate affected host", "Disable compromised account", "Block IP/domain at perimeter", "Revoke active sessions & tokens", "Reset credentials"],
  eradication: ["Remove malware / persistence", "Patch exploited vulnerability", "Rebuild affected host from gold image"],
  recovery: ["Restore from clean backup", "Re-enable account with enforced MFA", "Validate service health", "Heightened monitoring for recurrence"],
};
const PROMOTABLE: Record<string, string> = { host: "host", ip: "host", account: "account", email: "account" };

export default function ScopePage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();
  const promptText = usePromptDialog();
  const { readOnly } = useIncidentShell();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [bizImpact, setBizImpact] = useState<string | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [showAsset, setShowAsset] = useState(false);
  const [newAsset, setNewAsset] = useState({ name: "", assetType: "host", identifier: "", criticality: "medium", dataClassification: "none" });
  const [bulkPaste, setBulkPaste] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAction, setShowAction] = useState<string | null>(null);
  const [newActionTitle, setNewActionTitle] = useState("");
  const [newActionHighRisk, setNewActionHighRisk] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const [a, ac, ind, part, bi] = await Promise.all([
        fetch(`/api/incidents/${id}/assets`),
        fetch(`/api/incidents/${id}/actions`),
        fetch(`/api/incidents/${id}/indicators`).catch(() => null),
        fetch(`/api/incidents/${id}/participants`).catch(() => null),
        fetch(`/api/incidents/${id}/business-impact`).catch(() => null),
      ]);
      // Assets + actions are required — a failure on either means the page
      // can't render meaningful scope data.
      if (!a.ok || !ac.ok) { setLoadError(true); return; }
      const aData = await a.json().catch(() => null);
      if (aData) setAssets(aData.assets);
      const acData = await ac.json().catch(() => null);
      if (acData) { setActions(acData.actions); setCanApprove(acData.canApprove); }
      // The rest are optional enrichments — non-fatal if they fail.
      if (ind?.ok) { const d = await ind.json().catch(() => null); if (d) setIndicators((d.indicators ?? d) as Indicator[]); }
      if (part?.ok) {
        const d = await part.json().catch(() => null);
        if (d) {
          const list = (Array.isArray(d) ? d : d.participants ?? []) as Record<string, unknown>[];
          setParticipants(list.map((p) => ({ id: String(p.userId ?? p.id ?? ""), name: String(p.userName ?? p.name ?? p.userEmail ?? "User") })).filter((p) => p.id));
        }
      }
      if (bi?.ok) {
        const d = await bi.json().catch(() => null);
        if (d) {
          const obj = (d.businessImpact ?? d.merged ?? d) as Record<string, unknown>;
          const lvl = obj?.financialImpactLevel as string | undefined;
          setBizImpact(lvl ? String(lvl) : null);
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // ── Asset ops ──
  const addAsset = async () => {
    if (!newAsset.name.trim()) return;
    const res = await fetch(`/api/incidents/${id}/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newAsset, dataClassification: newAsset.dataClassification === "none" ? undefined : newAsset.dataClassification }) });
    if (res.ok) { setNewAsset({ name: "", assetType: "host", identifier: "", criticality: "medium", dataClassification: "none" }); setShowAsset(false); void load(); } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't add asset. Try again."));
  };
  const bulkAdd = async () => {
    const lines = bulkPaste.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const items = lines.map((l) => {
      const isAcct = l.includes("@") || l.includes("\\");
      return { name: l, identifier: l, assetType: isAcct ? "account" : "host", criticality: "medium", status: "affected" as const };
    });
    const res = await fetch(`/api/incidents/${id}/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    if (res.ok) { const d = await res.json(); toast.success(`Added ${d.created} assets`); setBulkPaste(""); setShowBulk(false); void load(); } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't add assets. Try again."));
  };
  const promote = async (ind: Indicator) => {
    const assetType = PROMOTABLE[ind.indicatorType];
    if (!assetType) return;
    const res = await fetch(`/api/incidents/${id}/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ind.value, assetType, identifier: ind.value, criticality: "high", sourceIndicatorId: ind.id }) });
    if (res.ok) { toast.success("Promoted to asset"); void load(); } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't add as asset. Try again."));
  };
  const patchAsset = async (assetId: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/incidents/${id}/assets/${assetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't update asset. Try again."));
    void load();
  };
  // Soft-delete + undo toast: the row tombstones server-side; Undo
  // restores it within the toast window.
  const restoreAsset = async (assetId: string) => {
    const res = await fetch(`/api/incidents/${id}/assets/${assetId}/restore`, { method: "POST" });
    if (res.ok) toast.success("Asset restored"); else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't restore asset. Try again."));
    void load();
  };
  const delAsset = async (assetId: string) => {
    const res = await fetch(`/api/incidents/${id}/assets/${assetId}`, { method: "DELETE" });
    if (!res.ok) { toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't delete asset. Try again.")); return; }
    void load();
    toast.success("Asset deleted", { action: { label: "Undo", onClick: () => void restoreAsset(assetId) }, duration: 6000 });
  };
  const bulkMark = async (status: string) => {
    const results = await Promise.all([...selected].map((aid) => fetch(`/api/incidents/${id}/assets/${aid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) })));
    const failed = results.find((r) => !r.ok);
    if (failed) toast.error(apiErrorMessage(await failed.json().catch(() => null), "Couldn't update assets. Try again."));
    setSelected(new Set()); void load();
  };

  // ── Action ops ──
  const addAction = async (phase: string, title: string) => {
    if (!title.trim()) return;
    const res = await fetch(`/api/incidents/${id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase, title, highRisk: newActionHighRisk }) });
    if (res.ok) { setNewActionTitle(""); setNewActionHighRisk(false); setShowAction(null); void load(); } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't add action. Try again."));
  };
  const actionOp = async (actionId: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/incidents/${id}/actions/${actionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) void load(); else toast.error(apiErrorMessage(d, "Couldn't update action. Try again."));
  };
  const restoreAction = async (actionId: string) => {
    const res = await fetch(`/api/incidents/${id}/actions/${actionId}/restore`, { method: "POST" });
    if (res.ok) toast.success("Action restored"); else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't restore action. Try again."));
    void load();
  };
  const delAction = async (actionId: string) => {
    const res = await fetch(`/api/incidents/${id}/actions/${actionId}`, { method: "DELETE" });
    if (!res.ok) { toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't delete action. Try again.")); return; }
    void load();
    toast.success("Action deleted", { action: { label: "Undo", onClick: () => void restoreAction(actionId) }, duration: 6000 });
  };

  // Reject requires a reason — cancel resolves null and is a true no-op
  // (the old prompt() sent a reject with an empty reason on cancel).
  const rejectAction = async (actionId: string) => {
    const reason = await promptText({
      title: "Reject this action?",
      description: "The requester sees your reason on the action card.",
      label: "Reason for rejection",
      required: true,
      destructive: true,
      confirmLabel: "Reject",
      multiline: true,
    });
    if (reason === null) return;
    await actionOp(actionId, { op: "reject", reason });
  };

  const setActionStatus = async (action: Action, status: string) => {
    if (status === "cancelled") {
      const ok = await confirm({
        title: `Cancel "${action.title}"?`,
        description: "A cancelled action can't be resumed.",
        confirmLabel: "Cancel action",
        cancelLabel: "Keep",
        destructive: true,
      });
      if (!ok) return;
    }
    await actionOp(action.id, { op: "status", status });
  };

  // ── Derived ──
  const stats = useMemo(() => {
    const total = assets.length;
    const contained = assets.filter((a) => CONTAINED.includes(a.status)).length;
    const critical = assets.filter((a) => a.criticality === "critical").length;
    const regulated = assets.filter((a) => a.dataClassification && REGULATED.includes(a.dataClassification));
    const classes = [...new Set(assets.map((a) => a.dataClassification).filter((c): c is string => !!c && c !== "none"))];
    const openActions = actions.filter((a) => !["verified", "rejected", "cancelled", "done"].includes(a.status));
    const overdue = openActions.filter((a) => a.dueAt && new Date(a.dueAt) < new Date()).length;
    return { total, contained, containedPct: total ? Math.round((contained / total) * 100) : 0, critical, regulated, classes, openActions: openActions.length, overdue };
  }, [assets, actions]);

  const promotable = indicators.filter((i) => PROMOTABLE[i.indicatorType] && i.status !== "false_positive");
  const visibleAssets = assets.filter((a) => statusFilter === "all" || a.status === statusFilter);

  const copySummary = () => {
    const lines = [
      `INCIDENT SCOPE SUMMARY`,
      `Assets: ${stats.total} (${stats.critical} critical) · ${stats.containedPct}% contained`,
      `Regulated data in scope: ${stats.regulated.length ? `YES (${[...new Set(stats.regulated.map((a) => DATA_CLASS_LABEL[a.dataClassification!]))].join(", ")})` : "none identified"}`,
      bizImpact ? `Business impact: ${bizImpact}` : null,
      `Open response actions: ${stats.openActions}${stats.overdue ? ` (${stats.overdue} overdue)` : ""}`,
    ].filter(Boolean).join("\n");
    void navigator.clipboard.writeText(lines);
    toast.success("Scope summary copied");
  };

  if (loading) return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  if (loadError) {
    return (
      <div className="mx-auto max-w-4xl p-8 text-center">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load scope data.</p>
        <button
          onClick={() => { setLoading(true); void load(); }}
          className="mt-3 rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-muted)]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]"><Crosshair className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-semibold">Scope</h1><p className="text-sm text-muted-foreground">Affected assets and response actions.</p></div>
        </div>
        <Button variant="outline" size="sm" onClick={copySummary}><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy summary</Button>
      </div>

      {/* Blast-radius summary */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Assets" value={String(stats.total)} sub={`${stats.critical} critical`} />
            <Stat label="Contained" value={`${stats.containedPct}%`} warn={stats.containedPct < 50} />
            <Stat label="Open actions" value={String(stats.openActions)} sub={stats.overdue ? `${stats.overdue} overdue` : undefined} warn={stats.overdue > 0} />
            <Stat label="Regulated data" value={stats.regulated.length ? "YES" : "None"} warn={stats.regulated.length > 0} />
            <Stat label="Business impact" value={bizImpact ?? "Not set"} />
          </div>
          {stats.classes.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[color:var(--color-border)] pt-3">
              <span className="text-[11px] text-muted-foreground">Data classes in scope:</span>
              {stats.classes.map((c) => (
                <Badge key={c} variant="outline" className={cn("text-[10px]", REGULATED.includes(c) ? "border-[color:var(--mist-danger)]/40 text-[color:var(--mist-danger)]" : "")}>{DATA_CLASS_LABEL[c]}</Badge>
              ))}
              {stats.regulated.length > 0 && <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-[color:var(--mist-danger)]"><AlertTriangle className="h-3 w-3" /> Notification rules may apply</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* IOC promotion */}
      {promotable.length > 0 && !readOnly && (
        <div className="rounded-lg border border-[color:var(--mist-indigo)]/30 bg-[color:var(--mist-indigo)]/5 p-3">
          <button onClick={() => setShowPromote((v) => !v)} className="flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--mist-indigo)]">
            <Sparkles className="h-3.5 w-3.5" /> {promotable.length} indicator{promotable.length === 1 ? "" : "s"} can be added as assets
            {showPromote ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {showPromote && (
            <div className="mt-2 space-y-1">
              {promotable.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate"><code className="text-[11px]">{i.value}</code> <span className="text-muted-foreground">({i.indicatorType})</span></span>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => promote(i)}><Plus className="mr-1 h-3 w-3" /> Add as asset</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assets */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Affected assets</h2>
          <div className="flex items-center gap-1.5">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 w-[120px] text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ASSET_STATUS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {!readOnly && (
              <>
                <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setShowBulk((v) => !v)}><ClipboardList className="mr-1 h-3.5 w-3.5" /> Paste list</Button>
                <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setShowAsset((v) => !v)}><Plus className="mr-1 h-3.5 w-3.5" /> Asset</Button>
              </>
            )}
          </div>
        </div>

        {showBulk && !readOnly && (
          <div className="mb-2 space-y-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3">
            <textarea value={bulkPaste} onChange={(e) => setBulkPaste(e.target.value)} placeholder="Hosts, IPs or accounts, one per line or comma-separated" rows={3} className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
            <div className="flex justify-end"><Button size="sm" onClick={bulkAdd}>Add {bulkPaste.split(/[\n,]/).filter((l) => l.trim()).length || ""} assets</Button></div>
          </div>
        )}
        {showAsset && !readOnly && (
          <div className="mb-2 flex flex-wrap gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3">
            <Input value={newAsset.name} onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })} placeholder="Asset name" className="h-8 min-w-[130px] flex-1 text-sm" />
            <Input value={newAsset.identifier} onChange={(e) => setNewAsset({ ...newAsset, identifier: e.target.value })} placeholder="Host/IP/user" className="h-8 w-28 text-sm" />
            <Select value={newAsset.assetType} onValueChange={(v) => setNewAsset({ ...newAsset, assetType: v })}><SelectTrigger className="h-8 w-[110px] text-xs capitalize"><SelectValue /></SelectTrigger><SelectContent>{ASSET_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>)}</SelectContent></Select>
            <Select value={newAsset.criticality} onValueChange={(v) => setNewAsset({ ...newAsset, criticality: v })}><SelectTrigger className="h-8 w-[100px] text-xs capitalize"><SelectValue /></SelectTrigger><SelectContent>{CRITICALITY.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent></Select>
            <Select value={newAsset.dataClassification} onValueChange={(v) => setNewAsset({ ...newAsset, dataClassification: v })}><SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger><SelectContent>{DATA_CLASS.map((c) => <SelectItem key={c} value={c}>{c === "none" ? "No reg. data" : DATA_CLASS_LABEL[c]}</SelectItem>)}</SelectContent></Select>
            <Button size="sm" onClick={addAsset}>Add</Button>
          </div>
        )}

        {selected.size > 0 && !readOnly && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[color:var(--mist-indigo)]/40 bg-[color:var(--mist-indigo)]/5 px-3 py-1.5 text-[12px]">
            <span>{selected.size} selected</span>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => bulkMark("contained")}>Mark contained</Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        {visibleAssets.length === 0 ? <p className="text-xs text-muted-foreground">No assets{statusFilter !== "all" ? " with this status" : " recorded"}.</p> : (
          <div className="overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
            {visibleAssets.map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 border-b border-[color:var(--color-border)] px-3 py-2 last:border-0">
                {!readOnly && <input type="checkbox" checked={selected.has(a.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })} />}
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ASSET_STATUS_COLOR[a.status] }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {a.name}
                    <span className="rounded bg-[color:var(--color-muted)] px-1 text-[10px] uppercase text-muted-foreground">{a.criticality}</span>
                    {a.dataClassification && a.dataClassification !== "none" && (
                      <Badge variant="outline" className={cn("text-[10px]", REGULATED.includes(a.dataClassification) ? "border-[color:var(--mist-danger)]/40 text-[color:var(--mist-danger)]" : "")}>{DATA_CLASS_LABEL[a.dataClassification]}</Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{a.assetType.replace("_", " ")}{a.identifier ? ` · ${a.identifier}` : ""}{a.owner ? ` · owner: ${a.owner}` : ""}{a.containedAt ? ` · contained ${new Date(a.containedAt).toLocaleString()}` : ""}</div>
                </div>
                <Select disabled={readOnly} value={a.dataClassification ?? "none"} onValueChange={(v) => patchAsset(a.id, { dataClassification: v === "none" ? null : v })}>
                  <SelectTrigger className="h-7 w-[92px] text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{DATA_CLASS.map((c) => <SelectItem key={c} value={c}>{c === "none" ? "No reg." : DATA_CLASS_LABEL[c]}</SelectItem>)}</SelectContent>
                </Select>
                <Select disabled={readOnly} value={a.status} onValueChange={(v) => patchAsset(a.id, { status: v })}>
                  <SelectTrigger className="h-7 w-[112px] text-[11px] capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASSET_STATUS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
                {!readOnly && <button onClick={() => delAsset(a.id)} aria-label="Delete asset" className="text-muted-foreground hover:text-[color:var(--mist-danger)]"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Action board */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Response actions</h2>
        {PHASES.map((p) => {
          const phaseActions = actions.filter((a) => a.phase === p.key);
          const isCollapsed = collapsed.has(p.key);
          return (
            <div key={p.key}>
              <div className="mb-1.5 flex items-center justify-between">
                <button onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}{p.label} <span className="text-muted-foreground/60">({phaseActions.length})</span>
                </button>
                {!readOnly && <button onClick={() => { setShowAction(showAction === p.key ? null : p.key); setNewActionTitle(""); }} className="text-xs text-[color:var(--mist-indigo)]">+ Action</button>}
              </div>
              {showAction === p.key && !readOnly && (
                <div className="mb-2 space-y-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={newActionTitle} onChange={(e) => setNewActionTitle(e.target.value)} placeholder={`${p.label} action`} className="h-8 min-w-[180px] flex-1 text-sm" />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={newActionHighRisk} onChange={(e) => setNewActionHighRisk(e.target.checked)} /> High-risk</label>
                    <Button size="sm" onClick={() => addAction(p.key, newActionTitle)}>Add</Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {TEMPLATES[p.key].map((t) => (
                      <button key={t} onClick={() => addAction(p.key, t)} className="rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-[10px] text-muted-foreground hover:border-[color:var(--mist-indigo)] hover:text-[color:var(--mist-indigo)]">+ {t}</button>
                    ))}
                  </div>
                </div>
              )}
              {!isCollapsed && (phaseActions.length === 0 ? <p className="text-xs text-muted-foreground/60">None.</p> : (
                <div className="space-y-1.5">
                  {phaseActions.map((a) => {
                    const overdue = a.dueAt && new Date(a.dueAt) < new Date() && !["verified", "done", "rejected", "cancelled"].includes(a.status);
                    return (
                      <div key={a.id} className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-2.5">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                              {a.highRisk && <ShieldAlert className="h-3.5 w-3.5 text-[color:var(--mist-danger)]" />}
                              {a.title}
                              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                                a.status === "verified" || a.status === "done" ? "bg-[color:var(--mist-emerald)]/15 text-[color:var(--mist-emerald)]" :
                                a.status === "rejected" || a.status === "cancelled" ? "bg-[color:var(--mist-danger)]/15 text-[color:var(--mist-danger)]" :
                                "bg-[color:var(--color-muted)] text-muted-foreground")}>{a.status}</span>
                              {a.highRisk && a.approvalStatus === "pending" && <span className="rounded bg-[color:var(--mist-amber)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--mist-amber)]">approval pending</span>}
                              {a.approvalStatus === "approved" && <span className="rounded bg-[color:var(--mist-emerald)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--mist-emerald)]">approved</span>}
                              {overdue && <span className="inline-flex items-center gap-0.5 rounded bg-[color:var(--mist-danger)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--mist-danger)]"><Clock className="h-2.5 w-2.5" /> overdue</span>}
                            </div>
                            {a.rejectedReason && <p className="text-[11px] text-[color:var(--mist-danger)]">Rejected: {a.rejectedReason}</p>}
                          </div>
                          {!readOnly && <button onClick={() => delAction(a.id)} aria-label="Delete action" className="text-muted-foreground hover:text-[color:var(--mist-danger)]"><Trash2 className="h-3.5 w-3.5" /></button>}
                        </div>
                        {/* Assignee + ETA */}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><User className="h-3 w-3" /></span>
                          <Select disabled={readOnly} value={a.assignedToId ?? "__none__"} onValueChange={(v) => actionOp(a.id, { op: "edit", assignedToId: v === "__none__" ? null : v })}>
                            <SelectTrigger className="h-6 w-[120px] text-[10px]"><SelectValue placeholder="Assign" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Unassigned</SelectItem>
                              {participants.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <input type="datetime-local" disabled={readOnly} value={toDatetimeLocalValue(a.dueAt)} onChange={(e) => actionOp(a.id, { op: "edit", dueAt: toIsoOrNull(e.target.value) })} className="h-6 rounded border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-1.5 text-[10px]" />
                        </div>
                        {/* Workflow controls */}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {a.highRisk && a.approvalStatus === "pending" && canApprove && !readOnly && (
                            <>
                              <button onClick={() => actionOp(a.id, { op: "approve" })} className="inline-flex items-center gap-1 rounded border border-[color:var(--mist-emerald)]/40 px-2 py-1 text-[11px] text-[color:var(--mist-emerald)]"><Check className="h-3 w-3" /> Approve</button>
                              <button onClick={() => void rejectAction(a.id)} className="inline-flex items-center gap-1 rounded border border-[color:var(--mist-danger)]/40 px-2 py-1 text-[11px] text-[color:var(--mist-danger)]"><X className="h-3 w-3" /> Reject</button>
                            </>
                          )}
                          {a.status !== "verified" && a.status !== "rejected" && a.status !== "cancelled" && (
                            <Select disabled={readOnly} value={a.status} onValueChange={(v) => void setActionStatus(a, v)}>
                              <SelectTrigger className="h-6 w-[110px] text-[11px]"><SelectValue /></SelectTrigger>
                              <SelectContent>{["proposed", "in_progress", "done", "verified", "cancelled"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-bold", warn ? "text-[color:var(--mist-danger)]" : "")}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
