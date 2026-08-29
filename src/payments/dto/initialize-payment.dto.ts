import { IsString, MaxLength, MinLength } from 'class-validator';

export class InitializePaymentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  planCode!: string;
}
