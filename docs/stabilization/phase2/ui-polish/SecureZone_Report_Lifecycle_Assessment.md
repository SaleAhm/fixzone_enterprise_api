# SecureZone Report Lifecycle Assessment

Assessment date: 2026-07-10

## Current protected principle

The backend `Report` model and existing report routes must not be renamed or migrated during Phase 2 UI stabilization. Platform language can describe future “service requests,” but Maintenance/FixZone reports remain the operational workflow.

## Expected report lifecycle

| Stage | Actor | Expected behavior |
| --- | --- | --- |
| Submitted | Citizen/client | Citizen submits issue with category, location, details, and optional evidence. |
| Reviewed | Organization/admin | Admin or dispatch confirms readiness for assignment. |
| Assigned | Dispatch/admin | Provider is assigned using internal provider/user IDs. |
| Accepted | Provider | Provider accepts and receives work context. |
| In Progress | Provider | Work starts; timeline records transition. |
| Completion Submitted | Provider | Provider uploads evidence and notes. |
| Citizen Validation | Citizen/client | Citizen confirms completed or marks incomplete with comment/evidence. |
| Closed | System/admin | Report closes after validation or approved review. |

## Key gaps to verify

- Timeline order consistency across citizen, provider, org admin, and super admin views.
- Image/evidence visibility on all detail pages.
- Notifications for each critical transition.
- Audit logs for assignment, status updates, completion, validation, and disputes.
- Tenant isolation for reports and analytics.
- Duplicate report handling is not confirmed and should remain a planned future capability.

## Risk classification

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Status names differ between portals | Medium | Create one display mapping and test all portals. |
| Evidence unavailable on review screens | High | Verify URL generation and authorization. |
| Citizen rejection semantics conflict with workflow | High | Use “Work still incomplete” and admin/org review path. |
| Duplicate reports inflate analytics | Medium | Add future duplicate candidate review. |
| Cross-tenant report visibility | Critical | Tenant isolation tests before release. |
