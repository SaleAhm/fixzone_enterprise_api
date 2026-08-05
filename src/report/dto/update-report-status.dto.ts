import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReportStatus } from '@prisma/client';

const LOCATION_SOURCES = [
  'DEVICE_GPS',
  'MAP_PIN',
  'ADDRESS_SEARCH',
  'MANUAL_TEXT',
  'PHOTO_METADATA',
  'MANUAL_PIN',
  'UNKNOWN',
] as const;

export class UpdateReportStatusDto {
  @IsEnum(ReportStatus)
  status: ReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  completionNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  completionImageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  completionImagePath?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  completionLatitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  completionLongitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  completionAccuracy?: number;

  @IsOptional()
  @IsDateString()
  completionLocationCapturedAt?: string;

  @IsOptional()
  @IsIn(LOCATION_SOURCES)
  completionLocationSource?: (typeof LOCATION_SOURCES)[number];
}
