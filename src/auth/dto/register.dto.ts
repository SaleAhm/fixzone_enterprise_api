import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ORG_ADMIN = 'ORG_ADMIN',
  DISPATCH_OFFICER = 'DISPATCH_OFFICER',
  PROVIDER = 'PROVIDER',
  CITIZEN = 'CITIZEN',
}

export class RegisterDto {
  @IsString()
  fullName!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsString()
  organizationId?: string;
}