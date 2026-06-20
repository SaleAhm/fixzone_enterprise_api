import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class FirebaseLoginDto {
  @IsString()
  @MinLength(1)
  firebaseUid: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsString()
  role: string;
}
