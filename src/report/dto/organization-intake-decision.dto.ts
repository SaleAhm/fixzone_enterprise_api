import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class OrganizationRejectReportDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class OrganizationAcceptReportDto {
  @IsString()
  @IsOptional()
  note?: string;
}
