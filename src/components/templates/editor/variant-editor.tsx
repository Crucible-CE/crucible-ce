"use client";

import { Plus, Trash2 } from "lucide-react";
import { ARTIFACT_KIND_LABELS, PATH_KEYS, PATH_LABELS, type Artifact, type PathKey } from "@/lib/exercise/modes/crisissim/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldSelect } from "@/components/form/field-select";
import { CRISISSIM_LABELS as L } from "@/lib/exercise/build-guide/labels";
import { Field } from "./fields";
import type { EditorInject, Variant } from "./state";

const MAX_ARTIFACTS = 6;
const KIND_OPTIONS = (Object.keys(ARTIFACT_KIND_LABELS) as Artifact["kind"][]).map((k) => ({ value: k, label: ARTIFACT_KIND_LABELS[k] }));

type EditInject = (fn: (d: EditorInject) => void) => void;

export function PathTabs({ inject, edit }: { inject: EditorInject; edit: EditInject }) {
  return (
    <Tabs defaultValue="optimal">
      <TabsList className="h-auto w-full flex-wrap sm:w-fit">
        {PATH_KEYS.map((p) => (
          <TabsTrigger key={p} value={p} className="gap-1.5">
            {PATH_LABELS[p]}
            <span className="font-mono text-[10px] opacity-70">{p}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {PATH_KEYS.map((p) => (
        <TabsContent key={p} value={p} className="pt-2">
          <VariantEditor injectKey={inject.key} path={p} variant={inject.content.variants[p]} edit={(fn) => edit((d) => fn(d.content.variants[p]))} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function VariantEditor({
  injectKey,
  path,
  variant,
  edit,
}: {
  injectKey: string;
  path: PathKey;
  variant: Variant;
  edit: (fn: (v: Variant) => void) => void;
}) {
  const base = `${injectKey}-${path}`;

  return (
    <div className="flex flex-col gap-4">
      <Field label={L.narrative} htmlFor={`${base}-narrative`}>
        <Textarea
          id={`${base}-narrative`}
          rows={8}
          maxLength={8000}
          value={variant.narrativeMd}
          onChange={(e) => {
            const v = e.target.value;
            edit((d) => void (d.narrativeMd = v));
          }}
        />
      </Field>
      <Field label={L.consequence} htmlFor={`${base}-consequence`}>
        <Textarea
          id={`${base}-consequence`}
          rows={3}
          maxLength={2000}
          value={variant.consequenceText ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            edit((d) => void (d.consequenceText = v));
          }}
        />
      </Field>
      <Artifacts base={base} path={path} artifacts={variant.artifacts} edit={edit} />
    </div>
  );
}

function Artifacts({
  base,
  path,
  artifacts,
  edit,
}: {
  base: string;
  path: PathKey;
  artifacts: Artifact[];
  edit: (fn: (v: Variant) => void) => void;
}) {
  function add() {
    edit((d) => {
      const ids = new Set(d.artifacts.map((a) => a.id));
      let n = d.artifacts.length + 1;
      while (ids.has(`${path[0]}${n}`)) n += 1;
      d.artifacts.push({ id: `${path[0]}${n}`, kind: "email", title: "", from: "", content: "" });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-medium">{L.artifacts}</h4>
        <Button size="sm" variant="outline" disabled={artifacts.length >= MAX_ARTIFACTS} onClick={add}>
          <Plus className="h-4 w-4" />
          Add artifact
        </Button>
      </div>
      {artifacts.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No artifacts.</p>}
      {artifacts.map((a, i) => (
        <div key={a.id} className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] p-3">
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label={L.kind} htmlFor={`${base}-${a.id}-kind`}>
              <FieldSelect
                id={`${base}-${a.id}-kind`}
                className="h-9"
                value={a.kind}
                options={KIND_OPTIONS}
                onChange={(v) => edit((d) => void (d.artifacts[i].kind = v as Artifact["kind"]))}
              />
            </Field>
            <Field label={L.title} htmlFor={`${base}-${a.id}-title`}>
              <Input
                id={`${base}-${a.id}-title`}
                value={a.title}
                maxLength={200}
                onChange={(e) => {
                  const v = e.target.value;
                  edit((d) => void (d.artifacts[i].title = v));
                }}
              />
            </Field>
            <Field label={L.from} htmlFor={`${base}-${a.id}-from`}>
              <Input
                id={`${base}-${a.id}-from`}
                value={a.from ?? ""}
                maxLength={200}
                onChange={(e) => {
                  const v = e.target.value;
                  edit((d) => void (d.artifacts[i].from = v));
                }}
              />
            </Field>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove artifact ${i + 1}`}
              onClick={() => edit((d) => void d.artifacts.splice(i, 1))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Field label={L.text} htmlFor={`${base}-${a.id}-content`}>
            <Textarea
              id={`${base}-${a.id}-content`}
              rows={4}
              maxLength={8000}
              value={a.content}
              onChange={(e) => {
                const v = e.target.value;
                edit((d) => void (d.artifacts[i].content = v));
              }}
            />
          </Field>
        </div>
      ))}
    </div>
  );
}
