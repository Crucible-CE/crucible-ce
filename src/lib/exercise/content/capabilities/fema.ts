import type { Capability, FemaMissionArea } from "./types";

// The 32 core capabilities of the FEMA National Preparedness Goal (2nd ed.,
// 2015), as used by HSEEP. Keys are kebab-case from the capability name.

type Row = [key: string, name: string, missionAreas: FemaMissionArea[], description: string];

const ROWS: Row[] = [
  // Common
  ["planning", "Planning", ["common"], "Develop and maintain plans through whole-community engagement."],
  ["public-information-and-warning", "Public Information and Warning", ["common"], "Deliver coordinated, prompt, reliable, and actionable information to the whole community."],
  ["operational-coordination", "Operational Coordination", ["common"], "Establish and maintain a unified, coordinated operational structure across organizations."],
  // Prevention
  ["forensics-and-attribution", "Forensics and Attribution", ["prevention"], "Conduct forensic analysis and attribute acts to their perpetrators."],
  ["intelligence-and-information-sharing", "Intelligence and Information Sharing", ["prevention", "protection"], "Provide timely, accurate, and actionable information to identify and disrupt threats."],
  ["interdiction-and-disruption", "Interdiction and Disruption", ["prevention", "protection"], "Delay, divert, intercept, halt, apprehend, or secure threats and hazards."],
  ["screening-search-and-detection", "Screening, Search, and Detection", ["prevention", "protection"], "Identify, discover, or locate threats through active and passive surveillance."],
  // Protection
  ["access-control-and-identity-verification", "Access Control and Identity Verification", ["protection"], "Apply physical, technological, and cyber controls to verify identity and authorize access."],
  ["cybersecurity", "Cybersecurity", ["protection"], "Protect against cyber threats to the confidentiality, integrity, and availability of data and systems."],
  ["physical-protective-measures", "Physical Protective Measures", ["protection"], "Maintain risk-informed countermeasures that protect people and key infrastructure."],
  ["risk-management-for-protection-programs-and-activities", "Risk Management for Protection Programs and Activities", ["protection"], "Identify, assess, and prioritize risks to inform protection activities and investments."],
  ["supply-chain-integrity-and-security", "Supply Chain Integrity and Security", ["protection"], "Strengthen the security and resilience of the supply chain."],
  // Mitigation
  ["community-resilience", "Community Resilience", ["mitigation"], "Help communities understand, communicate, and plan for risk."],
  ["long-term-vulnerability-reduction", "Long-term Vulnerability Reduction", ["mitigation"], "Build resilient systems and infrastructure to reduce vulnerability."],
  ["risk-and-disaster-resilience-assessment", "Risk and Disaster Resilience Assessment", ["mitigation"], "Assess risk and resilience to inform decisions and investments."],
  ["threats-and-hazards-identification", "Threats and Hazards Identification", ["mitigation"], "Identify the threats and hazards that could affect the community."],
  // Response
  ["critical-transportation", "Critical Transportation", ["response"], "Provide transportation for response priorities, including evacuation and supply movement."],
  ["environmental-response-health-and-safety", "Environmental Response/Health and Safety", ["response"], "Provide guidance and resources for environmental, health, and safety hazards."],
  ["fatality-management-services", "Fatality Management Services", ["response"], "Provide fatality management, including recovery and victim identification."],
  ["fire-management-and-suppression", "Fire Management and Suppression", ["response"], "Provide firefighting capabilities to manage and suppress fires."],
  ["infrastructure-systems", "Infrastructure Systems", ["response", "recovery"], "Stabilize critical infrastructure and restore essential services."],
  ["logistics-and-supply-chain-management", "Logistics and Supply Chain Management", ["response"], "Deliver essential commodities, equipment, and services to affected communities."],
  ["mass-care-services", "Mass Care Services", ["response"], "Provide life-sustaining services such as water, food, and shelter."],
  ["mass-search-and-rescue-operations", "Mass Search and Rescue Operations", ["response"], "Deliver search and rescue capabilities to save the greatest number of lives."],
  ["on-scene-security-protection-and-law-enforcement", "On-scene Security, Protection, and Law Enforcement", ["response"], "Keep the scene safe and secure through law enforcement and protection operations."],
  ["operational-communications", "Operational Communications", ["response"], "Provide timely communications for security, situational awareness, and operations."],
  ["public-health-healthcare-and-emergency-medical-services", "Public Health, Healthcare, and Emergency Medical Services", ["response"], "Provide lifesaving medical treatment and public health support."],
  ["situational-assessment", "Situational Assessment", ["response"], "Give decision makers accurate awareness of the nature and extent of the hazard."],
  // Recovery
  ["economic-recovery", "Economic Recovery", ["recovery"], "Return economic and business activity to a healthy state."],
  ["health-and-social-services", "Health and Social Services", ["recovery"], "Restore health and social services networks."],
  ["housing", "Housing", ["recovery"], "Provide housing solutions that support the needs of the whole community."],
  ["natural-and-cultural-resources", "Natural and Cultural Resources", ["recovery"], "Protect natural and cultural resources and historic properties."],
];

export const FEMA_CAPABILITIES: readonly Capability[] = ROWS.map(([key, name, missionAreas, description], i) => ({
  framework: "fema",
  key,
  name,
  description,
  seq: i + 1,
  missionAreas,
}));
