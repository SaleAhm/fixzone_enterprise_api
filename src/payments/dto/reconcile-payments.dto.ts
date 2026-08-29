import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ReconcilePaymentsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
