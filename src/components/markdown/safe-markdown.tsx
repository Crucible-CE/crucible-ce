// Minimal safe markdown for author and participant text. Everything renders as React
// Minimal safe markdown for AI and author text. Everything renders as React
// text nodes, so raw HTML shows as text. No images (alt text only) and no
// links (link text only), so nothing loads from a remote host.
//
// Supported: paragraphs, line breaks, **bold**, *italic*, _italic_, `code`,
// "- " and "1. " lists, "> " quotes, and "#" headings shown as bold lines.

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|!\[[^\]\n]*\]\([^)\n]*\)|\[[^\]\n]+\]\([^)\n]*\)|\*[^*\s\n][^*\n]*\*|_[^_\s\n][^_\n]*_)/g;

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyPrefix}-${n++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key} className="rounded bg-[color:var(--color-muted)] px-1 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("![")) {
      const alt = /^!\[([^\]]*)\]/.exec(tok)?.[1] ?? "";
      if (alt) out.push(<span key={key} className="text-[color:var(--color-muted-foreground)]">[{alt}]</span>);
    } else if (tok.startsWith("[")) out.push(<span key={key} className="underline decoration-dotted">{/^\[([^\]]*)\]/.exec(tok)?.[1] ?? ""}</span>);
    else out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(text: string, key: string): ReactNode[] {
  return text.split("\n").map((l, i, arr) => (
    <Fragment key={`${key}-l${i}`}>
      {renderInline(l, `${key}-l${i}`)}
      {i < arr.length - 1 && <br />}
    </Fragment>
  ));
}

export function SafeMarkdown({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className={cn("space-y-3 leading-relaxed", className)}>
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        const rows = block.split("\n");
        if (rows.every((r) => /^\s*[-*]\s+/.test(r))) {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {rows.map((r, i) => (
                <li key={i}>{renderInline(r.replace(/^\s*[-*]\s+/, ""), `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }
        if (rows.every((r) => /^\s*\d+[.)]\s+/.test(r))) {
          return (
            <ol key={key} className="list-decimal space-y-1 pl-5">
              {rows.map((r, i) => (
                <li key={i}>{renderInline(r.replace(/^\s*\d+[.)]\s+/, ""), `${key}-${i}`)}</li>
              ))}
            </ol>
          );
        }
        if (rows.every((r) => /^\s*>/.test(r))) {
          return (
            <blockquote key={key} className="border-l-2 border-[color:var(--color-border)] pl-3 text-[color:var(--color-muted-foreground)]">
              {lines(rows.map((r) => r.replace(/^\s*>\s?/, "")).join("\n"), key)}
            </blockquote>
          );
        }
        if (/^#{1,6}\s+/.test(rows[0])) {
          return (
            <div key={key}>
              <p className="font-semibold">{renderInline(rows[0].replace(/^#{1,6}\s+/, ""), `${key}-h`)}</p>
              {rows.length > 1 && <p>{lines(rows.slice(1).join("\n"), key)}</p>}
            </div>
          );
        }
        return <p key={key}>{lines(block, key)}</p>;
      })}
    </div>
  );
}
