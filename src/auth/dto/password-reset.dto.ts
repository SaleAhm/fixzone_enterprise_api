import { IsOptional, IsString, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  returnTo?: string;
}

export class CompletePasswordResetDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
