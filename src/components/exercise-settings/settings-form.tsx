"use client";

// Exercise settings for the organization (administrators): time zone,
// frameworks, HSEEP options, retention and the Cloud notes switch.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FieldSelect, type FieldSelectOption } from "@/components/form/field-select";

export interface SettingsValues {
  timezone: string;
  capabilityFramework: string;
  enabledFrameworks: string[];
  hseepMode: boolean;
  requireSponsorSignoff: boolean;
  retentionYears: number;
  showCloudNotes: boolean;
}

export function SettingsForm({
  initial,
  timeZones,
  capabilityFrameworks,
  controlFrameworks,
}: {
  initial: SettingsValues;
  timeZones: string[];
  capabilityFrameworks: FieldSelectOption[];
  controlFrameworks: FieldSelectOption[];
}) {
  const router = useRouter();
  const [v, setV] = useState<SettingsValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => setV((prev) => ({ ...prev, [key]: value }));

  function toggleFramework(key: string, on: boolean) {
    set("enabledFrameworks", on ? [...new Set([...v.enabledFrameworks, key])] : v.enabledFrameworks.filter((k) => k !== key));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } } | null;
      if (!res.ok) {
        const field = data?.details?.fieldErrors ? Object.values(data.details.fieldErrors).flat()[0] : undefined;
        setError(field ?? data?.error ?? "Settings were not saved. Try again.");
        return;
      }
      toast.success("Settings saved.");
      router.refresh();
    } catch {
      setError("Settings were not saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={save} className="space-y-6">
        <section className="space-y-4">
          <h2 className="text-base font-semibold">Time</h2>
          <div className="space-y-2">
            <Label htmlFor="timezone">Time zone</Label>
            <FieldSelect id="timezone" value={v.timezone} onChange={(z) => set("timezone", z)} options={timeZones.map((z) => ({ value: z, label: z }))} />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-base font-semibold">Exercises</h2>
          <div className="space-y-2">
            <Label htmlFor="capabilityFramework">Capability framework</Label>
            <FieldSelect
              id="capabilityFramework"
              value={v.capabilityFramework}
              onChange={(f) => set("capabilityFramework", f)}
              options={capabilityFrameworks}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Control frameworks</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {controlFrameworks.map((f) => (
                <label key={f.value} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[color:var(--mist-indigo)]"
                    checked={v.enabledFrameworks.includes(f.value)}
                    onChange={(e) => toggleFramework(f.value, e.target.checked)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="hseepMode">HSEEP structure</Label>
            <Switch id="hseepMode" checked={v.hseepMode} onCheckedChange={(c) => set("hseepMode", c)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="requireSponsorSignoff">Sponsor signs reports</Label>
            <Switch id="requireSponsorSignoff" checked={v.requireSponsorSignoff} onCheckedChange={(c) => set("requireSponsorSignoff", c)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="retentionYears">Keep records for (years)</Label>
            <Input
              id="retentionYears"
              type="number"
              min={1}
              max={50}
              value={v.retentionYears}
              onChange={(e) => set("retentionYears", Number.parseInt(e.target.value || "0", 10))}
              className="w-32"
            />
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Cloud notes</h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="showCloudNotes">Show Cloud notes</Label>
              <p className="text-[12px] text-[color:var(--color-muted-foreground)]">A short line where Crucible Cloud does a manual step with AI. Contributors, exercise directors and administrators only.</p>
            </div>
            <Switch id="showCloudNotes" checked={v.showCloudNotes} onCheckedChange={(c) => set("showCloudNotes", c)} />
          </div>
        </section>

        {error && (
          <p className="text-[13px] text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="accent" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
      </form>
    </Card>
  );
}
