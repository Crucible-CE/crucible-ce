import type { FrameworkId, TestCadence } from "./types";

// Control library for AAR control mapping and the program report.
// IDs follow each source's own convention. Titles and summaries are our own
// short wording, not the official text.

export type ControlRow = {
  controlId: string;
  title: string;
  summary: string;
  testCadence?: TestCadence;
};

export const CONTROL_ROWS: Readonly<Record<FrameworkId, readonly ControlRow[]>> = {
  "nist-csf": [
    { controlId: "ID.IM-02", title: "Improvements from tests and exercises", summary: "Lessons from security tests and exercises, including those run with suppliers, drive improvements." },
    { controlId: "ID.IM-04", title: "Incident response plans maintained", summary: "Incident response and related plans are written, shared, kept current, and improved." },
    { controlId: "PR.AA-05", title: "Access permissions managed", summary: "Access rights are defined, enforced and reviewed with least privilege and separation of duties." },
    { controlId: "PR.DS-11", title: "Backups maintained and tested", summary: "Data backups are made, protected, kept and tested so they work when needed." },
    { controlId: "DE.AE-02", title: "Adverse events analyzed", summary: "Possible adverse events are analyzed to understand what activity is behind them." },
    { controlId: "DE.AE-06", title: "Adverse event information shared", summary: "Information about adverse events reaches the staff and tools that need it." },
    { controlId: "DE.AE-08", title: "Incident declaration", summary: "An incident is declared when adverse events meet defined criteria." },
    { controlId: "RS.MA", title: "Incident Management", summary: "Responses to detected incidents are managed." },
    { controlId: "RS.MA-01", title: "Plan executed with third parties", summary: "The response plan is run with relevant third parties once an incident is declared." },
    { controlId: "RS.MA-02", title: "Triage and validation", summary: "Incident reports are triaged and confirmed." },
    { controlId: "RS.MA-03", title: "Categorization and prioritization", summary: "Incidents are categorized and prioritized." },
    { controlId: "RS.MA-04", title: "Escalation", summary: "Incidents are escalated to the right level when needed." },
    { controlId: "RS.MA-05", title: "Recovery criteria applied", summary: "Defined criteria decide when recovery starts." },
    { controlId: "RS.AN", title: "Incident Analysis", summary: "Investigations establish what happened and support response and recovery." },
    { controlId: "RS.AN-03", title: "Root cause analysis", summary: "Analysis establishes what happened during the incident and why." },
    { controlId: "RS.AN-06", title: "Investigation records", summary: "Investigation actions are recorded and the records are protected." },
    { controlId: "RS.AN-07", title: "Incident data preserved", summary: "Incident data and metadata are collected with integrity and provenance intact." },
    { controlId: "RS.AN-08", title: "Magnitude estimated", summary: "The size of the incident is estimated and confirmed." },
    { controlId: "RS.CO", title: "Incident Response Reporting and Communication", summary: "Response is coordinated with internal and external stakeholders." },
    { controlId: "RS.CO-02", title: "Stakeholders notified", summary: "Internal and external stakeholders are told about incidents." },
    { controlId: "RS.CO-03", title: "Information shared", summary: "Information is shared with designated internal and external stakeholders." },
    { controlId: "RS.MI", title: "Incident Mitigation", summary: "Activities stop the incident from spreading and reduce its effects." },
    { controlId: "RS.MI-01", title: "Containment", summary: "Incidents are contained." },
    { controlId: "RS.MI-02", title: "Eradication", summary: "Incidents are eradicated." },
    { controlId: "RC.RP", title: "Incident Recovery Plan Execution", summary: "Restoration activities bring affected systems and services back." },
    { controlId: "RC.RP-01", title: "Recovery plan executed", summary: "The recovery part of the response plan runs once recovery is started." },
    { controlId: "RC.RP-02", title: "Recovery actions chosen", summary: "Recovery actions are selected, scoped, prioritized, and carried out." },
    { controlId: "RC.RP-03", title: "Backup integrity verified", summary: "Backups and other restoration assets are checked before use." },
    { controlId: "RC.RP-04", title: "Post-incident norms", summary: "Critical functions and risk are weighed to set post-incident operating norms." },
    { controlId: "RC.RP-05", title: "Restored assets verified", summary: "Restored systems are checked and normal operation is confirmed." },
    { controlId: "RC.RP-06", title: "Recovery end declared", summary: "Recovery ends based on criteria and incident records are completed." },
    { controlId: "RC.CO", title: "Incident Recovery Communication", summary: "Restoration is coordinated with internal and external parties." },
    { controlId: "RC.CO-03", title: "Recovery progress communicated", summary: "Recovery progress is shared with designated internal and external stakeholders." },
    { controlId: "RC.CO-04", title: "Public recovery updates", summary: "Public updates on recovery use approved methods and messages." },
  ],
  "pci-dss": [
    { controlId: "12.10.1", title: "Incident response plan in place", summary: "An incident response plan covers roles, card brand and acquirer notice, containment, recovery, backups, and legal reporting." },
    {
      controlId: "12.10.2",
      title: "Annual review and test of the IR plan",
      summary: "The incident response plan is reviewed, updated, and tested at least once every 12 months.",
      testCadence: { months: 12, note: "Review and test every element of 12.10.1 at least every 12 months." },
    },
    { controlId: "12.10.3", title: "Responders available 24/7", summary: "Named people are available around the clock to respond to suspected incidents." },
    { controlId: "12.10.4", title: "Responder training", summary: "Incident responders are trained on their responsibilities on a regular basis." },
    { controlId: "12.10.4.1", title: "Training frequency set by risk analysis", summary: "How often responders are trained is set by a targeted risk analysis." },
    { controlId: "12.10.5", title: "Security alerts in the IR plan", summary: "The plan covers responding to alerts from intrusion detection, network controls, change detection, and payment page tamper detection." },
    { controlId: "12.10.6", title: "Plan updated from lessons learned", summary: "The plan is updated based on lessons learned and industry developments." },
    { controlId: "12.10.7", title: "Unexpected stored PAN", summary: "Procedures handle discovery of card numbers stored where they should not be." },
  ],
  hipaa: [
    { controlId: "164.308(a)(6)(i)", title: "Security incident procedures", summary: "Policies and procedures address security incidents." },
    { controlId: "164.308(a)(6)(ii)", title: "Response and reporting", summary: "Security incidents are identified, responded to, mitigated where practical, and documented." },
    { controlId: "164.308(a)(7)(i)", title: "Contingency plan", summary: "Policies cover responding to emergencies that damage systems holding ePHI." },
    { controlId: "164.308(a)(7)(ii)(B)", title: "Disaster recovery plan", summary: "Procedures exist to restore lost data." },
    { controlId: "164.308(a)(7)(ii)(C)", title: "Emergency mode operation plan", summary: "Critical processes can continue while protecting ePHI in emergency mode." },
    {
      controlId: "164.308(a)(7)(ii)(D)",
      title: "Testing and revision procedures",
      summary: "Contingency plans are tested and revised periodically.",
      testCadence: { months: 12, note: "The rule says periodic. Annual testing is a common policy choice." },
    },
    { controlId: "164.404", title: "Notice to individuals", summary: "Affected individuals are notified of a breach of unsecured PHI within 60 days of discovery." },
    { controlId: "164.408", title: "Notice to the Secretary", summary: "HHS is notified of breaches, at once for 500 or more people and annually for smaller ones." },
  ],
  gdpr: [
    { controlId: "Art.32(1)(d)", title: "Regular testing of security measures", summary: "Security measures are tested and evaluated on a regular basis." },
    { controlId: "Art.33", title: "Breach notice to the supervisory authority", summary: "The controller notifies the supervisory authority of a personal data breach within 72 hours of becoming aware, unless it is unlikely to cause risk." },
    { controlId: "Art.33(5)", title: "Breach documentation", summary: "Every personal data breach is documented, including its effects and the remedial action taken." },
    { controlId: "Art.34", title: "Breach notice to data subjects", summary: "People are told without undue delay when a breach is likely to put their rights at high risk." },
  ],
  soc2: [
    { controlId: "CC7.3", title: "Evaluation of security events", summary: "Security events are evaluated to decide whether they are incidents that could affect objectives." },
    {
      controlId: "CC7.4",
      title: "Incident response",
      summary: "Identified incidents are handled through a defined response program to understand, contain, remediate, and communicate.",
      testCadence: { months: 12, note: "Show the response program was tested within each audit period." },
    },
    { controlId: "CC7.5", title: "Incident recovery", summary: "Recovery activities for identified incidents are planned and carried out." },
  ],
  "iso-22301": [
    { controlId: "8.4", title: "Business continuity plans and procedures", summary: "Plans set the response structure, warning and communication, continuity steps, and recovery." },
    {
      controlId: "8.5",
      title: "Exercise programme",
      summary: "Continuity plans and capabilities are exercised and tested on a planned program and the results drive improvement.",
      testCadence: { months: 12, note: "Exercise at planned intervals and after significant change. Annual is common." },
    },
  ],
  "iso-27001": [
    { controlId: "A.5.24", title: "Incident management planning and preparation", summary: "Incident management processes, roles, and responsibilities are defined and communicated." },
    { controlId: "A.5.25", title: "Assessment and decision on events", summary: "Security events are assessed to decide whether they are incidents." },
    { controlId: "A.5.26", title: "Response to incidents", summary: "Incidents are handled according to documented procedures." },
    { controlId: "A.5.27", title: "Learning from incidents", summary: "Knowledge from incidents is used to strengthen controls." },
    { controlId: "A.5.28", title: "Collection of evidence", summary: "Evidence about security events is identified, collected, and preserved." },
    { controlId: "A.5.29", title: "Security during disruption", summary: "Security is maintained at an appropriate level during a disruption." },
    { controlId: "A.5.30", title: "ICT readiness for business continuity", summary: "ICT readiness is planned, maintained, and tested to meet continuity objectives." },
  ],
  sec: [
    { controlId: "S-K 106(b)", title: "Risk management and strategy disclosure", summary: "The annual report describes how the company assesses, identifies, and manages material cybersecurity risk." },
    { controlId: "S-K 106(c)", title: "Governance disclosure", summary: "The annual report describes board oversight and management's role in cybersecurity risk." },
    { controlId: "8-K 1.05", title: "Material cybersecurity incident", summary: "A Form 8-K is filed within four business days after the company determines an incident is material." },
  ],
  nydfs: [
    {
      controlId: "500.16",
      title: "Incident response and business continuity",
      summary: "Covered entities keep written incident response and continuity plans and test them.",
      testCadence: { months: 12, note: "Test incident response and BCDR plans at least annually." },
    },
    { controlId: "500.17(a)", title: "Notice of cybersecurity incident", summary: "The superintendent is notified within 72 hours of determining a reportable incident occurred." },
    { controlId: "500.17(c)", title: "Notice of extortion payment", summary: "An extortion payment is reported within 24 hours, with a written explanation within 30 days." },
  ],
  "nist-800-61": [
    { controlId: "SP 800-61r3", title: "Incident response recommendations", summary: "Guidance on using CSF 2.0 outcomes to prepare for, respond to, and recover from incidents." },
  ],
  "nist-800-84": [
    { controlId: "SP 800-84", title: "Test, training, and exercise programs", summary: "Guidance on designing, running, and evaluating exercises for IT plans and capabilities." },
  ],
};
