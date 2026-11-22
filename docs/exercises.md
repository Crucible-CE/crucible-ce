# Exercises and improvement

CE runs tabletop exercises next to incident command. The **Exercises** group in the side rail has Exercises, Templates, Documents and Schedule. The **Improvement** group has Executive dashboard, Program report, After-action reports and Work items. Every step is manual. CE has no AI.

## Who can do what

| CE role | In exercises |
| --- | --- |
| Reader | Joins exercises. Reads the final reports of exercises they took part in. Updates the status and closure evidence of work items that name them as the point of contact. |
| Contributor | Creates and runs exercises, templates and documents. Grades and writes reports. |
| Exercise director | Contributor, plus controls every exercise without a seat: runs it, signs its report and changes its improvement plan. No Org admin. |
| Administrator | Everything above, plus **Org admin > Exercise settings** (policy, signing keys, Export for Cloud). |

Inside an exercise, each person also has exercise roles: lead facilitator, controller, evaluator, scribe, player and observer. Control roles see hidden scoring, expected actions and rubrics. Players never do, and neither do guests.

## The three modes

**Crisis Sim.** A decision simulation. Each update gives teams a situation and a set of options. Teams vote, or a decision maker decides. Choices move the scenario between on track, under strain and escalating, and can start regulatory clocks. The facilitator can hold an update after it closes, reveal results and end the exercise (ENDEX). A debrief follows. Start blank or from the library (a practice sim and two starter scenarios). **How to build this** in the editor explains the fields and gives a prompt for your own AI tool. You enter the results by hand.

**Playbook Exercise.** Built from one of your documents. Upload or paste a playbook, plan or SOP under **Documents** (PDF, DOCX, Markdown or text, up to 10 MB). Then add modules, questions, expected actions and rubric criteria by hand, with the document beside the editor. During the run, players or a scribe post entries. The facilitator confirms or denies each one. Evaluators grade entries against the rubric.

**Strategic TTX.** A scripted master scenario events list (MSEL). Build it in **Studio**: updates with team variants, branches between updates, and expected actions per team. During the run, the controller can send a contingency inject or a simulation cell message, and can hold an update for review before release. Each team's decision maker answers. Evaluators rate the answers. The library has two Strategic TTX templates. **How to build this** in Studio explains the fields and gives a prompt for your own AI tool. You enter the results by hand.

Library templates can be edited in place or duplicated. Templates export and import as one JSON file per template. See [Template files](#template-files).

## Invites and joining

Open an exercise and use the lobby to add people.

- **Members.** Add people with CE accounts and give them exercise roles. They join from **Exercises**.
- **Invite code.** Turn on join by code. Anyone with the code or the join link can join as a guest with only a display name. Guests are players on one exercise. They never get control, never see other exercises and need no account. A code works only while the exercise is in the lobby, live or paused. Rotate it to cut off a leaked code. `GUEST_CAP_PER_EXERCISE` limits guests per exercise (default 60).
- **Email invites.** Send the join link, the code and a calendar file (ICS) by email. This needs email delivery set up. See [paging.md](paging.md). CE does not store the addresses.

**Set `PUBLIC_URL` before you invite anyone.** Join links, the QR code, invite emails and calendar files use it. If `PUBLIC_URL` is `http://localhost:3000`, participants on other machines get a link that does not work. The lobby warns when this is the case. Set it to the address participants open, and make sure they can reach it. If you restrict access with an IP allowlist or VPN (see [deployment.md](deployment.md)), guests need a way in too.

## After the exercise

After ENDEX, the exercise moves through these steps. The tracker at the top of the report shows where you are.

1. **Hotwash.** Record strengths and areas for improvement while the room is still together.
2. **Ratings.** Evaluators rate each objective P, S, M or U with a short rationale.
3. **Feedback.** Participants fill in a short form from their player view.
4. **Attendance.** Confirm attendance for every participant on the roster. Add people who took part without a device. Required roles count only people confirmed as present.
5. **After-action report.** Create the draft. Factual sections fill in from the exercise record: overview, decision log, regulatory clocks, roster, required roles, control mapping and methodology. Evaluators write the executive summary, and the strengths and areas for improvement for each objective. Cite evidence from observations, answers and decisions.
6. **After-action meeting.** Move the report to review and walk through it with the team.
7. **Improvement plan.** Turn each area for improvement into work items with an owner and a due date. Work items are listed under **Improvement > Work items**. A reader sees only the items where their account email is the point of contact email.
8. **Sign-off.** The facilitator signs. When the organization requires sponsor sign-off, the sponsor countersigns. The report is then final and locked. A change after that is a new version.

Reports export as PDF and DOCX at any stage. Drafts are marked Draft.

## Signing and the evidence bundle

CE signs final reports with the same Ed25519 key that signs case-file exports, `EXPORT_SIGNING_PRIVATE_KEY`. Without it, reports cannot be signed. See [case-file-exports.md](case-file-exports.md#key-rotation).

A final report has an **Evidence bundle** download. It is a zip with the signed PDF, a DOCX, the signed JSON record, CSV files for the roster, decision log and improvement plan, the public key and a signed manifest. Anyone can check it offline.

```bash
npm run verify-bundle -- --key <keyId> aar-bundle.zip
```

Pass the 16 character key ID shown in **Org admin > Exercise settings > Signing keys**, or the public key file downloaded there. Pass `--key` twice when the key was rotated between signing the report and the bundle. The verifier exits `0` for PASS, `1` for FAIL (any changed file or a key that is not pinned), `2` when it passed without `--key` (the signer is not confirmed) and `3` for a usage error. The bundle's README.txt also explains how to check it with OpenSSL alone.

## Schedule

**Exercises > Schedule** lists planned exercises, one-off or recurring. Times are in the organization's time zone. Each entry can link a template. CE never starts an exercise on its own.

Download a calendar file for one exercise, or subscribe to the private ICS feed for all of them. A contributor, exercise director or administrator creates the feed link. It is shown once. Replace it or turn it off at any time.

## After-action reports

**Improvement > After-action reports** lists the report of every ended exercise, newest first: mode, ended date, status, version, signers, accepted findings and work items. Filter by status, mode and ended date, or search by exercise title. The control team of an exercise downloads the final PDF and the evidence bundle from the list. Readers see final reports of exercises they took part in, read only. Practice exercises are not listed.

**Capability maturity** shows the objective ratings (P, S, M, U) for each capability across ended exercises, oldest on the left. Readers do not see it.

## Program report

**Improvement > Program report** shows the exercise program: exercise history, the last test date for each framework control, cadence against your policy, required-role coverage, reports that are overdue, and open and overdue work items. Download it as a PDF. Set the cadence policy in **Org admin > Exercise settings**.

## Executive dashboard

**Improvement > Executive dashboard** puts the program on one page: the readiness score with its 12-month trend, open incidents by severity, MTTA and MTTR for the last 90 days, open incidents past an SLA, the last exercise, exercises in the last 12 months by mode, cadence per framework, required-role coverage, open and overdue work items by age, and accepted findings with and without an action. Incident numbers count only the incidents you can see. Download it as a one-page PDF with the confidentiality marking. Readers do not see it.

### Readiness score

The score is 0 to 100 and rule-based. It never uses AI, and incidents do not change it. Each component scores 0 to 100 and shows why.

| Component | Weight | Scored on |
| --- | --- | --- |
| Exercise cadence | 20 | Cadence requirements current or due soon. With no cadence set, an exercise in the last 12 months. |
| Required roles | 15 | How often each required role attended exercises in the last 12 months. |
| Objective ratings | 15 | The latest evaluator rating per objective in 12 months: P 100, S 67, M 33, U 0. The trend compares the last 6 months with the 6 before. |
| Work items | 20 | Open items not overdue (50), not over 90 days old (30), and fewer than 5 open high priority (20). No open items scores 100. |
| Report timeliness | 10 | Exercises in 12 months without a report past due. |
| ATT&CK techniques | 10 | Distinct techniques tagged on delivered injects in 12 months. 20 is full credit. |
| Playbooks | 10 | Any playbook (30), one of your own or a duplicated library playbook (30), and the share of your own exercised or run on an incident in 12 months (40). |

A component with nothing to measure, such as no required roles in policy, is not counted, and the other weights scale to 100. A snapshot is stored every night at 02:30 server time. A rerun on the same day replaces that day. Crucible Cloud adds AI parts to its score, such as document analysis. CE leaves them out.

## Cloud notes

At a few manual steps, contributors, exercise directors and administrators see a one-line note that Crucible Cloud does that step with AI, with a link to the matching card on the **Crucible Cloud** page. Notes never replace or block the manual control. Players, guests, the presenter view, exports and emails never show them.

- Each person can dismiss a note. It stays dismissed for that person.
- An administrator can turn notes off for the whole organization in **Org admin > Exercise settings**.
- CE sends nothing about notes anywhere.

When `CLOUD_TRIAL_URL` is set, the Cloud page shows **Try Crucible Cloud free for 1 week** and links there. When it is not set, the page title carries a "Coming soon" tag, the button reads "Free 1 week trial coming soon" with a line saying Cloud is not open yet, and notes read "Coming soon in Cloud" and link to the Cloud page only. See [configuration.md](configuration.md). Notes and cards for steps Cloud does not have yet always read "Coming soon".

## Export for Cloud

**Org admin > Exercise settings > Export for Cloud** downloads one JSON file for import into Crucible Cloud when it opens. CE never connects to Cloud. The file holds:

- your own templates, in the template file format
- library templates, only the ones your organization edited (Cloud already has the unedited library)
- source documents (title, kind, text and a SHA-256 hash)
- the email addresses of active users, for invites

It holds no exercises, reports, incidents, names or settings. Templates whose hidden scoring you may not read (because you are playing in a live run) are left out.

## Template files

A template exports as JSON with `"format": "crucible-template"` and `"version": 1`. It carries the template's settings, updates, branches and rubrics, including hidden scoring, so only people who manage templates can export. A Playbook Exercise template names its source document by title and hash, never its text. Import always creates a new draft. Files with the older format name `crucible-ttx-template` still import.
