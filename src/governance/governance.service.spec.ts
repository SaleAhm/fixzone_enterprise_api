import { ForbiddenException } from '@nestjs/common';
import {
  AccountStatus,
  EvidenceAuditAction,
  OwnerType,
  OwnershipStatus,
  UserRole,
} from '@prisma/client';
import { GovernanceService } from './governance.service';

describe('GovernanceService foundation', () => {
  const actor = {
    sub: 'admin-1',
    role: UserRole.SUPER_ADMIN,
    organizationId: 'org-1',
  };

  const prisma = {
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    delegatedAuthority: {
      create: jest.fn(),
    },
    adminScope: {
      create: jest.fn(),
    },
    regulatoryCase: {
      create: jest.fn(),
    },
    evidencePackage: {
      create: jest.fn(),
    },
    evidenceAccessLog: {
      create: jest.fn(),
    },
    evidenceAudit: {
      create: jest.fn(),
    },
    assetClaim: {
      create: jest.fn(),
    },
    ownershipRecommendation: {
      create: jest.fn(),
    },
    complianceAuditLog: {
      create: jest.fn(),
    },
  };

  let service: GovernanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GovernanceService(prisma as any);
  });

  it('returns an inherited permission matrix for delegated admin roles', () => {
    const matrix = service.getPermissionMatrix();
    const technicalAdmin = matrix.roles.find(
      (item) => item.role === UserRole.TECHNICAL_ADMIN,
    );

    expect(technicalAdmin?.inherits).toContain(UserRole.SUPPORT_ADMIN);
    expect(technicalAdmin?.permissions).toEqual(
      expect.arrayContaining([
        'diagnostics.read',
        'monitoring.read',
        'support.read',
      ]),
    );
  });

  it('blocks delegated admin creation for non-delegation roles', async () => {
    await expect(
      service.createSubAdmin(
        { email: 'legal@example.com', role: UserRole.LEGAL_ADMIN },
        { sub: 'org-admin', role: UserRole.ORG_ADMIN, organizationId: 'org-1' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates sub-admins as pending invite accounts and records audit context', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'sub-1',
      fullName: 'Legal Admin',
      email: 'legal@example.com',
      phone: null,
      role: UserRole.LEGAL_ADMIN,
      organizationId: 'org-1',
      accountStatus: AccountStatus.PENDING_INVITE,
    });
    prisma.delegatedAuthority.create.mockResolvedValue({ id: 'da-1' });
    prisma.complianceAuditLog.create.mockResolvedValue({ id: 'audit-1' });

    const result = await service.createSubAdmin(
      {
        fullName: 'Legal Admin',
        email: 'Legal@Example.com',
        role: UserRole.LEGAL_ADMIN,
        permissions: ['disputes.manage'],
        scopes: [{ scopeType: 'ORGANIZATION', scopeRef: 'org-1' }],
        reason: 'legal review separation',
      },
      actor,
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(result.accountStatus).toBe(AccountStatus.PENDING_INVITE);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'legal@example.com',
          role: UserRole.LEGAL_ADMIN,
          accountStatus: AccountStatus.PENDING_INVITE,
        }),
      }),
    );
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'Sub Admin Created',
          metadata: expect.objectContaining({
            reason: 'legal review separation',
            ipAddress: '127.0.0.1',
            userAgent: 'jest',
          }),
        }),
      }),
    );
  });

  it('records chain-of-custody access and audit rows together', async () => {
    prisma.evidenceAccessLog.create.mockResolvedValue({ id: 'access-1' });
    prisma.evidenceAudit.create.mockResolvedValue({ id: 'audit-1' });

    await service.logEvidenceAccess(
      {
        evidenceRecordId: 'ev-1',
        action: EvidenceAuditAction.DOWNLOADED,
        reason: 'regulatory package check',
      },
      actor,
      { ipAddress: '10.0.0.2', userAgent: 'jest' },
    );

    expect(prisma.evidenceAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evidenceRecordId: 'ev-1',
          action: EvidenceAuditAction.DOWNLOADED,
          actorId: 'admin-1',
        }),
      }),
    );
    expect(prisma.evidenceAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evidenceRecordId: 'ev-1',
          action: EvidenceAuditAction.DOWNLOADED,
          reason: 'regulatory package check',
        }),
      }),
    );
  });

  it('keeps ownership recommendation foundation in pending state', async () => {
    prisma.ownershipRecommendation.create.mockResolvedValue({
      id: 'rec-1',
      recommendedOwnerType: OwnerType.LGA,
      status: OwnershipStatus.PENDING,
    });
    prisma.complianceAuditLog.create.mockResolvedValue({ id: 'audit-1' });

    const result = await service.createOwnershipRecommendation(
      {
        reportId: 'report-1',
        recommendedOwnerType: OwnerType.LGA,
        recommendedOwnerName: 'Ikeja LGA',
        confidence: 0.72,
      },
      actor,
    );

    expect(result.status).toBe(OwnershipStatus.PENDING);
    expect(prisma.ownershipRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportId: 'report-1',
          recommendedOwnerType: OwnerType.LGA,
          status: OwnershipStatus.PENDING,
          confidence: 0.72,
        }),
      }),
    );
  });
});
