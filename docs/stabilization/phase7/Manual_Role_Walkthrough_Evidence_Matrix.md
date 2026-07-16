# Manual Role Walkthrough Evidence Matrix

## Evidence status

No manual authenticated browser walkthrough was executed in this Phase 7B-F run. The matrix below records what remains required.

| Role | Required manual walkthrough | Status | Evidence classification |
| --- | --- | --- | --- |
| Citizen | Login, profile, report creation, completion review, notifications, refresh, logout/login | Not executed | Not testable in available environment |
| Provider | Login, dashboard, assignment, expiry/reassignment, completion, notifications, billing truthfulness | Not executed | Not testable in available environment |
| Organization administrator | Login, dashboard, reports, dispatch, providers, users, role restrictions | Not executed | Not testable in available environment |
| Dispatcher | Login, report queue, assignment, reassignment, expiry visibility, notifications | Not executed | Not testable in available environment |
| Super administrator | Dashboard, organizations, users, providers, reports, Platform Tools, backup/demo/audit/monetization truthfulness | Not executed | Not testable in available environment |

## Automated evidence retained

- Backend auth/report/platform-tools/trust E2E suites passed.
- Flutter Phase 7B-E test/build baseline passed.

## Manual evidence required before closure

Each role must be tested in an approved local or staging runtime using sanitized development accounts. Screenshots or logs should avoid exposing credentials, tokens, OTPs, or production records.
