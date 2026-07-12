# Public Metrics API Privacy Review

Date: 2026-07-12

## 1. Current Verified State

No unauthenticated public metrics API was found in the backend.

The website currently displays static metrics from `src/data/index.ts`, including:

- active organizations;
- verified providers;
- active reports;
- cases routed;
- successful routing percentage;
- pilot regions.

The website `Metrics` section visually labels the static figures as `Live`, but no source API or fetch hook was found.

## 2. Required Public Endpoint Family

Recommended endpoints:

- `GET /api/public/metrics`
- `GET /api/public/trends`
- `GET /api/public/category-summary`
- `GET /api/public/geographic-summary`
- `GET /api/public/success-stories`
- `GET /api/public/platform-status`

## 3. Privacy Safeguards

Public endpoints must not expose:

- citizen names;
- emails;
- phone numbers;
- exact private addresses;
- raw report coordinates;
- private evidence images;
- internal financial details;
- internal audit logs;
- provider private information;
- tenant identifiers not intended for publication.

Recommended public location policy:

- state/LGA/region-level aggregation;
- geohash/grid aggregation only if cell size is privacy-safe;
- no exact coordinates for private reports;
- suppress low-count buckets where re-identification risk exists.

## 4. Response Contract

Suggested `GET /api/public/metrics` response:

```json
{
  "version": "2026-07",
  "lastUpdatedAt": "2026-07-12T00:00:00.000Z",
  "metrics": {
    "totalReports": 0,
    "activeReports": 0,
    "resolvedReports": 0,
    "closedReports": 0,
    "resolutionRate": null,
    "averageResolutionTimeHours": null,
    "participatingOrganizations": 0,
    "verifiedProviders": 0,
    "pilotRegions": null,
    "publicSuccessStories": 0
  },
  "availability": {
    "resolutionRate": false,
    "averageResolutionTimeHours": false,
    "pilotRegions": false
  }
}
```

Use `null` or explicit availability flags for unknown values. Do not return misleading zeroes for uncalculated metrics.

## 5. Website Integration Requirements

- Central API service.
- API base URL from environment configuration.
- Static fallback in one controlled module.
- Loading skeletons.
- Failure fallback state.
- Last updated timestamp.
- No page crash if API is unavailable.
- Do not mix static and live values without labelling source.

## 6. Tests Required

Backend:

- aggregate accuracy;
- privacy/no PII leakage;
- no exact coordinates;
- safe behaviour with empty database;
- rate limiting.

Website:

- live metrics success;
- API failure fallback;
- stale-data indication;
- no invalid number display;
- responsive rendering.

