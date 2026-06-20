import { IsOptional, IsString } from 'class-validator';

export class AdminDashboardQueryDto {
  @IsOptional()
  @IsString()
  period?: string;
}