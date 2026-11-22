import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { CAPABILITY_FRAMEWORKS, CONTROL_FRAMEWORKS, getExerciseSettings, timeZones } from "@/lib/exercise/settings";
import { PageHeader } from "@/components/shell/page-header";
import { SettingsForm } from "@/components/exercise-settings/settings-form";
import { PolicySection } from "@/components/exercise-settings/policy-section";
import { CloudExportCard } from "@/components/exercise-settings/cloud-export-card";

export const dynamic = "force-dynamic";

// Exercise settings for the organization (administrators): time zone and
// frameworks, the exercise policy, report signing keys, Cloud notes and the
// Export for Cloud file.
export default async function ExerciseSettingsPage() {
  const user = await getSessionUser();
  if (!user || !hasPermission(user, "settings.manage")) redirect("/dashboard");
  const settings = await getExerciseSettings();
  if (!settings) redirect("/dashboard");

  return (
    <>
      <PageHeader title="Exercise settings" description="Time zone, frameworks, policy, signing keys and Cloud notes." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <SettingsForm
            initial={{
              timezone: settings.timezone,
              capabilityFramework: settings.capabilityFramework,
              enabledFrameworks: settings.enabledFrameworks,
              hseepMode: settings.hseepMode,
              requireSponsorSignoff: settings.requireSponsorSignoff,
              retentionYears: settings.retentionYears,
              showCloudNotes: settings.showCloudNotes,
            }}
            timeZones={timeZones()}
            capabilityFrameworks={CAPABILITY_FRAMEWORKS.map((f) => ({ value: f.key, label: f.label }))}
            controlFrameworks={CONTROL_FRAMEWORKS.map((f) => ({ value: f.key, label: f.label }))}
          />
          <PolicySection frameworks={CONTROL_FRAMEWORKS.filter((f) => settings.enabledFrameworks.includes(f.key)).map((f) => ({ key: f.key, label: f.label }))} />
        </div>
        <div className="space-y-6">
          <CloudExportCard />
        </div>
      </div>
    </>
  );
}
