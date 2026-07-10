# Phase 1 Technical Debt Register

Date: 2026-07-09

| ID | Area | Priority | Finding | Recommendation |
| --- | --- | --- | --- | --- |
| P1-TD-001 | Backend tests | Medium | Initial full command chain showed one transient demo-environment e2e 500; isolation and rerun passed. | Monitor for cross-suite state coupling; consider stricter test DB reset boundaries. |
| P1-TD-002 | Backend dependencies | Medium | pg deprecation warning appears during tests. | Trace warning before pg 9 upgrade. |
| P1-TD-003 | Security | Medium | Phase 1 rate limiting is implemented, but operational observability and tuning evidence remain needed. | Add route-level throttle metrics, expected `429` reporting and emergency tuning guidance. |
| P1-TD-004 | Evidence | High | Phase 1 upload validation hardening is implemented, but malware scanning and protected/signed delivery remain needed. | Add malware scanning strategy, image dimension validation and private/signed storage plan. |
| P1-TD-005 | Flutter logging | Medium | Multiple `debugPrint` diagnostics remain. | Gate noisy/sensitive logs behind debug/development mode. |
| P1-TD-006 | Backend logging | Medium | ReportService debug logs appear during tests. | Ensure production log level avoids noisy/sensitive output. |
| P1-TD-007 | Website | Closed | Typecheck/lint originally failed on unused imports; later Phase 1 website stabilization resolved this. | Keep website build, typecheck and lint in release validation. |
| P1-TD-008 | Website | Low | Browserslist database outdated. | Update in a planned website maintenance task. |
| P1-TD-009 | Performance | Medium | Large dashboard/list query performance not load-tested. | Add volume/performance test data. |
| P1-TD-010 | Documentation | Medium | Docs repo Phase 5E work remains uncommitted. | Preserve/commit before broad release documentation updates. |
| P1-TD-011 | Future modules | Medium | Metadata-only future modules are visible in platform configs. | Keep activation locked; avoid workflow exposure. |
| P1-TD-012 | Database | Medium | JSON profile data flexible but less constrained. | Document stable JSON structures as contracts mature. |
