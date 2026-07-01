import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class CitizenRegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  fullName: string;

  @Transform(emptyToUndefined)
  @IsEmail()
  email: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(7)
  phone: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  password: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  confirmPassword: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  address?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  lga?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  state?: string;

  @IsBoolean()
  acceptTerms: boolean;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  preferredLanguage?: string;

  @IsOptional()
  notificationPreferences?: unknown;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  emergencyContact?: string;

  @IsOptional()
  gpsPermission?: boolean;
}
