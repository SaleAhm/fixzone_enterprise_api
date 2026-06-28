import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const toInt = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : value;
};

const toBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return value;
};

export const demoScenarios = [
  'Smart City Operations',
  'Smart City',
  'Rainy Season',
  'Flood Emergency',
  'Road Rehabilitation',
  'Electricity Outage',
  'Water Crisis',
  'Waste Management Campaign',
  'Waste Management',
  'Emergency Response',
  'Flood Disaster',
  'Municipal Operations',
] as const;

export class GenerateDemoEnvironmentDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined,
  )
  @IsString()
  @IsIn(demoScenarios)
  scenario?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(250)
  citizens?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  providers?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(25)
  organizations?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(1000)
  reports?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(5000)
  notifications?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(1000)
  completedJobs?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeEvidenceImages?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  generateAnalytics?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  generateProviderRatings?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  generateAssignments?: boolean;
}
