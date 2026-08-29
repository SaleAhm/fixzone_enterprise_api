import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class InviteInternalAdminDto {
  @IsString()
  @MaxLength(120)
  fullName!: string;

  @IsEmail()
  email!: string;

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
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  expiresAt?: string;
}
