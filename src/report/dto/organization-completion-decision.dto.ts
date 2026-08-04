import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class OrganizationCompletionVerificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class OrganizationCompletionReworkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
