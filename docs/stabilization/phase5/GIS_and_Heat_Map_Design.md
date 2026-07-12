# GIS and Heat Map Design

Date: 2026-07-12

## 1. Current Verified State

No production heat-map or GIS dashboard implementation was found. Flutter includes `google_maps_flutter`, but the audited citizen submit screen does not implement manual pinning and no operational GIS dashboard was verified.

## 2. Required Layers

Authenticated organization/admin GIS:

- report density;
- unresolved reports;
- resolved reports;
- provider coverage;
- operational areas;
- linked assets/facilities.

Public GIS:

- aggregate-only;
- no exact private coordinates;
- blurred or area-level statistics.

## 3. Backend Strategy

Avoid returning every raw point for large datasets.

Use one or more:

- bounding-box filters;
- server-side grid aggregation;
- geohash aggregation;
- clustering by zoom level;
- count suppression for sensitive/low-count buckets.

## 4. Flutter Strategy

Map UI should support:

- zoom;
- pan;
- marker/cluster selection;
- summary card;
- legend;
- date/category/status filters;
- loading and empty states.

## 5. Privacy Rules

- Authenticated tenant users may see precise coordinates only within their permitted tenant scope.
- Public maps must aggregate or blur.
- Sensitive report categories must not expose exact points.

## 6. Tests Required

- tenant-scoped map data;
- public coordinate privacy;
- large dataset aggregation;
- empty-state rendering;
- filter correctness.

