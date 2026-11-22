import { FEMA_CAPABILITIES } from "./fema";
import { NIST_CSF_CAPABILITIES } from "./nist-csf";
import type { Capability, CapabilityFrameworkId } from "./types";

export * from "./types";
export { FEMA_CAPABILITIES } from "./fema";
export { NIST_CSF_CAPABILITIES } from "./nist-csf";

export const CAPABILITY_FRAMEWORKS: readonly { id: CapabilityFrameworkId; label: string; description: string }[] = [
  {
    id: "fema",
    label: "FEMA core capabilities",
    description: "The 32 core capabilities from the National Preparedness Goal used by HSEEP.",
  },
  {
    id: "nist-csf",
    label: "NIST CSF 2.0",
    description: "The six CSF 2.0 functions and their categories.",
  },
];

const BY_FRAMEWORK: Readonly<Record<CapabilityFrameworkId, readonly Capability[]>> = {
  fema: FEMA_CAPABILITIES,
  "nist-csf": NIST_CSF_CAPABILITIES,
};

/** Capabilities for a framework in display order. Unknown frameworks return []. */
export function listCapabilities(framework: string): Capability[] {
  const list = (BY_FRAMEWORK as Record<string, readonly Capability[] | undefined>)[framework];
  return list ? [...list] : [];
}
