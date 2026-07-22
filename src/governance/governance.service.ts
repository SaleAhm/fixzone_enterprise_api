import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  AdminScopeType,
  AssetClaimStatus,
  EvidenceAuditAction,
  OwnerType,
  OwnershipStatus,
  Prisma,
  RegulatoryCaseStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type GovernanceUser = {
  id?: string;
  userId?: string;
  sub?: string;
  email?: string | null;
  fullName?: string | null;
  role?: UserRole | string;
  organizationId?: string | null;
};

type RequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

const governanceAdminRoles = [
  UserRole.PLATFORM_OWNER,
  UserRole.EXECUTIVE_SUPER_ADMIN,
  UserRole.TECHNICAL_ADMIN,
  UserRole.BILLING_ADMIN,
  UserRole.LEGAL_ADMIN,
  UserRole.ASSIGNMENT_ADMIN,
  UserRole.ASSET_ADMIN,
  UserRole.COMPLIANCE_ADMIN,
  UserRole.REGULATORY_ADMIN,
  UserRole.SUPPORT_ADMIN,
] as const;

const roleInheritance: Partial<Record<UserRole, UserRole[]>> = {
  [UserRole.PLATFORM_OWNER]: [UserRole.SUPER_ADMIN],
  [UserRole.EXECUTIVE_SUPER_ADMIN]: [UserRole.SUPER_ADMIN],
  [UserRole.TECHNICAL_ADMIN]: [UserRole.SUPPORT_ADMIN],
  [UserRole.LEGAL_ADMIN]: [UserRole.COMPLIANCE_ADMIN],
  [UserRole.REGULATORY_ADMIN]: [UserRole.COMPLIANCE_ADMIN],
};

const rolePermissions: Record<string, string[]> = {
  [UserRole.PLATFORM_OWNER]: [
    'platform.*',
    'governance.*',
    'delegation.*',
    'audit.read',
  ],
  [UserRole.EXECUTIVE_SUPER_ADMIN]: [
    'organizations.read',
    'analytics.read',
    'regulatory.read',
    'audit.read',
  ],
  [UserRole.TECHNICAL_ADMIN]: [
    'diagnostics.read',
    'monitoring.read',
    'support.tools',
  ],
  [UserRole.BILLING_ADMIN]: [
    'billing.read',
    'subscriptions.manage',
    'invoices.manage',
    'refunds.review',
  ],
  [UserRole.LEGAL_ADMIN]: [
    'disputes.manage',
    'evidence.review',
    'regulatory.exports.request',
  ],
  [UserRole.ASSIGNMENT_ADMIN]: [
    'routing.manage',
    'assignments.override',
    'agencies.assign',
  ],
  [UserRole.ASSET_ADMIN]: [
    'assets.review',
    'ownership.review',
    'jurisdiction.manage',
  ],
  [UserRole.COMPLIANCE_ADMIN]: [
    'retention.review',
    'privacy.review',
    'exports.approve',
  ],
  [UserRole.REGULATORY_ADMIN]: [
    'regulatory.cases.manage',
    'regulatory.exports.prepare',
  ],
  [UserRole.SUPPORT_ADMIN]: ['support.read', 'users.assist'],
};

@Injectable()
export class GovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  getPermissionMatrix() {
    return {
      roles: governanceAdminRoles.map((role) => ({
        role,
        inherits: roleInheritance[role] ?? [],
        permissions: this.expandedPermissions(role),
      })),
      separationOfDuties: [
        {
          rule: 'billing_vs_legal_review',
          description:
            'Billing actions and legal export approval are split across Billing Admin and Legal/Compliance Admin roles.',
        },
        {
          rule: 'assignment_vs_asset_ownership',
          description:
            'Assignment routing and ownership intelligence are split across Assignment Admin and Asset Admin roles.',
        },
      ],
    };
  }

  getFoundationSummary() {
    return {
      governance: {
        entities: [
          'Permission',
          'RolePermission',
          'AdminScope',
          'DelegatedAuthority',
        ],
        advancedAi: false,
      },
      regulatory: {
        entities: [
          'RegulatoryCase',
          'RegulatoryExport',
          'EvidencePackage',
          'DisputeTimeline',
        ],
        templatesImplemented: false,
      },
      chainOfCustody: {
        entities: ['EvidenceAudit', 'EvidenceAccessLog'],
        deletionPolicy: 'soft_delete_only',
      },
      assetIntelligence: {
        entities: [
          'AssetCluster',
          'PotentialAsset',
          'AssetClaim',
          'AssetOwnershipHistory',
          'AssetCandidateOwner',
          'JurisdictionZone',
          'OwnershipRecommendation',
        ],
        gisIntegration: false,
        registrationForced: false,
      },
      disputes: {
        entities: ['DisputeCase', 'DisputeEvidence', 'DisputeDecision'],
      },
      exports: {
        formats: ['PDF', 'CSV', 'JSON', 'EVIDENCE_PACKAGE'],
        templatesImplemented: false,
      },
    };
  }

  async createSubAdmin(
    dto: Record<string, unknown>,
    user: GovernanceUser,
    context?: RequestContext,
  ) {
    this.assertDelegationAdmin(user);
    const actorId = this.actorId(user);
    const role = this.parseSubAdminRole(dto.role);
    const email = this.normalizeEmail(dto.email);
    const phone = this.normalizeText(dto.phone);
    const fullName = this.normalizeText(dto.fullName) ?? 'Delegated Admin';
    const organizationId = this.resolveOrganizationScope(dto, user);

    if (!email && !phone) {
      throw new BadRequestException('Email or phone is required');
    }

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [email ? { email } : null, phone ? { phone } : null].filter(
          (item): item is { email: string } | { phone: string } =>
            item !== null,
        ),
      },
      select: { id: true, email: true, phone: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'SUB_ADMIN_IDENTITY_EXISTS',
        message: 'A SecureZone user already exists with this email or phone.',
      });
    }

    const created = await this.prisma.user.create({
      data: {
        fullName,
        email,
        phone,
        role,
        organizationId,
        accountStatus: AccountStatus.PENDING_INVITE,
        profileData: {
          delegatedAdmin: true,
          permissions: this.stringList(dto.permissions),
          scopes: this.scopeList(dto.scopes),
        } as Prisma.InputJsonValue,
      },
      select: this.subAdminSelect(),
    });

    await this.prisma.delegatedAuthority.create({
      data: {
        userId: created.id,
        delegatedById: actorId,
        organizationId,
        role,
        permissions: this.stringList(dto.permissions) as Prisma.InputJsonValue,
        scopes: this.scopeList(dto.scopes) as Prisma.InputJsonValue,
        reason: this.normalizeText(dto.reason),
      },
    });

    await this.audit('Sub Admin Created', user, context, {
      entityType: 'User',
      entityId: created.id,
      afterState: created,
      reason: this.normalizeText(dto.reason),
    });

    return created;
  }

  async setSubAdminStatus(
    id: string,
    status: AccountStatus,
    user: GovernanceUser,
    context?: RequestContext,
  ) {
    this.assertDelegationAdmin(user);
    if (this.actorId(user) === id) {
      throw new ForbiddenException('You cannot change your own status here');
    }
    const existing = await this.findSubAdmin(id, user);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { accountStatus: status },
      select: this.subAdminSelect(),
    });

    await this.audit(`Sub Admin ${status}`, user, context, {
      entityType: 'User',
      entityId: id,
      beforeState: existing,
      afterState: updated,
    });
    return updated;
  }

  async assignPermissions(
    id: string,
    dto: Record<string, unknown>,
    user: GovernanceUser,
    context?: RequestContext,
  ) {
    this.assertDelegationAdmin(user);
    const target = await this.findSubAdmin(id, user);
    const permissions = this.stringList(dto.permissions);
    if (!permissions.length) {
      throw new BadRequestException('At least one permission is required');
    }
    const record = await this.prisma.delegatedAuthority.create({
      data: {
        userId: id,
        delegatedById: this.actorId(user),
        organizationId: target.organizationId,
        role: target.role,
        permissions: permissions as Prisma.InputJsonValue,
        reason: this.normalizeText(dto.reason),
      },
    });
    await this.audit('Sub Admin Permissions Assigned', user, context, {
      entityType: 'DelegatedAuthority',
      entityId: record.id,
      afterState: { userId: id, permissions },
      reason: this.normalizeText(dto.reason),
    });
    return record;
  }

  async assignScopes(
    id: string,
    dto: Record<string, unknown>,
    user: GovernanceUser,
    context?: RequestContext,
  ) {
    this.assertDelegationAdmin(user);
    const target = await this.findSubAdmin(id, user);
    const scopes = this.scopeList(dto.scopes);
    if (!scopes.length) {
      throw new BadRequestException('At least one scope is required');
    }
    const created = await Promise.all(
      scopes.map((scope) =>
        this.prisma.adminScope.create({
          data: {
            userId: id,
            scopeType: scope.scopeType,
            scopeRef: scope.scopeRef,
            organizationId: scope.organizationId ?? target.organizationId,
            permissions: scope.permissions as Prisma.InputJsonValue,
            createdById: this.actorId(user),
          },
        }),
      ),
    );
    await this.audit('Sub Admin Scopes Assigned', user, context, {
      entityType: 'AdminScope',
      entityId: id,
      afterState: created,
    });
    return created;
  }

  async createRegulatoryCase(
    dto: Record<string, unknown>,
    user: GovernanceUser,
    context?: RequestContext,
  ) {
    this.assertGovernanceRead(user);
    const title = this.requiredText(dto.title, 'title');
    const created = await this.prisma.regulatoryCase.create({
      data: {
        caseNumber: `REG-${new Date().getFullYear()}-${randomUUID()
          .slice(0, 8)
          .toUpperCase()}`,
        organizationId: this.resolveOrganizationScope(dto, user),
        reportId: this.normalizeText(dto.reportId),
        disputeId: this.normalizeText(dto.disputeId),
        title,
        status: RegulatoryCaseStatus.DRAFT,
        metadata: this.objectValue(dto.metadata),
        createdById: this.actorId(user),
      },
    });
    await this.audit('Regulatory Case Created', user, context, {
      entityType: 'RegulatoryCase',
      entityId: created.id,
      afterState: created,
    });
    return created;
  }

  async createEvidencePackage(
    dto: Record<string, unknown>,
    user: GovernanceUser,
    context?: RequestContext,
  ) {
    this.assertGovernanceRead(user);
    const created = await this.prisma.evidencePackage.create({
      data: {
        regulatoryCaseId: this.normalizeText(dto.regulatoryCaseId),
        organizationId: this.resolveOrganizationScope(dto, user),
        relatedEntityType: this.normalizeText(dto.relatedEntityType),
        relatedEntityId: this.normalizeText(dto.relatedEntityId),
        manifest: this.objectValue(dto.manifest),
        createdById: this.actorId(user),
      },
    });
    await this.audit('Evidence Package Created', user, context, {
      entityType: 'EvidencePackage',
      entityId: created.id,
      afterState: created,
    });
    return created;
  }

  async logEvidenceAccess(
    dto: Record<string, unknown>,
    user: GovernanceUser,
    context?: RequestContext,
  ) {
    this.assertGovernanceRead(user);
    const action = this.parseEvidenceAction(dto.action);
    const evidenceRecordId = this.normalizeText(dto.evidenceRecordId);
    const access = await this.prisma.evidenceAccessLog.create({
      data: {
        evidenceRecordId,
        actorId: this.actorId(user),
        actorRole: user.role as UserRole,
        action,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        metadata: this.objectValue(dto.metadata),
      },
    });
    await this.prisma.evidenceAudit.create({
      data: {
        evidenceRecordId,
        actorId: this.actorId(user),
        actorRole: user.role as UserRole,
        action,
        reason: this.normalizeText(dto.reason),
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        metadata: this.objectValue(dto.metadata),
      },
    });
    return access;
  }

  async createAssetClaim(
    dto: Record<string, unknown>,
    user: GovernanceUser,
    context?: RequestContext,
  ) {
    this.assertGovernanceRead(user);
    const created = await this.prisma.assetClaim.create({
      data: {
        potentialAssetId: this.normalizeText(dto.potentialAssetId),
        claimantUserId: this.normalizeText(dto.claimantUserId),
        claimantOrganizationId:
          this.normalizeText(dto.claimantOrganizationId) ??
          this.resolveOrganizationScope(dto, user),
        ownerType: this.parseOptionalOwnerType(dto.ownerType),
        status: AssetClaimStatus.PENDING,
        claimNote: this.normalizeText(dto.claimNote),
      },
    });
    await this.audit('Asset Claim Created', user, context, {
      entityType: 'AssetClaim',
      entityId: created.id,
      afterState: created,
    });
    return created;
  }

  async createOwnershipRecommendation(
    dto: Record<string, unknown>,
    user: GovernanceUser,
    context?: RequestContext,
  ) {
    this.assertGovernanceRead(user);
    const created = await this.prisma.ownershipRecommendation.create({
      data: {
        potentialAssetId: this.normalizeText(dto.potentialAssetId),
        reportId: this.normalizeText(dto.reportId),
        recommendedOwnerType: this.parseOptionalOwnerType(
          dto.recommendedOwnerType,
        ),
        recommendedOwnerName: this.normalizeText(dto.recommendedOwnerName),
        status: OwnershipStatus.PENDING,
        confidence: this.numberValue(dto.confidence),
        rationale: this.normalizeText(dto.rationale),
        metadata: this.objectValue(dto.metadata),
        createdById: this.actorId(user),
      },
    });
    await this.audit('Ownership Recommendation Created', user, context, {
      entityType: 'OwnershipRecommendation',
      entityId: created.id,
      afterState: created,
    });
    return created;
  }

  private expandedPermissions(role: UserRole) {
    const inherited = (roleInheritance[role] ?? []).flatMap(
      (baseRole) => rolePermissions[baseRole] ?? [],
    );
    return [...new Set([...(rolePermissions[role] ?? []), ...inherited])];
  }

  private async findSubAdmin(id: string, user: GovernanceUser) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: this.subAdminSelect(),
    });
    if (!existing || !governanceAdminRoles.includes(existing.role as any)) {
      throw new NotFoundException('Sub-admin not found');
    }
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.PLATFORM_OWNER &&
      existing.organizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Sub-admin is outside your scope');
    }
    return existing;
  }

  private assertDelegationAdmin(user: GovernanceUser) {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.PLATFORM_OWNER &&
      user.role !== UserRole.EXECUTIVE_SUPER_ADMIN
    ) {
      throw new ForbiddenException('Delegated administration access required');
    }
  }

  private assertGovernanceRead(user: GovernanceUser) {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      !governanceAdminRoles.includes(user.role as any)
    ) {
      throw new ForbiddenException('Governance access required');
    }
  }

  private actorId(user: GovernanceUser) {
    const actorId = user.id ?? user.userId ?? user.sub;
    if (!actorId) throw new ForbiddenException('Actor missing');
    return actorId;
  }

  private parseSubAdminRole(raw: unknown) {
    const role = String(raw ?? '')
      .trim()
      .toUpperCase() as UserRole;
    if (!governanceAdminRoles.includes(role as any)) {
      throw new BadRequestException('Invalid delegated admin role');
    }
    return role;
  }

  private parseEvidenceAction(raw: unknown) {
    const action = String(raw ?? '')
      .trim()
      .toUpperCase() as EvidenceAuditAction;
    if (!Object.values(EvidenceAuditAction).includes(action)) {
      throw new BadRequestException('Invalid evidence audit action');
    }
    return action;
  }

  private parseOptionalOwnerType(raw: unknown) {
    if (raw === undefined || raw === null || raw === '') return null;
    const ownerType = String(raw).trim().toUpperCase() as OwnerType;
    if (!Object.values(OwnerType).includes(ownerType)) {
      throw new BadRequestException('Invalid owner type');
    }
    return ownerType;
  }

  private resolveOrganizationScope(
    dto: Record<string, unknown>,
    user: GovernanceUser,
  ) {
    if (
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.PLATFORM_OWNER
    ) {
      return (
        this.normalizeText(dto.organizationId) ?? user.organizationId ?? null
      );
    }
    return user.organizationId ?? null;
  }

  private normalizeText(raw: unknown) {
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  private normalizeEmail(raw: unknown) {
    const email = this.normalizeText(raw)?.toLowerCase() ?? null;
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Enter a valid email address');
    }
    return email;
  }

  private requiredText(raw: unknown, field: string) {
    const value = this.normalizeText(raw);
    if (!value) throw new BadRequestException(`${field} is required`);
    return value;
  }

  private stringList(raw: unknown) {
    return Array.isArray(raw)
      ? raw.map((item) => String(item).trim()).filter((item) => item.length > 0)
      : [];
  }

  private scopeList(raw: unknown) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
      const value =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {};
      const scopeType = String(value.scopeType ?? 'ORGANIZATION')
        .trim()
        .toUpperCase() as AdminScopeType;
      if (!Object.values(AdminScopeType).includes(scopeType)) {
        throw new BadRequestException('Invalid admin scope type');
      }
      return {
        scopeType,
        scopeRef: this.normalizeText(value.scopeRef),
        organizationId: this.normalizeText(value.organizationId),
        permissions: this.stringList(value.permissions),
      };
    });
  }

  private objectValue(raw: unknown) {
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Prisma.InputJsonObject)
      : undefined;
  }

  private numberValue(raw: unknown) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  private subAdminSelect() {
    return {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      organizationId: true,
      accountStatus: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  private async audit(
    action: string,
    user: GovernanceUser,
    context: RequestContext | undefined,
    payload: {
      entityType?: string;
      entityId?: string;
      beforeState?: unknown;
      afterState?: unknown;
      reason?: string | null;
    },
  ) {
    await this.prisma.complianceAuditLog.create({
      data: {
        actorId: this.actorId(user),
        actorRole: user.role as UserRole,
        organizationId:
          this.normalizeText(
            (payload.afterState as { organizationId?: unknown })
              ?.organizationId,
          ) ?? user.organizationId,
        action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: {
          beforeState: payload.beforeState ?? null,
          afterState: payload.afterState ?? null,
          reason: payload.reason ?? null,
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
