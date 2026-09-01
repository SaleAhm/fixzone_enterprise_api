import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const trimStringOrUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export class FirebaseLoginDto {
  @Transform(trimStringOrUndefined)
  @IsString()
  @MinLength(1)
  idToken: string;

  @IsOptional()
  @Transform(trimStringOrUndefined)
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @Transform(trimStringOrUndefined)
  @IsString()
  @IsIn(['login', 'registration'])
  intent?: 'login' | 'registration';
}
