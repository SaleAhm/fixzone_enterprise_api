import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  InternalScopeType,
  InvitationStatus,
  PrivilegedApprovalStatus,
  PrivilegedOperationType,
  UserRole,
} from '@prisma/client';

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : Number(value);

const toTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export class InternalAdminPaginationQueryDto {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(['createdAt', 'expiresAt', 'status', 'role', 'operationType'])
  sortBy?: string;

  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @IsOptional()
  @Transform(toTrimmed)
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @Transform(toTrimmed)
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(['active', 'expired', 'all'])
  expiryState?: 'active' | 'expired' | 'all';

  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class InternalInvitationQueueQueryDto extends InternalAdminPaginationQueryDto {
  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(Object.values(InvitationStatus))
  status?: InvitationStatus;

  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(Object.values(UserRole))
  role?: UserRole;

  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(Object.values(InternalScopeType))
  scopeType?: InternalScopeType;

  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(80)
  organizationId?: string;

  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(80)
  moduleKey?: string;

  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(80)
  inviterId?: string;
}

export class PrivilegedApprovalQueueQueryDto extends InternalAdminPaginationQueryDto {
  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(Object.values(PrivilegedApprovalStatus))
  status?: PrivilegedApprovalStatus;

  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(Object.values(PrivilegedOperationType))
  operationType?: PrivilegedOperationType;

  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(80)
  requesterId?: string;

  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(80)
  targetUserId?: string;

  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(80)
  organizationId?: string;

  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(['true', 'false'])
  canDecide?: 'true' | 'false';

  @IsOptional()
  @Transform(toTrimmed)
  @IsIn(['true', 'false'])
  attention?: 'true' | 'false';
}
