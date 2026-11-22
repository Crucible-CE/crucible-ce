"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldSelect } from "@/components/form/field-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, documentKindLabel } from "@/lib/exercise/documents/kinds";
import { AddDocumentDialog } from "./add-document-dialog";
import { formatBytes, formatDate, request } from "./api";

interface Row {
  id: string;
  title: string;
  kind: string;
  scope: string;
  collection: string | null;
  sectionCount: number;
  file: { name: string; mime: string; size: number } | null;
  createdBy: string | null;
  updatedAt: string;
}

export function DocumentsClient({ canManage, initialScope = "" }: { canManage: boolean; initialScope?: "" | "library" | "local" }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [scope, setScope] = useState<"" | "library" | "local">(initialScope);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (kind) qs.set("kind", kind);
    if (scope) qs.set("scope", scope);
    const r = await request<{ documents: Row[] }>(`/api/documents${qs.size ? `?${qs.toString()}` : ""}`, { fallback: "The documents did not load. Reload the page." });
    if (r.ok) {
      setRows(r.data.documents);
      setError(null);
    } else setError(r.error);
  }, [kind, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={scope || "all"} onValueChange={(v) => setScope(v === "all" ? "" : (v as "library" | "local"))}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="local">Yours</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
          </TabsList>
        </Tabs>
        <FieldSelect
          aria-label="Type"
          className="w-56"
          value={kind}
          onChange={setKind}
          options={[{ value: "", label: "All types" }, ...DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] }))]}
        />
        {canManage && (
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add document
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-[color:var(--mist-danger)]">
          {error}
        </p>
      )}
      {!rows && !error && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />
        </div>
      )}
      {rows && rows.length === 0 && (
        <EmptyState
          icon={FileText}
          title="No documents yet."
          description={canManage ? "Add a playbook, plan or SOP to build an exercise from it." : "A facilitator adds documents here."}
        />
      )}
      {rows && rows.length > 0 && (
        <Card className="gap-0 p-0">
          <ul className="divide-y divide-[color:var(--color-border)]">
            {rows.map((d) => (
              <li key={d.id}>
                <Link href={`/documents/${d.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-[color:var(--color-muted)]">
                  <FileText className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                  {d.scope === "library" && (
                    <Badge variant="accent" title={d.collection ?? undefined}>
                      Library
                    </Badge>
                  )}
                  <Badge variant="outline">{documentKindLabel(d.kind)}</Badge>
                  <span className="w-24 text-right text-xs text-[color:var(--color-muted-foreground)]">
                    {d.sectionCount} {d.sectionCount === 1 ? "section" : "sections"}
                  </span>
                  <span className="w-20 text-right text-xs text-[color:var(--color-muted-foreground)]">{d.file ? formatBytes(d.file.size) : d.scope === "library" ? "Built in" : "Pasted"}</span>
                  <span className="w-28 text-right text-xs text-[color:var(--color-muted-foreground)]">{formatDate(d.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {canManage && (
        <AddDocumentDialog
          open={adding}
          onOpenChange={(v) => {
            setAdding(v);
            if (!v) void load();
          }}
        />
      )}
    </div>
  );
}
