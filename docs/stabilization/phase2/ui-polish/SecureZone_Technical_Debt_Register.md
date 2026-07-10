# SecureZone Technical Debt Register

Assessment date: 2026-07-10

## Summary

| Debt category | Count |
| --- | ---: |
| Security/configuration | 3 |
| Workflow consistency | 5 |
| Mobile/responsive UI | 5 |
| Data integrity/tenant isolation | 4 |
| Observability/testing | 4 |
| Future-platform boundaries | 3 |
| Total | 24 |

## Register

| ID | Category | Debt item | Risk | Suggested timing |
| --- | --- | --- | --- | --- |
| TD-001 | Security | Backend JWT fallback secrets exist in source. | Misconfiguration risk. | Security tranche. |
| TD-002 | Security | Firebase API key restrictions and historical service-account key rotation should remain verified. | External abuse risk. | Security tranche. |
| TD-003 | Security | Session/device controls need clear distinction between real revoke and placeholder. | False security UX. | Trust hardening. |
| TD-004 | Workflow | Assignment timeout/auto-unassign behavior not confirmed. | Stale dispatch. | Phase 2 workflow. |
| TD-005 | Workflow | Reassignment history and notifications need verification. | Audit gaps. | Phase 2 workflow. |
| TD-006 | Workflow | Completion validation wording and statuses need consistency. | User confusion. | Phase 2 UI polish. |
| TD-007 | Workflow | Duplicate report handling not production-ready. | Analytics/work duplication. | Future workflow tranche. |
| TD-008 | Workflow | Report timeline display may differ by role. | Trust/audit mismatch. | Phase 2 workflow. |
| TD-009 | Mobile UI | Provider cards can overflow on Pixel widths. | Visual regression. | First UI batch. |
| TD-010 | Mobile UI | Platform Tools cards can show bottom overflow. | Visual regression. | First UI batch. |
| TD-011 | Mobile UI | Bottom navigation must remain five-item mobile structure. | Crowded navigation. | Regression check. |
| TD-012 | Mobile UI | Long emails/IDs/org names need consistent ellipsis/wrap. | RenderFlex risk. | First UI batch. |
| TD-013 | Mobile UI | Provider analytics/sidebar hierarchy needs responsive audit. | Usability issue. | UI polish batch. |
| TD-014 | Data | Tenant isolation must be re-tested across reports/providers/billing/trust. | Critical data leakage risk. | Before RC. |
| TD-015 | Data | Provider public ID must be separate from internal assignment ID. | Identity leakage/confusion. | First UI batch. |
| TD-016 | Data | Evidence URL authorization and fallback behavior must be consistent. | Broken proof/access risk. | Evidence tranche. |
| TD-017 | Data | Module enablement must not activate future services. | Scope creep/regression. | Platform regression. |
| TD-018 | Testing | Auth tests should cover seeded, created, and reset provider passwords. | Regression risk. | Auth tranche. |
| TD-019 | Testing | Platform Tools card click tests/manual debug checks are needed. | Blank-page regression. | UI tranche. |
| TD-020 | Testing | Notification event matrix needs backend verification. | Silent workflow failure. | Notification tranche. |
| TD-021 | Testing | Mobile widths 360/390/430 need repeatable smoke protocol. | Missed mobile regressions. | UI tranche. |
| TD-022 | Future platform | Future modules are metadata-only and need clear UI labels. | Misleading product claims. | Platform polish. |
| TD-023 | Future platform | Entitlement gates are non-blocking foundations. | Accidental blocking. | Access framework tests. |
| TD-024 | Future platform | Website live-data integration needs API contract and cache plan. | Public instability. | Future website tranche. |
