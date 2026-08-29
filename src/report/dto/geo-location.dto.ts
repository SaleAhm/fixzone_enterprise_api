import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const GEO_LOCATION_SOURCES = [
  'DEVICE_GPS',
  'BROWSER_GEOLOCATION',
  'USER_SELECTED_MAP',
  'EXIF',
  'LEGACY',
  'UNAVAILABLE',
] as const;

export const GEO_CAPTURE_METHODS = [
  'DEVICE_SENSOR',
  'BROWSER_API',
  'MAP_SELECTION',
  'PHOTO_EXIF',
  'LEGACY_IMPORT',
  'NOT_PROVIDED',
] as const;

export const GEO_PERMISSION_STATES = [
  'GRANTED',
  'DENIED',
  'PROMPT',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;

export class ExifGeoLocationDto {
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}

export class GeoLocationMetadataDto {
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  accuracyMeters?: number;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  @IsOptional()
  @IsIn(GEO_LOCATION_SOURCES)
  source?: (typeof GEO_LOCATION_SOURCES)[number];

  @IsOptional()
  @IsIn(GEO_CAPTURE_METHODS)
  captureMethod?: (typeof GEO_CAPTURE_METHODS)[number];

  @IsOptional()
  @IsIn(GEO_PERMISSION_STATES)
  permissionState?: (typeof GEO_PERMISSION_STATES)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => ExifGeoLocationDto)
  exif?: ExifGeoLocationDto;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  clientReference?: string;
}
