import { IsOptional, IsString, MaxLength } from 'class-validator';

export class InternalAdminActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
