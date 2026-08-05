# FixZone Completion Governance Manual Production UAT Package

Date: 2026-08-05

Purpose: provide a browser-executable Production UAT package for the FixZone completion-governance release after backend and frontend deployment freshness have been confirmed.

This document intentionally contains no passwords, OTPs, tokens, cookies, session values, API keys, or production credentials.

## 1. UAT Safety Rules

- Use clearly identifiable test reports only.
- Prefix every new UAT report title with `UAT-2026-08`.
- Do not use real sensitive citizen information.
- Do not execute demo purge.
- Do not execute deadline processing.
- Do not change global category policies unless a separate approval is given.
- Do not test Paystack or live payments.
- Do not perform production data cleanup.
- Do not reset, purge, seed, or migrate the production database during UAT.
- Do not clear production uploads or deployment volumes.
- Stop immediately if tenant isolation, evidence ownership, or report custody is incorrect.
- Stop immediately if a report closes under the wrong completion policy.
- Stop immediately if evidence disappears, is reassigned to the wrong user/report, or becomes visible to an unrelated tenant.

## 2. Required Role Sessions

Use separate browser profiles, browsers, or private windows for each role to avoid session confusion.

| Role | Browser/session | Account placeholder | Notes |
| --- | --- | --- | --- |
| Citizen | Session A | `<CITIZEN_UAT_ACCOUNT>` | Creates reports, uploads evidence, reviews completion, rates provider. |
| Organization Admin | Session B | `<ORG_ADMIN_UAT_ACCOUNT>` | Reviews responsibility, assigns provider, verifies completion, requests rework. |
| Provider | Session C | `<PROVIDER_UAT_ACCOUNT>` | Accepts assignments, starts work, uploads completion evidence, submits completion. |
| Super Admin | Session D | `<SUPER_ADMIN_UAT_ACCOUNT>` | Verifies governance workspace, hold/unhold/reopen/resolve, policy override on dedicated UAT records only. |

Do not write credentials into this document, screenshots, notes, filenames, chat, or tickets.

## 3. Evidence Naming Convention

Create one evidence folder for the run:

```text
UAT-2026-08-completion-governance-<YYYYMMDD-HHMM>
```

Screenshot and export filenames:

```text
<TestID>_<Role>_<ReportID-or-TicketID>_<ShortScenario>_<PASS-FAIL-BLOCKED>.png
```

Examples:

```text
A01_Citizen_FZ-12345_SubmitMultiEvidence_PASS.png
B03_OrgAdmin_FZ-12345_AcceptResponsibility_PASS.png
G04_SuperAdmin_FZ-12345_HoldBlocksClosure_FAIL.png
```

Do not include credentials, tokens, citizen private contact data, or sensitive production data in screenshots.

## 4. Manual Execution Order

Run the scenarios in this order. Record every created ticket/report ID before changing roles.

### A. Citizen Submission

Test ID prefix: `A`

1. Sign in through the Citizen entry point using `<CITIZEN_UAT_ACCOUNT>`.
2. Create a new report titled `UAT-2026-08 Citizen completion policy - <initials/time>`.
3. Enter a human-readable location name.
4. Enter address and landmark where available.
5. Use GPS or manually position the pin.
6. Upload between two and five distinct evidence images.
7. Submit the report.
8. Record the ticket ID/report ID.
9. Open report history and report detail.
10. Verify:
    - all uploaded images render;
    - evidence order is preserved;
    - location name, address, landmark, and coordinates are visible where expected;
    - report status is correct;
    - timeline records the citizen submission;
    - citizen notification appears once;
    - no failed API request or console error appears.

Expected result: report is created with multi-image evidence, hybrid location data, timeline entry, notification, and a stable ticket/report ID.

### B. Routing And Responsibility

Test ID prefix: `B`

1. Sign in as Super Admin using `<SUPER_ADMIN_UAT_ACCOUNT>`.
2. Locate the new `UAT-2026-08` report.
3. Verify whether deterministic routing succeeded.
4. If responsibility review is required, send the report to the intended organization without ownership override.
5. Sign in as Organization Admin using `<ORG_ADMIN_UAT_ACCOUNT>`.
6. Open Responsibility Review.
7. Verify the UAT report appears in the queue.
8. Accept responsibility.
9. Confirm ownership transfers automatically and the report leaves the responsibility queue.
10. Record any situation where Super Admin must perform an unnecessary second ownership assignment.

Expected result: report custody is assigned to the intended organization exactly once, and responsibility review does not leak reports across tenants.

### C. Provider Assignment

Test ID prefix: `C`

1. As Organization Admin, open Dispatch.
2. Locate the accepted UAT report.
3. Verify only organization-authorized providers are listed.
4. Select a provider with suitable service capability.
5. Assign the report.
6. Verify:
    - assignment deadline appears;
    - timeline records assignment;
    - organization identity is correct;
    - provider details are correct;
    - selected provider can see the report;
    - unrelated providers cannot see the report.

Expected result: assignment is scoped to authorized organization providers and the assigned provider receives the job.

### D. Provider Lifecycle

Test ID prefix: `D`

1. Sign in as the assigned Provider using `<PROVIDER_UAT_ACCOUNT>`.
2. Verify notification and job detail are visible.
3. Accept the job.
4. Confirm status becomes `In Progress`.
5. Add a report discussion update.
6. Attempt completion submission without evidence.
7. Verify completion submission is rejected because evidence is required.
8. Upload multiple completion images with before/during/after/completion classifications where supported.
9. Enter a completion note.
10. Submit completion.
11. Verify:
    - completion evidence gallery is visible;
    - timeline records work start and provider completion;
    - notifications are delivered once;
    - status becomes Awaiting Confirmation or the correct policy-controlled review state;
    - no evidence is missing;
    - no failed API request or console error appears.

Expected result: provider cannot complete without evidence, can submit multiple completion images, and the report enters the correct review state.

### E. Completion Governance Policy Behaviour

Test ID prefix: `E`

Use one dedicated UAT report for each safely available policy:

- `CITIZEN_CONFIRMATION_REQUIRED`
- `ORGANIZATION_CONFIRMATION_REQUIRED`
- `BOTH_REQUIRED`

For each report:

1. Record the configured policy and policy source before approvals.
2. Perform approvals in the applicable order.
3. Verify the first approval does not close the report when another approval is required.
4. Verify only the required final decision closes the report.
5. Verify citizen rating and feedback are retained.
6. Verify final actor and policy used are shown in governance metadata or activity timeline.
7. Verify completed/closed lists update without manual data repair.

Expected results:

| Policy | Expected closure behavior |
| --- | --- |
| `CITIZEN_CONFIRMATION_REQUIRED` | Citizen confirmation closes when no dispute, rework, or hold exists. |
| `ORGANIZATION_CONFIRMATION_REQUIRED` | Citizen feedback may save, but organization verification is required to close. |
| `BOTH_REQUIRED` | Citizen and organization decisions are both required; either order must wait for the missing decision. |

### F. Rework

Test ID prefix: `F`

1. Use a UAT report where provider has submitted completion.
2. As Organization Admin or Citizen, request rework through the authorized path.
3. Verify a reason is required.
4. Verify the report does not close.
5. Verify provider receives the rework notification.
6. Verify provider can submit revised completion evidence.
7. Confirm old evidence remains available in history.
8. Confirm timeline records the rework actor, reason, and resulting state.

Expected result: rework blocks closure, preserves evidence history, notifies provider once, and allows revised completion evidence.

### G. Super Admin Completion Governance

Test ID prefix: `G`

Use dedicated UAT records. Do not use genuine operational records.

1. Sign in as Super Admin.
2. Verify only Super Admin sees the Completion Governance workspace.
3. Verify queue, counters, filters, loading, empty, and error states.
4. Inspect one eligible UAT report.
5. Place governance hold with a mandatory reason.
6. Confirm ordinary citizen and organization completion actions are blocked while held.
7. Confirm deadline preview classifies the held report as blocked by hold if applicable.
8. Remove hold with a mandatory reason.
9. Confirm the report returns to the correct review state.
10. Reopen only an appropriate closed UAT report.
11. Resolve only a dedicated governance UAT report and record the reason.
12. Test report policy override only on a dedicated UAT report.
13. Restore the original report policy afterward if the override test changed a UAT report that will continue through lifecycle testing.
14. Do not execute deadline processing.
15. Do not change platform category policy without separate approval.

Expected result: Super Admin governance actions require reasons, are unavailable to other roles, preserve audit/timeline history, and do not silently close disputed or held reports.

### H. Cross-Role Integrity

Test ID prefix: `H`

Verify the same UAT report across Citizen, Organization Admin, Provider, and Super Admin views.

1. Evidence galleries display all uploaded images in the correct order.
2. Named location and coordinates are consistent across roles.
3. Timelines contain correct actors and timestamps.
4. Notifications are not duplicated.
5. Discussions become read-only after closure.
6. Unrelated organizations cannot access the report.
7. Unrelated providers cannot access the report.
8. Closed reports move immediately to completed lists without manual refresh.
9. Citizen rating and feedback remain visible after reopening the report detail.
10. Dashboard counters and analytics update after state changes.

Expected result: every role sees only authorized data, report custody remains correct, and no fabricated state transition appears.

## 5. Evidence Register

Copy this table into the UAT evidence log and add one row per test step or grouped scenario.

| Test ID | Role | Report ID | Scenario | Expected result | Actual result | PASS / FAIL / BLOCKED | Screenshot filename | Defect severity | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A01 | Citizen | `<REPORT_ID>` | Submit UAT report with 2-5 evidence images | Report created; all images and hybrid location saved |  |  |  |  |  |
| A02 | Citizen | `<REPORT_ID>` | Verify report history/detail/notification | History, detail, timeline, notification visible once |  |  |  |  |  |
| B01 | Super Admin | `<REPORT_ID>` | Verify routing outcome | Correct routing or responsibility review path |  |  |  |  |  |
| B02 | Org Admin | `<REPORT_ID>` | Accept responsibility | Ownership transfers; leaves queue |  |  |  |  |  |
| C01 | Org Admin | `<REPORT_ID>` | Assign authorized provider | Provider assigned; unrelated providers excluded |  |  |  |  |  |
| D01 | Provider | `<REPORT_ID>` | Accept and start work | Status becomes In Progress |  |  |  |  |  |
| D02 | Provider | `<REPORT_ID>` | Completion without evidence | Submission rejected |  |  |  |  |  |
| D03 | Provider | `<REPORT_ID>` | Multi-image completion submission | Awaiting correct review state |  |  |  |  |  |
| E01 | Citizen/Org | `<REPORT_ID>` | Citizen-only policy | Citizen confirmation closes |  |  |  |  |  |
| E02 | Citizen/Org | `<REPORT_ID>` | Organization-only policy | Organization verification required to close |  |  |  |  |  |
| E03 | Citizen/Org | `<REPORT_ID>` | Both-required policy, citizen first | Waits for organization, then closes |  |  |  |  |  |
| E04 | Citizen/Org | `<REPORT_ID>` | Both-required policy, organization first | Waits for citizen, then closes |  |  |  |  |  |
| F01 | Citizen/Org | `<REPORT_ID>` | Request rework | Reason required; report does not close |  |  |  |  |  |
| F02 | Provider | `<REPORT_ID>` | Revised completion evidence | New evidence added; old evidence preserved |  |  |  |  |  |
| G01 | Super Admin | `<REPORT_ID>` | Governance workspace access | Super Admin sees workspace only |  |  |  |  |  |
| G02 | Super Admin | `<REPORT_ID>` | Hold blocks closure | Ordinary closure blocked |  |  |  |  |  |
| G03 | Super Admin | `<REPORT_ID>` | Unhold restores review state | Correct review state restored |  |  |  |  |  |
| G04 | Super Admin | `<REPORT_ID>` | Reopen closed UAT report | History/evidence preserved |  |  |  |  |  |
| G05 | Super Admin | `<REPORT_ID>` | Resolve dedicated UAT report | Reason recorded; report closes through governance |  |  |  |  |  |
| G06 | Super Admin | `<REPORT_ID>` | Report policy override | Previous and new policy audited |  |  |  |  |  |
| G07 | Super Admin | `<REPORT_ID>` | Deadline preview only | Preview shown; execution not run |  |  |  |  |  |
| H01 | All roles | `<REPORT_ID>` | Cross-role evidence and location consistency | Same authorized data across roles |  |  |  |  |  |
| H02 | All roles | `<REPORT_ID>` | Timeline/notification integrity | Correct actors; no duplicates |  |  |  |  |  |
| H03 | Unauthorized role | `<REPORT_ID>` | Tenant isolation | Access denied |  |  |  |  |  |

## 6. Defect Classification

| Severity | Definition | Examples |
| --- | --- | --- |
| Critical | Tenant isolation, data loss, unauthorized action, incorrect custody, destructive operation. | Unrelated organization can view report; evidence assigned to wrong report; purge/reset control executes; provider can resolve own report. |
| High | Completion closes under the wrong policy, evidence missing, assignment invisible, routing ownership wrong. | Both-required report closes after one approval; completion gallery loses images; assigned provider cannot see job; ownership requires unnecessary Super Admin reassignment. |
| Medium | Stale counters, incorrect unavailable messaging, duplicate notification, refresh required. | Governance counter stale after hold; notification duplicated; completed list needs manual browser reload. |
| Low | Layout, copy, spacing, non-blocking display defect. | Label typo; button spacing issue; non-critical overflow that does not block action. |

Stop UAT immediately for Critical defects. Continue only after product owner and release owner decide whether a fix, rollback, or controlled workaround is appropriate.

## 7. Go-Live Exit Criteria

The current FixZone release may be recommended for go-live only when:

- no Critical defects remain;
- no unresolved High defects remain in custody, assignment, evidence, completion governance, or tenant isolation;
- multi-image and named-location workflows pass;
- organization and provider lifecycle passes;
- completion policies behave correctly;
- production backups and persistent uploads remain verified;
- demo purge is locked;
- Paystack remains disabled until separately approved;
- deadline execution is not run except under separately approved isolated test conditions;
- category policy changes are not made without separate approval and an audit reason;
- evidence screenshots and notes are complete enough to reproduce any defect.

## 8. Final UAT Report Template

Use this template for the product owner's final report.

```text
Executive Result:
PASS / PASS WITH NOTES / BLOCKED / FAIL

Environment and deployed commits:
- Backend: be30d621c07b77234c5e01122c6e47a3cfd890e2
- Frontend: f5158cc3ee615eec89978c7aa0b63c97cc843ac3
- API: https://api.securezonegroup.com
- Web: https://fixzone.securezonegroup.com

Roles tested:
- Citizen:
- Organization Admin:
- Provider:
- Super Admin:

Reports created:
- UAT-2026-08 ... / Report ID:
- UAT-2026-08 ... / Report ID:
- UAT-2026-08 ... / Report ID:

Passed scenarios:
- 

Failed scenarios:
- 

Blocked scenarios:
- 

Defects by severity:
- Critical:
- High:
- Medium:
- Low:

Evidence summary:
- Evidence folder:
- Screenshot count:
- Screen recording count, if any:
- Exported logs, if any:

Data integrity assessment:
- Historical reports preserved:
- Report evidence preserved:
- Completion evidence preserved:
- Tenant isolation verified:
- Report custody verified:
- Governance history preserved:

Remaining production blockers:
- 

Go-live recommendation:
READY FOR PRODUCTION OPERATION / READY WITH NOTES / BLOCKED

Confirmation:
No destructive production action was performed.
No database reset occurred.
No data purge occurred.
No upload deletion occurred.
No deadline execution occurred.
No Paystack or live payment action occurred.
No credentials, tokens, OTPs, cookies, or API keys were recorded in evidence.
```

## 9. Manual UAT Completion Checklist

- [ ] UAT safety rules reviewed before sign-in.
- [ ] Four separate role sessions prepared.
- [ ] Evidence folder created using the naming convention.
- [ ] Citizen submission scenario completed.
- [ ] Routing/responsibility scenario completed.
- [ ] Provider assignment scenario completed.
- [ ] Provider lifecycle scenario completed.
- [ ] Citizen-only completion policy tested.
- [ ] Organization-only completion policy tested.
- [ ] Both-required policy tested in both approval orders.
- [ ] Rework path tested.
- [ ] Super Admin governance workspace tested.
- [ ] Hold/unhold tested.
- [ ] Reopen tested only on appropriate UAT report.
- [ ] Resolve tested only on dedicated UAT report.
- [ ] Report policy override tested only on dedicated UAT report and restored if needed.
- [ ] Deadline preview tested without execution.
- [ ] Category policy administration viewed only; no platform policy changed without separate approval.
- [ ] Cross-role evidence, timeline, notification, and tenant-isolation checks completed.
- [ ] Evidence register filled.
- [ ] Defects classified.
- [ ] Final UAT report completed.
