import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, statusVariant } from "../labels";

export function EditorHeading({ title, status, actions }: { title: string; status?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/templates"
        className="inline-flex w-fit items-center gap-1 text-[13px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
      >
        <ChevronLeft className="h-4 w-4" />
        Templates
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="headline truncate">{title}</h1>
          {status && <Badge variant={statusVariant(status)}>{STATUS_LABELS[status] ?? status}</Badge>}
        </div>
        {actions}
      </div>
    </div>
  );
}
