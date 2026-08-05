import { CompletionPolicy } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AdminCompletionGovernanceReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class AdminCompletionPolicyOverrideDto extends AdminCompletionGovernanceReasonDto {
  @IsEnum(CompletionPolicy)
  policy: CompletionPolicy;
}

export class AdminCategoryCompletionPolicyDto extends AdminCompletionGovernanceReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  category: string;

  @IsEnum(CompletionPolicy)
  policy: CompletionPolicy;

  @IsOptional()
  @IsString()
  organizationId?: string;
}
