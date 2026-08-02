import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AssignProviderDto {
  @IsString()
  @IsNotEmpty()
  providerId: string;

  @IsBoolean()
  @IsOptional()
  overrideOrganizationRouting?: boolean;

  @IsString()
  @IsOptional()
  overrideReason?: string;
}
