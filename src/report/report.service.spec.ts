import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
import { UploadSecurityService } from '../security/upload-security.service';
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
  jurisdictionSummary: {
    source: string;
    reason: string;
    level?: string;
    comparableLocationAvailable?: boolean;
    legacyFallback?: { active: boolean };
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

type EvidenceRecordCreateArgs = {
  data: {
    geoLatitude?: number | null;
    geoTrustOutcome?: string | null;
    metadata: { order?: number | null };
  };
};

type ComplianceAuditCreateArgs = {
  data: {
    action: string;
    metadata: {
      reasons?: string[];
    };
  };
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
    report?: {
      location?: string;
      locationName?: string;
      locationAddress?: string;
      locationLandmark?: string;
      title?: string;
      latitude?: number;
      longitude?: number;
    },
  ): OrganizationCandidate;
  resolveReportResponsibility(input: {
    title: string;
    description: string;
    category: string;
    location: string;
    locationName?: string;
    locationAddress?: string;
    locationLandmark?: string;
    latitude?: number;
    longitude?: number;
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
  | 'getProviderPerformance'
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
      { location: 'Hunslow, Kaduna' },
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
      { location: 'Hunslow, Kaduna' },
    );

    expect(candidate.eligible).toBe(true);
    expect(candidate.inheritedProfileProviderCount).toBe(1);
    expect(candidate.capabilityBackedProviderCount).toBe(0);
    expect(candidate.categoryMatch.source).toBe('INHERITED_PROVIDER_PROFILE');
    expect(candidate.reasons).not.toContain(
      'No active provider has explicit approved maintenance capability metadata.',
    );
  });

  it('allows organization mandate categories to drive responsibility review without provider capacity', () => {
    const candidate = service.serializeOrganizationCandidate(
      {
        id: 'org-mandate',
        name: 'Road Agency',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@road-agency.test',
        contactPhone: null,
        country: 'Nigeria',
        state: 'FCT',
        lga: 'Gwagwalada',
        address: null,
        profileData: {
          responsibilityRouting: {
            mandateCategories: ['Road & Infrastructure'],
          },
        },
        users: [],
        providerLinks: [],
      },
      'Road & Infrastructure',
      { location: 'Gwagwalada, FCT', title: 'Road damage' },
    );

    expect(candidate.eligible).toBe(true);
    expect(candidate.activeProviderCount).toBe(0);
    expect(candidate.categoryMatch.source).toBe('ORGANIZATION_MANDATE');
    expect(candidate.jurisdictionMatch).toBe(true);
    expect(candidate.readiness).toMatchObject({
      responsibilityCategoryConfigured: true,
      providerDispatchCapacityAvailable: false,
      jurisdictionSource: 'LEGACY_ORGANIZATION_LOCALITY',
    });
  });

  it('matches active LGA JurisdictionZone and reports governed source diagnostics', () => {
    const candidate = service.serializeOrganizationCandidate(
      {
        id: 'org-zone',
        name: 'Road Agency',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@road-agency.test',
        country: 'Nigeria',
        state: 'Kaduna',
        lga: 'Legacy LGA',
        jurisdictionZones: [
          {
            id: 'zone-gwagwalada',
            name: 'Gwagwalada',
            zoneType: 'LGA',
            country: 'Nigeria',
            state: 'FCT',
            lga: 'Gwagwalada',
            active: true,
          },
        ],
        profileData: {
          responsibilityRouting: { mandateCategories: ['Road'] },
        },
        users: [],
        providerLinks: [],
      },
      'Road',
      { locationName: 'Gwagwalada' },
    );

    expect(candidate.eligible).toBe(true);
    expect(candidate.jurisdictionSummary).toMatchObject({
      source: 'JURISDICTION_ZONE',
      level: 'LGA',
      reason: 'MATCHED_LGA',
    });
  });

  it('rejects different LGA when active JurisdictionZone is authoritative', () => {
    const candidate = service.serializeOrganizationCandidate(
      {
        id: 'org-zone',
        name: 'Road Agency',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@road-agency.test',
        country: 'Nigeria',
        state: 'FCT',
        lga: 'Gwagwalada',
        jurisdictionZones: [
          {
            id: 'zone-jabi',
            name: 'Jabi',
            zoneType: 'LGA',
            country: 'Nigeria',
            state: 'FCT',
            lga: 'Jabi',
            active: true,
          },
        ],
        profileData: {
          responsibilityRouting: { mandateCategories: ['Road'] },
        },
        users: [],
        providerLinks: [],
      },
      'Road',
      { location: 'Gwagwalada, FCT' },
    );

    expect(candidate.eligible).toBe(false);
    expect(candidate.jurisdictionSummary).toMatchObject({
      source: 'JURISDICTION_ZONE',
      reason: 'JURISDICTION_MISMATCH',
    });
  });

  it('matches state-level JurisdictionZone for reports in that state', () => {
    const candidate = service.serializeOrganizationCandidate(
      {
        id: 'org-state-zone',
        name: 'State Road Agency',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@state-road.test',
        jurisdictionZones: [
          {
            name: 'FCT',
            zoneType: 'STATE',
            country: 'Nigeria',
            state: 'FCT',
            active: true,
          },
        ],
        profileData: {
          responsibilityRouting: { mandateCategories: ['Road'] },
        },
        users: [],
        providerLinks: [],
      },
      'Road',
      { locationAddress: 'Gwagwalada, FCT' },
    );

    expect(candidate.eligible).toBe(true);
    expect(candidate.jurisdictionSummary.reason).toBe('MATCHED_STATE');
  });

  it('ignores inactive JurisdictionZone and uses legacy fallback only when no active zone exists', () => {
    const candidate = service.serializeOrganizationCandidate(
      {
        id: 'org-inactive-zone',
        name: 'Legacy Road Agency',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@legacy-road.test',
        country: 'Nigeria',
        state: 'FCT',
        lga: 'Gwagwalada',
        jurisdictionZones: [
          {
            name: 'Jabi',
            zoneType: 'LGA',
            country: 'Nigeria',
            state: 'FCT',
            lga: 'Jabi',
            active: false,
          },
        ],
        profileData: {
          responsibilityRouting: { mandateCategories: ['Road'] },
        },
        users: [],
        providerLinks: [],
      },
      'Road',
      { location: 'Gwagwalada, FCT' },
    );

    expect(candidate.eligible).toBe(true);
    expect(candidate.jurisdictionSummary.source).toBe(
      'LEGACY_ORGANIZATION_LOCALITY',
    );
  });

  it('does not let country-only organization data qualify every Nigerian report', () => {
    const candidate = service.serializeOrganizationCandidate(
      {
        id: 'org-country-only',
        name: 'Country Only Agency',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@country-only.test',
        country: 'Nigeria',
        profileData: {
          responsibilityRouting: { mandateCategories: ['Road'] },
        },
        users: [],
        providerLinks: [],
      },
      'Road',
      { location: 'Gwagwalada, FCT' },
    );

    expect(candidate.eligible).toBe(false);
    expect(candidate.jurisdictionSummary.source).toBe('NONE');
  });

  it('does not pass GPS-only reports without comparable locality text', () => {
    const candidate = service.serializeOrganizationCandidate(
      {
        id: 'org-gps',
        name: 'GPS Agency',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@gps.test',
        state: 'FCT',
        lga: 'Gwagwalada',
        profileData: {
          responsibilityRouting: { mandateCategories: ['Road'] },
        },
        users: [],
        providerLinks: [],
      },
      'Road',
      { latitude: 9.086529, longitude: 7.422313 },
    );

    expect(candidate.eligible).toBe(false);
    expect(candidate.reasons).toContain(
      'Report has no comparable textual locality for jurisdiction matching.',
    );
  });

  it('keeps mandate and contactability as hard routing requirements', () => {
    const missingMandate = service.serializeOrganizationCandidate(
      {
        id: 'org-no-mandate',
        name: 'No Mandate',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@no-mandate.test',
        state: 'FCT',
        lga: 'Gwagwalada',
        users: [],
        providerLinks: [],
      },
      'Road',
      { location: 'Gwagwalada, FCT' },
    );
    const missingContact = service.serializeOrganizationCandidate(
      {
        id: 'org-no-contact',
        name: 'No Contact',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        state: 'FCT',
        lga: 'Gwagwalada',
        profileData: {
          responsibilityRouting: { mandateCategories: ['Road'] },
        },
        users: [],
        providerLinks: [],
      },
      'Road',
      { location: 'Gwagwalada, FCT' },
    );

    expect(missingMandate.eligible).toBe(false);
    expect(missingContact.eligible).toBe(false);
    expect(missingContact.reasons).toContain(
      'Organization contact channel is missing.',
    );
  });

  it('does not use provider coverage as organization jurisdiction', () => {
    const candidate = service.serializeOrganizationCandidate(
      {
        id: 'org-provider-coverage-only',
        name: 'Coverage Only Org',
        status: OrganizationStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        contactEmail: 'ops@coverage.test',
        contactPhone: null,
        country: 'Nigeria',
        state: null,
        lga: null,
        address: null,
        users: [],
        providerLinks: [
          {
            active: true,
            provider: {
              id: 'provider-coverage',
              accountStatus: 'ACTIVE',
              serviceCategories: ['Road'],
              coverageAreas: ['Gwagwalada'],
            },
          },
        ],
      },
      'Road',
      { location: 'Gwagwalada, FCT', title: 'Road damage' },
    );

    expect(candidate.eligible).toBe(false);
    expect(candidate.jurisdictionMatch).toBe(false);
    expect(candidate.reasons).toContain(
      'Organization jurisdiction or address is missing.',
    );
    const jurisdictionSummary = candidate.jurisdictionSummary as {
      coverageAreas: string[];
    };
    expect(jurisdictionSummary.coverageAreas).toContain('Gwagwalada');
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
      'No mandate or inherited provider profile categories are configured.',
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
      jurisdictionZone: { findMany: jest.fn().mockResolvedValue([]) },
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
      location: 'Kubwa, FCT',
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
      text: 'Kubwa, FCT',
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
      jurisdictionZone: { findMany: jest.fn().mockResolvedValue([]) },
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
      location: 'Kubwa, FCT',
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

  it('returns no-location diagnostics for GPS-only reports without comparable locality text', async () => {
    const service = reportService({
      potentialAsset: { findMany: jest.fn().mockResolvedValue([]) },
      jurisdictionZone: { findMany: jest.fn().mockResolvedValue([]) },
      organization: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.resolveReportResponsibility({
      title: 'GPS-only road report',
      description: 'Captured by device',
      category: 'Road',
      location: '',
      latitude: 9.086529,
      longitude: 7.422313,
    });

    expect(result.outcome).toBe('NO_LOCATION');
    expect(result.diagnostics.reasonCode).toBe('NO_LOCATION_PROVIDED');
  });

  it('returns unmatched when no eligible organization satisfies governed jurisdiction', async () => {
    const service = reportService({
      potentialAsset: { findMany: jest.fn().mockResolvedValue([]) },
      jurisdictionZone: {
        findMany: jest.fn().mockResolvedValue([
          {
            organizationId: 'org-jabi',
            name: 'Jabi',
            zoneType: 'LGA',
            country: 'Nigeria',
            state: 'FCT',
            lga: 'Jabi',
            active: true,
          },
        ]),
      },
      organization: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'org-jabi',
            name: 'Jabi Agency',
            status: OrganizationStatus.ACTIVE,
            billingStatus: BillingStatus.ACTIVE,
            contactEmail: 'jabi@test.com',
            profileData: {
              responsibilityRouting: { mandateCategories: ['Road'] },
            },
            providerLinks: [],
            users: [],
          },
        ]),
      },
    });

    const result = await service.resolveReportResponsibility({
      title: 'Gwagwalada road report',
      description: 'Road issue',
      category: 'Road',
      location: 'Gwagwalada, FCT',
    });

    expect(result.outcome).toBe('UNMATCHED');
    expect(result.diagnostics).toMatchObject({
      outcome: 'UNMATCHED',
      eligibleCandidateCount: 0,
      reasonCode: 'NO_ELIGIBLE_ORGANIZATION',
    });
  });

  it('routes exactly one eligible JurisdictionZone organization to high confidence', async () => {
    const service = reportService({
      potentialAsset: { findMany: jest.fn().mockResolvedValue([]) },
      jurisdictionZone: {
        findMany: jest.fn().mockResolvedValue([
          {
            organizationId: 'org-gwagwalada',
            name: 'Gwagwalada',
            zoneType: 'LGA',
            country: 'Nigeria',
            state: 'FCT',
            lga: 'Gwagwalada',
            active: true,
          },
        ]),
      },
      organization: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'org-gwagwalada',
            name: 'Gwagwalada Agency',
            status: OrganizationStatus.ACTIVE,
            billingStatus: BillingStatus.ACTIVE,
            contactEmail: 'gwagwalada@test.com',
            profileData: {
              responsibilityRouting: { mandateCategories: ['Road'] },
            },
            providerLinks: [],
            users: [],
          },
        ]),
      },
    });

    const result = await service.resolveReportResponsibility({
      title: 'Gwagwalada road report',
      description: 'Road issue',
      category: 'Road',
      location: 'Gwagwalada, FCT',
    });

    expect(result.outcome).toBe('HIGH_CONFIDENCE');
    expect(result.organization).toMatchObject({ id: 'org-gwagwalada' });
    expect(result.diagnostics).toMatchObject({
      outcome: 'MATCHED',
      proposedOrganizationId: 'org-gwagwalada',
    });
  });

  it('returns ambiguous when multiple eligible organizations match governed jurisdiction', async () => {
    const org = (id: string) => ({
      id,
      name: id,
      status: OrganizationStatus.ACTIVE,
      billingStatus: BillingStatus.ACTIVE,
      contactEmail: `${id}@test.com`,
      state: 'FCT',
      lga: 'Gwagwalada',
      profileData: {
        responsibilityRouting: { mandateCategories: ['Road'] },
      },
      providerLinks: [],
      users: [],
    });
    const service = reportService({
      potentialAsset: { findMany: jest.fn().mockResolvedValue([]) },
      jurisdictionZone: { findMany: jest.fn().mockResolvedValue([]) },
      organization: {
        findMany: jest.fn().mockResolvedValue([org('org-a'), org('org-b')]),
      },
    });

    const result = await service.resolveReportResponsibility({
      title: 'Gwagwalada road report',
      description: 'Road issue',
      category: 'Road',
      location: 'Gwagwalada, FCT',
    });

    expect(result.outcome).toBe('AMBIGUOUS');
    expect(result.diagnostics).toMatchObject({
      outcome: 'AMBIGUOUS',
      eligibleCandidateCount: 2,
      reasonCode: 'MULTIPLE_ELIGIBLE_CANDIDATES',
    });
  });

  it('returns explicit diagnostics when category or location is missing', async () => {
    const service = reportService({
      potentialAsset: { findMany: jest.fn().mockResolvedValue([]) },
      jurisdictionZone: { findMany: jest.fn().mockResolvedValue([]) },
      organization: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const noCategory = await service.resolveReportResponsibility({
      title: 'Missing category report',
      description: 'Issue',
      category: '',
      location: 'Kubwa, FCT',
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

describe('ReportService provider performance metrics', () => {
  it('counts and rates closed organization-scoped reports only', async () => {
    const findMany = jest
      .fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([
        {
          id: 'provider-1',
          fullName: 'Provider One',
          email: 'provider@test.com',
          assignedReports: [
            {
              id: 'closed-rated',
              title: 'Closed rated',
              status: ReportStatus.CLOSED,
              citizenRating: 5,
              citizenFeedback: 'Good',
              updatedAt: new Date('2026-08-01T12:00:00.000Z'),
              assignedAt: new Date('2026-08-01T10:00:00.000Z'),
              activities: [
                {
                  actorUserId: 'provider-1',
                  providerId: 'provider-1',
                  createdAt: new Date('2026-08-01T10:30:00.000Z'),
                },
              ],
            },
            {
              id: 'closed-unrated',
              title: 'Closed unrated',
              status: ReportStatus.CLOSED,
              citizenRating: null,
              citizenFeedback: null,
              updatedAt: new Date('2026-08-02T12:00:00.000Z'),
              assignedAt: new Date('2026-08-02T10:00:00.000Z'),
              activities: [],
            },
            {
              id: 'awaiting-governance-rated',
              title: 'Awaiting governance rated',
              status: ReportStatus.COMPLETED_BY_PROVIDER,
              citizenRating: 1,
              citizenFeedback: 'Not final yet',
              updatedAt: new Date('2026-08-03T12:00:00.000Z'),
              assignedAt: new Date('2026-08-03T10:00:00.000Z'),
              activities: [],
            },
            {
              id: 'rework-pending',
              title: 'Rework pending',
              status: ReportStatus.ASSIGNED,
              citizenRating: 2,
              citizenFeedback: 'Needs rework',
              updatedAt: new Date('2026-08-04T12:00:00.000Z'),
              assignedAt: new Date('2026-08-04T10:00:00.000Z'),
              activities: [],
            },
          ],
        },
      ]);
    const service = reportService({ user: { findMany } });

    const result = (await service.getProviderPerformance({
      role: UserRole.ORG_ADMIN,
      organizationId: 'org-1',
    })) as Array<{
      completedJobs: number;
      averageRating: number;
      ratingCount: number;
      averageResponseHours: number | null;
      recentReviews: Array<{ reportId: string }>;
    }>;

    const findManyArgs = findMany.mock.calls[0]?.[0] as {
      include: { assignedReports: { where: { organizationId: string } } };
    };
    expect(findManyArgs.include.assignedReports.where.organizationId).toBe(
      'org-1',
    );
    expect(result).toEqual([
      expect.objectContaining({
        providerId: 'provider-1',
        completedJobs: 2,
        averageRating: 5,
        ratingCount: 1,
        averageResponseHours: 0.5,
      }),
    ]);
    const providerPerformance = result[0];
    expect(providerPerformance.recentReviews).toHaveLength(1);
    expect(providerPerformance.recentReviews[0].reportId).toBe('closed-rated');
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

describe('ReportService evidence persistence hardening', () => {
  const onePixelPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const previousUploadRoot = process.env.UPLOAD_ROOT;
  let uploadRoot: string;

  const citizen = {
    id: 'citizen-1',
    userId: 'citizen-1',
    role: UserRole.CITIZEN,
    organizationId: 'org-1',
  };
  const provider = {
    id: 'provider-1',
    userId: 'provider-1',
    role: UserRole.PROVIDER,
    organizationId: 'org-1',
  };
  const report = {
    id: 'report-1',
    title: 'Evidence persistence report',
    organizationId: 'org-1',
    citizenId: 'citizen-1',
    assignedProviderId: 'provider-1',
    status: ReportStatus.IN_PROGRESS,
    evidenceImagePath: null,
    evidenceImageUrl: null,
    completionImagePath: null,
    completionImageUrl: null,
    latitude: 9.0765,
    longitude: 7.4938,
    locationAccuracy: 15,
  };

  function listFiles(path: string): string[] {
    if (!existsSync(path)) return [];
    return readdirSync(path, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.toString());
  }

  function createPrismaMock(
    options: {
      createEvidenceRecord?: jest.Mock;
      updateReport?: jest.Mock;
    } = {},
  ) {
    const updateReport =
      options.updateReport ??
      jest.fn(({ data }: { data: Partial<typeof report> }) =>
        Promise.resolve({
          ...report,
          ...data,
        }),
      );
    return {
      report: {
        findUnique: jest.fn().mockResolvedValue(report),
        update: updateReport,
      },
      evidenceRecord: {
        count: jest.fn().mockResolvedValue(0),
        create: options.createEvidenceRecord ?? jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: UserRole.PROVIDER,
          accountStatus: 'ACTIVE',
        }),
      },
      reportActivity: {
        create: jest.fn().mockResolvedValue({}),
      },
      complianceAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
  }

  function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    uploadSecurity: UploadSecurityService = new UploadSecurityService(),
  ) {
    return new ReportService(
      prismaMock(prisma),
      undefined,
      undefined,
      uploadSecurity,
    );
  }

  beforeEach(() => {
    uploadRoot = mkdtempSync(join(tmpdir(), 'fixzone-evidence-hardening-'));
    process.env.UPLOAD_ROOT = uploadRoot;
  });

  afterEach(() => {
    if (previousUploadRoot === undefined) {
      delete process.env.UPLOAD_ROOT;
    } else {
      process.env.UPLOAD_ROOT = previousUploadRoot;
    }
    rmSync(uploadRoot, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('keeps citizen evidence file when EvidenceRecord persistence succeeds', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    const result = await service.uploadReportEvidence(
      report.id,
      {
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
      },
      citizen,
    );

    expect(prisma.evidenceRecord.create).toHaveBeenCalledTimes(1);
    expect(existsSync(join(uploadRoot, result.evidenceImagePath))).toBe(true);
  });

  it('removes a newly written citizen evidence file when EvidenceRecord persistence fails', async () => {
    const dbError = new Error('EvidenceRecord insert failed');
    const prisma = createPrismaMock({
      createEvidenceRecord: jest.fn().mockRejectedValue(dbError),
    });
    const service = createService(prisma);

    await expect(
      service.uploadReportEvidence(
        report.id,
        {
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
        },
        citizen,
      ),
    ).rejects.toBe(dbError);

    expect(listFiles(join(uploadRoot, 'report-evidence', report.id))).toEqual(
      [],
    );
  });

  it('keeps provider completion evidence files when EvidenceRecord persistence succeeds', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    const result = await service.uploadCompletionEvidence(
      report.id,
      {
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
      },
      provider,
    );

    expect(prisma.evidenceRecord.create).toHaveBeenCalledTimes(1);
    expect(existsSync(join(uploadRoot, result.completionImagePath))).toBe(true);
  });

  it('stores per-image geo metadata with the matching completion EvidenceRecord', async () => {
    const createEvidenceRecord = jest.fn().mockResolvedValue({});
    const prisma = createPrismaMock({ createEvidenceRecord });
    const service = createService(prisma);

    const result = await service.uploadCompletionEvidence(
      report.id,
      {
        images: [
          {
            contentType: 'image/png',
            imageBase64: onePixelPngBase64,
            classification: 'during',
            order: 0,
            geoMetadata: {
              latitude: 9.0766,
              longitude: 7.4938,
              accuracyMeters: 12,
              source: 'DEVICE_GPS',
              permissionState: 'GRANTED',
            },
          },
          {
            contentType: 'image/png',
            imageBase64: onePixelPngBase64,
            classification: 'after',
            order: 1,
            geoMetadata: {
              latitude: 9.09,
              longitude: 7.4938,
              accuracyMeters: 8,
              source: 'BROWSER_GEOLOCATION',
              captureMethod: 'BROWSER_API',
              permissionState: 'GRANTED',
            },
          },
        ],
      },
      provider,
    );

    expect(createEvidenceRecord).toHaveBeenCalledTimes(2);
    const calls = createEvidenceRecord.mock.calls as [
      [EvidenceRecordCreateArgs],
      [EvidenceRecordCreateArgs],
    ];
    const first = calls[0][0].data;
    const second = calls[1][0].data;
    expect(first.geoLatitude).toBe(9.0766);
    expect(first.geoTrustOutcome).toBe('CONSISTENT');
    expect(first.metadata.order).toBe(0);
    expect(second.geoLatitude).toBe(9.09);
    expect(second.geoTrustOutcome).toBe('REVIEW_RECOMMENDED');
    expect(second.metadata.order).toBe(1);
    expect(result.evidenceItems).toHaveLength(2);
    expect(result.evidenceItems[0].geoTrust?.trustOutcome).toBe('CONSISTENT');
    expect(result.evidenceItems[1].geoTrust?.trustOutcome).toBe(
      'REVIEW_RECOMMENDED',
    );
  });

  it('rejects mismatched top-level geo metadata and image arrays before saving files', async () => {
    const saveBase64Image = jest.fn();
    const uploadSecurity = {
      saveBase64Image,
    } as unknown as UploadSecurityService;
    const prisma = createPrismaMock();
    const service = createService(prisma, uploadSecurity);

    await expect(
      service.uploadCompletionEvidence(
        report.id,
        {
          images: [
            { contentType: 'image/png', imageBase64: onePixelPngBase64 },
            { contentType: 'image/png', imageBase64: onePixelPngBase64 },
          ],
          imageGeoMetadata: [
            {
              latitude: 9.0765,
              longitude: 7.4938,
            },
          ],
        },
        provider,
      ),
    ).rejects.toMatchObject({
      response: { code: 'GEO_METADATA_IMAGE_COUNT_MISMATCH' },
    });

    expect(saveBase64Image).not.toHaveBeenCalled();
    expect(prisma.evidenceRecord.create).not.toHaveBeenCalled();
    const auditCalls = prisma.complianceAuditLog.create.mock.calls as [
      [ComplianceAuditCreateArgs],
    ];
    expect(auditCalls[0][0].data.action).toBe(
      'COMPLETION_GEO_METADATA_REJECTED',
    );
    expect(auditCalls[0][0].data.metadata.reasons).toEqual([
      'GEO_METADATA_IMAGE_COUNT_MISMATCH',
    ]);
  });

  it('rejects invalid completion geo coordinates before saving files', async () => {
    const saveBase64Image = jest.fn();
    const uploadSecurity = {
      saveBase64Image,
    } as unknown as UploadSecurityService;
    const prisma = createPrismaMock();
    const service = createService(prisma, uploadSecurity);

    await expect(
      service.uploadCompletionEvidence(
        report.id,
        {
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
          geoMetadata: {
            latitude: 91,
            longitude: 7.4938,
          },
        },
        provider,
      ),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_GEO_METADATA' },
    });

    expect(saveBase64Image).not.toHaveBeenCalled();
    expect(prisma.evidenceRecord.create).not.toHaveBeenCalled();
    const auditCalls = prisma.complianceAuditLog.create.mock.calls as [
      [ComplianceAuditCreateArgs],
    ];
    expect(auditCalls[0][0].data.action).toBe(
      'COMPLETION_GEO_METADATA_REJECTED',
    );
    expect(auditCalls[0][0].data.metadata.reasons).toEqual([
      'INVALID_GEO_METADATA',
    ]);
  });

  it('removes unpersisted completion evidence after geo-backed persistence failure', async () => {
    const dbError = new Error('EvidenceRecord insert failed');
    const prisma = createPrismaMock({
      createEvidenceRecord: jest.fn().mockRejectedValue(dbError),
    });
    const service = createService(prisma);

    await expect(
      service.uploadCompletionEvidence(
        report.id,
        {
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
          geoMetadata: {
            latitude: 9.0766,
            longitude: 7.4938,
            source: 'DEVICE_GPS',
          },
        },
        provider,
      ),
    ).rejects.toBe(dbError);

    expect(listFiles(join(uploadRoot, 'report-completion', report.id))).toEqual(
      [],
    );
  });

  it('removes only unpersisted provider completion evidence after a later EvidenceRecord failure', async () => {
    const dbError = new Error('second EvidenceRecord insert failed');
    const createEvidenceRecord = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(dbError);
    const prisma = createPrismaMock({ createEvidenceRecord });
    const service = createService(prisma);

    await expect(
      service.uploadCompletionEvidence(
        report.id,
        {
          images: [
            {
              contentType: 'image/png',
              imageBase64: onePixelPngBase64,
            },
            {
              contentType: 'image/png',
              imageBase64: onePixelPngBase64,
            },
          ],
        },
        provider,
      ),
    ).rejects.toBe(dbError);

    expect(createEvidenceRecord).toHaveBeenCalledTimes(2);
    expect(
      listFiles(join(uploadRoot, 'report-completion', report.id)),
    ).toHaveLength(1);
  });

  it('preserves the original persistence exception when compensating cleanup fails', async () => {
    const dbError = new Error('EvidenceRecord insert failed');
    const uploadSecurity = {
      saveBase64Image: jest.fn().mockResolvedValue({
        imagePath: `report-evidence/${report.id}/missing.png`,
        imageUrl: `/uploads/report-evidence/${report.id}/missing.png`,
      }),
    } as unknown as UploadSecurityService;
    const prisma = createPrismaMock({
      createEvidenceRecord: jest.fn().mockRejectedValue(dbError),
    });
    const service = createService(prisma, uploadSecurity);

    await expect(
      service.uploadReportEvidence(
        report.id,
        {
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
        },
        citizen,
      ),
    ).rejects.toBe(dbError);
  });

  it('does not remove files outside UPLOAD_ROOT during compensating cleanup', async () => {
    const outsideFile = join(uploadRoot, '..', 'outside-evidence.png');
    writeFileSync(outsideFile, 'outside');
    const dbError = new Error('EvidenceRecord insert failed');
    const uploadSecurity = {
      saveBase64Image: jest.fn().mockResolvedValue({
        imagePath: `report-evidence/${report.id}/../../outside-evidence.png`,
        imageUrl: `/uploads/report-evidence/${report.id}/../../outside-evidence.png`,
      }),
    } as unknown as UploadSecurityService;
    const prisma = createPrismaMock({
      createEvidenceRecord: jest.fn().mockRejectedValue(dbError),
    });
    const service = createService(prisma, uploadSecurity);

    await expect(
      service.uploadReportEvidence(
        report.id,
        {
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
        },
        citizen,
      ),
    ).rejects.toBe(dbError);

    expect(existsSync(outsideFile)).toBe(true);
    rmSync(outsideFile, { force: true });
  });

  it('does not remove pre-existing evidence files when a new upload persistence fails', async () => {
    const existingDir = join(uploadRoot, 'report-evidence', report.id);
    const existingFile = join(existingDir, 'existing.png');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(existingFile, Buffer.from(onePixelPngBase64, 'base64'));
    const dbError = new Error('EvidenceRecord insert failed');
    const prisma = createPrismaMock({
      createEvidenceRecord: jest.fn().mockRejectedValue(dbError),
    });
    const service = createService(prisma);

    await expect(
      service.uploadReportEvidence(
        report.id,
        {
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
        },
        citizen,
      ),
    ).rejects.toBe(dbError);

    expect(existsSync(existingFile)).toBe(true);
    expect(listFiles(existingDir)).toEqual(['existing.png']);
  });
});
