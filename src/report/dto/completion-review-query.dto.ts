import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CompletionReviewQueueQueryDto {
  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ProcessCompletionReviewDeadlinesDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(250)
  limit?: number;

  @IsOptional()
  @IsIn(['true', true])
  dryRun?: true | 'true';

  @IsOptional()
  @IsString()
  reason?: string;
}
