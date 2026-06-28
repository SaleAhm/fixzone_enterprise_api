import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return value;
};

export class MaintenanceModeDto {
  @Transform(toBoolean)
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MinLength(3)
  message?: string;

  @IsOptional()
  @IsISO8601()
  estimatedCompletionTime?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  allowAdminBypass?: boolean;
}
