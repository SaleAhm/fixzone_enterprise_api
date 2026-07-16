# Phase 7B-E Failure Matrix

| ID | Area | Expected behavior | Finding | Class | Severity | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 7BE-01 | Provider payment method | UI must not imply live card storage or payment processor | Screen displayed fake saved Visa/bank method and checkout CTA | H | Medium | Fixed |
| 7BE-02 | Provider checkout | UI must not imply live payment capture or immediate upgrade | Direct route showed payment method, confirm upgrade and upgrade success with local plan mutation | H | High | Fixed |
| 7BE-03 | Citizen email login | If unsupported, UI must not claim support | Citizen login remains phone/OTP; registration collects email/password | F / K | Medium | Documented/deferred |
| 7BE-04 | Manual notification click-through | Role notifications should open valid targets | Browser-authenticated click-through not available in this execution | I | Medium | Deferred to Phase 7B-F manual pass |
| 7BE-05 | Org/admin notification deep links | Expected destination must be clear before implementation | Dedicated requirement not confirmed | K | Low | Product decision required |
| 7BE-06 | Backup restore/download | Controls must be governed and truthful | Backend endpoints exist; production restore/download not exercised here | F | Medium | Documented/governance controlled |
| 7BE-07 | npm audit/deprecations | Technical debt should be tracked separately | Existing warnings remain | I | Low | Deferred |

## Fixed in Phase 7B-E

- Provider payment method truthfulness
- Provider checkout truthfulness
- Provider billing widget regression coverage

## Deferred

- Authenticated browser walkthrough
- Full email verification/recovery
- Citizen email/password login architecture decision
- Duplicate-report handling
- Payment gateway/subscription billing implementation
- Exports
- Backup restore/download production exercise
- HPE replication
