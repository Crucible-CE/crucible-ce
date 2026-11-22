"use client";

// ---------------------------------------------------------------------------
// CSV import dialog for the Escalation Matrix.
//
// Two-step UX: (1) drop or select a file, (2) preview the parsed rows
// + any errors, then commit. On commit we POST each row to
// /api/escalation-contacts and report aggregate success/failure.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Upload, Loader2, Download, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { parseCsv, type CsvRow, type CsvParseResult } from "@/lib/escalation/io";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function CsvImportDialog({ open, onClose, onImported }: Props) {
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  function reset() {
    setParsed(null);
    setFileName(null);
    setImporting(false);
    setImportedCount(0);
  }

  async function onFile(file: File) {
    setFileName(file.name);
    const text = await file.text();
    setParsed(parseCsv(text));
  }

  async function commit() {
    if (!parsed) return;
    setImporting(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const row of parsed.rows) {
        const res = await fetch("/api/escalation-contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: row.name,
            title: row.title,
            email: row.email,
            phone: row.phone,
            alternatePhone: row.alternatePhone,
            tier: row.tier,
            severityLevel: row.severityLevel,
            role: row.role,
            notes: row.notes,
          }),
        });
        if (res.ok) {
          ok++;
        } else {
          failed++;
        }
      }
      setImportedCount(ok);
      if (failed > 0) {
        toast.warning(`Imported ${ok} contacts. ${failed} failed.`);
      } else {
        toast.success(`Imported ${ok} contacts`);
      }
      onImported();
    } finally {
      setImporting(false);
    }
  }

  const sample = [
    "name,title,email,phone,alt phone,role,tier,severity,notes",
    'Jane Smith,CISO,jane@example.com,+1-415-555-0123,+1-415-555-0124,executive,1,high,"On-call rotation A"',
    "Acme MSSP IR Desk,24/7 IR retainer,ir@acme.example,+1-800-555-0199,,vendor,1,critical,",
  ].join("\n");

  function downloadSample() {
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "escalation-contacts-sample.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
        </DialogHeader>

        {!parsed ? (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-[color:var(--color-muted-foreground)]">
              Columns:{" "}
              <code className="font-mono text-[11px]">name</code>,{" "}
              <code className="font-mono text-[11px]">title</code>,{" "}
              <code className="font-mono text-[11px]">email</code>,{" "}
              <code className="font-mono text-[11px]">phone</code>,{" "}
              <code className="font-mono text-[11px]">alt phone</code>,{" "}
              <code className="font-mono text-[11px]">role</code>,{" "}
              <code className="font-mono text-[11px]">tier</code>,{" "}
              <code className="font-mono text-[11px]">severity</code>,{" "}
              <code className="font-mono text-[11px]">notes</code>. Header row optional. Common aliases
              work.
            </p>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[color:var(--color-border)] bg-[color:var(--color-muted)] py-10 text-center hover:border-[color:var(--mist-indigo)]/40">
              <Upload className="h-5 w-5 text-[color:var(--mist-indigo)]" />
              <div className="text-[13px] font-medium">Choose a CSV file</div>
              <div className="text-[11.5px] text-[color:var(--color-muted-foreground)]">
                or drop it here
              </div>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </label>
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={downloadSample}>
                <Download className="h-3 w-3" />
                Download sample CSV
              </Button>
            </div>
          </div>
        ) : (
          <ParsedPreview
            parsed={parsed}
            fileName={fileName}
            importing={importing}
            importedCount={importedCount}
            onCommit={commit}
            onCancel={reset}
          />
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={importing}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ParsedPreview({
  parsed,
  fileName,
  importing,
  importedCount,
  onCommit,
  onCancel,
}: {
  parsed: CsvParseResult;
  fileName: string | null;
  importing: boolean;
  importedCount: number;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const errorRowSet = new Set(parsed.errors.map((e) => e.line));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[12px]">
        <div>
          <div className="font-semibold">{fileName ?? "uploaded file"}</div>
          <div className="text-[color:var(--color-muted-foreground)]">
            {parsed.rows.length} row{parsed.rows.length !== 1 ? "s" : ""} ready ·{" "}
            {parsed.errors.length} error{parsed.errors.length !== 1 ? "s" : ""}
          </div>
        </div>
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={importing}>
          <X className="h-3 w-3" />
          Reset
        </Button>
      </div>

      {parsed.errors.length > 0 && (
        <div className="rounded-lg bg-[color:color-mix(in_srgb,var(--mist-warn),transparent_92%)] p-3 text-[12px] leading-relaxed">
          <div className="font-semibold text-[color:var(--mist-warn)]">
            {parsed.errors.length} row(s) will be skipped
          </div>
          <ul className="mt-1 space-y-0.5">
            {parsed.errors.slice(0, 6).map((e, i) => (
              <li key={i} className="text-[color:var(--color-muted-foreground)]">
                Line {e.line}: {e.reason}
              </li>
            ))}
            {parsed.errors.length > 6 && (
              <li className="text-[color:var(--color-muted-foreground)]">
                ... +{parsed.errors.length - 6} more
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="max-h-[40vh] overflow-y-auto rounded-lg bg-[color:var(--color-card)] shadow-[var(--elevation-0)]">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="hairline-b text-left">
              <th className="px-3 py-2 eyebrow">Name</th>
              <th className="px-3 py-2 eyebrow">Role · Tier</th>
              <th className="px-3 py-2 eyebrow">Phone</th>
              <th className="px-3 py-2 eyebrow">Email</th>
            </tr>
          </thead>
          <tbody>
            {parsed.rows.map((r: CsvRow, i: number) => (
              <tr key={i} className="hairline-b">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-[color:var(--color-muted-foreground)]">
                  {r.role} · T{r.tier}
                </td>
                <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-muted-foreground)]">
                  {r.phone ?? ""}
                </td>
                <td className="px-3 py-2 text-[color:var(--color-muted-foreground)] truncate max-w-[200px]">
                  {r.email ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={onCommit} disabled={importing || parsed.rows.length === 0} size="sm">
          {importing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : importedCount > 0 ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {importing
            ? "Importing..."
            : importedCount > 0
              ? `Imported ${importedCount}`
              : `Import ${parsed.rows.length} contact${parsed.rows.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
      {!errorRowSet.size && parsed.rows.length === 0 && (
        <div className="text-[11.5px] text-[color:var(--color-muted-foreground)]">
          No valid rows.
        </div>
      )}
    </div>
  );
}
