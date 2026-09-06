import { IsIn, IsString, Length, MinLength } from 'class-validator';

export class StartMfaEnrollmentDto {
  @IsString()
  @MinLength(32)
  preAuthToken!: string;
}

export class ConfirmMfaEnrollmentDto {
  @IsString()
  @MinLength(32)
  preAuthToken!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class CompleteMfaChallengeDto {
  @IsString()
  @MinLength(32)
  preAuthToken!: string;

  @IsIn(['totp', 'recovery_code'])
  method!: 'totp' | 'recovery_code';

  @IsString()
  @MinLength(6)
  code!: string;
}
