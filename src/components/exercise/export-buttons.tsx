"use client";

// Exercise document downloads: Situation Manual for everyone in the exercise,
// the Controller/Evaluator handbook and the MSEL CSV for control only. Plain
// links; the export route checks access again.

import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ExportButtons({ exerciseId, isControl }: { exerciseId: string; isControl: boolean }) {
  const base = `/api/exercises/${exerciseId}/exports`;
  const items = [
    { kind: "situation-manual", label: "Situation Manual (PDF)" },
    ...(isControl
      ? [
          { kind: "ce-handbook", label: "Controller and evaluator handbook (PDF)" },
          { kind: "msel-csv", label: "MSEL (CSV)" },
        ]
      : []),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <FileDown className="h-4 w-4" />
          Documents
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((i) => (
          <DropdownMenuItem key={i.kind} asChild>
            <a href={`${base}/${i.kind}`} download>
              {i.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
