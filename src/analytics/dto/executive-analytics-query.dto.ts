import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export enum AnalyticsInterval {
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
}

export class ExecutiveAnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(AnalyticsInterval)
  interval?: AnalyticsInterval;

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  category?: string;
}
