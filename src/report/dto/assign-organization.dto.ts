import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AssignOrganizationDto {
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  establishAuthoritativeOwnership?: boolean;

  @IsBoolean()
  @IsOptional()
  overrideReadiness?: boolean;
}
