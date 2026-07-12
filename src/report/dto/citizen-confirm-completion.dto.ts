import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  IsOptional,
} from 'class-validator';

export class CitizenConfirmCompletionDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}
