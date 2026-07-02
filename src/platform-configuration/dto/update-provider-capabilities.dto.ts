import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateProviderCapabilitiesDto {
  @IsArray()
  @IsString({ each: true })
  capabilityIds!: string[];

  @IsOptional()
  @IsString()
  status?: string;
}
