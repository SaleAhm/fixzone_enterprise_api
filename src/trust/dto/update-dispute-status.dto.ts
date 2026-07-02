import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DisputeStatus } from '@prisma/client';

export class UpdateDisputeStatusDto {
  @IsEnum(DisputeStatus)
  status!: DisputeStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionSummary?: string;
}
