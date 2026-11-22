"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/rbac";
import {
  Plus,
  Search,
  Server,
  Radio,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataValue } from "@/components/ui/data-value";

interface Incident {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  source: string;
  category: string | null;
  affectedSystems: string[] | null;
  createdAt: string;
  reportedBy: { id: string; name: string | null };
  assignedTo: { id: string; name: string | null } | null;
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-[color:var(--mist-danger)]/10 text-[color:var(--mist-danger)] border-[color:var(--mist-danger)]/30",
  investigating: "bg-[color:var(--mist-warn)]/10 text-[color:var(--mist-warn)] border-[color:var(--mist-warn)]/30",
  contained: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  eradicated: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
  recovered: "bg-[color:var(--mist-ok)]/10 text-[color:var(--mist-ok)] border-[color:var(--mist-ok)]/30",
  closed: "bg-muted text-muted-foreground border-border",
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-[color:var(--mist-danger)]/10 text-[color:var(--mist-danger)] border-[color:var(--mist-danger)]/30",
  high: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
  medium: "bg-[color:var(--mist-warn)]/10 text-[color:var(--mist-warn)] border-[color:var(--mist-warn)]/30",
  low: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
};

const INCIDENT_CATEGORIES = [
  "malware",
  "phishing",
  "data_breach",
  "unauthorized_access",
  "dos_ddos",
  "insider_threat",
  "ransomware",
  "supply_chain",
  "misconfiguration",
  "other",
];

export default function IncidentsPage() {
  const router = useRouter();
  // Readers can follow incidents but not declare them (the API would 403).
  const { data: session } = useSession();
  const canDeclare = hasPermission(session?.user, "incidents.edit");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("critical");
  const [category, setCategory] = useState("");

  const fetchIncidents = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (severityFilter !== "all") params.set("severity", severityFilter);
      const res = await fetch(`/api/incidents?${params}`);
      if (!res.ok) throw new Error();
      setIncidents(await res.json());
    } catch {
      toast.error("Couldn't load incidents. Try again.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  // /incidents?declare=1 (the Ops Room's "Declare incident") opens the dialog.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("declare") === "1") setDialogOpen(true);
  }, []);

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          severity,
          category: category || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Incident created");
      setDialogOpen(false);
      setTitle("");
      setDescription("");
      setSeverity("medium");
      setCategory("");
      fetchIncidents();
    } catch {
      toast.error("Couldn't declare incident. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const filtered = incidents.filter((inc) => {
    if (
      search &&
      !inc.title.toLowerCase().includes(search.toLowerCase()) &&
      !inc.description.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  // Stats
  const openCount = incidents.filter((i) => i.status === "open").length;
  const investigatingCount = incidents.filter(
    (i) => i.status === "investigating"
  ).length;
  const criticalCount = incidents.filter(
    (i) => i.severity === "critical" && i.status !== "closed"
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="headline">Incidents</h1>
          <p className="text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)] max-w-2xl">
            Major incidents your team is responding to.
          </p>
        </div>
        {canDeclare && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <button className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--mist-danger)] px-3 h-9 text-[13px] font-semibold text-white hover:opacity-90">
              <Plus className="h-4 w-4" />
              Declare incident
            </button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Declare incident</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short title"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What happened?"
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Severity</Label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {INCIDENT_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={creating || !title.trim() || !description.trim()}
                  className="bg-[color:var(--mist-danger)] text-white hover:bg-[color:var(--mist-danger)]"
                >
                  {creating ? "Declaring..." : "Declare incident"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Open
          </div>
          <div className="font-mono text-2xl font-extrabold text-[color:var(--mist-danger)]">
            {openCount}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Investigating
          </div>
          <div className="font-mono text-2xl font-extrabold text-[color:var(--mist-warn)]">
            {investigatingCount}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Critical (active)
          </div>
          <div className="font-mono text-2xl font-extrabold text-[color:var(--mist-danger)]">
            {criticalCount}
          </div>
        </div>
      </div>

      {/* Scope reminder */}
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-[color:var(--mist-danger)]/20 bg-[color:var(--mist-danger)]/5 px-5 py-4">
        <Radio className="h-5 w-5 text-[color:var(--mist-danger)]" />
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-[color:var(--mist-danger)]">
            Major incidents only
          </h4>
          <p className="text-xs text-muted-foreground">
            For high-severity incidents. Routine alerts belong in your SIEM.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search incidents"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="investigating">Investigating</SelectItem>
            <SelectItem value="contained">Contained</SelectItem>
            <SelectItem value="eradicated">Eradicated</SelectItem>
            <SelectItem value="recovered">Recovered</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Incident List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl border border-border bg-muted/30"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No incidents"
          description="Nothing matches your filters."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Declare incident
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((inc) => (
            <div
              key={inc.id}
              className="flex items-center gap-4 rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm transition-colors hover:border-primary/20 cursor-pointer"
              onClick={() => router.push(`/incidents/${inc.id}`)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-bold">{inc.title}</h3>
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase ${SEVERITY_STYLES[inc.severity] ?? ""}`}
                  >
                    {inc.severity}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-[10px] capitalize ${STATUS_STYLES[inc.status] ?? ""}`}
                  >
                    {inc.status.replace(/_/g, " ")}
                  </Badge>
                  {inc.source !== "manual" && (
                    <Badge variant="secondary" className="text-[10px]">
                      {inc.source}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {inc.description}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">
                  {inc.reportedBy.name ?? "Unknown"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  <DataValue muted>{new Date(inc.createdAt).toLocaleDateString()}</DataValue>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
