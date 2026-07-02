import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class TrustEnforcementSettingsDto {
  @IsOptional()
  @IsBoolean()
  requireVerifiedIdentityForDisputes?: boolean;

  @IsOptional()
  @IsBoolean()
  requireVerifiedIdentityForProviderJobAcceptance?: boolean;

  @IsOptional()
  @IsBoolean()
  requireVerifiedIdentityForEvidenceUpload?: boolean;

  @IsOptional()
  @IsBoolean()
  requireEntitlementPlanForPriorityWorkflows?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  requiredPriorityPlan?: string;
}
