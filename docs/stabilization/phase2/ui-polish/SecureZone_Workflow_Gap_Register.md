# SecureZone Workflow Gap Register

Phase 2 stabilization planning  
Assessment date: 2026-07-10

## Summary

| Area | Gap count |
| --- | ---: |
| Authentication and routing | 2 |
| Assignment lifecycle | 3 |
| Citizen/report lifecycle | 2 |
| Evidence and notifications | 2 |
| Admin oversight | 1 |
| Total | 10 |

## Gaps

| ID | Workflow | Gap | Risk | Recommended stabilization action |
| --- | --- | --- | --- | --- |
| WFG-001 | Provider login | Seeded, reset, and newly created provider authentication must be re-verified. | Provider portal blocked. | Add/confirm targeted auth tests and manual smoke. |
| WFG-002 | Role routing | Login responses must route PROVIDER, ORG_ADMIN, SUPER_ADMIN, and CITIZEN to correct portals. | Wrong portal access. | Verify frontend route mapping and backend roles. |
| WFG-003 | Assignment accept/reject | Reject reason and dispatch notification behavior need confirmation. | Unclear dispatch workflow. | End-to-end assignment lifecycle test. |
| WFG-004 | Assignment timeout | Timeout countdown and auto-unassign behavior need confirmation. | Stale assignments. | Validate scheduled logic or document as missing. |
| WFG-005 | Reassignment | Assignment history and reassignment notification consistency need verification. | Audit gaps. | Review assignment history source and UI. |
| WFG-006 | Completion validation | Citizen should confirm completed or mark incomplete for admin/org review. | Incorrect “reject provider” semantics. | UX terminology and status transition audit. |
| WFG-007 | Report timeline | Assigned → Accepted → In Progress → Completed → Citizen Validation → Closed must be consistent. | Timeline mismatch across portals. | Compare detail screens by role. |
| WFG-008 | Evidence | Completion evidence must appear in provider, citizen, and admin review screens. | Proof missing from workflow. | Verify storage URL generation and access. |
| WFG-009 | Notifications | All critical transitions should create role-scoped notifications. | Users miss work/state changes. | Use event matrix in notification assessment. |
| WFG-010 | Admin oversight | Organization admin and super admin views must remain tenant-correct. | Multi-tenant leakage. | Tenant-isolation regression checklist. |
