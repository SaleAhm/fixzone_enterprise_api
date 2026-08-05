import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AssignmentOutcome,
  BillingStatus,
  CompletionDecision,
  CompletionPolicy,
  OrganizationStatus,
  ReportStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportService } from './report.service';

type TestUser = {
  role: UserRole;
  organizationId?: string | null;
};

type AssignmentReport = {
  status: string;
  assignedProviderId: string | null;
  organizationId: string;
};

type OrganizationCandidate = {
  eligible: boolean;
  activeProviderCount: number;
  capabilityBackedProviderCount: number;
  inheritedProfileProviderCount: number;
  coveredCategories: string[];
  categoryMatch: {
    source: string;
    normalizedCategory: string;
    matchedMaintenanceCapabilities: string[];
  };
  confidence: string;
  reasons: string[];
  diagnostics: {
    providerCapabilitySource: string;
    finalEligibilityDecision: boolean;
  };
};

type ResponsibilityResult = {
  outcome: string;
  organization: { id: string } | null;
  matchFactors: string[];
  diagnostics: {
    outcome: string;
    candidateCount: number;
    eligibleCandidateCount?: number;
    proposedOrganizationId?: string;
    reasonCode: string;
    report?: {
      category?: string | null;
      normalizedCategory?: string | null;
      location?: { text?: string | null };
    };
    candidates?: Array<{
      organizationId: string;
      coverageAreas: string[];
      eligible: boolean;
    }>;
  };
};

type ProviderResponseMetric = {
  averageHours: number | null;
  sampleCount: number;
  reason: string | null;
};

type ProviderResponseReport = {
  status: string;
  assignedAt?: Date | null;
  activities?: Array<{
    actorUserId?: string | null;
    providerId?: string | null;
    createdAt?: Date | null;
  }>;
};

type ReportServiceInternals = {
  assertAssignmentAllowed(
    report: AssignmentReport,
    providerOrganizationId: string | null,
    providerLinkedToReportOrgOrUser: boolean | TestUser,
    userOrProviderId?: TestUser | string,
    providerId?: string,
  ): void;
  assertStatusTransitionAllowed(
    report: AssignmentReport,
    nextStatus: ReportStatus,
    user: TestUser,
    userId: string,
  ): void;
  enforceMonthlyReportQuota(organizationId: string): Promise<void>;
  serializeOrganizationCandidate(
    organization: unknown,
    category: string,
    report?: { location?: string; title?: string },
  ): OrganizationCandidate;
  resolveReportResponsibility(input: {
    title: string;
    description: string;
    category: string;
    location: string;
  }): Promise<ResponsibilityResult>;
  calculateProviderAverageResponse(
    reports: ProviderResponseReport[],
    providerId: string,
  ): ProviderResponseMetric;
};

type ReportServicePublic = Pick<
  ReportService,
  | 'getAssignedReports'
  | 'getReportById'
  | 'createReportMessage'
  | 'rejectAssignment'
>;

type TestReportService = ReportServicePublic & ReportServiceInternals;

function prismaMock(value: unknown): PrismaService {
  return value as PrismaService;
}

function reportService(value: unknown = {}): TestReportService {
  return new ReportService(prismaMock(value)) as unknown as TestReportService;
}

describe('ReportService workflow validators', () => {
  const service = reportService();

  describe('assertAssignmentAllowed', () => {
    it('allows same-org admin assignment from PENDING', () => {
      expect(() =>
        service.assertAssignmentAllowed(
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
        service.assertAssignmentAllowed(
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
        service.assertAssignmentAllowed(
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
        service.assertAssignmentAllowed(
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
        service.assertAssignmentAllowed(
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
        service.assertStatusTransitionAllowed(
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
        service.assertStatusTransitionAllowed(
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
        service.assertStatusTransitionAllowed(
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
        service.assertStatusTransitionAllowed(
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
    const service = reportService({
      organization: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ allowedReportsPerMonth: null }),
      },
      report: { count: jest.fn() },
    });

    await expect(
      service.enforceMonthlyReportQuota('org-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects report creation after monthly quota is reached', async () => {
    const service = reportService({
      organization: {
        findUnique: jest.fn().mockResolvedValue({ allowedReportsPerMonth: 2 }),
      },
      report: { count: jest.fn().mockResolvedValue(2) },
    });

    await expect(service.enforceMonthlyReportQuota('org-1')).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('ReportService provider tenant access', () => {
  it('lists directly assigned jobs even when provider organization membership is missing', async () => {
    const prisma = {
      providerOrganization: {
        findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-b' }]),
      },
      report: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = reportService(prisma);

    await service.getAssignedReports({
      id: 'provider-1',
      role: UserRole.PROVIDER,
      organizationId: 'org-a',
    });

    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignedProviderId: 'provider-1',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('allows an explicitly assigned provider to open the assigned report', async () => {
    const service = reportService({
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
    });

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
    const service = reportService({
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
    });

    await expect(
      service.getReportById('report-1', {
        id: 'provider-1',
        role: UserRole.PROVIDER,
        organizationId: 'org-a',
      }),
    ).rejects.toThrow('Access denied');
  });

  it('keeps closed report discussions read-only', async () => {
    const service = reportService({
      report: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'report-1',
          status: ReportStatus.CLOSED,
          citizenId: 'citizen-1',
          assignedProviderId: null,
          organizationId: 'org-a',
        }),
      },
    });

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
  const service = reportService();

  it('marks ready organizations eligible when provider category and explicit capability coverage exist', () => {
    const candidate = service.serializeOrganizationCandidate(
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

  it('treats inherited provider profile categories as routing-ready', () => {
    const candidate = service.serializeOrganizationCandidate(
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

    expect(candidate.eligible).toBe(true);
    expect(candidate.inheritedProfileProviderCount).toBe(1);
    expect(candidate.capabilityBackedProviderCount).toBe(0);
    expect(candidate.categoryMatch.source).toBe('INHERITED_PROVIDER_PROFILE');
    expect(candidate.reasons).not.toContain(
      'No active provider has explicit approved maintenance capability metadata.',
    );
  });

  it('maps Telecom category to ICT capability diagnostics', () => {
    const candidate = service.serializeOrganizationCandidate(
      {
        id: 'org-telecom',
        name: 'Hunslow Telecom',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@hunslow.test',
        contactPhone: null,
        country: 'Nigeria',
        state: 'Sokoto',
        lga: 'Sokoto',
        address: null,
        users: [],
        providerLinks: [
          {
            active: true,
            provider: {
              id: 'provider-telecom',
              accountStatus: 'ACTIVE',
              serviceCategories: ['Telecommunications'],
              coverageAreas: ['Sokoto Road'],
              profileData: {
                secureZoneProviderCapabilities: [
                  { id: 'ict', status: 'ACTIVE' },
                ],
              },
            },
          },
        ],
      },
      'Telecom',
      { location: 'Sokoto Road', title: 'Telecom outage' },
    );

    expect(candidate.eligible).toBe(true);
    expect(candidate.confidence).toBe('HIGH');
    expect(candidate.categoryMatch.normalizedCategory).toBe('telecom');
    expect(candidate.categoryMatch.matchedMaintenanceCapabilities).toContain(
      'ict',
    );
    expect(candidate.diagnostics.providerCapabilitySource).toBe(
      'EXPLICIT_PROVIDER_CAPABILITY',
    );
    expect(candidate.diagnostics.finalEligibilityDecision).toBe(true);
  });

  it('marks not-ready organizations unavailable with reasons', () => {
    const candidate = service.serializeOrganizationCandidate(
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

describe('ReportService responsibility resolver', () => {
  it('prefers existing asset responsibility when a single eligible owner exists', async () => {
    const service = reportService({
      potentialAsset: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'asset-1',
            organizationId: 'org-asset',
            ownershipStatus: 'VERIFIED',
          },
        ]),
      },
      assetCandidateOwner: { findMany: jest.fn().mockResolvedValue([]) },
      assetClaim: { findMany: jest.fn().mockResolvedValue([]) },
      organization: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'org-asset',
            name: 'Asset Owner Org',
            status: OrganizationStatus.ACTIVE,
            billingStatus: BillingStatus.ACTIVE,
            contactEmail: 'asset@test.com',
            state: 'FCT',
            lga: 'Kubwa',
            providerLinks: [
              {
                active: true,
                provider: {
                  id: 'provider-asset',
                  accountStatus: 'ACTIVE',
                  serviceCategories: ['Road'],
                  coverageAreas: ['Kubwa'],
                  profileData: {
                    secureZoneProviderCapabilities: [
                      { id: 'civil_works', status: 'ACTIVE' },
                    ],
                  },
                },
              },
            ],
            users: [],
          },
          {
            id: 'org-general',
            name: 'General Road Org',
            status: OrganizationStatus.ACTIVE,
            billingStatus: BillingStatus.ACTIVE,
            contactEmail: 'general@test.com',
            state: 'FCT',
            lga: 'Kubwa',
            providerLinks: [
              {
                active: true,
                provider: {
                  id: 'provider-general',
                  accountStatus: 'ACTIVE',
                  serviceCategories: ['Road'],
                  coverageAreas: ['Kubwa'],
                  profileData: {
                    secureZoneProviderCapabilities: [
                      { id: 'civil_works', status: 'ACTIVE' },
                    ],
                  },
                },
              },
            ],
            users: [],
          },
        ]),
      },
    });

    const result = await service.resolveReportResponsibility({
      title: 'Asset road report',
      description: 'Road issue',
      category: 'Road',
      location: 'Kubwa',
    });

    expect(result.outcome).toBe('HIGH_CONFIDENCE');
    expect(result.organization).toMatchObject({ id: 'org-asset' });
    expect(result.matchFactors).toContain('asset_or_ownership_responsibility');
    expect(result.diagnostics).toMatchObject({
      outcome: 'MATCHED',
      candidateCount: 2,
      eligibleCandidateCount: 2,
      proposedOrganizationId: 'org-asset',
      reasonCode: 'MATCHED_DETERMINISTIC',
      report: { category: 'Road', normalizedCategory: 'road' },
    });
    expect(result.diagnostics.report?.location).toMatchObject({
      text: 'Kubwa',
    });
    expect(result.diagnostics.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: 'org-asset',
          coverageAreas: ['Kubwa'],
          eligible: true,
        }),
      ]),
    );
  });

  it('blocks automatic routing when an explicit responsibility exclusion matches', async () => {
    const service = reportService({
      potentialAsset: { findMany: jest.fn().mockResolvedValue([]) },
      organization: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'org-restricted',
            name: 'Restricted Org',
            status: OrganizationStatus.ACTIVE,
            billingStatus: BillingStatus.ACTIVE,
            contactEmail: 'restricted@test.com',
            state: 'FCT',
            lga: 'Kubwa',
            profileData: {
              responsibilityRouting: {
                excludedCategories: ['Road'],
              },
            },
            providerLinks: [
              {
                active: true,
                provider: {
                  id: 'provider-restricted',
                  accountStatus: 'ACTIVE',
                  serviceCategories: ['Road'],
                  coverageAreas: ['Kubwa'],
                  profileData: {
                    secureZoneProviderCapabilities: [
                      { id: 'civil_works', status: 'ACTIVE' },
                    ],
                  },
                },
              },
            ],
            users: [],
          },
        ]),
      },
    });

    const result = await service.resolveReportResponsibility({
      title: 'Restricted road report',
      description: 'Road issue',
      category: 'Road',
      location: 'Kubwa',
    });

    expect(result.outcome).toBe('RESTRICTED_OR_CONFLICTED');
    expect(result.organization).toBeNull();
    expect(result.diagnostics).toMatchObject({
      outcome: 'RESTRICTED',
      candidateCount: 1,
      reasonCode: 'EXPLICIT_EXCLUSION_OR_RESTRICTION',
    });
    expect(result.diagnostics.proposedOrganizationId).toBeUndefined();
  });

  it('returns explicit diagnostics when category or location is missing', async () => {
    const service = reportService({
      potentialAsset: { findMany: jest.fn().mockResolvedValue([]) },
      organization: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const noCategory = await service.resolveReportResponsibility({
      title: 'Missing category report',
      description: 'Issue',
      category: '',
      location: 'Kubwa',
    });
    expect(noCategory.diagnostics).toMatchObject({
      outcome: 'NO_CATEGORY',
      candidateCount: 0,
      reasonCode: 'NO_CATEGORY_PROVIDED',
    });

    const noLocation = await service.resolveReportResponsibility({
      title: 'Missing location report',
      description: 'Issue',
      category: 'Road',
      location: '',
    });
    expect(noLocation.diagnostics).toMatchObject({
      outcome: 'NO_LOCATION',
      candidateCount: 0,
      reasonCode: 'NO_LOCATION_PROVIDED',
    });
  });
});

describe('ReportService assignment rejection', () => {
  const findUnique = jest.fn<Promise<unknown>, [unknown]>();
  const update = jest.fn<Promise<unknown>, [unknown]>();
  const service = reportService({
    report: { findUnique, update },
  });

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

    const updateCall = update.mock.calls[0]?.[0] as
      | {
          where?: { id?: string };
          data?: {
            status?: ReportStatus;
            assignedProviderId?: string | null;
            lastAssignmentOutcome?: AssignmentOutcome;
            lastAssignmentReason?: string;
            lastAssignmentProviderId?: string;
          };
        }
      | undefined;
    expect(updateCall?.where).toEqual({ id: 'report-1' });
    expect(updateCall?.data).toMatchObject({
      status: ReportStatus.PENDING,
      assignedProviderId: null,
      lastAssignmentOutcome: AssignmentOutcome.REJECTED,
      lastAssignmentReason: 'Outside current service area',
      lastAssignmentProviderId: 'provider-1',
    });
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

describe('ReportService provider response metrics', () => {
  const service = reportService();
  const metric = (reports: ProviderResponseReport[]) =>
    service.calculateProviderAverageResponse(reports, 'provider-1');

  it('returns a structured reason when no assignments were accepted', () => {
    expect(
      metric([
        {
          status: ReportStatus.ASSIGNED,
          assignedAt: new Date('2026-08-01T08:00:00.000Z'),
          activities: [],
        },
      ]),
    ).toEqual({
      averageHours: null,
      sampleCount: 0,
      reason: 'NO_ACCEPTED_ASSIGNMENTS',
    });
  });

  it('calculates one valid assignment-to-acceptance sample', () => {
    expect(
      metric([
        {
          status: ReportStatus.IN_PROGRESS,
          assignedAt: new Date('2026-08-01T08:00:00.000Z'),
          activities: [
            {
              actorUserId: 'provider-1',
              createdAt: new Date('2026-08-01T10:30:00.000Z'),
            },
          ],
        },
      ]),
    ).toEqual({
      averageHours: 2.5,
      sampleCount: 1,
      reason: null,
    });
  });

  it('averages multiple valid samples and excludes malformed records', () => {
    expect(
      metric([
        {
          status: ReportStatus.CLOSED,
          assignedAt: new Date('2026-08-01T08:00:00.000Z'),
          activities: [
            {
              actorUserId: 'provider-1',
              createdAt: new Date('2026-08-01T09:00:00.000Z'),
            },
          ],
        },
        {
          status: ReportStatus.COMPLETED_BY_PROVIDER,
          assignedAt: new Date('2026-08-02T08:00:00.000Z'),
          activities: [
            {
              actorUserId: 'provider-1',
              createdAt: new Date('2026-08-02T11:00:00.000Z'),
            },
          ],
        },
        {
          status: ReportStatus.IN_PROGRESS,
          assignedAt: null,
          activities: [
            {
              actorUserId: 'provider-1',
              createdAt: new Date('2026-08-03T11:00:00.000Z'),
            },
          ],
        },
      ]).averageHours,
    ).toBe(2);
  });

  it('does not use another provider acceptance activity', () => {
    expect(
      metric([
        {
          status: ReportStatus.IN_PROGRESS,
          assignedAt: new Date('2026-08-01T08:00:00.000Z'),
          activities: [
            {
              actorUserId: 'provider-2',
              createdAt: new Date('2026-08-01T09:00:00.000Z'),
            },
          ],
        },
      ]),
    ).toEqual({
      averageHours: null,
      sampleCount: 0,
      reason: 'MISSING_ACCEPTANCE_TIMESTAMP',
    });
  });
});

describe('ReportService completion governance policy helpers', () => {
  type CompletionPolicyHarness = {
    isCompletionSatisfied(input: {
      policy: CompletionPolicy;
      citizenDecision?: CompletionDecision | null;
      organizationDecision?: CompletionDecision | null;
    }): boolean;
    reviewStateFor(input: {
      policy: CompletionPolicy;
      citizenDecision?: CompletionDecision | null;
      organizationDecision?: CompletionDecision | null;
    }): string;
    assertNoActiveCompletionBlockers(report: {
      status?: ReportStatus | null;
      completionReviewState?: string | null;
      citizenCompletionDecision?: CompletionDecision | null;
      organizationCompletionDecision?: CompletionDecision | null;
    }): void;
    resolveCompletionPolicy(report: {
      completionPolicy?: CompletionPolicy | null;
      category?: string | null;
      organization?: { profileData?: unknown } | null;
    }): Promise<{ policy: CompletionPolicy; source: string }>;
    completionDeadlineSkipReason(report: {
      status?: ReportStatus | null;
      completionReviewState?: string | null;
      citizenCompletionDecision?: CompletionDecision | null;
      organizationCompletionDecision?: CompletionDecision | null;
      completionGovernanceHoldReason?: string | null;
      completionReviewProcessedAt?: Date | string | null;
    }): string | null;
  };
  const prisma = {
    platformSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const service = reportService(prisma) as unknown as CompletionPolicyHarness;
  const satisfied = (input: {
    policy: CompletionPolicy;
    citizenDecision?: CompletionDecision | null;
    organizationDecision?: CompletionDecision | null;
  }) => service.isCompletionSatisfied(input);
  const state = (input: {
    policy: CompletionPolicy;
    citizenDecision?: CompletionDecision | null;
    organizationDecision?: CompletionDecision | null;
  }) => service.reviewStateFor(input);

  it('closes citizen-only policy after citizen confirmation', () => {
    expect(
      satisfied({
        policy: CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED,
        citizenDecision: CompletionDecision.CONFIRMED,
      }),
    ).toBe(true);
  });

  it('requires organization verification for organization-only policy', () => {
    expect(
      satisfied({
        policy: CompletionPolicy.ORGANIZATION_CONFIRMATION_REQUIRED,
        citizenDecision: CompletionDecision.CONFIRMED,
      }),
    ).toBe(false);
    expect(
      satisfied({
        policy: CompletionPolicy.ORGANIZATION_CONFIRMATION_REQUIRED,
        organizationDecision: CompletionDecision.VERIFIED,
      }),
    ).toBe(true);
  });

  it('keeps both-required policy open until both approvals exist', () => {
    expect(
      satisfied({
        policy: CompletionPolicy.BOTH_REQUIRED,
        citizenDecision: CompletionDecision.CONFIRMED,
      }),
    ).toBe(false);
    expect(
      state({
        policy: CompletionPolicy.BOTH_REQUIRED,
        citizenDecision: CompletionDecision.CONFIRMED,
      }),
    ).toBe('AWAITING_ORGANIZATION_VERIFICATION');
    expect(
      satisfied({
        policy: CompletionPolicy.BOTH_REQUIRED,
        citizenDecision: CompletionDecision.CONFIRMED,
        organizationDecision: CompletionDecision.VERIFIED,
      }),
    ).toBe(true);
  });

  it('allows either party for citizen-or-organization policy', () => {
    expect(
      satisfied({
        policy: CompletionPolicy.CITIZEN_OR_ORGANIZATION,
        citizenDecision: CompletionDecision.CONFIRMED,
      }),
    ).toBe(true);
    expect(
      satisfied({
        policy: CompletionPolicy.CITIZEN_OR_ORGANIZATION,
        organizationDecision: CompletionDecision.VERIFIED,
      }),
    ).toBe(true);
  });

  it('does not close admin-resolution policy through ordinary approvals', () => {
    expect(
      satisfied({
        policy: CompletionPolicy.ADMIN_RESOLUTION_REQUIRED,
        citizenDecision: CompletionDecision.CONFIRMED,
        organizationDecision: CompletionDecision.VERIFIED,
      }),
    ).toBe(false);
    expect(state({ policy: CompletionPolicy.ADMIN_RESOLUTION_REQUIRED })).toBe(
      'AWAITING_ADMIN_RESOLUTION',
    );
  });

  it('identifies rework and dispute blockers before ordinary closure', () => {
    expect(
      state({
        policy: CompletionPolicy.BOTH_REQUIRED,
        citizenDecision: CompletionDecision.REWORK_REQUESTED,
      }),
    ).toBe('REWORK_REQUESTED');
    expect(
      state({
        policy: CompletionPolicy.BOTH_REQUIRED,
        organizationDecision: CompletionDecision.ESCALATED,
      }),
    ).toBe('DISPUTED');
    expect(() =>
      service.assertNoActiveCompletionBlockers({
        status: ReportStatus.COMPLETED_BY_PROVIDER,
        completionReviewState: 'REWORK_REQUESTED',
      }),
    ).toThrow(ConflictException);
  });

  it('resolves category policy before organization default policy', async () => {
    await expect(
      service.resolveCompletionPolicy({
        category: 'telecom infrastructure',
        organization: {
          profileData: {
            completionPolicy: CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED,
            completionPoliciesByCategory: {
              telecom: CompletionPolicy.BOTH_REQUIRED,
            },
          },
        },
      }),
    ).resolves.toEqual({
      policy: CompletionPolicy.BOTH_REQUIRED,
      source: 'ORGANIZATION_SERVICE_CATEGORY',
    });
  });

  it('keeps report override above category policy', async () => {
    await expect(
      service.resolveCompletionPolicy({
        completionPolicy: CompletionPolicy.ADMIN_RESOLUTION_REQUIRED,
        category: 'sanitation',
        organization: {
          profileData: {
            completionPoliciesByCategory: {
              sanitation: CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED,
            },
          },
        },
      }),
    ).resolves.toEqual({
      policy: CompletionPolicy.ADMIN_RESOLUTION_REQUIRED,
      source: 'REPORT_OVERRIDE',
    });
  });

  it('applies persisted platform category policy before organization default policy', async () => {
    prisma.platformSetting.findUnique.mockResolvedValueOnce({
      value: {
        sanitation: CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
      },
    });
    await expect(
      service.resolveCompletionPolicy({
        category: 'sanitation',
        organization: {
          profileData: {
            completionPolicy: CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED,
          },
        },
      }),
    ).resolves.toEqual({
      policy: CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
      source: 'PLATFORM_SERVICE_CATEGORY',
    });
  });

  it('skips deadline fallback when blockers are active', () => {
    expect(
      service.completionDeadlineSkipReason({
        status: ReportStatus.COMPLETED_BY_PROVIDER,
        completionReviewState: 'REWORK_REQUESTED',
      }),
    ).toBe('active_rework');
    expect(
      service.completionDeadlineSkipReason({
        status: ReportStatus.COMPLETED_BY_PROVIDER,
        completionGovernanceHoldReason: 'Legal hold',
      }),
    ).toBe('governance_hold');
    expect(
      service.completionDeadlineSkipReason({
        status: ReportStatus.COMPLETED_BY_PROVIDER,
      }),
    ).toBeNull();
  });
});
