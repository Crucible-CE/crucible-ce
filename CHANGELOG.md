# Changelog

## 0.2.0

### Added

- Exercises in three modes: Crisis Sim, Playbook Exercise and Strategic TTX. A template library, Studio for branching scenarios, and a document library for playbooks, plans and SOPs.
- Invites: members join with their account, guests join with an invite code and no account. Email invites with a calendar file. `GUEST_CAP_PER_EXERCISE` limits guests per exercise.
- After-action: hotwash, objective ratings, participant feedback, attendance, an after-action report written by evaluators with evidence from the record, an improvement plan, facilitator and sponsor sign-off, and PDF and DOCX exports.
- Evidence bundle for final reports, signed with `EXPORT_SIGNING_PRIVATE_KEY`, and `npm run verify-bundle` to check it offline.
- Improvement: exercise schedule with calendar files and a private ICS feed, work items, and a program report with a PDF download.
- After-action reports list with filters, and a capability maturity view of objective ratings over time.
- Readers see the work items that name them as the point of contact and update their status and closure evidence.
- Executive dashboard with a rule-based readiness score, a nightly snapshot, a 12-month trend and a one-page PDF.
- The exercise director role: runs the exercise program and every exercise in it, without Org admin.
- Org admin > Exercises: exercise settings, signing keys, Cloud notes switch and Export for Cloud.
- Cloud notes at a few manual steps, dismissible per person. The Cloud page lists the AI features of Crucible Cloud. `CLOUD_TRIAL_URL` shows a trial link.
- Template files use the format name `crucible-template`. Files with the older name still import.
- Incident guest links: outside parties reach one incident by link, with expiry and revoke.
- Public status pages per incident, with email subscribers (double opt-in).
- Messaging: broadcasts to members and escalation contacts over the paging channels, with acknowledgements.
- Incident Playbooks tab: playbooks from Documents, suggested by rules and run as a checklist.
- Onboarding practice steps in Your setup, for the roles that can do them: run a training incident, run the practice Crisis Sim to ENDEX, add your IR playbook, and schedule your first exercise.
- Training incidents: a per-member practice incident with a seeded scenario and a persistent banner. It never pages, notifies, emails or calls a webhook, and stays out of lists, metrics, SLAs, reports, the readiness score, the executive dashboard and exports. Reset deletes it.
- Documents opens on the Library tab from `/documents?tab=library`.

### Upgrade

Migrations only add tables and columns (`Incident.isTraining` defaults to false). See [docs/upgrading.md](docs/upgrading.md#to-02).

## 0.1.0

First release: incidents, war room, action board, decisions log, paging with escalation, evidence vault, signed case-file exports, calendar feeds and two-factor sign-in.
