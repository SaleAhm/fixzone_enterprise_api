import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AssignInternalRoleDto {
  @IsString()
  @MaxLength(80)
  role!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  scopeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  scopeRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  organizationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  moduleKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  startsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
