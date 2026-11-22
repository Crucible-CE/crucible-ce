"use client";

// "How to build this": the editor's steps in order, and a prompt built from
// what is already entered, for the facilitator's own AI tool. CE sends the
// prompt nowhere. The facilitator copies the answer into the fields by hand.
// The AAR workspace reuses it for "How to write the AAR" with its own copy,
// no inject count, and the live finalize blockers.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_DRAFT_INJECTS } from "@/lib/exercise/build-guide/prompt-parts";

export const BUILD_GUIDE_COPY = {
  trigger: "How to build this",
  title: "How to build this",
  description: "The steps in editor order, and a prompt for your own AI tool.",
  steps: "Steps",
  prompt: "Prompt",
  count: "Injects to draft",
  brackets: "Replace the parts in brackets before you send it.",
  copy: "Copy prompt",
  copied: "Prompt copied.",
  copyFailed: "The prompt was not copied. Select the text and copy it.",
  caution: "Use your organization's approved AI tool. Don't paste confidential details into a public one.",
  manual: (editor: string) => `Copy each part of the answer into the matching field. ${editor} does not import it.`,
} as const;

export interface GuideCopy {
  trigger: string;
  title: string;
  description: string;
  caution: string;
  /** The manual entry line under the prompt. */
  manual: string;
}

export function BuildGuideDialog({
  editorName,
  steps,
  defaultCount,
  buildPrompt,
  cloudNote,
  size = "default",
  copy: copyText,
  extra,
  onOpen,
  brackets = true,
}: {
  /** "Crisis Sim" or "Scenario Studio", for the manual entry line. */
  editorName: string;
  steps: readonly string[];
  /** Injects to draft. Without it the count field is hidden. */
  defaultCount?: number;
  buildPrompt: (count: number) => string;
  /** A CloudSeam for this spot, if any. */
  cloudNote?: React.ReactNode;
  size?: "default" | "sm";
  /** Text in place of the "How to build this" defaults. */
  copy?: Partial<GuideCopy>;
  /** Shown after the steps. */
  extra?: ReactNode;
  /** Called each time the dialog opens. */
  onOpen?: () => void;
  /** Show the "replace the parts in brackets" line. */
  brackets?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [countText, setCountText] = useState(String(defaultCount ?? 1));
  const ref = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const parsed = Number.parseInt(countText, 10);
  const fallback = defaultCount ?? 1;
  const count = Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, MAX_DRAFT_INJECTS) : fallback;
  const text = {
    trigger: copyText?.trigger ?? BUILD_GUIDE_COPY.trigger,
    title: copyText?.title ?? BUILD_GUIDE_COPY.title,
    description: copyText?.description ?? BUILD_GUIDE_COPY.description,
    caution: copyText?.caution ?? BUILD_GUIDE_COPY.caution,
    manual: copyText?.manual ?? BUILD_GUIDE_COPY.manual(editorName),
  };
  const prompt = useMemo(() => (open ? buildPrompt(count) : ""), [open, buildPrompt, count]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(BUILD_GUIDE_COPY.copied);
    } catch {
      ref.current?.select();
      toast.error(BUILD_GUIDE_COPY.copyFailed);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setCountText(String(fallback));
          onOpen?.();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size={size}>
          <BookOpen className="h-4 w-4" />
          {text.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent
        ref={contentRef}
        onOpenAutoFocus={(e) => {
          // Start at the top of the dialog, not on the first field.
          e.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[90dvh] sm:max-w-3xl">
        <DialogHeader className="border-b border-[color:var(--color-border)] px-4 pt-4 pb-3 pr-12 text-left sm:px-6 sm:pt-5">
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">{BUILD_GUIDE_COPY.steps}</h3>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-snug">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>

          {extra}

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[13px] font-semibold">{BUILD_GUIDE_COPY.prompt}</h3>
                {brackets && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">{BUILD_GUIDE_COPY.brackets}</p>}
              </div>
              {defaultCount !== undefined && (
              <div className="flex items-center gap-2">
                <Label htmlFor="build-guide-count" className="text-[13px]">
                  {BUILD_GUIDE_COPY.count}
                </Label>
                <Input
                  id="build-guide-count"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_DRAFT_INJECTS}
                  className="h-8 w-20"
                  value={countText}
                  onChange={(e) => setCountText(e.target.value)}
                  onBlur={() => setCountText(String(count))}
                />
              </div>
              )}
            </div>
            <Textarea
              ref={ref}
              readOnly
              aria-label={BUILD_GUIDE_COPY.prompt}
              value={prompt}
              rows={14}
              spellCheck={false}
              className="max-h-[50dvh] min-h-48 resize-y font-mono text-[12px] leading-relaxed [field-sizing:fixed] md:text-[12px]"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Button className="w-fit shrink-0" onClick={() => void copy()} disabled={!prompt}>
                <Copy className="h-4 w-4" />
                {BUILD_GUIDE_COPY.copy}
              </Button>
              <p className="text-[12px] leading-snug text-[color:var(--color-muted-foreground)]">{text.caution}</p>
            </div>
            <p className="text-[13px]">{text.manual}</p>
          </section>

          {cloudNote}
        </div>
      </DialogContent>
    </Dialog>
  );
}
