import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AssignDisputeDto {
  @IsString()
  @MaxLength(200)
  assignedAdminId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
