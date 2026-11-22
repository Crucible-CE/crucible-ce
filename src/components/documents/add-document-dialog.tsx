"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/exercise/documents/kinds";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { request } from "./api";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

export function AddDocumentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the new document id instead of opening the document page. */
  onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const [source, setSource] = useState<"file" | "paste">("file");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DocumentKind>("playbook");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTitle("");
    setFile(null);
    setText("");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (source === "file") {
      if (!file) return setError("Choose a file.");
      if (file.size > MAX_BYTES) return setError("The file is larger than 10 MB. Upload a smaller file.");
    } else if (!text.trim()) {
      return setError("Paste the document text.");
    }
    if (source === "paste" && !title.trim()) return setError("Enter a title.");
    setBusy(true);
    let r;
    if (source === "file") {
      const form = new FormData();
      form.set("file", file!);
      form.set("kind", kind);
      if (title.trim()) form.set("title", title.trim());
      r = await request<{ id: string }>("/api/documents", { form, fallback: "The upload failed. Try again." });
    } else {
      r = await request<{ id: string }>("/api/documents", { body: { title: title.trim(), kind, text }, fallback: "The document was not saved. Try again." });
    }
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast.success("Document added.");
    reset();
    onOpenChange(false);
    if (onCreated) onCreated(r.data.id);
    else router.push(`/documents/${r.data.id}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          if (!v) reset();
          onOpenChange(v);
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a document</DialogTitle>
          <DialogDescription>PDF, Word, Markdown or plain text, up to 10 MB.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="inline-flex rounded-md bg-[color:var(--color-muted)] p-1" role="tablist" aria-label="Source">
            {(["file", "paste"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                onClick={() => setSource(s)}
                className={`rounded px-3 py-1 text-sm ${source === s ? "bg-[color:var(--color-card)] font-medium shadow-[var(--elevation-0)]" : "text-[color:var(--color-muted-foreground)]"}`}
              >
                {s === "file" ? "Upload" : "Paste"}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="doc-title">Title</Label>
              <Input id="doc-title" value={title} maxLength={200} placeholder={source === "file" ? "From the file name" : ""} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-kind">Type</Label>
              <FieldSelect id="doc-kind" value={kind} onChange={(v) => setKind(v as DocumentKind)} options={DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] }))} />
            </div>
          </div>

          {source === "file" ? (
            <div className="space-y-1.5">
              <Label htmlFor="doc-file">File</Label>
              <input
                ref={inputRef}
                id="doc-file"
                type="file"
                accept={ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[color:var(--color-muted)] file:px-3 file:py-2 file:text-sm file:font-medium"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="doc-text">Text</Label>
              <Textarea id="doc-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} className="max-h-[50vh] font-mono text-xs" />
              <p className="text-xs text-[color:var(--color-muted-foreground)]">Headings like ## Escalation or 3.2 Notification become sections.</p>
            </div>
          )}

          <CloudSeam feature="document-analysis" />

          {error && (
            <p role="alert" className="text-sm text-[color:var(--mist-danger)]">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {source === "file" ? "Upload" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
