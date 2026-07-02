import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { KycSubmissionType } from '@prisma/client';

export class SubmitKycDto {
  @IsEnum(KycSubmissionType)
  submissionType!: KycSubmissionType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  documentUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  evidenceFileRef?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
