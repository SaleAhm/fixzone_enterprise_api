# Organization-First Report Intake

## Authoritative Ownership

`Report.organizationId` is the authoritative operational tenant for report dashboards, report lists, dispatch queues, analytics, provider workload metrics, notifications, discussion records and activity history.

`Report.assignedOrganizationId` is routing metadata. It records the organization currently being offered the report for intake, or the organization selected by platform routing. It must agree with `organizationId` while a report is in organization review or organization dispatch. It may be `null` for Super Admin triage and legacy direct-assignment compatibility.

## Intake States

- `TRIAGE`: the platform could not deterministically route the report, or an organization rejected it. Super Admin retains oversight and routing control. Organization workspaces do not treat this as dispatchable work.
- `ORG_REVIEW`: exactly one eligible active organization matched, or Super Admin manually routed the report to an organization. The organization can view the report and must accept or reject it before provider dispatch.
- `PENDING`: the organization accepted the report. It is now in that organization's dispatch queue and may be assigned to a provider.
- `ASSIGNED`, `IN_PROGRESS`, `COMPLETED_BY_PROVIDER`, `CLOSED`: provider and citizen completion lifecycle states.

## Routing And Decisions

Automatic routing only selects an organization when exactly one active eligible organization matches the report category and jurisdiction signals. Multiple matches or no match leave the report in `TRIAGE`; the platform does not silently choose among organizations.

Organization Admins and Dispatch Officers may accept or reject only reports whose `organizationId` and `assignedOrganizationId` match their own organization. Acceptance moves `ORG_REVIEW` to `PENDING`. Rejection requires a reason, clears `assignedOrganizationId`, records the rejection reason in assignment history, and returns the report to `TRIAGE`.

## Super Admin Oversight And Overrides

Super Admin can view all reports and manually route triage reports. Ordinary provider assignment cannot bypass `ORG_REVIEW`; provider assignment is only valid from `PENDING`. Cross-organization provider assignment requires an explicit override flag and reason, and is recorded in audit/activity metadata.

## Provider Assignment Tenant Rules

Organization users can assign only providers in their organization or accepted active provider members linked to that organization. Providers operate on assigned work through the report's authoritative `organizationId`. Legacy reports with direct provider assignments remain readable by their assigned provider for compatibility; new organization-routed reports should flow through `ORG_REVIEW` and `PENDING`.

## Historical Compatibility

No production-style records are bulk-mutated by this release. Existing records where `organizationId` and routing metadata disagree are left unchanged. Reports in `TRIAGE` are excluded from organization operational scopes even though the current schema requires a non-null `organizationId`; Super Admin must explicitly route them before organization dispatch.
