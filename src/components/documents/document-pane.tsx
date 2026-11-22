"use client";

// The source document beside the Playbook Exercise editor. Lists the
// sections, starts a module from one, and quotes selected text word for word
// into the module being edited.

import { useMemo, useRef, useState } from "react";
import { ListPlus, Quote, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PaneSection {
  id: string;
  heading: string;
  level: number;
  start: number;
  end: number;
}

interface Block {
  section: PaneSection | null;
  heading: string | null;
  body: string;
}

/** Split the text into a preamble and one block per section, in order, without overlap. */
function blocksOf(text: string, sections: PaneSection[]): Block[] {
  const sorted = [...sections].sort((a, b) => a.start - b.start);
  const out: Block[] = [];
  const first = sorted[0]?.start ?? text.length;
  if (first > 0 && text.slice(0, first).trim()) out.push({ section: null, heading: null, body: text.slice(0, first).trim() });
  for (const [i, s] of sorted.entries()) {
    const stop = sorted[i + 1]?.start ?? text.length;
    const chunk = text.slice(s.start, Math.max(s.start, stop));
    const nl = chunk.indexOf("\n");
    out.push({ section: s, heading: s.heading, body: (nl >= 0 ? chunk.slice(nl + 1) : "").trim() });
  }
  if (out.length === 0) out.push({ section: null, heading: null, body: text.trim() });
  return out;
}

export function DocumentPane({
  title,
  text,
  sections,
  activeModule,
  canEdit,
  onStartModule,
  onQuote,
}: {
  title: string;
  text: string;
  sections: PaneSection[];
  /** One-based number of the module quotes go into, or null when there is none. */
  activeModule: number | null;
  canEdit: boolean;
  onStartModule: (section: PaneSection) => void;
  onQuote: (text: string, sectionId: string | null) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<{ text: string; sectionId: string | null } | null>(null);
  const blocks = useMemo(() => blocksOf(text, sections), [text, sections]);
  const q = filter.trim().toLowerCase();
  const shown = q ? blocks.filter((b) => (b.heading ?? "").toLowerCase().includes(q) || b.body.toLowerCase().includes(q)) : blocks;

  function readSelection() {
    const sel = typeof window === "undefined" ? null : window.getSelection();
    const picked = sel?.toString().trim() ?? "";
    if (!sel || !picked || !bodyRef.current || !sel.anchorNode || !bodyRef.current.contains(sel.anchorNode)) {
      setSelection(null);
      return;
    }
    const el = (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement)?.closest("[data-section-id]");
    setSelection({ text: picked.slice(0, 3000), sectionId: el?.getAttribute("data-section-id") || null });
  }

  return (
    <Card dense className="max-h-[calc(100vh-2rem)] gap-3 overflow-hidden">
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Source document</p>
        <p className="truncate text-sm font-semibold">{title}</p>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" aria-hidden />
        <Input aria-label="Find in the document" placeholder="Find in the document" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 pl-8 text-xs" />
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-[color:var(--color-muted)] p-2 text-xs">
          <Button
            size="xs"
            variant="outline"
            disabled={!selection || activeModule === null}
            onClick={() => {
              if (!selection) return;
              onQuote(selection.text, selection.sectionId);
              window.getSelection()?.removeAllRanges();
              setSelection(null);
            }}
          >
            <Quote className="h-3 w-3" />
            Quote selection
          </Button>
          <span className="text-[color:var(--color-muted-foreground)]">
            {activeModule === null ? "Add a module first." : selection ? `Goes into module ${activeModule}.` : "Select text to quote it."}
          </span>
        </div>
      )}
      <div ref={bodyRef} onMouseUp={readSelection} onKeyUp={readSelection} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-[13px] leading-relaxed">
        {shown.length === 0 && <p className="text-[color:var(--color-muted-foreground)]">Nothing matches.</p>}
        {shown.map((b, i) => (
          <section key={b.section?.id ?? `pre-${i}`} data-section-id={b.section?.id ?? ""} className="space-y-1.5">
            {b.heading && (
              <div className="flex items-start gap-2">
                <h3 className={cn("min-w-0 flex-1 font-semibold", (b.section?.level ?? 1) > 1 && "pl-3 text-[12.5px]")}>{b.heading}</h3>
                {canEdit && b.section && (
                  <Button size="xs" variant="ghost" onClick={() => onStartModule(b.section!)} aria-label={`Start a module from ${b.heading}`} title="Start a module from this section">
                    <ListPlus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
            {b.body && <p className="whitespace-pre-wrap text-[color:var(--color-muted-foreground)]">{b.body}</p>}
          </section>
        ))}
      </div>
    </Card>
  );
}
