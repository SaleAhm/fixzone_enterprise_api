# Present Location and Geotagging Design

Date: 2026-07-12

## 1. Current Verified State

Backend:

- `Report` has nullable `latitude` and `longitude`.
- `CreateReportDto` accepts optional `latitude` and `longitude`.
- No metadata fields exist for accuracy, source, captured timestamp, or reverse-geocoded components.
- No completion geotag fields exist.

Flutter:

- `CitizenSubmitReportScreen` uses `geolocator`.
- Current UI has one location capture card.
- Captured data sent to backend is latitude, longitude, and formatted location text.
- No manual map pinning was found.
- No location accuracy/source/capturedAt is submitted.

## 2. Target Architecture

Citizen report location should support:

- `latitude`
- `longitude`
- `locationAccuracy`
- `locationCapturedAt`
- `locationSource`
- human-readable `location`

Recommended `locationSource` values:

- `DEVICE_GPS`
- `MANUAL_PIN`
- `ORGANIZATION_ASSET`
- `PROVIDER_CAPTURE`
- `IMPORTED`
- `UNKNOWN`

Provider completion geotag should support:

- `completionLatitude`
- `completionLongitude`
- `completionAccuracy`
- `completionLocationCapturedAt`
- `completionLocationSource`

## 3. Privacy Rules

- No continuous tracking.
- User must explicitly select current-location capture.
- Report submission must explain that coordinates are attached to the report.
- Public APIs must not expose exact private coordinates.
- No device identifiers should be stored.

## 4. Backend Design

Add nullable fields to `Report` in an additive migration:

- `locationAccuracy Float?`
- `locationCapturedAt DateTime?`
- `locationSource String?` or enum if migration risk is acceptable
- `completionLatitude Float?`
- `completionLongitude Float?`
- `completionAccuracy Float?`
- `completionLocationCapturedAt DateTime?`
- `completionLocationSource String?`

DTO validation:

- latitude: `-90..90`
- longitude: `-180..180`
- accuracy: non-negative and capped to a reasonable upper bound
- source: allowlist

## 5. Flutter Design

Citizen report creation should show two explicit actions:

- Use My Current Location
- Pin Location Manually

Device GPS flow:

1. Explain permission purpose.
2. Request location permission.
3. Capture latitude, longitude, accuracy, capturedAt.
4. Display accuracy and source.
5. Allow manual adjustment.

Manual pin flow:

1. Open map picker.
2. Allow drag/tap placement.
3. Save latitude/longitude with source `MANUAL_PIN`.

Failure states:

- permission denied;
- permission permanently denied;
- location services disabled;
- unsupported browser/device;
- timeout;
- low accuracy;
- temporary GPS failure.

Each failure must offer retry and manual fallback.

## 6. Reverse-Geocoding Foundation

Create an interface such as:

```ts
interface ReverseGeocoder {
  reverseGeocode(input: {
    latitude: number;
    longitude: number;
  }): Promise<ReverseGeocodeResult | null>;
}
```

Normalized result:

- `formattedAddress`
- `country`
- `countryCode`
- `state`
- `stateCode`
- `lga`
- `ward`
- `city`
- `district`
- `street`
- `postalCode`
- `provider`
- `confidence`

No raw provider payload should be returned to normal clients.

Initial adapter:

- no-op/local fallback adapter;
- future adapters for Nominatim, Google Maps, Mapbox.

No API key should be committed.

## 7. Tests Required

Backend:

- valid coordinate metadata persistence;
- invalid latitude/longitude rejection;
- invalid accuracy rejection;
- allowed source validation;
- reverse-geocode failure does not block report creation;
- tenant isolation unchanged.

Flutter:

- current-location success;
- permission denied;
- timeout;
- manual fallback;
- accuracy display;
- map pin adjustment;
- metadata submission;
- no location capture without explicit action.

## 8. Rollback

All proposed database fields are nullable and additive. If runtime rollback is required, existing reports remain compatible and new metadata can remain unused until forward-fixed.

