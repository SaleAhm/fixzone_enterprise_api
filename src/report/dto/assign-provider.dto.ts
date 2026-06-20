import { IsNotEmpty, IsString } from 'class-validator';

export class AssignProviderDto {
  @IsString()
  @IsNotEmpty()
  providerId: string;
}