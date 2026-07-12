# Phase 5 Implementation Roadmap

Date: 2026-07-12

This roadmap converts the Phase 5 gap audit into controlled implementation batches. It intentionally avoids claiming Phase 5 is complete. Each batch requires separate implementation, validation, commit, push, and deployment authorization.

## 1. Implementation Principles

- Keep FixZone/Maintenance as the only active production service module.
- Do not activate Healthcare, Legal, ICT, Agriculture, Education, Property, Security, or other future modules.
- Preserve tenant isolation, RBAC, auditability, evidence-first workflow, and production branch governance.
- Never expose private report coordinates or PII through public APIs.
- Persist relative storage paths and generate renderable URLs during serialization.
- Use working source, API, persistence, tests, and UI as readiness evidence.

## 2. Recommended Controlled Batches

### Batch 5A-1 — Present Location, Completion Geotagging and Reverse-Geocoding Foundation

Entry criteria:

- Current report create flow remains stable.
- Evidence upload remediation is deployed or explicitly included in the same release window.
- Prisma migration policy approved.

Implementation:

- Add report location metadata: accuracy, capturedAt, source.
- Add optional provider completion geotag metadata.
- Add coordinate DTO validation and range checks.
- Add provider-neutral reverse-geocoding abstraction with no committed API key.
- Update Flutter citizen submit screen with explicit “Use My Current Location” and “Pin Location Manually”.
- Add optional provider completion location capture.

Tests:

- Coordinate range validation.
- Permission denied/timeout/manual fallback widget tests.
- Metadata persistence e2e.
- Provider completion geotag e2e.

Migration impact:

- Likely additive migration for location metadata fields.

Rollback:

- Additive nullable fields allow runtime rollback without data loss.

### Batch 5A-2 — Privacy-Safe Public Metrics and Website Live Metrics

Entry criteria:

- Public data contract approved.
- Privacy review completed.

Implementation:

- Add `/api/public/metrics`, `/api/public/trends`, `/api/public/category-summary`, `/api/public/geographic-summary`, `/api/public/platform-status`.
- Return aggregate counts only.
- Add website API client with environment-driven base URL.
- Keep static fallback in one controlled file.
- Add visible `lastUpdatedAt` and fallback state.

Tests:

- Public metrics accuracy.
- No PII leakage.
- API failure fallback on website.
- No invalid number display.

Migration impact:

- None for metrics if derived from existing tables.

### Batch 5A-3 — Executive Charts and Authenticated Analytics Contracts

Entry criteria:

- Decide charting library or implement lightweight SVG/chart components.
- Confirm date-range requirements.

Implementation:

- Add backend chart data contracts for daily/weekly/monthly volume, status distribution, category distribution, resolution trend, provider performance, commercial indicators where authorized, and geographic summary.
- Update Flutter admin analytics with loading/empty/error states and accessible labels.

Tests:

- Tenant scoping.
- Date range filtering.
- Empty state.
- No PII in chart payload.

### Batch 5A-4 — Operational Responsibility Registry and Jurisdiction Routing

Entry criteria:

- Organization ownership policy agreed.
- Asset/facility taxonomy approved.

Implementation:

- Add operational registry model and CRUD APIs.
- Add optional report link to registry item.
- Add jurisdiction recommendation rules with explanation and manual override.
- Record audit events for routing/override/link changes.

Tests:

- Tenant isolation.
- Rule explanation.
- Manual override audit.
- Report link/unlink.

Migration impact:

- Additive models and optional report foreign keys.

### Batch 5A-5 — Duplicate Detection and Incident Clustering

Entry criteria:

- Location metadata available or acceptable fallback using existing lat/lng.

Implementation:

- Add conservative duplicate candidate service.
- Signals: distance, category, normalized text, time window, asset link, status.
- Admin compare/link/reject workflow.
- Preserve all citizen submissions.

Tests:

- Nearby same-category reports.
- Unrelated nearby reports.
- Same description far away.
- Tenant isolation.
- Time-window boundaries.

### Batch 5A-6 — GIS and Heat Map Dashboard

Entry criteria:

- Public/private location privacy policy approved.
- Server-side aggregation strategy selected.

Implementation:

- Add authenticated GIS aggregates and bounded point/cluster endpoints.
- Add public aggregated/blurred geographic summary only.
- Add Flutter admin GIS dashboard with report density, unresolved/resolved layers, provider coverage, registry assets.

Tests:

- Large dataset aggregation.
- Public coordinate privacy.
- Tenant-scoped private maps.

### Batch 5A-7 — Provider Reputation, Investor Readiness and Visitor Analytics

Entry criteria:

- Reputation metric definitions approved.
- Analytics provider/consent model selected.

Implementation:

- Add provider reputation aggregation with minimum sample thresholds.
- Add badge eligibility states without fabricated awards.
- Improve investor section using verified public API values.
- Add privacy-conscious visitor analytics with no invasive fingerprinting.

Tests:

- Reputation calculations.
- Insufficient data state.
- Visitor analytics disabled/no-secret behaviour.

## 3. Batch Exit Criteria

Every batch must record:

- files changed;
- Prisma/migration impact;
- tests run;
- rollback notes;
- commit hashes;
- working-tree status;
- remaining limitations.

## 4. Current Recommendation

Start with Batch 5A-1 in the next controlled implementation turn. It is the foundation for heat maps, jurisdiction routing, duplicate detection, provider geotagging, and future public geographic summaries.

