# Citizen Email Architecture Assessment

## Scope

Phase 7B-G reviewed the citizen email/login/profile concern without starting a broad authentication redesign.

## Observed state

Manual evidence reported:

- phone OTP login works;
- profile can show `Email: Not provided`;
- email/password paths are visible;
- email verification, recovery, and change-password are not complete.

## Source-level assessment

The platform currently contains a mixed identity foundation:

- Firebase-assisted citizen phone/OTP flows remain present in Flutter.
- Backend `AuthService` supports email/password login where a backend `User` has email and password hash.
- Profile display depends on whether email exists on the backend/Firebase-linked user record.
- Full email verification, resend verification, password recovery, and phone/email identity-linking are not completed as a unified citizen architecture.

## Classification

`PARTIAL / DEFERRED`

The visible email controls should remain truthful and should not imply a complete verified email authentication architecture until the following are implemented:

1. backend email verification lifecycle;
2. password recovery/reset flow;
3. Firebase/backend identity linking;
4. duplicate email/phone conflict resolution;
5. role-specific profile synchronization;
6. manual and automated regression coverage.

## Recommendation

Create a future controlled authentication tranche for citizen email identity completion. Do not attempt it inside Phase 7B-G.
