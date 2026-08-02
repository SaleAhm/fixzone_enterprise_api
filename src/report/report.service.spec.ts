import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AssignmentOutcome,
  BillingStatus,
  OrganizationStatus,
  ReportStatus,
  UserRole,
} from '@prisma/client';
import { ReportService } from './report.service';

describe('ReportService workflow validators', () => {
  const service = new ReportService({} as any);

  describe('assertAssignmentAllowed', () => {
    it('allows same-org admin assignment from PENDING', () => {
      expect(() =>
        (service as any).assertAssignmentAllowed(
          {
            status: ReportStatus.PENDING,
            assignedProviderId: null,
            organizationId: 'org-1',
          },
          'org-1',
          {
            role: UserRole.ORG_ADMIN,
            organizationId: 'org-1',
          },
        ),
      ).not.toThrow();
    });

    it('allows assignment when a pending status arrives in lowercase', () => {
      expect(() =>
        (service as any).assertAssignmentAllowed(
          {
            status: 'pending',
            assignedProviderId: null,
            organizationId: 'org-1',
          },
          'org-1',
          {
            role: UserRole.ORG_ADMIN,
            organizationId: 'org-1',
          },
          'provider-1',
        ),
      ).not.toThrow();
    });

    it('rejects assignment when the report is already assigned', () => {
      expect(() =>
        (service as any).assertAssignmentAllowed(
          {
            status: ReportStatus.ASSIGNED,
            assignedProviderId: 'provider-1',
            organizationId: 'org-1',
          },
          'org-1',
          {
            role: UserRole.ORG_ADMIN,
            organizationId: 'org-1',
          },
        ),
      ).toThrow(
        new ForbiddenException(
          'Report cannot be assigned in its current status',
        ),
      );
    });

    it('rejects cross-org assignment for org admins', () => {
      expect(() =>
        (service as any).assertAssignmentAllowed(
          {
            status: ReportStatus.PENDING,
            assignedProviderId: null,
            organizationId: 'org-1',
          },
          'org-2',
          {
            role: UserRole.ORG_ADMIN,
            organizationId: 'org-1',
          },
        ),
      ).toThrow(new ForbiddenException('Provider must be same org'));
    });

    it('allows super admin cross-org assignment from PENDING', () => {
      expect(() =>
        (service as any).assertAssignmentAllowed(
          {
            status: ReportStatus.PENDING,
            assignedProviderId: null,
            organizationId: 'org-1',
          },
          'org-2',
          {
            role: UserRole.SUPER_ADMIN,
            organizationId: null,
          },
        ),
      ).not.toThrow();
    });
  });

  describe('assertStatusTransitionAllowed', () => {
    it('allows provider to move assigned report to in progress', () => {
      expect(() =>
        (service as any).assertStatusTransitionAllowed(
          {
            status: ReportStatus.ASSIGNED,
            assignedProviderId: 'provider-1',
            organizationId: 'org-1',
          },
          ReportStatus.IN_PROGRESS,
          {
            role: UserRole.PROVIDER,
            organizationId: 'org-1',
          },
          'provider-1',
        ),
      ).not.toThrow();
    });

    it('rejects provider skipping from assigned to completed', () => {
      expect(() =>
        (service as any).assertStatusTransitionAllowed(
          {
            status: ReportStatus.ASSIGNED,
            assignedProviderId: 'provider-1',
            organizationId: 'org-1',
          },
          ReportStatus.COMPLETED_BY_PROVIDER,
          {
            role: UserRole.PROVIDER,
            organizationId: 'org-1',
          },
          'provider-1',
        ),
      ).toThrow(
        new ForbiddenException(
          'Invalid status transition from ASSIGNED to COMPLETED_BY_PROVIDER',
        ),
      );
    });

    it('rejects updates from non-owner providers', () => {
      expect(() =>
        (service as any).assertStatusTransitionAllowed(
          {
            status: ReportStatus.ASSIGNED,
            assignedProviderId: 'provider-1',
            organizationId: 'org-1',
          },
          ReportStatus.IN_PROGRESS,
          {
            role: UserRole.PROVIDER,
            organizationId: 'org-1',
          },
          'provider-2',
        ),
      ).toThrow(new ForbiddenException('Not your report'));
    });

    it('rejects changes to closed reports even for super admins', () => {
      expect(() =>
        (service as any).assertStatusTransitionAllowed(
          {
            status: ReportStatus.CLOSED,
            assignedProviderId: 'provider-1',
            organizationId: 'org-1',
          },
          ReportStatus.IN_PROGRESS,
          {
            role: UserRole.SUPER_ADMIN,
            organizationId: null,
          },
          'super-admin',
        ),
      ).toThrow(
        new ForbiddenException(
          'Invalid status transition from CLOSED to IN_PROGRESS',
        ),
      );
    });
  });
});

describe('ReportService monthly quota guard', () => {
  it('allows reporting when monthly quota is unset', async () => {
    const service = new ReportService({
      organization: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ allowedReportsPerMonth: null }),
      },
      report: { count: jest.fn() },
    } as any);

    await expect(
      (service as any).enforceMonthlyReportQuota('org-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects report creation after monthly quota is reached', async () => {
    const service = new ReportService({
      organization: {
        findUnique: jest.fn().mockResolvedValue({ allowedReportsPerMonth: 2 }),
      },
      report: { count: jest.fn().mockResolvedValue(2) },
    } as any);

    await expect(
      (service as any).enforceMonthlyReportQuota('org-1'),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ReportService provider tenant access', () => {
  it('lists directly assigned jobs even when provider organization membership is missing', async () => {
    const service = new ReportService({
      providerOrganization: {
        findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-b' }]),
      },
      report: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any);

    await service.getAssignedReports({
      id: 'provider-1',
      role: UserRole.PROVIDER,
      organizationId: 'org-a',
    });

    expect((service as any).prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignedProviderId: 'provider-1',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('allows an explicitly assigned provider to open the assigned report', async () => {
    const service = new ReportService({
      providerOrganization: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      report: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'report-1',
          citizenId: 'citizen-1',
          assignedProviderId: 'provider-1',
          organizationId: 'org-b',
        }),
      },
    } as any);

    await expect(
      service.getReportById('report-1', {
        id: 'provider-1',
        role: UserRole.PROVIDER,
        organizationId: 'org-a',
      }),
    ).resolves.toMatchObject({
      id: 'report-1',
      assignedProviderId: 'provider-1',
    });
  });

  it('denies unassigned provider direct access without active organization membership', async () => {
    const service = new ReportService({
      providerOrganization: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      report: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'report-1',
          citizenId: 'citizen-1',
          assignedProviderId: 'provider-2',
          organizationId: 'org-b',
        }),
      },
    } as any);

    await expect(
      service.getReportById('report-1', {
        id: 'provider-1',
        role: UserRole.PROVIDER,
        organizationId: 'org-a',
      }),
    ).rejects.toThrow('Access denied');
  });

  it('keeps closed report discussions read-only', async () => {
    const service = new ReportService({
      report: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'report-1',
          status: ReportStatus.CLOSED,
          citizenId: 'citizen-1',
          assignedProviderId: null,
          organizationId: 'org-a',
        }),
      },
    } as any);

    await expect(
      service.createReportMessage(
        'report-1',
        { message: 'Any update?' },
        {
          id: 'citizen-1',
          role: UserRole.CITIZEN,
          organizationId: 'org-a',
        },
      ),
    ).rejects.toThrow('Discussion is read-only for this report');
  });
});

describe('ReportService organization candidates', () => {
  const service = new ReportService({} as any);

  it('marks ready organizations eligible when provider category and explicit capability coverage exist', () => {
    const candidate = (service as any).serializeOrganizationCandidate(
      {
        id: 'org-1',
        name: 'Hunslow',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@hunslow.test',
        contactPhone: null,
        country: 'Nigeria',
        state: 'Kaduna',
        lga: 'Hunslow',
        address: null,
        users: [],
        providerLinks: [
          {
            active: true,
            provider: {
              id: 'provider-1',
              accountStatus: 'ACTIVE',
              serviceCategories: ['Road'],
              coverageAreas: ['Hunslow'],
              profileData: {
                secureZoneProviderCapabilities: [
                  { id: 'civil_works', status: 'ACTIVE' },
                ],
              },
            },
          },
        ],
      },
      'Road',
    );

    expect(candidate.eligible).toBe(true);
    expect(candidate.activeProviderCount).toBe(1);
    expect(candidate.capabilityBackedProviderCount).toBe(1);
    expect(candidate.coveredCategories).toContain('Road');
  });

  it('exposes inherited profile coverage without treating it as capability-ready', () => {
    const candidate = (service as any).serializeOrganizationCandidate(
      {
        id: 'org-1',
        name: 'Hunslow',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@hunslow.test',
        contactPhone: null,
        country: 'Nigeria',
        state: 'Kaduna',
        lga: 'Hunslow',
        address: null,
        users: [],
        providerLinks: [
          {
            active: true,
            provider: {
              id: 'provider-1',
              accountStatus: 'ACTIVE',
              serviceCategories: ['Waste Management'],
              coverageAreas: ['Hunslow'],
            },
          },
        ],
      },
      'Waste Management',
    );

    expect(candidate.eligible).toBe(false);
    expect(candidate.inheritedProfileProviderCount).toBe(1);
    expect(candidate.capabilityBackedProviderCount).toBe(0);
    expect(candidate.categoryMatch.source).toBe('INHERITED_PROVIDER_PROFILE');
    expect(candidate.reasons).toContain(
      'No active provider has explicit approved maintenance capability metadata.',
    );
  });

  it('marks not-ready organizations unavailable with reasons', () => {
    const candidate = (service as any).serializeOrganizationCandidate(
      {
        id: 'org-2',
        name: 'No Providers',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: null,
        contactPhone: null,
        country: 'Nigeria',
        state: null,
        lga: null,
        address: null,
        users: [],
        providerLinks: [],
      },
      'Water',
    );

    expect(candidate.eligible).toBe(false);
    expect(candidate.reasons).toContain(
      'No accepted active provider membership is linked.',
    );
    expect(candidate.reasons).toContain(
      'Organization contact channel is missing.',
    );
  });
});

describe('ReportService assignment rejection', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const service = new ReportService({
    report: { findUnique, update },
  } as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a rejected new assignment to the pending queue', async () => {
    findUnique.mockResolvedValue({
      id: 'report-1',
      status: ReportStatus.ASSIGNED,
      assignedProviderId: 'provider-1',
      organizationId: 'org-1',
    });
    update.mockResolvedValue({ id: 'report-1', status: ReportStatus.PENDING });

    await service.rejectAssignment(
      'report-1',
      { reason: 'Outside current service area' },
      { id: 'provider-1', role: UserRole.PROVIDER, organizationId: 'org-1' },
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'report-1' },
        data: expect.objectContaining({
          status: ReportStatus.PENDING,
          assignedProviderId: null,
          lastAssignmentOutcome: AssignmentOutcome.REJECTED,
          lastAssignmentReason: 'Outside current service area',
          lastAssignmentProviderId: 'provider-1',
        }),
      }),
    );
  });

  it('does not allow rejection after work has started', async () => {
    findUnique.mockResolvedValue({
      id: 'report-1',
      status: ReportStatus.IN_PROGRESS,
      assignedProviderId: 'provider-1',
      organizationId: 'org-1',
    });

    await expect(
      service.rejectAssignment(
        'report-1',
        { reason: 'Cannot continue' },
        { id: 'provider-1', role: UserRole.PROVIDER, organizationId: 'org-1' },
      ),
    ).rejects.toThrow('Only new assignments can be rejected');
  });
});
