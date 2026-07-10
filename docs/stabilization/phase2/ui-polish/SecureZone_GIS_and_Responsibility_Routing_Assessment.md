# SecureZone GIS and Responsibility Routing Assessment

Assessment date: 2026-07-10

## Scope

This assessment covers map/location readiness, responsibility routing, service-area matching, and organization scoping for Maintenance/FixZone reports. It does not introduce new GIS features.

## Current assessment

| Area | Status | Notes |
| --- | --- | --- |
| Report location capture | Implemented/verify | Confirm address/GPS consistency by platform. |
| Provider coverage area display | Partial/verify | Provider profile should show human-readable service areas. |
| Responsibility routing | Partial/foundation | Confirm how dispatch chooses organization/provider responsibility. |
| Hotspots | Implemented/verify | Ensure analytics remain tenant-scoped. |
| Map display | Implemented/verify | Confirm report detail map does not fail on missing coordinates. |
| Future GIS routing | Deferred | Do not build advanced routing in this phase. |

## Risks

- Missing coordinates may break map widgets or produce empty states.
- Coverage areas may be stored as labels rather than enforceable geofences.
- Dispatch routing may rely on manual selection rather than deterministic responsibility rules.
- Tenant boundaries must not be inferred from public GIS data without policy.

## Recommended stabilization checks

1. Report with precise coordinates.
2. Report with address but missing coordinates.
3. Provider with coverage area.
4. Provider without coverage area.
5. Org admin sees only organization reports on maps/hotspots.
6. Super admin sees global analytics only where allowed.

## Future architecture recommendation

Introduce a responsibility-routing service later that can evaluate:

- organization jurisdiction,
- report category,
- service area,
- provider capabilities,
- SLA priority,
- workload,
- and tenant policy.

This should be a future controlled tranche, not part of the current documentation-only pass.
