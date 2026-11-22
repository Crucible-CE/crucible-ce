// Healthcare data analytics on Azure: a fictional HIPAA business associate
// (Quarrystone Health Analytics) facing four attacks from the October 2026
// threat brief. Each attack has a template and a matching playbook that
// share the same roles, decision points and clocks.

import type { LibraryCollection } from "../types";
import { HEALTHCARE_COLLECTION_LABEL } from "./org";
import { HEALTHCARE_CRISISSIM_HELP_DESK } from "./scattered-spider";
import { HEALTHCARE_CRISISSIM_SALESFORCE } from "./shinyhunters";
import { HEALTHCARE_STRATEGIC_QILIN } from "./qilin";
import { HEALTHCARE_STRATEGIC_STORM_0501 } from "./storm-0501";

export const HEALTHCARE_COLLECTION: LibraryCollection = {
  label: HEALTHCARE_COLLECTION_LABEL,
  crisisSim: [HEALTHCARE_CRISISSIM_HELP_DESK, HEALTHCARE_CRISISSIM_SALESFORCE],
  strategic: [HEALTHCARE_STRATEGIC_STORM_0501, HEALTHCARE_STRATEGIC_QILIN],
  playbooks: [
    {
      libraryKey: "healthcare-playbook-hybrid-cloud-ransomware",
      title: "Hybrid cloud ransomware response",
      kind: "playbook",
      collection: HEALTHCARE_COLLECTION_LABEL,
      file: "healthcare/playbooks/storm-0501-hybrid-cloud-ransomware.md",
    },
    {
      libraryKey: "healthcare-playbook-help-desk-social-engineering",
      title: "Help desk social engineering response",
      kind: "playbook",
      collection: HEALTHCARE_COLLECTION_LABEL,
      file: "healthcare/playbooks/scattered-spider-help-desk.md",
    },
    {
      libraryKey: "healthcare-playbook-salesforce-vishing",
      title: "Salesforce vishing and data theft response",
      kind: "playbook",
      collection: HEALTHCARE_COLLECTION_LABEL,
      file: "healthcare/playbooks/salesforce-vishing-data-theft.md",
    },
    {
      libraryKey: "healthcare-playbook-ransomware-phi-warehouse",
      title: "Ransomware on analytics systems and the PHI warehouse",
      kind: "playbook",
      collection: HEALTHCARE_COLLECTION_LABEL,
      file: "healthcare/playbooks/qilin-ransomware-phi-warehouse.md",
    },
  ],
};
