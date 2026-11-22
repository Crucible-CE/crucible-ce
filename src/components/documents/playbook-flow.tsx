"use client";

// Guided Playbook Exercise setup: pick or add a document, set the options,
// write the modules beside the document, review them, then publish the
// template and create the exercise. Every step reuses the Documents APIs.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { documentKindLabel } from "@/lib/exercise/documents/kinds";
import { cn } from "@/lib/utils";
import { AddDocumentDialog } from "./add-document-dialog";
import { BuildForm } from "./build-form";
import { DocumentTemplateEditor } from "./document-template-editor";
import { request } from "./api";

interface DocRow {
  id: string;
  title: string;
  kind: string;
  sectionCount: number;
}

interface TemplateData {
  template: {
    id: string;
    title: string;
    status: "draft" | "published" | "archived";
    config: { sourceDocumentId: string | null; paced: "facilitator" | "timer"; moduleMinutes: number | null };
  };
  modules: Array<{ title: string; content: { scenarioUpdate: string; questions: Array<{ key: string; text: string }> } }>;
  rubrics: Array<{ questionKey: string }>;
  document: { id: string; title: string } | null;
  issues: Array<{ module: number | null; message: string }>;
}

const STEPS = ["Document", "Options", "Modules", "Review"] as const;

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-2" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px]",
            i === current
              ? "border-[color:var(--mist-indigo)] text-[color:var(--mist-indigo)]"
              : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]",
          )}
        >
          {i < current ? <Check className="h-3.5 w-3.5" /> : <span className="font-mono">{i + 1}</span>}
          {s}
        </li>
      ))}
    </ol>
  );
}

export function PlaybookFlow({
  canAuthor,
  canUpload,
  initialTemplateId,
}: {
  canAuthor: boolean;
  canUpload: boolean;
  initialTemplateId: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialTemplateId ? 2 : 0);
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId);
  const [title, setTitle] = useState("");
  const [hasTemplates, setHasTemplates] = useState(false);

  const loadDocs = useCallback(async () => {
    const r = await request<{ documents: DocRow[] }>("/api/documents", { fallback: "The documents did not load. Reload the page." });
    if (r.ok) setDocs(r.data.documents);
    else setDocError(r.error);
  }, []);

  useEffect(() => {
    void loadDocs();
    void request<{ templates: Array<{ mode: string; status: string }> } | Array<{ mode: string; status: string }>>("/api/templates?status=published").then((r) => {
      if (!r.ok) return;
      const list = Array.isArray(r.data) ? r.data : (r.data.templates ?? []);
      setHasTemplates(list.some((t) => t.mode === "document" && t.status === "published"));
    });
  }, [loadDocs]);

  const doc = docs?.find((d) => d.id === docId) ?? null;

  if (!canAuthor) {
    return (
      <Card className="max-w-xl gap-2">
        <p className="text-sm">Writing a Playbook Exercise needs template access. Ask an admin or a facilitator.</p>
        {hasTemplates && (
          <Link href="/exercises/new?mode=document" className="text-sm font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
            Use a published template
          </Link>
        )}
      </Card>
    );
  }

  function created(id: string, t: string) {
    setTemplateId(id);
    setTitle(t);
    setStep(2);
    router.replace(`/exercises/new/playbook?${new URLSearchParams({ template: id }).toString()}`);
  }

  return (
    <div className={step === 2 ? "max-w-none" : "max-w-3xl"}>
      <Steps current={step} />

      {step === 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Pick a document</h2>
            {canUpload && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Add document
              </Button>
            )}
          </div>
          {docError && (
            <p role="alert" className="text-sm text-[color:var(--mist-danger)]">
              {docError}
            </p>
          )}
          {docs === null && !docError && <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />}
          {docs && docs.length === 0 && <p className="text-sm text-[color:var(--color-muted-foreground)]">No documents yet. Upload a file or paste the text.</p>}
          {docs && docs.length > 0 && (
            <div role="radiogroup" aria-label="Document" className="grid gap-2 sm:grid-cols-2">
              {docs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={docId === d.id}
                  onClick={() => setDocId(d.id)}
                  className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)]"
                >
                  <Card dense className={cn("h-full flex-row items-start gap-3", docId === d.id && "ring-2 ring-[color:var(--mist-indigo)]")}>
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold">{d.title}</div>
                      <div className="text-[12px] text-[color:var(--color-muted-foreground)]">
                        {documentKindLabel(d.kind)}, {d.sectionCount} {d.sectionCount === 1 ? "section" : "sections"}
                      </div>
                    </div>
                  </Card>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="accent" disabled={!doc} onClick={() => setStep(1)}>
              Next
            </Button>
            {hasTemplates && (
              <Link href="/exercises/new?mode=document" className="text-[13px] font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
                Use a published template
              </Link>
            )}
          </div>
          <AddDocumentDialog
            open={adding}
            onOpenChange={setAdding}
            onCreated={(id) => {
              setDocId(id);
              void loadDocs();
            }}
          />
        </div>
      )}

      {step === 1 && doc && (
        <div className="space-y-4">
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(0)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <BuildForm documentId={doc.id} documentTitle={doc.title} sectionCount={doc.sectionCount} onCreated={created} extra={<CloudSeam feature="sop-analysis" />} />
        </div>
      )}

      {step === 2 && templateId && (
        <div className="space-y-4">
          <DocumentTemplateEditor id={templateId} canLaunch={false} embedded />
          <div className="flex justify-end">
            <Button variant="accent" onClick={() => setStep(3)}>
              Review
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 3 && templateId && (
        <Review templateId={templateId} initialTitle={title} onBack={() => setStep(2)} onCreated={(id) => router.push(`/exercises/${id}`)} />
      )}
    </div>
  );
}

function Review({
  templateId,
  initialTitle,
  onBack,
  onCreated,
}: {
  templateId: string;
  initialTitle: string;
  onBack: () => void;
  onCreated: (exerciseId: string) => void;
}) {
  const [data, setData] = useState<TemplateData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ module: number | null; message: string }>>([]);

  const load = useCallback(async () => {
    const r = await request<TemplateData>(`/api/documents/templates/${templateId}`, { fallback: "The exercise did not load. Reload the page." });
    if (!r.ok) return setLoadError(r.error);
    setLoadError(null);
    setData(r.data);
    setIssues(r.data.issues);
    setTitle((t) => t || r.data.template.title);
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!data) return;
    setBusy(true);
    setError(null);
    if (data.template.status !== "published") {
      const p = await request(`/api/documents/templates/${templateId}/publish`, { method: "POST", fallback: "The modules could not be published. Try again." });
      if (!p.ok) {
        setBusy(false);
        setError(p.error);
        const list = (p.body as { issues?: Array<{ module: number | null; message: string }> } | null)?.issues;
        if (Array.isArray(list)) setIssues(list);
        return;
      }
    }
    const sourceDocumentId = data.template.config.sourceDocumentId ?? data.document?.id;
    const timed = data.template.config.paced === "timer" && Boolean(data.template.config.moduleMinutes);
    const r = await request<{ id: string }>("/api/exercises", {
      body: {
        mode: "document",
        templateId,
        title: title.trim() || data.template.title,
        advancePolicy: timed ? "timer" : "facilitator",
        ...(sourceDocumentId ? { sourceDocumentId } : {}),
      },
      fallback: "The exercise was not created. Try again.",
    });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      await load();
      return;
    }
    onCreated(r.data.id);
  }

  if (loadError) return <p role="alert" className="text-sm text-[color:var(--mist-danger)]">{loadError}</p>;
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />;
  const t = data.template;

  if (t.status === "archived") {
    return <p className="text-sm">This template is archived. Restore it in the editor first.</p>;
  }

  const questions = data.modules.reduce((n, m) => n + m.content.questions.length, 0);
  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Back to the modules
      </Button>
      <Card className="gap-3">
        <div>
          <h2 className="text-base font-semibold">{t.title}</h2>
          <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">
            {data.modules.length} {data.modules.length === 1 ? "module" : "modules"}, {questions} {questions === 1 ? "question" : "questions"},{" "}
            {data.rubrics.length} {data.rubrics.length === 1 ? "rubric" : "rubrics"}
            {data.document ? `. From ${data.document.title}.` : "."}
          </p>
        </div>
        <ol className="space-y-3" data-testid="playbook-modules">
          {data.modules.map((m, i) => (
            <li key={i} className="rounded-lg border border-[color:var(--color-border)] p-3">
              <p className="text-[14px] font-semibold">
                {i + 1}. {m.title || "Untitled module"}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-[color:var(--color-muted-foreground)]">
                {m.content.questions.map((q) => (
                  <li key={q.key}>{q.text || "No question text yet."}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Card>
      {issues.length > 0 && (
        <Card dense className="gap-1 text-sm">
          <p className="font-medium">Fix these first</p>
          <ul className="list-disc pl-5">
            {issues.map((x, i) => (
              <li key={i}>{x.message}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="max-w-xl space-y-2">
        <Label htmlFor="playbook-title">Exercise title</Label>
        <Input id="playbook-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-[color:var(--mist-danger)]">
          {error}
        </p>
      )}
      <Button variant="accent" disabled={busy || data.modules.length === 0 || issues.length > 0} onClick={() => void create()}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Create exercise
      </Button>
    </div>
  );
}
