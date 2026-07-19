# Manual Verification Limitations Register

## Limitation summary

Phase 7B-E did not perform a live authenticated browser walkthrough. No manual validation is claimed beyond source-level and automated test/build validation.

## Limitations

| Limitation | Impact | Mitigation used |
| --- | --- | --- |
| No approved interactive authenticated browser session | Could not manually click through citizen/provider/admin workflows | Used backend E2E suites and Flutter tests |
| Firebase OTP/manual phone login not exercised | Citizen live login path remains configuration-dependent | Reviewed source and preserved as Phase 7B-F manual item |
| No manual browser refresh/logout-login pass | Persistence behavior not manually verified | Backend and Flutter source/test verification only |
| No production data access | Production state not inspected or modified | Correct for governance scope |
| No Dokploy interaction | Deployment status unchanged | Correct for governance scope |
| Admin/org notification deep-link expectation unclear | Cannot classify as broken without product route decision | Recorded as product decision required |

## Sanitized account handling

Seed/demo credentials are visible in repository seed/test code, but no credentials, tokens, OTPs, or production records were exposed in this report. Any future manual walkthrough should use approved local development accounts only.

## Required Phase 7B-F manual checks

- Citizen login/logout/refresh
- Provider login/logout/refresh
- Organization admin login/logout/refresh
- Super admin login/logout/refresh
- Provider assignment notification click-through
- Citizen completion-review notification click-through
- Invalid/deleted target behavior
- Provider stale-action state after real expiry/reassignment
- Placeholder truthfulness across all role menus
