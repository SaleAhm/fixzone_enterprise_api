import { BadRequestException } from '@nestjs/common';
import { GeoTrustService } from './geo-trust.service';

describe('GeoTrustService', () => {
  let service: GeoTrustService;

  beforeEach(() => {
    delete process.env.FIXZONE_GEO_WARNING_DISTANCE_METERS;
    delete process.env.FIXZONE_GEO_MAX_ACCURACY_METERS;
    service = new GeoTrustService();
  });

  it('accepts valid latitude and longitude boundaries', () => {
    const normalized = service.normalizeReportLocation({
      latitude: -90,
      longitude: 180,
      accuracyMeters: 0,
      source: 'BROWSER_GEOLOCATION',
      captureMethod: 'BROWSER_API',
      permissionState: 'GRANTED',
    });

    expect(normalized.validationOutcome).toBe('VALID');
    expect(normalized.latitude).toBe(-90);
    expect(normalized.longitude).toBe(180);
    expect(normalized.accuracyMeters).toBe(0);
  });

  it('rejects invalid latitude and longitude', () => {
    expect(() =>
      service.normalizeReportLocation({ latitude: 90.01, longitude: 7 }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.normalizeReportLocation({ latitude: 9, longitude: -180.01 }),
    ).toThrow(BadRequestException);
  });

  it('rejects NaN, infinite and string coordinate abuse', () => {
    for (const latitude of [Number.NaN, Number.POSITIVE_INFINITY, '9.1']) {
      expect(() =>
        service.normalizeReportLocation({ latitude, longitude: 7 }),
      ).toThrow(BadRequestException);
    }
  });

  it('distinguishes missing or denied permission from zero coordinates', () => {
    const denied = service.normalizeReportLocation({
      permissionState: 'DENIED',
      source: 'UNAVAILABLE',
    });
    const zero = service.normalizeReportLocation({
      latitude: 0,
      longitude: 0,
      accuracyMeters: 10,
    });

    expect(denied.validationOutcome).toBe('INSUFFICIENT_LOCATION_DATA');
    expect(denied.validationReasons).toContain('LOCATION_PERMISSION_DENIED');
    expect(zero.validationOutcome).toBe('VALID');
    expect(zero.latitude).toBe(0);
    expect(zero.longitude).toBe(0);
  });

  it('validates accuracy against configured maximum', () => {
    process.env.FIXZONE_GEO_MAX_ACCURACY_METERS = '50';
    service = new GeoTrustService();

    expect(() =>
      service.normalizeReportLocation({
        latitude: 9,
        longitude: 7,
        accuracyMeters: 51,
      }),
    ).toThrow(BadRequestException);
  });

  it('calculates deterministic Haversine distance for known points', () => {
    const distance = service.distanceMeters(
      { latitude: 9.0765, longitude: 7.4938 },
      { latitude: 9.0775, longitude: 7.4938 },
    );

    expect(distance).toBeGreaterThanOrEqual(110);
    expect(distance).toBeLessThanOrEqual(112);
  });

  it('recommends review when distance exceeds accuracy-aware threshold', () => {
    process.env.FIXZONE_GEO_WARNING_DISTANCE_METERS = '50';
    service = new GeoTrustService();

    const assessment = service.assessCompletion(
      {
        latitude: 9.09,
        longitude: 7.4938,
        accuracyMeters: 10,
        source: 'DEVICE_GPS',
      },
      { latitude: 9.0765, longitude: 7.4938, accuracyMeters: 10 },
    );

    expect(assessment.distanceMeters).toBeGreaterThan(50);
    expect(assessment.trustOutcome).toBe('REVIEW_RECOMMENDED');
    expect(assessment.warnings).toContain('DISTANCE_EXCEEDS_THRESHOLD');
  });

  it('treats absent report coordinates as insufficient rather than zero', () => {
    const assessment = service.assessCompletion(
      { latitude: 9.0765, longitude: 7.4938 },
      { latitude: null, longitude: null },
    );

    expect(assessment.distanceMeters).toBeNull();
    expect(assessment.trustOutcome).toBe('INSUFFICIENT_LOCATION_DATA');
    expect(assessment.validationReasons).toContain(
      'REPORT_LOCATION_UNAVAILABLE',
    );
  });

  it('flags conflicting device and EXIF coordinates without overwriting either', () => {
    const assessment = service.assessCompletion(
      {
        latitude: 9.0765,
        longitude: 7.4938,
        source: 'DEVICE_GPS',
        exif: { latitude: 9.09, longitude: 7.4938 },
      },
      { latitude: 9.0765, longitude: 7.4938 },
    );

    expect(assessment.latitude).toBe(9.0765);
    expect(assessment.exif?.latitude).toBe(9.09);
    expect(assessment.trustOutcome).toBe('REVIEW_RECOMMENDED');
    expect(assessment.warnings).toContain('DEVICE_AND_EXIF_LOCATION_CONFLICT');
  });

  it('marks legacy evidence as unassessed', () => {
    const assessment = service.assessCompletion(
      { source: 'LEGACY', captureMethod: 'LEGACY_IMPORT' },
      { latitude: 9.0765, longitude: 7.4938 },
    );

    expect(assessment.trustOutcome).toBe('LEGACY_UNASSESSED');
    expect(assessment.validationOutcome).toBe('INSUFFICIENT_LOCATION_DATA');
  });
});
