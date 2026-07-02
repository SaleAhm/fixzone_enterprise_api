import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DisputePriority } from '@prisma/client';

export class CreateDisputeDto {
  @IsString()
  @MaxLength(80)
  relatedEntityType!: string;

  @IsString()
  @MaxLength(200)
  relatedEntityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  againstUserId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsEnum(DisputePriority)
  priority?: DisputePriority;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
