# FixZone Final Production Browser UAT Checklist

Date: 2026-08-01

| Persona | Scenario | Expected evidence | Result |
| --- | --- | --- | --- |
| Citizen | Submit a new report with image and location | Tracking ID, newest-first list placement, image renders | Pending |
| Citizen | Duplicate review: view match, cancel, continue once | Selected report opens; continue creates exactly one new report | Pending |
| Citizen | Confirm provider completion | Timeline shows citizen confirmed and report closes | Pending |
| Citizen | Dispute/reject completion | Timeline and notifications show citizen disputed state | Pending |
| Super Administrator | Log in through internal admin flow | Super admin shell and Platform Tools load | Pending |
| Super Administrator | Assign report to direct provider | Success message, refreshed detail shows provider/status/deadline | Pending |
| Super Administrator | Expire overdue assignments | One timeout transition and report returns to dispatch | Pending |
| Super Administrator | Reassign Provider A to Provider B | Provider A loses actions; Provider B can accept | Pending |
| Super Administrator | Review backup metadata | Metadata is not labelled as full DB backup; restore unavailable | Pending |
| Hunslow Organization Administrator | Log in through organization-admin entry | Organization admin shell, no internal super-admin privilege | Pending |
| Hunslow Organization Administrator | Invite existing provider | Invitation appears in Hunslow-scoped list | Pending |
| Hunslow Organization Administrator | Invite new provider | Invitation persists and sends/records pending identity | Pending |
| Hunslow Organization Administrator | Dispatch Hunslow report to accepted provider | Hunslow roster/count and report state update | Pending |
| Invited existing provider | Sign in and view pending invitation | Invitation card references Hunslow and intended role | Pending |
| Invited existing provider | Accept invitation | Membership activates without duplicate membership | Pending |
| Invited existing provider | Decline invitation | Invitation becomes declined and cannot be accepted later | Pending |
| Invited new provider | Register/sign in with invited identity | Pending invitation is visible only to invited identity | Pending |
| Invited new provider | Accept invitation | Provider retains provider account and SecureZone ID | Pending |
| Directly assigned provider | Open notification and job detail | Evidence image, deadline, Accept and Reject actions visible | Pending |
| Directly assigned provider | Accept active assignment | Job moves to In Progress; stale new-job actions disappear | Pending |
| Directly assigned provider | Reject active assignment with reason | Report returns to dispatch; reason appears in timeline/admin view | Pending |
| Directly assigned provider | Complete work with evidence | Completion evidence renders to admin/citizen/provider | Pending |
| Directly assigned provider | Attempt expired/superseded assignment | Truthful expired/superseded guidance, state refreshes | Pending |
