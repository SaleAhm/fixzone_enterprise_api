import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CitizenRejectCompletionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
