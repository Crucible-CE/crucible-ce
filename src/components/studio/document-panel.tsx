"use client";

// Document TTX module fields. Rubrics stay in the Document TTX editor.

import Link from "next/link";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { ChipGroup, Field, KeyPicker } from "@/components/templates/editor/fields";
import { QUESTION_CATEGORIES, QUESTION_CATEGORY_LABELS } from "@/lib/exercise/modes/document/schema";
import { newQuestionKey, type DocumentContent, type DocumentSecret, type DraftGraph, type DraftInject, type DraftQuestion } from "@/lib/exercise/studio/editor";
import { HiddenBadge, LinesField, MarkdownField, PanelSection } from "./bits";

type Options = Array<{ value: string; label: string }>;
const CATEGORY_OPTIONS = QUESTION_CATEGORIES.map((c) => ({ value: c, label: QUESTION_CATEGORY_LABELS[c] }));
const MAX_QUESTIONS = 8;

export function DocumentPanel({
  templateId,
  graph,
  inject,
  readOnly,
  capabilities,
  sections,
  rubricKeys,
  onChange,
}: {
  templateId: string;
  graph: DraftGraph;
  inject: DraftInject;
  readOnly: boolean;
  capabilities: Options;
  sections: Options;
  rubricKeys: string[];
  onChange: (fn: (i: DraftInject) => DraftInject) => void;
}) {
  const c = inject.content as DocumentContent;
  const s = inject.secret as DocumentSecret;
  const objectives = graph.template.objectives.map((o) => ({ value: o.key, label: o.key }));
  const setContent = (patch: Partial<DocumentContent>) => onChange((i) => ({ ...i, content: { ...(i.content as DocumentContent), ...patch } }));
  const setQuestion = (key: string, patch: Partial<DraftQuestion>) => setContent({ questions: c.questions.map((q) => (q.key === key ? { ...q, ...patch } : q)) });

  return (
    <fieldset disabled={readOnly} className="flex flex-col gap-5">
      <PanelSection title="Module">
        <Field label="Scenario update" htmlFor="doc-update" hint="What the room learns. Markdown.">
          <MarkdownField id="doc-update" value={c.scenarioUpdate} maxLength={6000} onChange={(scenarioUpdate) => setContent({ scenarioUpdate })} />
        </Field>
        <Field label="What it tests" htmlFor="doc-rationale">
          <Textarea id="doc-rationale" rows={2} maxLength={1500} value={c.rationale ?? ""} onChange={(e) => setContent({ rationale: e.target.value })} />
        </Field>
        <Field label="Key issues" hint="One per line.">
          <LinesField aria-label="Key issues" value={c.keyIssues} max={8} onChange={(keyIssues) => setContent({ keyIssues })} />
        </Field>
        <Field label="Source excerpt" htmlFor="doc-excerpt" hint="Copied word for word from the document.">
          <Textarea id="doc-excerpt" rows={2} maxLength={3000} value={c.sourceExcerpt ?? ""} onChange={(e) => setContent({ sourceExcerpt: e.target.value })} />
        </Field>
        {sections.length > 0 && (
          <Field label="Sections">
            <KeyPicker label="Sections" addLabel="Add section" options={sections} value={c.docSectionRefs} max={8} onChange={(docSectionRefs) => setContent({ docSectionRefs })} />
          </Field>
        )}
      </PanelSection>

      <PanelSection
        title="Questions"
        action={
          <Link href={`/documents/templates/${templateId}`} className="text-[12px] text-[color:var(--mist-indigo)] hover:underline">
            Edit rubrics
          </Link>
        }
      >
        {c.questions.map((q, n) => (
          <div key={q.key} className="flex flex-col gap-2 rounded-lg border border-[color:var(--color-border)] p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">{q.key}</span>
              <Textarea aria-label={`Question ${n + 1}`} rows={2} maxLength={1000} value={q.text} onChange={(e) => setQuestion(q.key, { text: e.target.value })} />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove question ${n + 1}`}
                disabled={c.questions.length <= 1}
                onClick={() => setContent({ questions: c.questions.filter((x) => x.key !== q.key) })}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {!rubricKeys.includes(q.key) && <p className="text-[12px] text-[color:var(--mist-warn)]">No rubric yet. Add one in the Playbook Exercise editor after saving.</p>}
            <FieldSelect aria-label={`Question ${n + 1} category`} className="h-9" value={q.category} options={CATEGORY_OPTIONS} onChange={(category) => setQuestion(q.key, { category })} />
            {objectives.length > 0 && <ChipGroup label={`Objectives for question ${n + 1}`} options={objectives} value={q.objectiveKeys} onChange={(objectiveKeys) => setQuestion(q.key, { objectiveKeys })} />}
            <KeyPicker label={`Capabilities for question ${n + 1}`} addLabel="Add capability" options={capabilities} value={q.capabilityKeys} max={6} onChange={(capabilityKeys) => setQuestion(q.key, { capabilityKeys })} />
            {sections.length > 0 && (
              <KeyPicker label={`Sections for question ${n + 1}`} addLabel="Add section" options={sections} value={q.docSectionRefs} max={6} onChange={(docSectionRefs) => setQuestion(q.key, { docSectionRefs })} />
            )}
          </div>
        ))}
        {c.questions.length < MAX_QUESTIONS && (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() =>
              setContent({
                questions: [...c.questions, { key: newQuestionKey(graph), text: "", category: "decision_making", capabilityKeys: [], objectiveKeys: [], docSectionRefs: [] }],
              })
            }
          >
            <Plus className="h-4 w-4" />
            Add question
          </Button>
        )}
      </PanelSection>

      <PanelSection title="Expected actions" action={<HiddenBadge />}>
        <LinesField
          aria-label="Expected actions"
          value={s.expectedActions}
          max={10}
          placeholder="One per line"
          onChange={(expectedActions) => onChange((i) => ({ ...i, secret: { ...(i.secret as DocumentSecret), expectedActions } }))}
        />
      </PanelSection>
    </fieldset>
  );
}
