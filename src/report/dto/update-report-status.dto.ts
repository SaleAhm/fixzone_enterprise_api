import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportStatus } from '@prisma/client';

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
}
