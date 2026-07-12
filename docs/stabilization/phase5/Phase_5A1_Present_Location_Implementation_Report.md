# Phase 5A-1 Present Location, Geotagging and Reverse-Geocoding Foundation

Date: 2026-07-12  
Status: Implemented and validated  
Scope: Maintenance/FixZone runtime only

## Summary

Phase 5A-1 adds the first production foundation for geospatial intelligence without activating later Phase 5 capabilities. The implementation keeps FixZone report workflows intact while adding nullable report location metadata, optional provider completion geotagging, a provider-neutral reverse-geocoding abstraction, and Flutter UI foundations for current-location capture and manual pin selection.

This batch does not implement heat maps, public APIs, investor dashboards, duplicate detection, jurisdiction routing, website metrics, production deployment, or production migrations.

## Files Changed

Backend:

- `prisma/schema.prisma`
- `prisma/migrations/20260712090000_phase5a1_geolocation_metadata/migration.sql`
- `src/report/dto/create-report.dto.ts`
- `src/report/dto/update-report-status.dto.ts`
- `src/report/report.service.ts`
- `src/geo/reverse-geocoding.service.ts`
- `test/report-workflow.e2e-spec.ts`

Flutter:

- `lib/core/location/location_metadata.dart`
- `lib/core/services/api_service.dart`
- `lib/core/services/report_service.dart`
- `lib/features/citizen/presentation/screens/citizen_submit_report_screen.dart`
- `lib/features/provider/presentation/screens/provider_completion_evidence_screen.dart`
- `lib/features/provider/presentation/screens/provider_job_details_screen.dart`
- `test/location_metadata_test.dart`

## Schema and Migration Impact

A development migration adds nullable geolocation columns to `Report`:

- `locationAccuracy`
- `locationCapturedAt`
- `locationSource`
- `completionLatitude`
- `completionLongitude`
- `completionAccuracy`
- `completionLocationCapturedAt`
- `completionLocationSource`

All additions are nullable and backward compatible. Existing reports continue to work without metadata.

## Architecture

Citizen report creation now accepts optional metadata for the final selected location:

- latitude
- longitude
- accuracy
- captured timestamp
- source: `DEVICE_GPS`, `MANUAL_PIN`, or `UNKNOWN`

Provider completion now accepts optional completion geotag metadata. Completion remains non-blocking if location capture is denied, times out, or is unsupported.

Image evidence persistence remains relative-path based. Completion evidence URL canonicalization from the previous stabilization pass is preserved.

## Reverse-Geocoding Foundation

`ReverseGeocodingService` defines a provider-neutral abstraction for future OpenStreetMap, Google Maps, or Mapbox integration.

Current behavior is intentionally non-blocking and providerless:

- no API key required
- no external network dependency
- coordinates remain valid if reverse geocoding is unavailable
- returns structured fallback fields with `provider: none`

## Privacy Considerations

- No continuous tracking is introduced.
- Citizen location is captured only after explicit user action.
- Provider completion geotagging is optional.
- Denied permissions do not block report submission or provider completion.
- Metadata is scoped to the existing report lifecycle and tenant boundaries.

## Deployment Sequencing

Recommended order for a future controlled deployment:

1. Apply backend migration during an approved maintenance window.
2. Deploy backend API.
3. Verify report creation and provider completion remain backward compatible.
4. Deploy Flutter web/mobile build.
5. Run citizen/provider/admin smoke tests.

No production migration or deployment was performed in this implementation pass.

## Rollback Considerations

The migration adds nullable columns only. Application rollback can safely ignore the new columns. Database rollback, if required by governance, should drop only the added nullable columns after confirming no production release depends on them.

## Tests Added

Backend:

- citizen location metadata persistence
- invalid coordinate rejection
- backward compatibility for reports without metadata
- provider completion geotag metadata persistence

Flutter:

- report payload mapping
- completion payload mapping
- location source labels
- permission denied / timeout / unsupported user-facing messages

## Remaining Limitations

- Manual pinning uses a provider-neutral map preview foundation, not a live map tile provider.
- Reverse geocoding is an abstraction only; no provider is configured.
- Provider job details inline completion captures GPS best-effort and silently continues without metadata if unavailable.
- No GIS dashboard, heat map, public metrics API, duplicate detection, or jurisdiction routing is implemented in this batch.
