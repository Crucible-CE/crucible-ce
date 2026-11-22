"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Loader2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldSelect } from "@/components/form/field-select";
import { MODE_LABELS, STATUS_LABELS, statusVariant, templateHref } from "./labels";

export interface TemplateRow {
  id: string;
  mode: string;
  title: string;
  summary: string | null;
  status: string;
  scope: string;
  collection: string | null;
  branching: string;
  updatedAt: string;
  injectCount: number;
  teams: string[];
  targetDurationMin: number | null;
  practice: boolean;
}

const STATUS_FILTERS = [
  { value: "active", label: "Not archived" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

const MODE_FILTERS = [{ value: "", label: "All modes" }, ...Object.entries(MODE_LABELS).map(([value, label]) => ({ value, label }))];

function statusParam(filter: string): string {
  if (filter === "all") return "";
  if (filter === "active") return "draft,published";
  return filter;
}

export function TemplatesClient() {
  const router = useRouter();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState("active");
  const [collection, setCollection] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (mode) qs.set("mode", mode);
    const s = statusParam(status);
    if (s) qs.set("status", s);
    try {
      const res = await fetch(`/api/templates?${qs.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { templates?: TemplateRow[]; error?: string } | null;
      if (!res.ok || !data?.templates) {
        setError(data?.error ?? "Templates did not load. Refresh the page.");
        return;
      }
      setError(null);
      setRows(data.templates);
    } catch {
      setError("Templates did not load. Check your connection and refresh.");
    }
  }, [mode, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const collections = useMemo(() => [...new Set((rows ?? []).map((t) => t.collection).filter((c): c is string => Boolean(c)))].sort(), [rows]);
  const visible = useMemo(() => (rows ? rows.filter((t) => !collection || t.collection === collection) : null), [rows, collection]);
  // Templates without a collection first, then one group per collection.
  const groups = useMemo(() => {
    if (!visible) return [];
    const order: Array<string | null> = [null, ...collections];
    return order.map((label) => ({ label, rows: visible.filter((t) => (t.collection ?? null) === label) })).filter((g) => g.rows.length > 0);
  }, [visible, collections]);

  async function importFile(file: File) {
    setImporting(true);
    try {
      if (file.size > 2 * 1024 * 1024) {
        toast.error("The file is larger than 2 MB. Pick a template export file.");
        return;
      }
      const text = await file.text();
      const res = await fetch("/api/templates/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
      const data = (await res.json().catch(() => null)) as { id?: string; href?: string; error?: string; issues?: unknown[] } | null;
      if (!res.ok || !data?.id) {
        toast.error(data?.error ?? "The template was not imported. Check the file and try again.");
        return;
      }
      toast.success(data.issues?.length ? "Imported as a draft. Fix the listed problems before publishing." : "Imported as a draft.");
      router.push(data.href ?? `/templates/${data.id}`);
    } catch {
      toast.error("The file could not be read. Pick a template export file.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FieldSelect aria-label="Mode" value={mode} onChange={setMode} options={MODE_FILTERS} className="h-9 w-44" />
        <FieldSelect aria-label="Status" value={status} onChange={setStatus} options={STATUS_FILTERS} className="h-9 w-44" />
        {collections.length > 0 && (
          <FieldSelect
            aria-label="Collection"
            value={collection}
            onChange={setCollection}
            options={[{ value: "", label: "All collections" }, ...collections.map((c) => ({ value: c, label: c }))]}
            className="h-9 w-72"
          />
        )}
        <div className="ml-auto flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
            }}
          />
          <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import
          </Button>
          <Button variant="accent" asChild>
            <Link href="/templates/new">
              <Plus className="h-4 w-4" />
              New template
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-[13px] text-destructive" role="alert">
          {error}
        </p>
      )}

      {rows === null && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {visible && visible.length === 0 && (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates match."
          description="Start from the library, build one, or import an export file."
          action={
            <Button variant="accent" asChild>
              <Link href="/templates/new">New template</Link>
            </Button>
          }
        />
      )}

      {groups.map((group) => (
        <section key={group.label ?? ""} className="mb-6 space-y-3" aria-label={group.label ?? "Templates"}>
          {group.label && <h2 className="text-sm font-semibold">{group.label}</h2>}
          <div className="grid gap-3">
            {group.rows.map((t) => (
              <Card key={t.id} dense className="gap-2">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <Link href={templateHref(t)} className="font-medium hover:underline">
                      {t.title}
                    </Link>
                    <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
                      {MODE_LABELS[t.mode] ?? t.mode}
                      {t.injectCount ? `, ${t.injectCount} injects` : ""}
                      {t.teams.length ? `, ${t.teams.length} ${t.teams.length === 1 ? "team" : "teams"}` : ""}
                      {t.targetDurationMin ? `, ${t.targetDurationMin} min` : ""}
                      {t.scope === "library" ? ", library" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.practice && <Badge variant="outline">Practice</Badge>}
                    <Badge variant={statusVariant(t.status)}>{STATUS_LABELS[t.status] ?? t.status}</Badge>
                  </div>
                </div>
                {t.summary && (
                  <p className="line-clamp-2 text-[13px] text-[color:var(--color-muted-foreground)]">{t.summary}</p>
                )}
              </Card>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
