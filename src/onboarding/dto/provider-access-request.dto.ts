import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class ProviderAccessRequestDto {
  @IsIn(['INDIVIDUAL', 'COMPANY'])
  applicantType: 'INDIVIDUAL' | 'COMPANY';

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

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  address: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  coverageArea: string;

  @IsArray()
  serviceCategories: string[];

  @IsInt()
  @Min(0)
  yearsOfExperience: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  organizationInviteCode?: string;

  @IsOptional()
  supportingDocuments?: unknown;
}
