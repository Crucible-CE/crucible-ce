import { CONTROL_ROWS } from "./controls";
import type { Control, Framework, FrameworkId } from "./types";

export * from "./types";

export const FRAMEWORKS: readonly Framework[] = [
  { id: "nist-csf", label: "NIST CSF 2.0", kind: "standard", sourceUrl: "https://www.nist.gov/cyberframework" },
  { id: "pci-dss", label: "PCI DSS v4.0", kind: "standard", sourceUrl: "https://www.pcisecuritystandards.org/document_library/" },
  { id: "hipaa", label: "HIPAA", kind: "regulation", sourceUrl: "https://www.hhs.gov/hipaa/for-professionals/security/index.html" },
  { id: "gdpr", label: "GDPR", kind: "regulation", sourceUrl: "https://eur-lex.europa.eu/eli/reg/2016/679/oj" },
  {
    id: "soc2",
    label: "SOC 2",
    kind: "standard",
    sourceUrl: "https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services",
  },
  { id: "iso-22301", label: "ISO 22301:2019", kind: "standard", sourceUrl: "https://www.iso.org/standard/75106.html" },
  { id: "iso-27001", label: "ISO/IEC 27001:2022", kind: "standard", sourceUrl: "https://www.iso.org/standard/27001" },
  {
    id: "sec",
    label: "SEC cybersecurity disclosure",
    kind: "regulation",
    sourceUrl: "https://www.ecfr.gov/current/title-17/chapter-II/part-229/subpart-229.100/section-229.106",
  },
  { id: "nydfs", label: "NYDFS 23 NYCRR 500", kind: "regulation", sourceUrl: "https://www.dfs.ny.gov/" },
  { id: "nist-800-61", label: "NIST SP 800-61r3", kind: "guidance", sourceUrl: "https://csrc.nist.gov/pubs/sp/800/61/r3/final" },
  { id: "nist-800-84", label: "NIST SP 800-84", kind: "guidance", sourceUrl: "https://csrc.nist.gov/pubs/sp/800/84/final" },
];

/**
 * Default exercise cadence in months per framework, used by the program
 * report when the instance policy does not set one. Frameworks with no
 * testing expectation are absent.
 */
export const defaultCadence: Readonly<Partial<Record<FrameworkId, number>>> = {
  "pci-dss": 12,
  hipaa: 12,
  "iso-22301": 12,
  soc2: 12,
  nydfs: 12,
};

export const CONTROLS: readonly Control[] = FRAMEWORKS.flatMap((f) =>
  CONTROL_ROWS[f.id].map((row) => ({ framework: f.id, frameworkLabel: f.label, ...row })),
);

export function getFramework(id: string): Framework | undefined {
  return FRAMEWORKS.find((f) => f.id === id);
}

/** Controls for a framework in canonical order. Unknown frameworks return []. */
export function listControls(framework: string): Control[] {
  return CONTROLS.filter((c) => c.framework === framework);
}

/** Exact match on controlId, ignoring surrounding whitespace. */
export function getControl(framework: string, controlId: string): Control | undefined {
  const id = controlId.trim();
  return CONTROLS.find((c) => c.framework === framework && c.controlId === id);
}

/** Controls that carry a test cadence, for the program report. */
export function listCadenceControls(framework?: string): Control[] {
  return CONTROLS.filter((c) => c.testCadence && (!framework || c.framework === framework));
}
