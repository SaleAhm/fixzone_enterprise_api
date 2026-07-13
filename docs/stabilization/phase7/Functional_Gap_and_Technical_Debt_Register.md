# Phase 7A — Functional Gap and Technical Debt Register

| ID | Role/Module | Issue | Evidence | Severity | Impact | Dependency | Size | Recommendation | Tranche |
|---|---|---|---|---|---|---|---|---|---|
| P7A-001 | Backend tests | Full backend tests fail in auth/platform tools. | `npm test`: 2 suites failed, 9 tests failed. | High | Security, maintainability | Test DB isolation | M | Stabilize tests before runtime work. | 7B |
| P7A-002 | Backend e2e | E2E tests fail in auth/rate-limit/demo environment. | `npm run test:e2e`: 3 suites failed, 7 tests failed. | High | Release readiness | Test fixtures | M | Fix fixtures and deterministic cleanup. | 7B |
| P7A-003 | Backup | Backup creation e2e returns 500. | `platform-tools.e2e-spec.ts` failure. | High | Operational | Platform tools service | M | Diagnose and fix backup path/permissions/test setup. | 7B/7D |
| P7A-004 | Restore/download | Restore/download endpoints exist but UI safety incomplete. | Platform tools endpoints and UI disabled export. | Critical | Operational/security | Policy/runbook | L | Implement safe ops workflow with confirmation/audit. | 7D |
| P7A-005 | Provider auth | Auth regression suite failing; duplicate email/test state collisions. | `auth.e2e-spec.ts` failures. | High | Provider productivity | Test data/auth | M | Stabilize provider/admin/citizen auth tests. | 7B |
| P7A-006 | Rate limiting | Rate-limit e2e FK violations. | `rate-limiting.e2e-spec.ts`. | High | Security | Test fixtures | S | Fix organization fixture lifecycle. | 7B |
| P7A-007 | Monetization | Payment gateway absent; invoice download disabled. | Billing history screen text. | High | Revenue/investor | Payment/provider | L | Implement billing/payment or relabel. | 7E |
| P7A-008 | Monetization | RC/manual pricing placeholder language. | `admin_monetization_screen.dart`. | Medium | Investor perception | UX/policy | S | Hide or relabel before investor demos. | 7C/7E |
| P7A-009 | Provider login | Forgot password empty callback. | `provider_login_screen.dart onPressed: () {}`. | High | User support | Auth UX/API | S/M | Implement forgot/reset flow. | 7B |
| P7A-010 | Session management | Device termination UI future-ready only. | Trust Center text. | High | Security | Token/session model | L | Implement real session list/revoke. | 7F |
| P7A-011 | Export | Audit export backend-only/UI disabled. | Platform Tools export disabled. | Medium | Operations | Export policy | M | Add secure export UX. | 7D |
| P7A-012 | Report export | No mature report/PDF/CSV export. | No complete UI route found. | Medium | Client usability | Backend export | M | Add tenant-scoped exports. | 7D |
| P7A-013 | Evidence | Multi-image retry/progress maturity uncertain. | Uploads exist; retry queue not verified. | Medium | Citizen/provider usability | UI/upload service | M | Add upload progress/retry audit. | 7B/7C |
| P7A-014 | Dispatch AI | “AI” label may overclaim rules/scoring. | Dispatch UI and backend service. | Medium | Investor/client trust | Product wording | S | Explain matching logic. | 7C |
| P7A-015 | Tenant isolation | Manual authenticated tenant walkthrough missing. | No credentials/session in audit. | High | Security/privacy | Test accounts | M | Controlled tenant isolation smoke. | 7B |
| P7A-016 | Future modules | Metadata-only modules visible in admin. | Organization screen labels. | Medium | Client confusion | Product policy | S | Keep locked and clarify. | 7C |
| P7A-017 | Analytics definitions | Denominators/active/resolved/closed ambiguity. | Public metrics differences noted historically. | Medium | Investor trust | Analytics spec | M | Add definitions/tooltips. | 7E |
| P7A-018 | Accessibility | Flutter complex screens lack systematic a11y evidence. | Static audit only. | Medium | Accessibility | UX QA | L | Add role screen a11y pass. | 7F |
| P7A-019 | Responsive | Authenticated 320/375/768/1024/1440 screenshots missing for current build. | No safe authenticated session. | Medium | Mobile usability | Test accounts | M | Run authenticated screenshot pass. | 7C |
| P7A-020 | Audit coverage | Need event-by-event audit verification. | Many audit APIs exist; no live sampling. | High | Governance | Test data | M | Add audit matrix tests. | 7B |
| P7A-021 | Public website | npm audit warnings remain. | Website `npm ci`: 18 vulnerabilities. | Medium | Security | Dependency policy | M | Separate dependency review. | 7F |
| P7A-022 | Backend deps | npm audit warnings remain. | Backend `npm ci`: 34 vulnerabilities. | Medium | Security | Dependency policy | M | Separate dependency review. | 7F |
| P7A-023 | Flutter deps | 67 packages outdated/incompatible with current constraints. | `flutter pub get` output. | Low/Medium | Maintainability | Package policy | M | Planned upgrade review. | 7F |
| P7A-024 | Demo environment | Demo generation e2e returns 500. | `demo-environment.e2e-spec.ts`. | High | Demo reliability | Demo service/test DB | M | Stabilize demo generation. | 7B |
| P7A-025 | Operational DR | Off-site HPE ML30 replication pending. | Phase 2 evidence. | Medium | Disaster recovery | Infrastructure | L | Complete DR replication. | 7D |

