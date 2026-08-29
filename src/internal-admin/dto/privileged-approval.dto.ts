import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePrivilegedApprovalDto {
  @IsString()
  @MaxLength(80)
  operationType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  requestedRole?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  organizationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DecidePrivilegedApprovalDto {
  @IsString()
  @MaxLength(20)
  decision!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
