# FixZone Geo-Tagged Evidence and Location Trust Backend Foundation

Date: 2026-08-29
Scope: backend foundation only. No frontend UI, deployment, production data change, or production migration is included in this tranche.

## Contract

The backend now accepts structured geo metadata for report creation and provider completion evidence:

- coordinates: latitude and longitude must be supplied together, finite, and within valid earth ranges.
- accuracy: finite non-negative metres, bounded by `FIXZONE_GEO_MAX_ACCURACY_METERS`.
- timestamps: client capture time is separate from server receipt time.
- source and method: GPS, browser geolocation, user-selected map, EXIF, legacy, and unavailable sources are normalized.
- permission state: granted, denied, prompt, unavailable, or unknown.
- EXIF comparison: optional EXIF coordinates and capture time can be stored in sanitized metadata and compared with device/browser coordinates.
- schema version: report and evidence trust metadata use schema version 1.

Invalid metadata fails closed with a 400 response before evidence persistence. Missing or denied location is not treated as zero coordinates; it is recorded as insufficient location data.

## Database foundation

The Prisma migration `20260829165000_add_geo_trust_evidence_fields` adds report-level receipt, permission, validation, and schema fields. It also adds queryable geo and trust columns to `EvidenceRecord`, including coordinates, accuracy, capture/receipt timestamps, source, capture method, permission state, validation outcome, provider-to-report distance, trust outcome, and schema version.

The migration is additive. It does not rewrite existing report or evidence records and does not remove legacy completion location fields.

## Trust assessment

Completion evidence is compared against the report location when report coordinates exist. The backend computes Haversine distance in metres and returns one of:

- `CONSISTENT`
- `REVIEW_RECOMMENDED`
- `INSUFFICIENT_LOCATION_DATA`
- `INVALID_METADATA`
- `LEGACY_UNASSESSED`

Warnings are truthful review signals only. They do not auto reject completion evidence:

- `LOW_LOCATION_ACCURACY`
- `CAPTURE_TIME_DISTANT_FROM_UPLOAD`
- `DEVICE_AND_EXIF_LOCATION_CONFLICT`
- `DISTANCE_EXCEEDS_THRESHOLD`

## API and authorization

Geo trust data is returned only through the existing authenticated report and protected evidence flows. Completion evidence continues to use protected report-scoped routes. Existing provider, citizen, and organization authorization checks remain the access boundary; unrelated tenants should continue to receive denial through the existing report access guards.

Public metrics and analytics continue to avoid precise report or evidence coordinates. They remain based on aggregate organization geography, not per-image evidence coordinates.

## Audit trail

The backend records audit events for:

- report geo metadata receipt;
- completion evidence geo comparison;
- completion evidence geo review recommendation;
- rejected completion geo metadata.

Audit metadata intentionally avoids storing precise coordinates in the event payload. Queryable evidence location belongs to the evidence record, not the audit log.

## Configuration

The following defaults are documented in `.env.example`:

- `FIXZONE_GEO_MAX_ACCURACY_METERS=10000`
- `FIXZONE_GEO_WARNING_DISTANCE_METERS=250`
- `FIXZONE_GEO_STALE_CAPTURE_MINUTES=1440`
- `FIXZONE_GEO_EXIF_CONFLICT_DISTANCE_METERS=100`

These values are conservative MVP guardrails and can be tightened after guided UAT.

## UAT checks still required

- provider uploads at least two completion images with distinct geo metadata for one assigned job;
- all images persist in durable upload storage and `EvidenceRecord`;
- provider, citizen, and organization completion-review views render all images and trust metadata after refresh and re-login;
- unrelated tenant access is denied;
- missing location, denied permission, stale capture time, low accuracy, and distance mismatch show truthful review UX;
- public metrics remain aggregate and do not expose precise evidence coordinates.

## Rollback note

Because the migration is additive, code rollback can ignore the new columns. Database rollback, if explicitly required in a local or controlled environment, should drop the new indexes before dropping the new columns. Production rollback must follow the production backup and recovery contract.
