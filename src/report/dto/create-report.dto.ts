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

const LOCATION_SOURCES = [
  'DEVICE_GPS',
  'MANUAL_PIN',
  'TYPED_LOCATION',
  'COMBINED',
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
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  locationAccuracy?: number;

  @IsOptional()
  @IsDateString()
  locationCapturedAt?: string;

  @IsOptional()
  @IsIn(LOCATION_SOURCES)
  locationSource?: (typeof LOCATION_SOURCES)[number];
}
