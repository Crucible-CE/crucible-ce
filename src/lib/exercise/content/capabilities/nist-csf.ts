import type { Capability } from "./types";

// NIST Cybersecurity Framework 2.0 functions and categories (NIST CSWP 29,
// February 2024). Names are the official names. Descriptions are short
// paraphrases, not the official text.

type Row = [key: string, name: string, description: string];

const FUNCTIONS: Row[] = [
  ["GV", "Govern", "Set, communicate, and monitor cybersecurity risk strategy, expectations, and policy."],
  ["ID", "Identify", "Understand the organization's current cybersecurity risks."],
  ["PR", "Protect", "Use safeguards to manage cybersecurity risks."],
  ["DE", "Detect", "Find and analyze possible attacks and compromises."],
  ["RS", "Respond", "Take action on a detected cybersecurity incident."],
  ["RC", "Recover", "Restore assets and operations affected by an incident."],
];

const CATEGORIES: Row[] = [
  ["GV.OC", "Organizational Context", "Mission, stakeholders, and legal requirements that shape risk decisions are understood."],
  ["GV.RM", "Risk Management Strategy", "Risk priorities, appetite, and assumptions are set and used."],
  ["GV.RR", "Roles, Responsibilities, and Authorities", "Cybersecurity roles and authority are defined and accountable."],
  ["GV.PO", "Policy", "Cybersecurity policy is set, communicated, and enforced."],
  ["GV.OV", "Oversight", "Results of risk activities are used to adjust strategy."],
  ["GV.SC", "Cybersecurity Supply Chain Risk Management", "Supplier and third-party risk is identified and managed."],
  ["ID.AM", "Asset Management", "Assets are known and managed by importance."],
  ["ID.RA", "Risk Assessment", "Risks to the organization, assets, and people are understood."],
  ["ID.IM", "Improvement", "Improvements are found through evaluations, tests, exercises, and operations."],
  ["PR.AA", "Identity Management, Authentication, and Access Control", "Access is limited to authorized users, services, and hardware."],
  ["PR.AT", "Awareness and Training", "People get the awareness and training to do their cybersecurity tasks."],
  ["PR.DS", "Data Security", "Data is managed to protect its confidentiality, integrity, and availability."],
  ["PR.PS", "Platform Security", "Hardware, software, and services are managed securely."],
  ["PR.IR", "Technology Infrastructure Resilience", "Architecture is managed to protect assets and support resilience."],
  ["DE.CM", "Continuous Monitoring", "Assets are monitored for anomalies and signs of compromise."],
  ["DE.AE", "Adverse Event Analysis", "Anomalies and events are analyzed to find and declare incidents."],
  ["RS.MA", "Incident Management", "Responses to detected incidents are managed."],
  ["RS.AN", "Incident Analysis", "Investigations establish what happened and support response and recovery."],
  ["RS.CO", "Incident Response Reporting and Communication", "Response is coordinated with internal and external stakeholders."],
  ["RS.MI", "Incident Mitigation", "Activities prevent the incident from expanding and reduce its effects."],
  ["RC.RP", "Incident Recovery Plan Execution", "Restoration activities bring affected systems and services back."],
  ["RC.CO", "Incident Recovery Communication", "Restoration is coordinated with internal and external parties."],
];

export const NIST_CSF_CAPABILITIES: readonly Capability[] = (() => {
  const out: Capability[] = [];
  let seq = 1;
  for (const [fnKey, fnName, fnDesc] of FUNCTIONS) {
    out.push({ framework: "nist-csf", key: fnKey, name: fnName, description: fnDesc, seq: seq++ });
    for (const [key, name, description] of CATEGORIES) {
      if (key.startsWith(`${fnKey}.`)) {
        out.push({ framework: "nist-csf", key, name, description, seq: seq++, parentKey: fnKey });
      }
    }
  }
  return out;
})();
