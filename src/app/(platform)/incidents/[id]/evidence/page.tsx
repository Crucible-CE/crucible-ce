"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { FolderLock, Upload, Loader2, FileDown, ShieldCheck, ShieldAlert, FileText, Eye, History } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Evidence {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  category: string | null;
  description: string | null;
  uploadedByName: string | null;
  createdAt: string;
  _count?: { accesses: number };
}

interface Access {
  id: string;
  userName: string | null;
  action: string;
  createdAt: string;
}

const CATEGORIES = ["logs", "screenshots", "forensics", "comms", "malware", "other"];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function IncidentEvidencePage() {
  const { id } = useParams<{ id: string }>();
  const { readOnly } = useIncidentShell();
  const [items, setItems] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const [accesses, setAccesses] = useState<Access[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${id}/evidence`);
    if (res.ok) setItems((await res.json()).evidence ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploading(true);
      try {
        for (const file of list) {
          const fd = new FormData();
          fd.append("file", file);
          if (description.trim()) fd.append("description", description.trim());
          if (category) fd.append("category", category);
          const res = await fetch(`/api/incidents/${id}/evidence`, { method: "POST", body: fd });
          if (!res.ok) {
            toast.error(res.status === 413 ? `${file.name} is over 100 MB.` : apiErrorMessage(await res.json().catch(() => null), `Couldn't upload ${file.name}. Try again.`));
          }
        }
        toast.success(list.length > 1 ? `${list.length} files uploaded & hashed` : "Evidence uploaded & hashed");
        setDescription("");
        if (fileRef.current) fileRef.current.value = "";
        await load();
      } finally {
        setUploading(false);
      }
    },
    [id, description, category, load],
  );

  const reverify = async (e: Evidence) => {
    const res = await fetch(`/api/incidents/${id}/evidence/${e.id}/verify`);
    if (res.ok) {
      const d = await res.json();
      d.intact ? toast.success(`${e.filename}: integrity verified`) : toast.error(`${e.filename}: hash mismatch. The file has changed.`);
    } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't verify. Try again."));
  };

  const showAccess = async (e: Evidence) => {
    if (accessFor === e.id) {
      setAccessFor(null);
      return;
    }
    const res = await fetch(`/api/incidents/${id}/evidence/${e.id}/access`);
    if (res.ok) {
      setAccesses((await res.json()).accesses ?? []);
      setAccessFor(e.id);
    }
  };

  const filtered = filter ? items.filter((e) => e.category === filter) : items;

  return (
    <div className="space-y-4">
      {/* ── Upload ────────────────────────────────────────────────── */}
      {!readOnly && <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="mb-1 flex items-center gap-2">
          <FolderLock className="h-4 w-4 text-[color:var(--mist-indigo)]" />
          <h2 className="text-sm font-semibold">Add evidence</h2>
        </div>
        <p className="mb-3 text-[11px] text-[color:var(--color-muted-foreground)]">
          Up to 100 MB per file. Files are hashed (SHA-256) to the ledger. Views and downloads are logged.
        </p>
        <div className="mb-2 flex flex-wrap gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 text-[12.5px]">
            <option value="">Category (optional)</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description for these files" className="h-8 flex-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 text-[12.5px]" />
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-center transition-colors",
            dragOver ? "border-[color:var(--mist-indigo)] bg-[color:var(--mist-indigo-soft)]" : "border-[color:var(--color-border)] hover:border-[color:var(--mist-indigo)]/50",
          )}
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin text-[color:var(--mist-indigo)]" /> : <Upload className="h-5 w-5 text-[color:var(--mist-indigo)]" />}
          <p className="text-[12.5px] font-medium">{uploading ? "Uploading…" : "Drop files or click to upload"}</p>
        </div>
        <input ref={fileRef} type="file" multiple onChange={(e) => e.target.files && uploadFiles(e.target.files)} className="hidden" />
      </section>}

      {/* ── Locker ────────────────────────────────────────────────── */}
      <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[color:var(--mist-ok)]" />
          <h2 className="text-sm font-semibold">Evidence locker</h2>
          <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{filtered.length} item{filtered.length === 1 ? "" : "s"}</span>
          <div className="ml-auto flex flex-wrap gap-1">
            <button type="button" onClick={() => setFilter("")} className={cn("rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10.5px]", filter === "" ? "border-[color:var(--mist-indigo)]/50 bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]" : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]")}>All</button>
            {CATEGORIES.map((c) => (
              <button key={c} type="button" onClick={() => setFilter(c)} className={cn("rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10.5px] capitalize", filter === c ? "border-[color:var(--mist-indigo)]/50 bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]" : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]")}>{c}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">Loading…</div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">No evidence{filter ? ` in “${filter}”` : ""}.</p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((e) => {
              const isImage = e.mimeType.startsWith("image/");
              return (
                <li key={e.id} className="rounded-[var(--radius-md)] border border-[color:var(--color-border)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--mist-indigo)]" />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">
                          {e.filename}
                          {e.category && <span className="ml-1.5 rounded-[var(--radius-sm)] bg-[color:var(--color-muted)] px-1.5 py-0.5 text-[10px] uppercase text-[color:var(--color-muted-foreground)]">{e.category}</span>}
                        </p>
                        {e.description && <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{e.description}</p>}
                        <p className="mt-0.5 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                          {formatBytes(e.sizeBytes)} · {e.uploadedByName ?? "Unknown"} · {new Date(e.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-[color:var(--color-muted-foreground)]" title={e.sha256}>sha256:{e.sha256.slice(0, 16)}…</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex gap-1">
                        {isImage && (
                          <button type="button" onClick={() => setPreview(preview === e.id ? null : e.id)} title="Preview" aria-label="Preview" className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-1 hover:border-[color:var(--mist-indigo)]/50">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button type="button" onClick={() => reverify(e)} title="Verify hash" aria-label="Verify hash" className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-1 hover:border-[color:var(--mist-ok)]/50">
                          <ShieldAlert className="h-3.5 w-3.5" />
                        </button>
                        <a href={`/api/incidents/${id}/evidence/${e.id}`} title="Download" aria-label="Download" className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-1 hover:border-[color:var(--mist-indigo)]/50">
                          <FileDown className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <button type="button" onClick={() => showAccess(e)} className="inline-flex items-center gap-1 text-[10px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-indigo)]">
                        <History className="h-3 w-3" /> {e._count?.accesses ?? 0} access
                      </button>
                    </div>
                  </div>

                  {preview === e.id && isImage && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={`/api/incidents/${id}/evidence/${e.id}?inline=1`} alt={e.filename} className="mt-2 max-h-72 rounded-[var(--radius-sm)] border border-[color:var(--color-border)]" />
                  )}

                  {accessFor === e.id && (
                    <div className="mt-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-2">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Access log</p>
                      {accesses.length === 0 ? (
                        <p className="text-[11px] text-[color:var(--color-muted-foreground)]">No access recorded.</p>
                      ) : (
                        <ul className="space-y-0.5">
                          {accesses.map((a) => (
                            <li key={a.id} className="flex justify-between text-[11px] text-[color:var(--color-muted-foreground)]">
                              <span>{a.userName ?? "Unknown"} · <span className="capitalize">{a.action}</span></span>
                              <span>{new Date(a.createdAt).toLocaleString()}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
