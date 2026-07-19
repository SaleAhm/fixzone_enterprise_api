# Provider Authentication and Provider ID Synchronization Report

## Scope

Phase 7B-G investigated the manually observed provider login and Provider ID issues:

- provider management cards showed `Provider ID pending`;
- `provider1@fixzone.ng` returned `User not found`;
- assignment to provider records still worked;
- provider entities existed in management views but were not synchronized with login identities.

## Exact root cause

The local development database contained stale provider `User` records from an older seed shape.

Before repair:

| Email | Role | Provider ID | Account status | Password hash | Password123! |
| --- | --- | --- | --- | --- | --- |
| `provider1@fixzone.ng` | missing | missing | missing | missing | n/a |
| `provider2@fixzone.ng` | `PROVIDER` | `null` | `ACTIVE` | bcrypt | valid |
| `provider3@fixzone.ng` | `PROVIDER` | `null` | `ACTIVE` | bcrypt | valid |
| `provider4@fixzone.ng` | `PROVIDER` | `null` | `ACTIVE` | bcrypt | valid |
| `provider5@fixzone.ng` | `PROVIDER` | `null` | `ACTIVE` | bcrypt | valid |
| `provider6@fixzone.ng` | `PROVIDER` | `null` | `ACTIVE` | bcrypt | valid |

`ProviderOrganization` count was `0`.

The backend `AuthService.login` implementation was not the root cause. It supports:

- email login;
- phone login;
- Provider ID-only login;
- email + Provider ID validation;
- Provider ID mismatch rejection.

The Flutter provider login screen sends the correct payload shape through `ApiService.login(email, password, providerId: providerId)`.

## Why login failed

`provider1@fixzone.ng` failed because the local database did not contain that `User` row.

Provider cards showed `Provider ID pending` because the local provider `User.providerId` fields were null. The admin provider card already reads `provider['providerId']` first and only falls back to `Provider ID pending` when no usable public ID exists.

## Local repair performed

The existing seed was inspected before use. It is upsert-based for users/providers and only creates reports when the demo organization has none.

Local command run:

```bash
npm run seed
```

Result:

```text
Seed users updated. Existing reports preserved (37).
```

After repair:

| Email | Provider ID | Account status | Organization | Password hash | Password123! |
| --- | --- | --- | --- | --- | --- |
| `provider1@fixzone.ng` | `PRV-2024-001` | `ACTIVE` | present | bcrypt | valid |
| `provider2@fixzone.ng` | `PRV-2024-002` | `ACTIVE` | present | bcrypt | valid |
| `provider3@fixzone.ng` | `PRV-2024-003` | `ACTIVE` | present | bcrypt | valid |
| `provider4@fixzone.ng` | `PRV-2024-004` | `ACTIVE` | present | bcrypt | valid |
| `provider5@fixzone.ng` | `PRV-2024-005` | `ACTIVE` | present | bcrypt | valid |
| `provider6@fixzone.ng` | `PRV-2024-006` | `ACTIVE` | present | bcrypt | valid |

`ProviderOrganization` count became `6`.

## Source changes

No backend source change was required for provider authentication.

No provider-login source change was made.

## Remaining verification

The local HTTP server background-start command was blocked by shell policy in the prior execution. In Phase 7B-H, a local Nest test harness verified the backend authentication path without starting production services or touching production data.

Verified through local backend harness:

- email + Provider ID login for `provider1@fixzone.ng` returned HTTP `201`;
- Provider ID-only login for `PRV-2024-001` returned HTTP `201`;
- returned role was `PROVIDER`;
- returned Provider ID was `PRV-2024-001`;
- organization ID was present;
- `/api/auth/me` preserved `PROVIDER` and `PRV-2024-001`;
- invalid password returned HTTP `401` with `Incorrect password`.

Browser retest remains required.

Required manual browser retest:

1. Start local backend and Flutter web.
2. Log in with `provider1@fixzone.ng` + approved local password.
3. Log in with `PRV-2024-001` + approved local password if Provider ID-only login is supported in the current UI.
4. Confirm provider dashboard opens.
5. Confirm provider profile and admin provider cards show `PRV-2024-001`, `PRV-2024-002`, and `PRV-2024-003` instead of database IDs or pending labels.

## Stable production comparison

Stable production was not logged into during this tranche because production login creates audit/security records and production data changes were prohibited.

## Phase 7C-A update

Provider authentication and public Provider ID synchronization were not changed in Phase 7C-A.

Read-only local dataset inspection confirmed:

- `provider1@fixzone.ng` remains `ACTIVE`;
- `provider1@fixzone.ng` retains Provider ID `PRV-2024-001`;
- six demo providers retain `PRV-2024-001` through `PRV-2024-006`;
- representative workflow states exist on providers 2-6, allowing provider1 to remain protected for login parity.

No destructive test fixture used `provider1@fixzone.ng` or `PRV-2024-001`.

Classification: `VERIFIED`.

## Classification

`LOCAL DATA PARITY DEFECT — REPAIRED LOCALLY, BROWSER RETEST REQUIRED`
