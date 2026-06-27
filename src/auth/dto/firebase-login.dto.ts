import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class FirebaseLoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  firebaseUid: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(7)
  phone?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail()
  email?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(2)
  fullName?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  role: string;
}
