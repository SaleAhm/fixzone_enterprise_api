import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail()
  email?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(7)
  phone?: string;

  @Transform(trimString)
  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  role?: unknown;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  organizationId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(2)
  organizationName?: string;
}
