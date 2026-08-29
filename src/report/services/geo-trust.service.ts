import { BadRequestException, Injectable } from '@nestjs/common';

export type GeoSource =
  | 'DEVICE_GPS'
  | 'BROWSER_GEOLOCATION'
  | 'USER_SELECTED_MAP'
  | 'EXIF'
  | 'LEGACY'
  | 'UNAVAILABLE';

export type GeoCaptureMethod =
  | 'DEVICE_SENSOR'
  | 'BROWSER_API'
  | 'MAP_SELECTION'
  | 'PHOTO_EXIF'
  | 'LEGACY_IMPORT'
  | 'NOT_PROVIDED';

export type GeoPermissionState =
  | 'GRANTED'
  | 'DENIED'
  | 'PROMPT'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export type GeoValidationOutcome =
  | 'VALID'
  | 'INSUFFICIENT_LOCATION_DATA'
  | 'INVALID_METADATA';

export type GeoTrustOutcome =
  | 'CONSISTENT'
  | 'REVIEW_RECOMMENDED'
  | 'INSUFFICIENT_LOCATION_DATA'
  | 'INVALID_METADATA'
  | 'LEGACY_UNASSESSED';

export type GeoInput = {
  latitude?: unknown;
  longitude?: unknown;
  accuracyMeters?: unknown;
  capturedAt?: unknown;
  source?: unknown;
  captureMethod?: unknown;
  permissionState?: unknown;
  exif?: unknown;
};

export type NormalizedGeoMetadata = {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: Date | null;
  receivedAt: Date;
  source: GeoSource;
  captureMethod: GeoCaptureMethod;
  permissionState: GeoPermissionState;
  validationOutcome: GeoValidationOutcome;
  trustOutcome: GeoTrustOutcome;
  distanceMeters: number | null;
  warnings: string[];
  validationReasons: string[];
  exif: {
    latitude: number | null;
    longitude: number | null;
    capturedAt: Date | null;
  } | null;
  schemaVersion: 1;
};

type Point = {
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
};

const GEO_SOURCES = new Set<GeoSource>([
  'DEVICE_GPS',
  'BROWSER_GEOLOCATION',
  'USER_SELECTED_MAP',
  'EXIF',
  'LEGACY',
  'UNAVAILABLE',
]);
const CAPTURE_METHODS = new Set<GeoCaptureMethod>([
  'DEVICE_SENSOR',
  'BROWSER_API',
  'MAP_SELECTION',
  'PHOTO_EXIF',
  'LEGACY_IMPORT',
  'NOT_PROVIDED',
]);
const PERMISSION_STATES = new Set<GeoPermissionState>([
  'GRANTED',
  'DENIED',
  'PROMPT',
  'UNAVAILABLE',
  'UNKNOWN',
]);

@Injectable()
export class GeoTrustService {
  private readonly maxAccuracyMeters = this.envNumber(
    'FIXZONE_GEO_MAX_ACCURACY_METERS',
    10000,
  );
  private readonly warningDistanceMeters = this.envNumber(
    'FIXZONE_GEO_WARNING_DISTANCE_METERS',
    250,
  );
  private readonly staleCaptureMinutes = this.envNumber(
    'FIXZONE_GEO_STALE_CAPTURE_MINUTES',
    1440,
  );
  private readonly conflictDistanceMeters = this.envNumber(
    'FIXZONE_GEO_EXIF_CONFLICT_DISTANCE_METERS',
    100,
  );

  normalizeReportLocation(input: GeoInput): NormalizedGeoMetadata {
    return this.normalize(input, null, new Date());
  }

  assessCompletion(input: GeoInput, report: Point): NormalizedGeoMetadata {
    return this.normalize(input, report, new Date());
  }

  distanceMeters(a: Point, b: Point): number | null {
    if (!this.hasCoordinates(a) || !this.hasCoordinates(b)) return null;
    const earthRadiusMeters = 6371008.8;
    const lat1 = this.toRadians(a.latitude!);
    const lat2 = this.toRadians(b.latitude!);
    const dLat = this.toRadians(b.latitude! - a.latitude!);
    const dLon = this.toRadians(b.longitude! - a.longitude!);
    const haversine =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return Math.round(
      earthRadiusMeters *
        2 *
        Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)),
    );
  }

  private normalize(
    input: GeoInput,
    report: Point | null,
    receivedAt: Date,
  ): NormalizedGeoMetadata {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const permissionState = this.permissionState(input.permissionState);
    const latitude = this.coordinate(input.latitude, -90, 90, 'latitude');
    const longitude = this.coordinate(input.longitude, -180, 180, 'longitude');
    const hasLat = latitude !== null;
    const hasLon = longitude !== null;

    if (hasLat !== hasLon) {
      throw new BadRequestException({
        code: 'INVALID_GEO_METADATA',
        message: 'Latitude and longitude must be supplied together.',
      });
    }

    const accuracyMeters = this.accuracy(input.accuracyMeters);
    if (accuracyMeters !== null && accuracyMeters > this.maxAccuracyMeters) {
      throw new BadRequestException({
        code: 'INVALID_GEO_ACCURACY',
        message: `Location accuracy must be ${this.maxAccuracyMeters} metres or less.`,
      });
    }

    const capturedAt = this.date(input.capturedAt, 'capturedAt');
    const source = this.source(input.source, hasLat && hasLon);
    const captureMethod = this.captureMethod(input.captureMethod, source);
    const exif = this.exif(input.exif);
    const distanceMeters =
      report && hasLat && hasLon
        ? this.distanceMeters({ latitude, longitude }, report)
        : null;

    if (!hasLat || !hasLon) {
      reasons.push(
        permissionState === 'DENIED'
          ? 'LOCATION_PERMISSION_DENIED'
          : 'COORDINATES_NOT_SUPPLIED',
      );
    }
    if (
      accuracyMeters !== null &&
      accuracyMeters > this.warningDistanceMeters
    ) {
      warnings.push('LOW_LOCATION_ACCURACY');
    }
    if (capturedAt) {
      const ageMinutes =
        Math.abs(receivedAt.getTime() - capturedAt.getTime()) / 60000;
      if (ageMinutes > this.staleCaptureMinutes) {
        warnings.push('CAPTURE_TIME_DISTANT_FROM_UPLOAD');
      }
    }
    if (
      exif &&
      exif.latitude !== null &&
      exif.longitude !== null &&
      hasLat &&
      hasLon
    ) {
      const exifDistance = this.distanceMeters(
        { latitude, longitude },
        { latitude: exif.latitude, longitude: exif.longitude },
      );
      if (exifDistance !== null && exifDistance > this.conflictDistanceMeters) {
        warnings.push('DEVICE_AND_EXIF_LOCATION_CONFLICT');
      }
    }
    if (distanceMeters !== null) {
      const tolerance =
        this.warningDistanceMeters +
        (accuracyMeters ?? 0) +
        (report?.accuracyMeters ?? 0);
      if (distanceMeters > tolerance)
        warnings.push('DISTANCE_EXCEEDS_THRESHOLD');
    } else if (report && this.hasCoordinates(report) && (!hasLat || !hasLon)) {
      reasons.push('COMPLETION_LOCATION_UNAVAILABLE');
    } else if (report && !this.hasCoordinates(report)) {
      reasons.push('REPORT_LOCATION_UNAVAILABLE');
    }

    const validationOutcome: GeoValidationOutcome =
      hasLat && hasLon ? 'VALID' : 'INSUFFICIENT_LOCATION_DATA';
    let trustOutcome: GeoTrustOutcome = 'INSUFFICIENT_LOCATION_DATA';
    if (source === 'LEGACY') trustOutcome = 'LEGACY_UNASSESSED';
    else if (reasons.includes('REPORT_LOCATION_UNAVAILABLE')) {
      trustOutcome = 'INSUFFICIENT_LOCATION_DATA';
    } else if (validationOutcome === 'VALID') {
      trustOutcome = warnings.length ? 'REVIEW_RECOMMENDED' : 'CONSISTENT';
    }

    return {
      latitude,
      longitude,
      accuracyMeters,
      capturedAt,
      receivedAt,
      source,
      captureMethod,
      permissionState,
      validationOutcome,
      trustOutcome,
      distanceMeters,
      warnings,
      validationReasons: [...new Set(reasons)],
      exif,
      schemaVersion: 1,
    };
  }

  private coordinate(
    value: unknown,
    min: number,
    max: number,
    label: string,
  ): number | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException({
        code: 'INVALID_GEO_METADATA',
        message: `${label} must be a finite number.`,
      });
    }
    if (value < min || value > max) {
      throw new BadRequestException({
        code: 'INVALID_GEO_METADATA',
        message: `${label} is outside the valid range.`,
      });
    }
    return value;
  }

  private accuracy(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new BadRequestException({
        code: 'INVALID_GEO_ACCURACY',
        message: 'Location accuracy must be a finite non-negative number.',
      });
    }
    return value;
  }

  private date(value: unknown, label: string): Date | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') {
      throw new BadRequestException({
        code: 'INVALID_GEO_METADATA',
        message: `${label} must be an ISO date string.`,
      });
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_GEO_METADATA',
        message: `${label} must be a valid ISO date string.`,
      });
    }
    return parsed;
  }

  private source(value: unknown, hasCoordinates: boolean): GeoSource {
    if (typeof value === 'string' && GEO_SOURCES.has(value as GeoSource)) {
      return value as GeoSource;
    }
    return hasCoordinates ? 'DEVICE_GPS' : 'UNAVAILABLE';
  }

  private captureMethod(value: unknown, source: GeoSource): GeoCaptureMethod {
    if (
      typeof value === 'string' &&
      CAPTURE_METHODS.has(value as GeoCaptureMethod)
    ) {
      return value as GeoCaptureMethod;
    }
    if (source === 'BROWSER_GEOLOCATION') return 'BROWSER_API';
    if (source === 'USER_SELECTED_MAP') return 'MAP_SELECTION';
    if (source === 'EXIF') return 'PHOTO_EXIF';
    if (source === 'LEGACY') return 'LEGACY_IMPORT';
    if (source === 'DEVICE_GPS') return 'DEVICE_SENSOR';
    return 'NOT_PROVIDED';
  }

  private permissionState(value: unknown): GeoPermissionState {
    if (
      typeof value === 'string' &&
      PERMISSION_STATES.has(value as GeoPermissionState)
    ) {
      return value as GeoPermissionState;
    }
    return 'UNKNOWN';
  }

  private exif(value: unknown): NormalizedGeoMetadata['exif'] {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const record = value as Record<string, unknown>;
    return {
      latitude: this.coordinate(record.latitude, -90, 90, 'exif.latitude'),
      longitude: this.coordinate(record.longitude, -180, 180, 'exif.longitude'),
      capturedAt: this.date(record.capturedAt, 'exif.capturedAt'),
    };
  }

  private hasCoordinates(
    point: Point,
  ): point is Required<Pick<Point, 'latitude' | 'longitude'>> & Point {
    return (
      typeof point.latitude === 'number' &&
      Number.isFinite(point.latitude) &&
      typeof point.longitude === 'number' &&
      Number.isFinite(point.longitude)
    );
  }

  private toRadians(value: number) {
    return (value * Math.PI) / 180;
  }

  private envNumber(name: string, fallback: number) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
