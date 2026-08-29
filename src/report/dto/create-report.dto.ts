import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import {
  GEO_LOCATION_SOURCES,
  GEO_PERMISSION_STATES,
} from './geo-location.dto';

const LOCATION_SOURCES = [
  'DEVICE_GPS',
  'BROWSER_GEOLOCATION',
  'USER_SELECTED_MAP',
  'MAP_PIN',
  'ADDRESS_SEARCH',
  'MANUAL_TEXT',
  'EXIF',
  'PHOTO_METADATA',
  'MANUAL_PIN',
  'TYPED_LOCATION',
  'COMBINED',
  'LEGACY',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;

export class CreateReportDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  location: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  locationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationLandmark?: string;

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
  locationAccuracy?: number;

  @IsOptional()
  @IsDateString()
  locationCapturedAt?: string;

  @IsOptional()
  @IsIn(LOCATION_SOURCES)
  locationSource?:
    | (typeof LOCATION_SOURCES)[number]
    | (typeof GEO_LOCATION_SOURCES)[number];

  @IsOptional()
  @IsIn(GEO_PERMISSION_STATES)
  locationPermissionState?: (typeof GEO_PERMISSION_STATES)[number];
}
