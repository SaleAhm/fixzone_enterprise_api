# Email and Profile Feature Assessment

## Current architecture

| Capability | Status | Evidence |
| --- | --- | --- |
| Backend user email field | Supported | Prisma user model and auth tests |
| Provider/admin email password login | Supported | `ApiService.login`, provider/admin login screens, `auth.e2e-spec.ts` |
| Citizen registration email collection | Supported | Citizen registration screen and onboarding API |
| Citizen phone/OTP login | Supported/configuration-dependent | Firebase phone flow |
| Citizen email/password login | Unsupported as primary login | Citizen login screen is phone/OTP-oriented |
| Email verification | Deferred/partial metadata only | Trust/identity fields reference verification status but no full workflow |
| Password reset/recovery | Deferred | Profile/security screens describe pending security API integration |
| Profile email display | Supported where backend/Firebase data exists | Citizen/provider/admin profile screens display email when present |
| Phone/email account synchronization | Partial | Firebase citizen bridge uses Firebase UID and profile email fallback |

## Findings

1. Provider and admin email/password authentication are supported by backend and Flutter login flows.
2. Citizen registration collects email/password, but citizen sign-in remains phone/OTP-oriented. This is a partial implementation and should not be presented as full citizen email-login support.
3. Profile screens generally display email when authorized data is returned.
4. Self-service password recovery and email verification remain deferred and should not be implemented in Phase 7B-E.

## Phase 7B-E action

No email/profile runtime change was made. The current visible password/security wording is already framed as pending or organization/admin managed.

## Recommended next action

Phase 7B-F or a dedicated auth tranche should decide whether SecureZone will support citizen email/password login alongside phone OTP, and then implement email verification/recovery consistently across backend, Firebase, and Flutter.
