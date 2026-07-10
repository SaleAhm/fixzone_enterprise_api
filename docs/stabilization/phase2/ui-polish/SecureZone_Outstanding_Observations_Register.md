# SecureZone Outstanding Observations Register

Phase 2 UI Stabilization inventory  
Assessment date: 2026-07-10

## Summary

| Category | Count |
| --- | ---: |
| Authentication and identity observations | 4 |
| Provider workflow observations | 5 |
| Citizen/report lifecycle observations | 5 |
| Admin and organization operations observations | 6 |
| Platform tools and trust observations | 4 |
| Mobile/UI observations | 5 |
| Website/live-data observations | 3 |
| Total observations | 32 |

## Register

| ID | Area | Observation | Severity | Current assessment |
| --- | --- | --- | --- | --- |
| OBS-001 | Provider auth | Provider authentication has previously been unreliable for seeded and newly created providers. | High | Needs regression verification before further UI work. |
| OBS-002 | Provider auth | Provider ID login support must be confirmed separately from email login. | Medium | Expected only if explicitly supported by current auth flow. |
| OBS-003 | Identity | Demo credentials and seeded hashes require repeatable validation. | High | Should be included in backend auth smoke tests. |
| OBS-004 | Role routing | ORG_ADMIN and PROVIDER routing has had prior drift risk. | High | Verify portal routing from login responses. |
| OBS-005 | Provider profile | Public provider cards must show PRV-style IDs rather than internal database IDs. | Medium | UI display concern; backend assignment should still use internal IDs. |
| OBS-006 | Provider workflow | Accept/reject/timeout/reassign lifecycle needs end-to-end smoke coverage. | High | Core production workflow. |
| OBS-007 | Provider workflow | Provider completion evidence visibility has previously failed in detail screens. | High | Requires image URL and role-scope verification. |
| OBS-008 | Provider analytics | Provider analytics screenshot/layout requires mobile polish and data-source review. | Medium | See UI stabilization backlog. |
| OBS-009 | Provider dashboard | Subscription and performance widgets require backend consistency checks. | Medium | Avoid placeholder UX in production views. |
| OBS-010 | Report lifecycle | Duplicate report detection is not confirmed as implemented. | Medium | See duplicate report assessment. |
| OBS-011 | Report lifecycle | Citizen completion validation should avoid direct provider rejection language. | High | Must preserve enterprise workflow terminology. |
| OBS-012 | Report lifecycle | Status history/timeline consistency needs verification across all portals. | High | Required for auditability. |
| OBS-013 | Report lifecycle | Evidence gallery and thumbnails need consistent loading and fallbacks. | Medium | Especially on Web and Android. |
| OBS-014 | Citizen portal | Category-card navigation and history visibility require regression smoke tests. | Medium | UX completeness item. |
| OBS-015 | Citizen settings | Profile, security, notifications, and email/password support remain high-risk user-facing areas. | Medium | Verify current implementation before expanding. |
| OBS-016 | Admin providers | Mobile provider cards have previously overflowed on Pixel-width screens. | High | Must be part of first UI stabilization batch. |
| OBS-017 | Admin organizations | Billing/module status visibility must remain static and non-animated after data load. | Medium | Previously observed issue. |
| OBS-018 | Admin reports | Enterprise Operations panel visibility in report details must be checked. | Medium | Prior defect. |
| OBS-019 | Dispatch | Responsibility routing and assignment filters require strict organization scoping. | High | Tenant isolation concern. |
| OBS-020 | Users | Organization admin user-management actions require smoke verification. | Medium | Action menus should show loading/success/error states. |
| OBS-021 | Platform tools | Cards/panels have previously blanked when selected. | High | Must remain covered by local debug smoke tests. |
| OBS-022 | Platform tools | Platform Tools mobile cards have shown tiny bottom overflow. | Medium | Responsive layout issue. |
| OBS-023 | Trust Center | KYC/dispute/session controls need permission and audit-log regression checks. | High | Sensitive identity area. |
| OBS-024 | Records Vault | Evidence/document visibility requires private document scope verification. | High | Compliance concern. |
| OBS-025 | Mobile navigation | Admin bottom navigation must remain limited to five items on mobile. | Medium | Prevents crowded UI regression. |
| OBS-026 | Mobile layout | Welcome/KPI cards must not clip on 360-430px browser widths. | Medium | Re-test on emulator and web responsive mode. |
| OBS-027 | Mobile layout | Long emails, IDs, and organization names need wrapping or ellipsis rules. | Medium | Common RenderFlex cause. |
| OBS-028 | Flutter web | Image upload paths must remain `XFile`/bytes-safe and not depend on `dart:io`. | High | Cross-platform compatibility. |
| OBS-029 | Website | Website currently needs clear separation between static marketing data and live platform metrics. | Medium | See website live-data assessment. |
| OBS-030 | Website | Live API integration should not be introduced without cache/error states. | Medium | Prevents public-page instability. |
| OBS-031 | Website | Production website branch differs from local stabilization branch. | Medium | Release governance item. |
| OBS-032 | Documentation | Existing documentation repo has unrelated dirty Phase 5E files. | Medium | Must not be touched by backend stabilization commits. |

## Recommended first triage order

1. Provider auth and role-routing verification.
2. Mobile overflow fixes in provider/admin/platform tools screens.
3. Evidence image display verification.
4. Platform Tools panel rendering regression tests.
5. Notification and assignment lifecycle smoke tests.
