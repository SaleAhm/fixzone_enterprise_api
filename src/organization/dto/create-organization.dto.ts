import {
  IsEmail,
  IsEnum,
  IsInt,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  BillingStatus,
  OrganizationType,
  SubscriptionPlan,
} from '@prisma/client';

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsEnum(OrganizationType)
  type?: OrganizationType;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  tenantCode?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  lga?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsEnum(SubscriptionPlan)
  subscriptionPlan?: SubscriptionPlan;

  @IsOptional()
  @IsEnum(BillingStatus)
  billingStatus?: BillingStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  allowedUsers?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  allowedProviders?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  allowedReportsPerMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  allowedStorageMb?: number;

  @IsOptional()
  @IsObject()
  profileData?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledModules?: string[];
}
