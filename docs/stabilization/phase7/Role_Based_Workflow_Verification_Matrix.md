# Role-Based Workflow Verification Matrix

## Classification key

- A: Confirmed backend defect
- B: Confirmed Flutter defect
- C: Cross-layer state defect
- D: Navigation defect
- E: Missing feature
- F: Partial implementation
- G: Placeholder
- H: Misleading UI
- I: Environment/configuration dependency
- J: Historical issue not reproduced
- K: Product decision required
- L: Working as intended

## Citizen

| Workflow | Evidence | Result | Classification | Notes |
| --- | --- | --- | --- | --- |
| Phone login and OTP | Source inspection; Firebase-dependent Flutter flow | Not manually exercised | I | Requires approved Firebase/browser session |
| Email/password login | Source inspection | Unsupported for citizen sign-in | E / K | Citizen login remains phone/OTP-oriented |
| Registration | Source inspection and API contract | Partially supported | F | Registration collects email/password, but login path is still phone/OTP |
| Report lifecycle | `report-workflow.e2e-spec.ts` | Passed | L | Create, assignment, completion review, rating, ownership covered |
| Evidence upload/retrieval | E2E coverage from prior tranche and report workflow suite | Passed | L | Completion evidence persistence previously fixed |
| Notifications | Source + Phase 7B-D Flutter tests | Partially verified | F | Manual click-through remains pending |

## Provider

| Workflow | Evidence | Result | Classification | Notes |
| --- | --- | --- | --- | --- |
| Email/provider ID login | `auth.e2e-spec.ts`; source inspection | Passed in backend | L | Manual browser login not exercised |
| Dashboard/job lists | Flutter source and tests | Automated build/test passed | F | Manual dashboard data refresh remains pending |
| Assignment accept/reject | `report-workflow.e2e-spec.ts`; Phase 7B-D Flutter tests | Passed | L | Expiry/reassignment protected by backend and UI state helper |
| Completion workflow | `report-workflow.e2e-spec.ts` | Passed | L | Completion, evidence and citizen review covered |
| Notifications | Phase 7B-D source/tests | Partially verified | F | Manual read/open badge behavior remains pending |
| Billing/payment | Source audit | Corrected | H fixed | Fake card/checkout wording replaced with manual-billing readiness |

## Organization administrator / dispatcher

| Workflow | Evidence | Result | Classification | Notes |
| --- | --- | --- | --- | --- |
| Admin login/RBAC | `auth.e2e-spec.ts` | Passed | L | ORG_ADMIN/DISPATCH behavior covered at backend level |
| Reports/dispatch | `report-workflow.e2e-spec.ts` | Passed | L | Assignment/reassignment/timer behavior covered |
| Platform Tools visibility | Flutter admin navigation tests | Passed | L | Organization admin excludes Platform Tools construction |
| Notification deep links | Source/governance review | Product decision pending | K | No dedicated org/dispatcher notification UI route confirmed |

## Super administrator

| Workflow | Evidence | Result | Classification | Notes |
| --- | --- | --- | --- | --- |
| Login/RBAC | `auth.e2e-spec.ts` | Passed | L | Backend role behavior covered |
| Platform Tools | `platform-tools.e2e-spec.ts`, Flutter tests | Passed | L | Health/cache/backup/audit covered at API/UI rendering level |
| Backup create/list/delete | `platform-tools.e2e-spec.ts` | Passed | L | Restore/download production operation remains governance-controlled |
| Audit export | Source/API inspection | Implemented endpoint | F | Manual browser download not exercised |
| Monetization | Source audit | Manual-invoice RC posture | F | Real payment gateway intentionally deferred |

## Manual refresh/logout-login evidence

Manual browser refresh and logout/login persistence checks remain unperformed in this execution context. Automated API and Flutter tests are green, but Phase 7B-F should include the role-authenticated browser pass.
