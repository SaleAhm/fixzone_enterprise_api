import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class OrganizationRegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  organizationName: string;

  @IsIn(['GOVERNMENT', 'NGO', 'PRIVATE'])
  organizationClass: 'GOVERNMENT' | 'NGO' | 'PRIVATE';

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  organizationType?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  country: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  state: string;

  @Transform(emptyToUndefined)
  @IsEmail()
  contactEmail: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(7)
  contactPhone: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  ownerFullName: string;

  @Transform(emptyToUndefined)
  @IsEmail()
  ownerEmail: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(7)
  ownerPhone: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  password: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}
