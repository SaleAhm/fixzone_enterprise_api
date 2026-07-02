import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateServiceConfigurationDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledServices?: string[];

  @IsOptional()
  @IsString()
  defaultService?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceOrdering?: string[];

  @IsOptional()
  @IsObject()
  serviceVisibility?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  brandingOverrides?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  futureSlaConfiguration?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  futureEscalationConfiguration?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  futureAiPreferences?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  futureDocumentRetention?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  futureRegionalSettings?: Record<string, unknown>;
}
