"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { CrisisSimEditor } from "./crisissim-editor";
import { EditorHeading } from "./editor-heading";
import { fetchTemplate, type ApiTemplate } from "./state";

export function TemplateEditor({ id }: { id: string }) {
  const [data, setData] = useState<ApiTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await fetchTemplate(id);
    if (r.data) {
      setData(r.data);
      setError(null);
    } else {
      setError(r.error);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-[13px] text-[color:var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <EditorHeading title="Template" />
        <Card className="max-w-xl">
          <p className="text-[13px]">{error ?? "The template did not load. Try again."}</p>
          <div>
            <Button
              variant="outline"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              Try again
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const t = data.template;

  if (t.mode !== "crisissim") {
    return (
      <div className="flex flex-col gap-6">
        <EditorHeading title={t.title} status={t.status} />
        <Card className="max-w-xl">
          <p className="text-[13px]">This mode is edited in a later release.</p>
        </Card>
      </div>
    );
  }

  return (
    <ConfirmDialogProvider>
      <CrisisSimEditor key={t.id} initial={data} />
    </ConfirmDialogProvider>
  );
}
