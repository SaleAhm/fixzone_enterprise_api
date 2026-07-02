import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { EvidenceRelatedEntityType } from '@prisma/client';

export class CreateEvidenceDto {
  @IsEnum(EvidenceRelatedEntityType)
  relatedEntityType!: EvidenceRelatedEntityType;

  @IsString()
  @MaxLength(200)
  relatedEntityId!: string;

  @IsString()
  @MaxLength(1000)
  fileUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fileType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
