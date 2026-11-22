"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Download, Hammer, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialogProvider, useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldSelect } from "@/components/form/field-select";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, documentKindLabel, type DocumentKind } from "@/lib/exercise/documents/kinds";
import { formatBytes, formatDate, request } from "./api";

interface Section {
  id: string;
  heading: string;
  level: number;
  start: number;
  end: number;
}

interface DocumentData {
  document: {
    id: string;
    title: string;
    kind: string;
    scope: string;
    collection: string | null;
    text: string;
    sha256: string;
    sections: Section[];
    file: { name: string; mime: string; size: number } | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
  };
  usage: {
    exercises: Array<{ id: string; title: string; status: string }>;
    templates: Array<{ id: string; title: string; status: string }>;
  };
}

const TEMPLATE_STATUS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

/** Non-overlapping parts of the text, each starting at a section heading. */
function parts(text: string, sections: Section[]) {
  const starts = [...new Map([...sections].sort((a, b) => a.start - b.start).map((s) => [s.start, s])).values()];
  const out: Array<{ id: string | null; level: number; body: string }> = [];
  const first = starts[0]?.start ?? text.length;
  if (first > 0) out.push({ id: null, level: 1, body: text.slice(0, first) });
  starts.forEach((s, i) => out.push({ id: s.id, level: s.level, body: text.slice(s.start, starts[i + 1]?.start ?? text.length) }));
  return out.filter((p) => p.body.trim());
}

function View({ id, canManage, canBuild }: { id: string; canManage: boolean; canBuild: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [data, setData] = useState<DocumentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DocumentKind>("other");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await request<DocumentData>(`/api/documents/${id}`, { fallback: "The document did not load. Reload the page." });
    if (r.ok) {
      setData(r.data);
      setTitle(r.data.document.title);
      setKind((DOCUMENT_KINDS as readonly string[]).includes(r.data.document.kind) ? (r.data.document.kind as DocumentKind) : "other");
    } else setError(r.error);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const textParts = useMemo(() => (data ? parts(data.document.text, data.document.sections) : []), [data]);

  if (error) return <p role="alert" className="text-sm text-[color:var(--mist-danger)]">{error}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }
  const d = data.document;
  const library = d.scope === "library";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    const r = await request(`/api/documents/${id}`, { method: "PATCH", body: { title: title.trim(), kind }, fallback: "The changes were not saved. Try again." });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Saved.");
    setEditing(false);
    void load();
  }

  async function duplicate() {
    setBusy("duplicate");
    const r = await request<{ id: string }>(`/api/documents/${id}/duplicate`, { method: "POST", fallback: "The document was not copied. Try again." });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Copied to your documents.");
    router.push(`/documents/${r.data.id}`);
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this document?",
      description: "Templates built from it keep their modules. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy("delete");
    const r = await request(`/api/documents/${id}`, { method: "DELETE", fallback: "The document was not deleted. Try again." });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Document deleted.");
    router.push("/documents");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="headline">{d.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
            {library && <Badge variant="accent">Library</Badge>}
            <Badge variant="outline">{documentKindLabel(d.kind)}</Badge>
            <span>{d.sections.length} sections</span>
            {library ? (
              <span>{d.collection ?? "Built in"}</span>
            ) : (
              <span>{d.file ? `${d.file.name}, ${formatBytes(d.file.size)}` : "Pasted text"}</span>
            )}
            <span>
              {library ? "Updated" : "Added"} {formatDate(library ? d.updatedAt : d.createdAt)}
              {d.createdBy ? ` by ${d.createdBy}` : ""}
            </span>
            <span className="font-mono" title={d.sha256}>
              SHA-256 {d.sha256.slice(0, 12)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canBuild && (
            <Button asChild>
              <Link href={`/documents/${id}/build`}>
                <Hammer className="h-4 w-4" />
                Build exercise
              </Link>
            </Button>
          )}
          {d.file && (
            <Button variant="outline" asChild>
              <a href={`/api/documents/${id}/file`}>
                <Download className="h-4 w-4" />
                Download
              </a>
            </Button>
          )}
          {canManage && library && (
            <Button variant="outline" disabled={busy !== null} onClick={() => void duplicate()}>
              {busy === "duplicate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              Duplicate to edit
            </Button>
          )}
          {canManage && !library && (
            <>
              <Button variant="outline" onClick={() => setEditing((v) => !v)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button variant="outline" disabled={busy !== null || data.usage.exercises.length > 0} onClick={() => void remove()} title={data.usage.exercises.length > 0 ? "An exercise that has not ended uses this document." : undefined}>
                {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {library && (
        <p className="text-sm text-[color:var(--color-muted-foreground)]">Duplicate this library document to edit it.</p>
      )}

      {editing && canManage && !library && (
        <Card dense>
          <form onSubmit={(e) => void save(e)} className="grid gap-3 sm:grid-cols-[1fr_240px_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="doc-edit-title">Title</Label>
              <Input id="doc-edit-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-edit-kind">Type</Label>
              <FieldSelect id="doc-edit-kind" value={kind} onChange={(v) => setKind(v as DocumentKind)} options={DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] }))} />
            </div>
            <Button type="submit" disabled={busy !== null || !title.trim()}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </form>
        </Card>
      )}

      {(data.usage.templates.length > 0 || data.usage.exercises.length > 0) && (
        <Card dense className="gap-3">
          {data.usage.templates.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Templates from this document</p>
              <ul className="space-y-1 text-sm">
                {data.usage.templates.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    {canBuild ? (
                      <Link href={`/documents/templates/${t.id}`} className="text-[color:var(--mist-indigo)] hover:underline">
                        {t.title}
                      </Link>
                    ) : (
                      <span>{t.title}</span>
                    )}
                    <Badge variant="outline">{TEMPLATE_STATUS[t.status] ?? t.status}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.usage.exercises.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Exercises using it</p>
              <ul className="space-y-1 text-sm">
                {data.usage.exercises.map((x) => (
                  <li key={x.id}>
                    <Link href={`/exercises/${x.id}`} className="text-[color:var(--mist-indigo)] hover:underline">
                      {x.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Sections" className="lg:sticky lg:top-4 lg:max-h-[80vh] lg:overflow-y-auto">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Sections</p>
          <ul className="space-y-1 text-sm">
            {d.sections.map((s) => (
              <li key={s.id} style={{ paddingLeft: `${Math.max(0, s.level - 1) * 12}px` }}>
                <a href={`#sec-${s.id}`} className="block truncate rounded px-2 py-1 hover:bg-[color:var(--color-muted)]" title={s.heading}>
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <Card className="gap-0">
          {textParts.map((p, i) => (
            <section key={p.id ?? `intro-${i}`} id={p.id ? `sec-${p.id}` : undefined} className={cn("scroll-mt-4", i > 0 && "mt-4")}>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{p.body.trim()}</pre>
            </section>
          ))}
        </Card>
      </div>
    </div>
  );
}

export function DocumentView(props: { id: string; canManage: boolean; canBuild: boolean }) {
  return (
    <ConfirmDialogProvider>
      <View {...props} />
    </ConfirmDialogProvider>
  );
}
