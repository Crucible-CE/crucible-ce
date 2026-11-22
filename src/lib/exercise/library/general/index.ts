// General library collection: six enterprise playbooks and seven templates
// that pair with them. Each template names its playbook in its executive
// brief and follows the playbook's roles, decision points and clocks.
// Facts follow research/threat-brief-2026-10 and its addendum (internal).
// All organizations, people and domains are fictional.

import type { LibraryCollection, LibraryPlaybook } from "../types";
import { GENERAL_CRISISSIM_BEC_WIRE_FRAUD } from "./bec-wire-fraud";
import { GENERAL_STRATEGIC_EU_BANK_DORA } from "./eu-bank-dora";
import { GENERAL_CRISISSIM_EXECUTIVE_MISCONDUCT } from "./executive-misconduct";
import { GENERAL_CRISISSIM_HOSPITAL_RANSOMWARE } from "./hospital-ransomware";
import { GENERAL_CRISISSIM_IDENTITY_TAKEOVER } from "./identity-takeover";
import { GENERAL_CRISISSIM_INSIDER_DATA_THEFT } from "./insider-data-theft";
import { GENERAL_COLLECTION_LABEL } from "./label";
import { GENERAL_STRATEGIC_SUPPLY_CHAIN } from "./supply-chain-outage";

function playbook(libraryKey: string, title: string, file: string, kind: LibraryPlaybook["kind"] = "playbook"): LibraryPlaybook {
  return { libraryKey, title, kind, collection: GENERAL_COLLECTION_LABEL, file: `general/playbooks/${file}` };
}

export const GENERAL_COLLECTION: LibraryCollection = {
  label: GENERAL_COLLECTION_LABEL,
  crisisSim: [GENERAL_CRISISSIM_HOSPITAL_RANSOMWARE, GENERAL_CRISISSIM_BEC_WIRE_FRAUD, GENERAL_CRISISSIM_INSIDER_DATA_THEFT, GENERAL_CRISISSIM_IDENTITY_TAKEOVER, GENERAL_CRISISSIM_EXECUTIVE_MISCONDUCT],
  strategic: [GENERAL_STRATEGIC_SUPPLY_CHAIN, GENERAL_STRATEGIC_EU_BANK_DORA],
  playbooks: [
    playbook("general-playbook-ransomware-extortion", "Ransomware and extortion response", "ransomware-extortion.md"),
    playbook("general-playbook-identity-provider-compromise", "Identity provider compromise response", "identity-provider-compromise.md"),
    playbook("general-playbook-saas-data-theft", "SaaS data theft and extortion response", "saas-data-theft-extortion.md"),
    playbook("general-playbook-bec-wire-fraud", "Business email compromise and wire fraud response", "bec-wire-fraud.md"),
    playbook("general-playbook-data-breach-notification", "Data breach notification and disclosure", "data-breach-notification.md"),
    playbook("general-playbook-business-continuity-site-loss", "Business continuity and disaster recovery: site or region loss", "business-continuity-site-loss.md", "bcp_dr"),
  ],
};
