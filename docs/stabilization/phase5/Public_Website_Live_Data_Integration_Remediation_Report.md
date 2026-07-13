# Public Website Live Data Integration Remediation Report

Date: 2026-07-13  
Scope: SecureZone public website live-data integration and FixZone pilot linking

## Summary

Production API verification confirmed that the Phase 5 public endpoints are
available and return live aggregate data. The website bundle was also confirmed
to contain the Phase 5 public metrics integration.

The live fallback behavior was traced to two issues:

1. The API CORS allowlist permits the apex website origin
   `https://securezonegroup.com`, but did not return an allowed CORS origin for
   `https://www.securezonegroup.com`.
2. Several visible website sections still contained static pilot numbers or
   live-looking badges independent of the live API state.

No private data, report descriptions, evidence URLs, exact GPS coordinates,
tenant secrets, or user identities were exposed or added.

## Evidence Collected

Production API endpoints verified with `Origin: https://securezonegroup.com`:

- `/api/public/metrics` — HTTP 200
- `/api/public/trends` — HTTP 200
- `/api/public/impact-summary` — HTTP 200
- `/api/public/category-summary` — HTTP 200
- `/api/public/geographic-summary` — HTTP 200
- `/api/public/platform-status` — HTTP 200
- `/api/public/success-stories` — HTTP 200

Observed `/api/public/metrics` response during audit:

- `totalReports`: 94
- `activeReports`: 73
- `resolvedReports`: 40
- `closedReports`: 21
- `resolutionRate`: 42.6
- `participatingOrganizations`: 6
- `verifiedProviders`: 16
- `pilotRegions`: 1

CORS check:

- `Origin: https://securezonegroup.com` returned
  `Access-Control-Allow-Origin: https://securezonegroup.com`.
- `Origin: https://www.securezonegroup.com` returned no allowed origin header.

This means browsers opening the `www` website can block live public API reads
and the React app can fall back to cached/static data.

## Remediation Applied

Backend:

- Expanded configured CORS origins so an explicit
  `https://securezonegroup.com` allowlist entry also permits
  `https://www.securezonegroup.com`, and vice versa.
- This is intentionally narrow and does not allow arbitrary origins.

Website:

- Added support for these API base variables:
  - `VITE_PUBLIC_API_BASE_URL`
  - `VITE_PUBLIC_API_URL`
  - `VITE_API_BASE_URL`
  - `VITE_API_URL`
- Normalized API base URLs so both `https://api.securezonegroup.com` and
  `https://api.securezonegroup.com/api` resolve safely without duplicating or
  omitting `/api`.
- Prevented fallback snapshots from being restored from localStorage.
- Changed metric badges to show `Live`, `Cached`, or `Fallback` accurately.
- Replaced hardcoded hero and partner pilot numbers with live public metrics.
- Linked the FixZone production module card to:
  `https://fixzone.securezonegroup.com`.
- Preserved static fallback behavior for genuine API failures, but made fallback
  state explicit.

## Files Changed

Backend:

- `src/configure-app.ts`

Website:

- `src/services/publicMetrics.ts`
- `src/components/sections/Hero.tsx`
- `src/components/sections/Metrics.tsx`
- `src/components/sections/Modules.tsx`
- `src/components/sections/Partners.tsx`
- `src/components/sections/PublicImpactDashboard.tsx`

## Validation

Backend:

- `npm run build` — passed
- `npm test -- --runInBand` — passed, 16 suites / 108 tests
- `npm run test:e2e -- --runInBand public-metrics.e2e-spec.ts` — passed,
  1 suite / 5 tests

Website:

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm run lint` — passed

Known non-blocking warning:

- Website build still reports the existing Browserslist/caniuse-lite freshness
  warning.

## Deployment Notes

Recommended deployment order after push/promotion authorization:

1. Deploy backend API first so `www` CORS is available.
2. Verify CORS for:
   - `https://securezonegroup.com`
   - `https://www.securezonegroup.com`
3. Deploy website.
4. Hard-refresh or clear site localStorage in browser smoke tests if stale cache
   is suspected.
5. Confirm public website shows `Source: live` and current API values.
6. Confirm the FixZone module card opens `https://fixzone.securezonegroup.com`.

## Remaining Limitations

- If Dokploy or DNS serves the website through another origin, that origin must
  be explicitly present in `CORS_ORIGINS`.
- Fallback values remain available for genuine public API failures, but the UI
  now labels fallback state clearly.
- No Dokploy environment values were changed during this remediation.
