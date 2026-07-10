# SecureZone Assignment Lifecycle Assessment

Assessment date: 2026-07-10

## Expected lifecycle

```text
Unassigned
  -> Assigned
  -> Accepted
  -> In Progress
  -> Completion Submitted
  -> Citizen Validation
  -> Closed
```

Alternative paths:

```text
Assigned -> Rejected -> Reassignment Required
Assigned -> Timed Out -> Auto-unassigned/Reassignment Required
Completion Submitted -> Incomplete -> Admin/Organization Review
```

## Assessment

| Capability | Status | Notes |
| --- | --- | --- |
| Assign provider | Implemented; verify | Confirm tenant-safe provider list and internal ID usage. |
| Provider accepts | Implemented; verify | Must update timeline and notify dispatch/org. |
| Provider rejects | Partial/verify | Requires reject reason, audit, and notification. |
| Timeout countdown | Not confirmed | Needs scheduled/derived state verification. |
| Auto-unassign | Not confirmed | Do not assume production behavior without tests. |
| Reassign | Partial/verify | Must preserve assignment history. |
| Completion evidence | Partial/verify | Evidence should display across provider/citizen/admin details. |
| Citizen validation | Partial/verify | Should not expose “Reject Provider” as primary action. |
| Assignment history | Partial/verify | Needed for audit and dispute workflows. |

## Stabilization notes

- Backend should continue using internal IDs for assignment.
- UI should display PRV-style provider IDs only as public identifiers.
- Every state change should create an audit trail.
- Notifications should be generated from successful state changes.
- Organization scope must be enforced in list and detail endpoints.

## Recommended tests

1. Dispatch assigns provider in same organization.
2. Provider accepts assignment.
3. Provider rejects with reason.
4. Provider completion evidence appears in admin/citizen review.
5. Citizen confirms work completed.
6. Citizen marks incomplete and returns report to admin/org review.
