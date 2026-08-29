import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AssignmentOutcome,
  BillingStatus,
  AccountStatus,
  CompletionDecision,
  CompletionPolicy,
  EvidenceRelatedEntityType,
  OrganizationStatus,
  Prisma,
  ReportStatus,
  UserRole,
} from '@prisma/client';
import { createReadStream } from 'fs';
import { access, unlink } from 'fs/promises';
import { basename, extname, posix, resolve, relative, sep } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { UploadSecurityService } from '../security/upload-security.service';
import { uploadRoot } from '../storage/upload-root';
import { TrustService } from '../trust/trust.service';
import { WorkflowOrchestratorService } from '../business-logic/workflow-orchestrator.service';
import { AssignProviderDto } from './dto/assign-provider.dto';
import { AssignOrganizationDto } from './dto/assign-organization.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { UploadCompletionEvidenceDto } from './dto/upload-completion-evidence.dto';
import { UploadReportEvidenceDto } from './dto/upload-report-evidence.dto';
import { AdminDashboardQueryDto } from './dto/admin-dashboard-query.dto';
import {
  CompletionReviewQueueQueryDto,
  ProcessCompletionReviewDeadlinesDto,
} from './dto/completion-review-query.dto';
import {
  AdminCategoryCompletionPolicyDto,
  AdminCompletionGovernanceReasonDto,
  AdminCompletionPolicyOverrideDto,
} from './dto/admin-completion-governance.dto';
import { RejectAssignmentDto } from './dto/reject-assignment.dto';
import { CitizenConfirmCompletionDto } from './dto/citizen-confirm-completion.dto';
import { CitizenRejectCompletionDto } from './dto/citizen-reject-completion.dto';
import {
  OrganizationCompletionReworkDto,
  OrganizationCompletionVerificationDto,
} from './dto/organization-completion-decision.dto';
import {
  OrganizationAcceptReportDto,
  OrganizationRejectReportDto,
} from './dto/organization-intake-decision.dto';
import {
  canTransitionReportStatus,
  normalizeReportStatus,
} from './report-workflow';
import {
  evaluateRoutingJurisdiction,
  routingLocationText,
  type RoutingJurisdictionMatch,
} from '../organization/routing-jurisdiction';
import {
  GeoTrustService,
  type GeoInput,
  type NormalizedGeoMetadata,
} from './services/geo-trust.service';

type JwtUser = {
  id?: string;
  userId?: string;
  sub?: string;
  firebaseUid?: string | null;
  email?: string | null;
  fullName?: string | null;
  role: UserRole;
  organizationId?: string | null;
};

type EvidenceKind = 'report-evidence' | 'report-completion';
type EvidenceGeoTrustPayload = {
  schemaVersion: number;
  source: string;
  captureMethod: string;
  permissionState: string;
  validationOutcome: string;
  trustOutcome: string;
  distanceMeters: number | null;
  accuracyMeters: number | null;
  capturedAt: Date | string | null;
  receivedAt: Date | string | null;
  warnings: unknown[];
  validationReasons: unknown[];
  coordinates: { latitude: number; longitude: number } | null;
} | null;
type SavedEvidenceFile = {
  imagePath: string;
  imageUrl: string;
  geoTrust?: EvidenceGeoTrustPayload;
};

type CompletionPolicyResolution = {
  policy: CompletionPolicy;
  source: string;
};

type ResponsibilityOutcome =
  | 'HIGH_CONFIDENCE'
  | 'AMBIGUOUS'
  | 'UNMATCHED'
  | 'RESTRICTED_OR_CONFLICTED'
  | 'NO_LOCATION'
  | 'NO_CATEGORY';

type CanonicalResponsibilityOutcome =
  | 'MATCHED'
  | 'AMBIGUOUS'
  | 'UNMATCHED'
  | 'RESTRICTED'
  | 'NO_LOCATION'
  | 'NO_CATEGORY';

type ResponsibilityResolutionDiagnostics = {
  outcome: CanonicalResponsibilityOutcome;
  candidateCount: number;
  eligibleCandidateCount: number;
  proposedOrganizationId?: string;
  selectedCandidateId?: string;
  reasonCode: string;
  evaluatedAt: string;
  report: {
    category: string | null;
    normalizedCategory: string | null;
    normalizedCategoryAliases: string[];
    coordinates: { latitude: number | null; longitude: number | null };
    location: {
      text: string | null;
      name: string | null;
      address: string | null;
      landmark: string | null;
      source: string | null;
    };
  };
  candidates: Array<{
    organizationId: string;
    organizationName: string;
    organizationStatus: string | null;
    organizationVerificationState: string | null;
    mandateCategories: string[];
    providerCategories: string[];
    coverageAreas: string[];
    jurisdictionSource?: string;
    jurisdictionLevel?: string;
    eligible: boolean;
    confidence: string | null;
    reasons: string[];
  }>;
};

type ResponsibilityProviderProfile = {
  id: string;
  accountStatus?: string | null;
  serviceCategories?: unknown;
  coverageAreas?: unknown;
  profileData?: Prisma.JsonValue | null;
};

type ResponsibilityOrganizationProfile = {
  id: string;
  name: string;
  status?: OrganizationStatus | null;
  billingStatus?: BillingStatus | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  country?: string | null;
  state?: string | null;
  lga?: string | null;
  address?: string | null;
  enabledModules?: unknown;
  identityVerificationStatus?: string | null;
  verificationStatus?: string | null;
  profileData?: Prisma.JsonValue | null;
  jurisdictionZones?: Array<{
    name?: string | null;
    zoneType?: string | null;
    country?: string | null;
    state?: string | null;
    lga?: string | null;
    boundaryRef?: string | null;
    metadata?: Prisma.JsonValue | null;
    active?: boolean | null;
  }>;
  providerLinks?: Array<{
    provider?: ResponsibilityProviderProfile | null;
  }>;
  users?: ResponsibilityProviderProfile[];
};

type OrganizationCandidate = {
  type: 'ORGANIZATION';
  id: string;
  name: string;
  eligible: boolean;
  ready: boolean;
  reasons: string[];
  exclusionReasons: string[];
  categoryMatch: {
    requestedCategory: string;
    normalizedCategory: string;
    matched: boolean;
    matchedMaintenanceCapabilities: string[];
    source: string;
  };
  jurisdictionMatch: boolean;
  serviceModuleReady: boolean;
  confidence: string;
  activeProviderCount: number;
  acceptedProviderCount: number;
  capabilityBackedProviderCount: number;
  inheritedProfileProviderCount: number;
  verifiedCapabilityProviderCount: number;
  coveredCategories: string[];
  mandateCategories: string[];
  excludedCategories: string[];
  inheritedProfileCategories: string[];
  explicitCapabilities: string[];
  readiness: Record<string, unknown>;
  diagnostics: {
    organizationStatus?: OrganizationStatus | null;
    organizationVerificationState?: string | null;
  };
  jurisdictionSummary: {
    country?: string | null;
    state?: string | null;
    lga?: string | null;
    address?: string | null;
    configuredZones: string[];
    configuredZoneDetails: RoutingJurisdictionMatch['configuredZones'];
    source: RoutingJurisdictionMatch['source'];
    level: RoutingJurisdictionMatch['level'];
    reason: RoutingJurisdictionMatch['reason'];
    comparableLocationAvailable: boolean;
    legacyFallback: RoutingJurisdictionMatch['legacyFallback'];
    coverageAreas: string[];
  };
};

type PrismaCreateDelegate = {
  create(args: unknown): Promise<unknown>;
};

type PrismaFindManyDelegate<T> = {
  findMany(args: unknown): Promise<T[]>;
};

type PrismaNotificationDelegate = PrismaCreateDelegate &
  PrismaFindFirstDelegate<{ id: string }>;

type PrismaFindFirstDelegate<T> = {
  findFirst(args: unknown): Promise<T | null>;
};

type OptionalReportActivityRecord = {
  id: string;
  action?: string | null;
  reportId?: string | null;
  organizationId?: string | null;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  actorName?: string | null;
  providerId?: string | null;
  fromStatus?: ReportStatus | null;
  toStatus?: ReportStatus | null;
  reason?: string | null;
  note?: string | null;
  metadata?: unknown;
  createdAt?: Date | string | null;
};

type OptionalNotificationRecord = {
  id: string;
  reportId?: string | null;
  userId?: string | null;
  type?: string | null;
  title?: string | null;
  message?: string | null;
  read?: boolean | null;
  createdAt?: Date | string | null;
};

type OptionalEvidenceRecord = {
  id: string;
  fileUrl: string;
  fileType?: string | null;
  uploadedAt?: Date | string | null;
  metadata?: unknown;
  geoLatitude?: number | null;
  geoLongitude?: number | null;
  geoAccuracyMeters?: number | null;
  geoCapturedAt?: Date | string | null;
  geoReceivedAt?: Date | string | null;
  geoSource?: string | null;
  geoCaptureMethod?: string | null;
  geoPermissionState?: string | null;
  geoValidationOutcome?: string | null;
  geoDistanceMeters?: number | null;
  geoTrustOutcome?: string | null;
  geoSchemaVersion?: number | null;
};

type PotentialAssetRecord = {
  id: string;
  organizationId?: string | null;
  ownershipStatus?: string | null;
};

type AssetCandidateOwnerRecord = {
  organizationId?: string | null;
};

type AssetClaimRecord = {
  claimantOrganizationId?: string | null;
};

type ResponsibilityResolution = {
  outcome: ResponsibilityOutcome;
  organization: { id: string } | null;
  candidates: OrganizationCandidate[];
  reasons: string[];
  matchFactors: string[];
  diagnostics: ResponsibilityResolutionDiagnostics;
};

type ResponsibilityEligibilityReason =
  | 'MATCHED_PROPOSED_ORGANIZATION'
  | 'STATUS_NOT_ORG_REVIEW'
  | 'NO_PROPOSED_ORGANIZATION'
  | 'ACCEPTED_ALREADY'
  | 'REJECTED_ALREADY'
  | 'MANUALLY_OVERRIDDEN'
  | 'CLOSED_REPORT'
  | 'ORGANIZATION_SCOPE_MISMATCH'
  | 'STALE_ASSIGNMENT'
  | 'INVALID_ROUTING_STATE'
  | 'LEGACY_MATCHED_ROUTING_STATE';

type ReportWithEvidence = {
  id: string;
  description?: string | null;
  createdAt?: Date | string | null;
  organizationId: string;
  assignedOrganizationId?: string | null;
  citizenId: string;
  assignedProviderId: string | null;
  lastAssignmentProviderId?: string | null;
  status?: ReportStatus;
  priority?: string | null;
  evidenceImageUrl?: string | null;
  evidenceImagePath?: string | null;
  completionImageUrl?: string | null;
  completionImagePath?: string | null;
};

type EnterpriseReportWithEvidence = ReportWithEvidence & {
  title?: string | null;
  category?: string | null;
  location?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationLandmark?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracy?: number | null;
  locationCapturedAt?: Date | string | null;
  locationReceivedAt?: Date | string | null;
  locationSource?: string | null;
  locationPermissionState?: string | null;
  locationValidationOutcome?: string | null;
  locationSchemaVersion?: number | null;
  completionNote?: string | null;
  completedByProviderAt?: Date | string | null;
  completionLatitude?: number | null;
  completionLongitude?: number | null;
  completionAccuracy?: number | null;
  completionLocationCapturedAt?: Date | string | null;
  completionLocationSource?: string | null;
  citizenRating?: number | null;
  citizenFeedback?: string | null;
  completionRejectionReason?: string | null;
  completionPolicy?: CompletionPolicy | null;
  completionPolicySource?: string | null;
  completionReviewState?: string | null;
  completionReviewDeadlineAt?: Date | string | null;
  completionReviewProcessedAt?: Date | string | null;
  completionFallbackRule?: string | null;
  completionFinalActorType?: string | null;
  completionGovernanceHoldReason?: string | null;
  citizenCompletionDecision?: CompletionDecision | null;
  citizenCompletionDecidedAt?: Date | string | null;
  organizationCompletionDecision?: CompletionDecision | null;
  organizationCompletionDecidedAt?: Date | string | null;
  organizationCompletionDecidedById?: string | null;
  organizationCompletionReason?: string | null;
  completionFinalizedAt?: Date | string | null;
  completionFinalizedById?: string | null;
  completionFinalizedByRole?: UserRole | null;
  completionClosureReason?: string | null;
  completionDisputeReason?: string | null;
  assignedAt?: Date | string | null;
  assignmentDeadlineAt?: Date | string | null;
  lastAssignmentOutcome?: AssignmentOutcome | null;
  lastAssignmentReason?: string | null;
  assignedProvider?: {
    id: string;
    fullName?: string | null;
    email?: string | null;
    providerId?: string | null;
  } | null;
  organization?: { id: string; name?: string | null } | null;
  assignedOrganization?: { id: string; name?: string | null } | null;
  organizationAssignmentSource?: string | null;
  organizationAssignedAt?: Date | string | null;
};

const COMPLETION_REVIEW_WINDOW_FALLBACK_RULE =
  'AUTO_CLOSE_AFTER_REVIEW_WINDOW_DEADLINE_EXPIRED';

const AUTOMATIC_ORGANIZATION_REVIEW_SOURCE = 'Automatic intake match';
const ORGANIZATION_ACCEPTED_SOURCE = 'Organization accepted report';
const ORGANIZATION_REJECTED_SOURCE = 'Organization rejected report';
const PLATFORM_RESPONSIBILITY_RESOLUTION_SOURCE =
  'Platform responsibility resolution';
const PROVIDER_CAPABILITIES_KEY = 'secureZoneProviderCapabilities';
const ACTIVE_MAINTENANCE_CAPABILITIES = new Set([
  'electrical',
  'plumbing',
  'mechanical',
  'civil_works',
  'ict',
  'facilities',
]);
const CATEGORY_CAPABILITY_ALIASES: Record<string, string[]> = {
  telecom: ['ict', 'electrical'],
  telecommunications: ['ict', 'electrical'],
  internet: ['ict', 'electrical'],
  network: ['ict', 'electrical'],
  fibre: ['ict', 'electrical'],
  fiber: ['ict', 'electrical'],
  road: ['civil_works'],
  pothole: ['civil_works'],
  drainage: ['civil_works', 'plumbing'],
  water: ['plumbing'],
  plumbing: ['plumbing'],
  electrical: ['electrical'],
  electricity: ['electrical'],
  light: ['electrical'],
  lighting: ['electrical'],
  waste: ['facilities'],
  cleaning: ['facilities'],
};

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);
  private readonly assignmentTimeoutMinutes = Number(
    process.env.ASSIGNMENT_TIMEOUT_MINUTES || 30,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly trustService?: TrustService,
    private readonly workflowOrchestrator?: WorkflowOrchestratorService,
    @Optional()
    @Inject(UploadSecurityService)
    private readonly uploadSecurity?: UploadSecurityService,
    @Optional()
    @Inject(GeoTrustService)
    private readonly geoTrustService?: GeoTrustService,
  ) {}

  private prismaDelegate<T>(name: string): T | undefined {
    return this.prismaDelegateFrom<T>(this.prisma, name);
  }

  private prismaDelegateFrom<T>(source: unknown, name: string): T | undefined {
    const delegates = source as Record<string, unknown>;
    const delegate = delegates[name];
    return delegate && typeof delegate === 'object'
      ? (delegate as T)
      : undefined;
  }

  // ===================== CREATE =====================

  async createReport(user: JwtUser, dto: CreateReportDto) {
    const userId = this.getUserId(user);
    const reportLocation = this.geoTrust().normalizeReportLocation({
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyMeters: dto.locationAccuracy,
      capturedAt: dto.locationCapturedAt,
      source: dto.locationSource,
      permissionState: dto.locationPermissionState,
    });

    if (user.role !== UserRole.CITIZEN) {
      throw new ForbiddenException('Only citizens can create reports');
    }

    if (!user.organizationId) {
      throw new ForbiddenException('Citizen must belong to an organization');
    }

    const intakeRoute = await this.resolveReportResponsibility(dto);
    const intakeOrganization = intakeRoute.organization;
    const organizationId = user.organizationId;
    const routedOrganizationId =
      intakeRoute.outcome === 'HIGH_CONFIDENCE'
        ? (intakeOrganization?.id ?? null)
        : null;
    const routedToOrganization = Boolean(routedOrganizationId);

    await this.enforceMonthlyReportQuota(organizationId);

    const report = await this.prisma.report.create({
      data: {
        ...dto,
        locationCapturedAt: reportLocation.capturedAt ?? undefined,
        locationReceivedAt: reportLocation.receivedAt,
        locationSource: dto.locationSource ?? reportLocation.source,
        locationPermissionState: reportLocation.permissionState,
        locationValidationOutcome: reportLocation.validationOutcome,
        locationSchemaVersion: reportLocation.schemaVersion,
        status: routedToOrganization
          ? ReportStatus.ORG_REVIEW
          : ReportStatus.TRIAGE,
        citizenId: userId,
        organizationId,
        assignedOrganizationId: routedOrganizationId,
        organizationAssignedAt: routedToOrganization ? new Date() : null,
        organizationAssignmentSource: routedToOrganization
          ? AUTOMATIC_ORGANIZATION_REVIEW_SOURCE
          : intakeRoute.outcome === 'AMBIGUOUS'
            ? 'Ambiguous responsibility match'
            : intakeRoute.outcome === 'RESTRICTED_OR_CONFLICTED'
              ? 'Restricted or conflicted responsibility match'
              : PLATFORM_RESPONSIBILITY_RESOLUTION_SOURCE,
      },
      include: this.includeRelations(),
    });

    await this.createNotification({
      userId,
      reportId: report.id,
      type: 'acknowledged',
      title: 'Report received',
      message: `Your report "${report.title}" has been received and is under review.`,
    });

    this.logger.debug({
      message: 'Citizen report created',
      reportId: report.id,
      citizenId: report.citizenId,
      firebaseUid: user.firebaseUid,
      organizationId: report.organizationId,
      assignedOrganizationId: report.assignedOrganizationId,
      locationSupplied: Boolean(
        report.latitude != null && report.longitude != null,
      ),
    });

    await this.recordGeoAudit(report.id, 'REPORT_GEO_METADATA_RECEIVED', user, {
      organizationId: report.organizationId,
      outcome: reportLocation.validationOutcome,
      trustOutcome: reportLocation.trustOutcome,
      reasons: reportLocation.validationReasons,
    });

    await this.audit('Report Created', user, {
      targetType: 'Report',
      targetId: report.id,
      organizationId: report.organizationId,
      category: report.category,
      responsibilityOutcome: intakeRoute.outcome,
      responsibilityCandidateOrganizationId: report.assignedOrganizationId,
      responsibilityReasons: intakeRoute.reasons,
      responsibilityMatchFactors: intakeRoute.matchFactors,
      responsibilityResolution: intakeRoute.diagnostics,
    });
    await this.recordReportActivity(report.id, 'REPORT_CREATED', user, {
      organizationId: report.organizationId,
      toStatus: report.status,
      metadata: {
        category: report.category,
        assignedOrganizationId: report.assignedOrganizationId,
        routingSource: report.organizationAssignmentSource,
        responsibilityOutcome: intakeRoute.outcome,
        responsibilityReasons: intakeRoute.reasons,
        responsibilityMatchFactors: intakeRoute.matchFactors,
        responsibilityResolution: intakeRoute.diagnostics,
      },
    });
    await this.recordReportActivity(
      report.id,
      'RESPONSIBILITY_RESOLUTION_ATTEMPTED',
      {
        role: UserRole.SUPER_ADMIN,
        fullName: 'SecureZone Responsibility Resolver',
      },
      {
        organizationId: report.organizationId,
        toStatus: report.status,
        metadata: {
          outcome: intakeRoute.outcome,
          candidateOrganizationId: report.assignedOrganizationId,
          candidateOrganizationIds: intakeRoute.candidates.map(
            (candidate) => candidate.id,
          ),
          reasons: intakeRoute.reasons,
          matchFactors: intakeRoute.matchFactors,
          responsibilityResolution: intakeRoute.diagnostics,
        },
      },
    );
    if (routedToOrganization) {
      await this.recordReportActivity(
        report.id,
        'RESPONSIBILITY_REVIEW_ENTERED',
        {
          role: UserRole.SUPER_ADMIN,
          fullName: 'SecureZone Responsibility Resolver',
        },
        {
          organizationId: report.organizationId,
          fromStatus: ReportStatus.TRIAGE,
          toStatus: report.status,
          metadata: {
            assignedOrganizationId: report.assignedOrganizationId,
            routingSource: report.organizationAssignmentSource,
            outcome: intakeRoute.outcome,
            responsibilityResolution: intakeRoute.diagnostics,
          },
        },
      );
      await this.notifyOrganizationOperators(report.assignedOrganizationId!, {
        reportId: report.id,
        type: 'organization_report_offered',
        title: 'Incoming report for review',
        message: `"${report.title}" is awaiting your organization intake decision.`,
      });
    } else if (
      intakeRoute.outcome === 'AMBIGUOUS' ||
      intakeRoute.outcome === 'UNMATCHED' ||
      intakeRoute.outcome === 'RESTRICTED_OR_CONFLICTED'
    ) {
      await this.notifyPlatformResolvers({
        reportId: report.id,
        type: 'responsibility_resolution_required',
        title: 'Responsibility resolution required',
        message: `"${report.title}" requires platform responsibility resolution.`,
      });
    }

    return {
      ...this.withProtectedEvidenceUrls(report),
      responsibilityResolution: intakeRoute.diagnostics,
    };
  }

  // ===================== CITIZEN =====================

  async getMyReports(user: JwtUser) {
    const userId = this.getUserId(user);

    try {
      const reports = await this.prisma.report.findMany({
        where: { citizenId: userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: this.includeRelations(),
      });

      if (reports.length === 0) {
        this.logger.warn({
          message: 'Citizen report query returned no rows',
          userId,
          firebaseUid: user.firebaseUid,
          organizationId: user.organizationId,
        });
      }

      return reports.map((report) => this.withProtectedEvidenceUrls(report));
    } catch (error) {
      const prismaError = error as {
        code?: string;
        message?: string;
        meta?: unknown;
        stack?: string;
      };

      this.logger.error(
        {
          message: 'Failed to fetch citizen reports',
          userId,
          prismaCode: prismaError.code,
          prismaMessage: prismaError.message,
          prismaMeta: prismaError.meta,
        },
        prismaError.stack,
      );

      throw error;
    }
  }

  async getCitizenDashboardSummary(user: JwtUser) {
    const userId = this.getUserId(user);
    const where = { citizenId: userId };

    const [
      total,
      pending,
      assigned,
      inProgress,
      completed,
      closed,
      rejectedAssignments,
      citizenRejectedCompletions,
      organizationMetrics,
    ] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.PENDING },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.ASSIGNED },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.IN_PROGRESS },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.COMPLETED_BY_PROVIDER },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.CLOSED },
      }),
      this.prisma.report.count({
        where: { ...where, lastAssignmentOutcome: AssignmentOutcome.REJECTED },
      }),
      this.prisma.report.count({
        where: { ...where, completionRejectionReason: { not: null } },
      }),
      this.getDashboardOrganizationMetrics(user),
    ]);

    return {
      total,
      pending,
      assigned,
      inProgress,
      completed,
      closed,
      rejectedAssignments,
      citizenRejectedCompletions,
      organizations: organizationMetrics,
    };
  }

  // ===================== PROVIDER =====================

  async getAssignedReports(user: JwtUser) {
    const userId = this.getUserId(user);

    if (!this.isProvider(user)) {
      throw new ForbiddenException('Only providers allowed');
    }

    await this.expireOverdueAssignments({ providerId: userId });

    const reports = await this.prisma.report.findMany({
      where: {
        assignedProviderId: userId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: this.includeRelations(),
    });
    return reports.map((report) => this.withProtectedEvidenceUrls(report));
  }

  // ===================== ORGANIZATION =====================

  async getOrganizationReports(user: JwtUser) {
    const where = this.buildOrgScope(user);
    await this.expireOverdueAssignments({
      organizationId: this.isSuperAdmin(user)
        ? undefined
        : this.requireUserOrganizationId(user),
    });

    const reports = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: this.includeRelations(),
    });
    return reports.map((report) => this.withProtectedEvidenceUrls(report));
  }

  async getResponsibilityReviewReports(
    user: JwtUser,
    query?: { limit?: string; offset?: string },
  ) {
    const organizationId = this.requireUserOrganizationId(user);
    if (!this.isAdmin(user) && !this.isDispatch(user)) {
      throw new ForbiddenException('Organization review access required');
    }
    const take = this.safePageLimit(query?.limit, 50);
    const skip = this.safePageOffset(query?.offset);

    const reports = await this.prisma.report.findMany({
      where: {
        OR: [
          {
            assignedOrganizationId: organizationId,
            status: ReportStatus.ORG_REVIEW,
          },
          {
            organizationId,
            assignedOrganizationId: null,
            assignedProviderId: null,
            status: ReportStatus.TRIAGE,
            AND: [
              {
                OR: [
                  { lastAssignmentOutcome: null },
                  {
                    lastAssignmentOutcome: { not: AssignmentOutcome.REJECTED },
                  },
                ],
              },
              {
                OR: [
                  { organizationAssignmentSource: null },
                  {
                    organizationAssignmentSource: {
                      not: ORGANIZATION_REJECTED_SOURCE,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      orderBy: [
        { organizationAssignedAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: Math.min(skip + take + 50, 200),
      include: this.includeRelations(),
    });

    const detailed = await Promise.all(
      reports.map((report) => this.withEnterpriseReportDetails(report)),
    );
    return detailed
      .filter((report) => report.queueOrganizationId === organizationId)
      .filter((report) => report.eligibleForResponsibilityReview)
      .slice(skip, skip + take);
  }

  async getResponsibilityDiagnostics(reportId: string, user: JwtUser) {
    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException('Super Admin access required');
    }
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');

    const timeline = await this.reportActivityTimeline(reportId);
    const responsibilityResolution =
      this.responsibilityResolutionFromActivity(timeline);
    const latestResponsibilityActivity =
      this.latestResponsibilityActivity(timeline);
    const queueState = this.responsibilityQueueState(
      report,
      responsibilityResolution,
    );
    const normalizedCategory = report.category?.trim()
      ? this.normalizeResponsibilityCategory(report.category)
      : null;

    return {
      reportId: report.id,
      status: report.status,
      organizationId: report.organizationId,
      assignedOrganizationId: report.assignedOrganizationId,
      category: report.category,
      normalizedCategory,
      locationName: report.locationName ?? report.location ?? null,
      latitude: report.latitude ?? null,
      longitude: report.longitude ?? null,
      locationSource: report.locationSource ?? null,
      resolverOutcome: responsibilityResolution?.outcome ?? null,
      resolverReasonCode: responsibilityResolution?.reasonCode ?? null,
      candidateCount: responsibilityResolution?.candidateCount ?? null,
      eligibleCandidateCount:
        responsibilityResolution?.eligibleCandidateCount ?? null,
      proposedOrganizationId:
        responsibilityResolution?.proposedOrganizationId ??
        report.assignedOrganizationId,
      evaluatedAt: responsibilityResolution?.evaluatedAt ?? null,
      latestResponsibilityActivity,
      eligibleForResponsibilityReview:
        queueState.eligibleForResponsibilityReview,
      eligibilityReason: queueState.eligibilityReason,
      queueOrganizationId: queueState.queueOrganizationId,
      dispatchAllowed: queueState.dispatchAllowed,
      manualOverrideOccurred: queueState.manualOverrideOccurred,
      diagnosticsAvailable: responsibilityResolution !== null,
    };
  }

  // ===================== SINGLE REPORT =====================

  async getReportById(reportId: string, user: JwtUser) {
    const userId = this.getUserId(user);

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });

    if (!report) throw new NotFoundException('Report not found');

    if (this.isSuperAdmin(user))
      return this.withEnterpriseReportDetails(report);

    const sameOrg =
      user.organizationId && report.organizationId === user.organizationId;
    const assignedReviewOrg =
      user.organizationId &&
      report.assignedOrganizationId === user.organizationId &&
      report.status === ReportStatus.ORG_REVIEW;

    if (report.citizenId === userId) {
      return this.withEnterpriseReportDetails(report);
    }

    if (report.assignedProviderId === userId && this.isProvider(user)) {
      return this.withEnterpriseReportDetails(report);
    }

    if (
      (this.isAdmin(user) || this.isDispatch(user)) &&
      (sameOrg || assignedReviewOrg) &&
      report.status !== ReportStatus.TRIAGE
    ) {
      return this.withEnterpriseReportDetails(report);
    }

    throw new ForbiddenException('Access denied');
  }

  async getReportTimeline(reportId: string, user: JwtUser) {
    await this.getReportById(reportId, user);
    const activity =
      this.prismaDelegate<PrismaFindManyDelegate<OptionalReportActivityRecord>>(
        'reportActivity',
      );
    if (!activity) return [];
    return activity.findMany({
      where: { reportId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getReportMessages(reportId: string, user: JwtUser) {
    await this.getReportById(reportId, user);
    return this.prisma.reportMessage.findMany({
      where: { reportId },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        reportId: true,
        organizationId: true,
        authorId: true,
        authorRole: true,
        authorName: true,
        message: true,
        createdAt: true,
      },
    });
  }

  async createReportMessage(
    reportId: string,
    dto: { message?: unknown },
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);
    const text = typeof dto.message === 'string' ? dto.message.trim() : '';
    if (!text) throw new BadRequestException('Message is required');
    if (text.length > 1200) {
      throw new BadRequestException('Message must be 1200 characters or less');
    }
    const report = await this.getReportById(reportId, user);
    if (report.status === ReportStatus.CLOSED) {
      throw new ForbiddenException('Discussion is read-only for this report');
    }
    // eslint-disable-next-line no-control-regex
    const safeMessage = text.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    const message = await this.prisma.reportMessage.create({
      data: {
        reportId,
        organizationId: report.organizationId,
        authorId: userId,
        authorRole: user.role,
        authorName: user.fullName ?? null,
        message: safeMessage,
      },
      select: {
        id: true,
        reportId: true,
        organizationId: true,
        authorId: true,
        authorRole: true,
        authorName: true,
        message: true,
        createdAt: true,
      },
    });
    await this.recordReportActivity(
      reportId,
      'REPORT_DISCUSSION_MESSAGE',
      user,
      {
        organizationId: report.organizationId,
        note: safeMessage.slice(0, 240),
        metadata: { messageId: message.id },
      },
    );
    await this.notifyReportMessageParticipants(report, userId, safeMessage);
    return message;
  }

  // ===================== ASSIGN =====================

  async assignProvider(
    reportId: string,
    dto: AssignProviderDto,
    user: JwtUser,
  ) {
    return this.assignProviderById(reportId, dto.providerId, user, dto);
  }

  async openEvidenceFile(
    reportId: string,
    kind: EvidenceKind,
    fileName: string,
    user: JwtUser,
  ) {
    this.assertSafeEvidenceFileName(fileName);
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        organizationId: true,
        assignedOrganizationId: true,
        citizenId: true,
        assignedProviderId: true,
        lastAssignmentProviderId: true,
        status: true,
        evidenceImageUrl: true,
        evidenceImagePath: true,
        completionImageUrl: true,
        completionImagePath: true,
      },
    });

    if (!report) throw new NotFoundException('Evidence not found');
    await this.assertCanAccessEvidence(report, kind, user);

    const expectedPath = posix.join(kind, reportId, fileName);

    const evidencePathAllowed = await this.reportHasEvidencePath(
      report,
      kind,
      expectedPath,
    );
    if (!evidencePathAllowed) {
      throw new NotFoundException('Evidence not found');
    }

    const root = uploadRoot();
    const absolutePath = resolve(root, kind, reportId, fileName);
    this.assertInsideUploadRoot(root, absolutePath);

    try {
      await access(absolutePath);
    } catch {
      throw new NotFoundException('Evidence not found');
    }

    return {
      stream: createReadStream(absolutePath),
      fileName,
      contentType: this.contentTypeForEvidenceFile(fileName),
    };
  }

  private async reportHasEvidencePath(
    report: Pick<
      ReportWithEvidence,
      | 'id'
      | 'evidenceImageUrl'
      | 'evidenceImagePath'
      | 'completionImageUrl'
      | 'completionImagePath'
    >,
    kind: EvidenceKind,
    expectedPath: string,
  ) {
    const scalarPath =
      kind === 'report-evidence'
        ? (this.extractLocalUploadPath(report.evidenceImagePath) ??
          this.extractLocalUploadPath(report.evidenceImageUrl))
        : (this.extractLocalUploadPath(report.completionImagePath) ??
          this.extractLocalUploadPath(report.completionImageUrl));
    if (scalarPath === expectedPath) return true;

    const evidenceRecord =
      this.prismaDelegate<PrismaFindManyDelegate<OptionalEvidenceRecord>>(
        'evidenceRecord',
      );
    if (!evidenceRecord) return false;

    const records = await evidenceRecord.findMany({
      where: {
        relatedEntityType: EvidenceRelatedEntityType.REPORT,
        relatedEntityId: report.id,
      },
      select: {
        id: true,
        fileUrl: true,
        metadata: true,
      },
    });

    return records.some((record) => {
      const metadata =
        record.metadata &&
        typeof record.metadata === 'object' &&
        !Array.isArray(record.metadata)
          ? (record.metadata as Record<string, unknown>)
          : {};
      const recordKind =
        metadata.kind === 'report-completion'
          ? 'report-completion'
          : 'report-evidence';
      if (recordKind !== kind) return false;

      const metadataPath =
        typeof metadata.imagePath === 'string' ? metadata.imagePath : null;
      const recordPath =
        this.extractLocalUploadPath(metadataPath) ??
        this.extractLocalUploadPath(record.fileUrl);
      return recordPath === expectedPath;
    });
  }

  async getAssignmentCandidates(reportId: string, user: JwtUser) {
    if (
      !this.isAdmin(user) &&
      !this.isDispatch(user) &&
      !this.isSuperAdmin(user)
    ) {
      throw new ForbiddenException('Not allowed');
    }
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');
    if (
      !this.isSuperAdmin(user) &&
      report.organizationId !== user.organizationId &&
      report.assignedOrganizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Cross-org not allowed');
    }

    const scopedOrganizationWhere = this.isSuperAdmin(user)
      ? { status: { not: OrganizationStatus.ARCHIVED } }
      : { id: user.organizationId ?? '' };
    const [providers, organizations] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          role: UserRole.PROVIDER,
          accountStatus: 'ACTIVE',
          OR: [
            { organizationId: report.organizationId },
            {
              providerOrganizations: {
                some: { organizationId: report.organizationId, active: true },
              },
            },
          ],
        },
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          fullName: true,
          providerId: true,
          serviceCategories: true,
          coverageAreas: true,
          organizationId: true,
          accountStatus: true,
          assignedReports: {
            where: {
              status: {
                in: [ReportStatus.ASSIGNED, ReportStatus.IN_PROGRESS],
              },
            },
            select: { id: true },
          },
          providerOrganizations: {
            where: { organizationId: report.organizationId, active: true },
            select: { organizationId: true, active: true, isPrimary: true },
          },
        },
      }),
      this.prisma.organization.findMany({
        where: scopedOrganizationWhere,
        orderBy: { name: 'asc' },
        include: {
          providerLinks: {
            where: { active: true },
            include: {
              provider: {
                select: {
                  id: true,
                  accountStatus: true,
                  serviceCategories: true,
                  coverageAreas: true,
                  profileData: true,
                },
              },
            },
          },
          users: {
            where: { role: UserRole.PROVIDER, accountStatus: 'ACTIVE' },
            select: {
              id: true,
              accountStatus: true,
              serviceCategories: true,
              coverageAreas: true,
              profileData: true,
            },
          },
        },
      }),
    ]);

    const organizationCandidates = organizations.map((organization) =>
      this.serializeOrganizationCandidate(
        organization,
        report.category,
        report,
      ),
    );

    return {
      reportId,
      reportCategory: report.category,
      assignedOrganization: report.assignedOrganization ?? null,
      assignedProvider: report.assignedProvider ?? null,
      routing: this.routingDiagnostics(report, organizationCandidates),
      providers: providers.map((provider) => ({
        type: 'PROVIDER',
        id: provider.id,
        providerId: provider.id,
        name: provider.fullName,
        providerName: provider.fullName,
        externalProviderId: provider.providerId,
        eligible: this.providerMatchesCategory(provider, report.category),
        isAvailable: provider.assignedReports.length < 5,
        activeJobs: provider.assignedReports.length,
        maxActiveJobs: 5,
        rating: null,
        confidence: this.providerMatchesCategory(provider, report.category)
          ? 100
          : 60,
        confidenceLabel:
          provider.providerOrganizations.length > 0
            ? 'Active organization membership'
            : 'Primary organization provider',
        serviceCategories: this.jsonStringList(provider.serviceCategories),
        specialties: this.jsonStringList(provider.serviceCategories),
        coverageAreas: this.jsonStringList(provider.coverageAreas),
        reasons: [
          provider.providerOrganizations.length > 0
            ? 'Active accepted organization membership'
            : 'Primary provider account in this organization',
          provider.assignedReports.length === 0
            ? 'No active assignments'
            : `${provider.assignedReports.length} active assignment(s)`,
        ],
      })),
      organizations: organizationCandidates,
    };
  }

  async assignOrganization(
    reportId: string,
    dto: AssignOrganizationDto,
    user: JwtUser,
  ) {
    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException(
        'Only Super Admin can manually route organization responsibility',
      );
    }
    const actorId = user.id ?? user.userId ?? user.sub;
    if (!actorId) throw new ForbiddenException('Actor missing');
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');
    const currentStatus = normalizeReportStatus(report.status);
    const routableStatuses: ReportStatus[] = [
      ReportStatus.PENDING,
      ReportStatus.TRIAGE,
    ];
    if (!routableStatuses.includes(currentStatus as ReportStatus)) {
      throw new ForbiddenException(
        'Report cannot be assigned in its current status',
      );
    }
    if (report.assignedProviderId) {
      throw new ForbiddenException('Report already has an assigned provider');
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
      include: {
        providerLinks: {
          where: { active: true },
          include: {
            provider: {
              select: {
                id: true,
                accountStatus: true,
                serviceCategories: true,
                coverageAreas: true,
                profileData: true,
              },
            },
          },
        },
        users: {
          where: { role: UserRole.PROVIDER, accountStatus: 'ACTIVE' },
          select: {
            id: true,
            accountStatus: true,
            serviceCategories: true,
            coverageAreas: true,
            profileData: true,
          },
        },
      },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    const jurisdictionZones = await this.prisma.jurisdictionZone.findMany({
      where: { organizationId: organization.id, active: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const candidate = this.serializeOrganizationCandidate(
      {
        ...organization,
        jurisdictionZones,
      },
      report.category,
      report,
    );
    const overrideReadiness = dto.overrideReadiness === true;
    const establishOwnership =
      this.isSuperAdmin(user) && dto.establishAuthoritativeOwnership === true;
    if (
      !candidate.eligible &&
      !(this.isSuperAdmin(user) && (overrideReadiness || establishOwnership))
    ) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_NOT_READY',
        message: 'Organization is not eligible for this assignment.',
        reasons: candidate.reasons,
      });
    }

    const routeReason = dto.reason?.trim() || 'Manual organization assignment';
    if (this.isSuperAdmin(user) && !dto.reason?.trim()) {
      throw new BadRequestException('Manual routing reason is required');
    }
    if (establishOwnership) {
      if (organization.status !== OrganizationStatus.ACTIVE) {
        throw new ForbiddenException('Organization is not active');
      }
      if (!this.maintenanceModuleEnabled(organization.enabledModules)) {
        throw new ForbiddenException(
          'Maintenance Services is not enabled for this organization.',
        );
      }
    }
    const routeSource = overrideReadiness
      ? `Super Admin override: ${routeReason}`
      : routeReason;
    const updated = await this.prisma.$transaction(async (tx) => {
      const routed = await tx.report.update({
        where: { id: reportId },
        data: {
          organizationId: establishOwnership
            ? organization.id
            : report.organizationId,
          assignedOrganizationId: organization.id,
          organizationAssignedById: actorId,
          organizationAssignedAt: new Date(),
          organizationAssignmentSource: routeSource,
          status: establishOwnership
            ? ReportStatus.PENDING
            : ReportStatus.ORG_REVIEW,
          lastAssignmentOutcome: null,
          lastAssignmentReason: null,
          lastAssignmentAt: new Date(),
          lastAssignmentProviderId: null,
        } satisfies Prisma.ReportUncheckedUpdateInput,
        include: this.includeRelations(),
      });

      const audit = this.prismaDelegateFrom<PrismaCreateDelegate>(
        tx,
        'demoAuditLog',
      );
      if (audit) {
        await audit.create({
          data: {
            action: 'Report Assigned To Organization',
            actorUserId: actorId,
            metadata: {
              targetType: 'Report',
              targetId: reportId,
              previousOrganizationId: report.organizationId,
              assignedOrganizationId: organization.id,
              organizationId: routed.organizationId,
              reason: dto.reason?.trim() || null,
              overrideReadiness,
              authoritativeOwnershipEstablished: establishOwnership,
              readinessReasons: candidate.reasons,
              readinessSummary: candidate.readiness,
            },
          },
        });
      }

      const activity = this.prismaDelegateFrom<PrismaCreateDelegate>(
        tx,
        'reportActivity',
      );
      if (activity) {
        await activity.create({
          data: {
            reportId,
            organizationId: routed.organizationId,
            actorUserId: actorId,
            actorRole: user.role ?? null,
            actorName: user.fullName ?? user.email ?? null,
            action: 'ORGANIZATION_ASSIGNED',
            fromStatus: report.status,
            toStatus: routed.status,
            reason: dto.reason?.trim() || null,
            metadata: {
              previousOrganizationId: report.organizationId,
              assignedOrganizationId: organization.id,
              assignedOrganizationName: organization.name,
              overrideReadiness,
              authoritativeOwnershipEstablished: establishOwnership,
              readinessReasons: candidate.reasons,
              readinessSummary: candidate.readiness,
            },
          },
        });
      }

      return routed;
    });
    await this.notifyOrganizationOperators(organization.id, {
      reportId,
      type: establishOwnership
        ? 'organization_manual_override'
        : 'organization_assignment',
      title: establishOwnership
        ? 'Report ownership assigned by platform'
        : 'Report assigned for responsibility review',
      message: establishOwnership
        ? `"${updated.title}" was assigned to ${organization.name} by platform override.`
        : `"${updated.title}" is awaiting your organization's responsibility review.`,
    });
    await this.createNotification({
      userId: updated.citizenId,
      reportId,
      type: establishOwnership
        ? 'organization_manual_override'
        : 'organization_responsibility_review',
      title: 'Report routing update',
      message: establishOwnership
        ? `"${updated.title}" has been routed to the responsible organization.`
        : `"${updated.title}" is being reviewed by a responsible organization.`,
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async acceptOrganizationReport(
    reportId: string,
    dto: OrganizationAcceptReportDto,
    user: JwtUser,
  ) {
    const organizationId = this.requireUserOrganizationId(user);
    if (!this.isAdmin(user) && !this.isDispatch(user)) {
      throw new ForbiddenException(
        'Only organization operators can accept reports',
      );
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');
    const timeline = await this.reportActivityTimeline(reportId);
    const responsibilityResolution =
      this.responsibilityResolutionFromActivity(timeline);
    const legacyMatchedReview = this.isLegacyMatchedResponsibilityReview(
      report,
      organizationId,
      responsibilityResolution,
    );
    if (
      report.assignedOrganizationId !== organizationId &&
      !legacyMatchedReview
    ) {
      throw new ForbiddenException('Report is not routed to your organization');
    }
    if (
      report.status === ReportStatus.PENDING &&
      report.organizationId === organizationId
    ) {
      return this.withProtectedEvidenceUrls(report);
    }
    if (report.status !== ReportStatus.ORG_REVIEW && !legacyMatchedReview) {
      throw new ConflictException(
        'Report is not awaiting organization decision',
      );
    }

    const note = dto.note?.trim();
    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.PENDING,
        organizationId,
        assignedOrganizationId: report.assignedOrganizationId ?? organizationId,
        organizationAssignedAt: report.organizationAssignedAt ?? new Date(),
        organizationAssignmentSource: ORGANIZATION_ACCEPTED_SOURCE,
        lastAssignmentOutcome: null,
        lastAssignmentReason: null,
        lastAssignmentAt: new Date(),
      } satisfies Prisma.ReportUncheckedUpdateInput,
      include: this.includeRelations(),
    });

    await this.audit('Organization Report Accepted', user, {
      targetType: 'Report',
      targetId: reportId,
      organizationId,
      previousStatus: report.status,
      note: note ?? null,
    });
    await this.recordReportActivity(
      reportId,
      'ORGANIZATION_ACCEPTED_REPORT',
      user,
      {
        organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        note: note || undefined,
        metadata: {
          assignedOrganizationId: updated.assignedOrganizationId,
          previousOrganizationId: report.organizationId,
          authoritativeOrganizationId: organizationId,
          previousStatus: report.status,
        },
      },
    );
    await this.createNotification({
      userId: updated.citizenId,
      reportId,
      type: 'organization_report_accepted',
      title: 'Report accepted for dispatch',
      message: `"${updated.title}" was accepted by the responsible organization and is awaiting provider assignment.`,
    });
    await this.notifyOrganizationOperators(organizationId, {
      reportId,
      type: 'organization_report_accepted',
      title: 'Report accepted',
      message: `"${updated.title}" is now in your dispatch queue.`,
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async rejectOrganizationReport(
    reportId: string,
    dto: OrganizationRejectReportDto,
    user: JwtUser,
  ) {
    const organizationId = this.requireUserOrganizationId(user);
    if (!this.isAdmin(user) && !this.isDispatch(user)) {
      throw new ForbiddenException(
        'Only organization operators can reject reports',
      );
    }
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('Rejection reason is required');

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');
    const timeline = await this.reportActivityTimeline(reportId);
    const responsibilityResolution =
      this.responsibilityResolutionFromActivity(timeline);
    const legacyMatchedReview = this.isLegacyMatchedResponsibilityReview(
      report,
      organizationId,
      responsibilityResolution,
    );
    if (
      report.assignedOrganizationId !== organizationId &&
      !legacyMatchedReview
    ) {
      throw new ForbiddenException('Report is not routed to your organization');
    }
    if (report.status === ReportStatus.TRIAGE && !legacyMatchedReview) {
      return this.withProtectedEvidenceUrls(report);
    }
    if (report.status !== ReportStatus.ORG_REVIEW && !legacyMatchedReview) {
      throw new ConflictException(
        'Report is not awaiting organization decision',
      );
    }

    let suggestedOrganization: { id: string; name: string } | null = null;
    const suggestedOrganizationId = dto.suggestedOrganizationId?.trim();
    if (suggestedOrganizationId) {
      suggestedOrganization = await this.prisma.organization.findUnique({
        where: { id: suggestedOrganizationId },
        select: { id: true, name: true },
      });
      if (!suggestedOrganization) {
        throw new BadRequestException('Suggested organization was not found');
      }
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.TRIAGE,
        organizationId: report.organizationId,
        assignedOrganizationId: null,
        organizationAssignedById: null,
        organizationAssignedAt: null,
        organizationAssignmentSource: ORGANIZATION_REJECTED_SOURCE,
        assignedProviderId: null,
        assignedAt: null,
        assignmentDeadlineAt: null,
        lastAssignmentOutcome: AssignmentOutcome.REJECTED,
        lastAssignmentReason: reason,
        lastAssignmentAt: new Date(),
      } satisfies Prisma.ReportUncheckedUpdateInput,
      include: this.includeRelations(),
    });

    await this.audit('Organization Report Rejected', user, {
      targetType: 'Report',
      targetId: reportId,
      organizationId,
      previousStatus: report.status,
      reason,
      suggestedOrganizationId: suggestedOrganization?.id ?? null,
    });
    await this.recordReportActivity(
      reportId,
      'ORGANIZATION_REJECTED_REPORT',
      user,
      {
        organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        reason,
        metadata: {
          returnedToSuperAdminTriage: true,
          previousAssignedOrganizationId: organizationId,
          suggestedOrganizationId: suggestedOrganization?.id ?? null,
          suggestedOrganizationName: suggestedOrganization?.name ?? null,
        },
      },
    );
    await this.notifyPlatformResolvers({
      reportId,
      type: 'organization_report_rejected',
      title: 'Organization rejected responsibility',
      message: `"${updated.title}" was returned to platform responsibility resolution.`,
    });
    await this.createNotification({
      userId: updated.citizenId,
      reportId,
      type: 'organization_report_rejected',
      title: 'Report returned for platform review',
      message: `"${updated.title}" was returned for SecureZone platform triage.`,
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async processOverdueAssignments(user: JwtUser) {
    if (
      !this.isAdmin(user) &&
      !this.isDispatch(user) &&
      !this.isSuperAdmin(user)
    ) {
      throw new ForbiddenException('Not allowed');
    }
    const result = await this.expireOverdueAssignments({
      organizationId: this.isSuperAdmin(user)
        ? undefined
        : (user.organizationId ?? undefined),
      actor: user,
    });
    return {
      expired: result.length,
      reports: result,
      timeoutMinutes: this.assignmentTimeoutMinutes,
    };
  }

  async cancelAssignment(
    reportId: string,
    reason: string | undefined,
    user: JwtUser,
  ) {
    if (
      !this.isAdmin(user) &&
      !this.isDispatch(user) &&
      !this.isSuperAdmin(user)
    ) {
      throw new ForbiddenException('Not allowed');
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (
      !this.isSuperAdmin(user) &&
      report.organizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Wrong org');
    }
    if (!report.assignedProviderId || report.status === ReportStatus.PENDING) {
      throw new ForbiddenException('Report has no active assignment');
    }

    const previousProviderId = report.assignedProviderId;
    const cleanReason =
      reason?.trim() || 'Assignment cancelled by administrator';
    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.PENDING,
        assignedProviderId: null,
        assignedAt: null,
        assignmentDeadlineAt: null,
        lastAssignmentOutcome: AssignmentOutcome.REJECTED,
        lastAssignmentReason: cleanReason,
        lastAssignmentAt: new Date(),
        lastAssignmentProviderId: previousProviderId,
      },
      include: this.includeRelations(),
    });

    await this.audit('Assignment Cancelled', user, {
      targetType: 'Report',
      targetId: reportId,
      reason: cleanReason,
      previousProviderId,
      organizationId: updated.organizationId,
    });
    await this.recordReportActivity(reportId, 'ASSIGNMENT_CANCELLED', user, {
      organizationId: updated.organizationId,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId: previousProviderId,
      reason: cleanReason,
      metadata: { returnedToDispatchQueue: true },
    });
    await this.createNotification({
      userId: previousProviderId,
      reportId,
      type: 'assignment_cancelled',
      title: 'Assignment cancelled',
      message: `Your assignment for "${updated.title}" was cancelled. Reason: ${cleanReason}`,
    });
    await this.notifyOrganizationOperators(updated.organizationId, {
      reportId,
      type: 'assignment_cancelled',
      title: 'Assignment returned to dispatch',
      message: `"${updated.title}" was returned to the dispatch queue.`,
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async reassignProvider(
    reportId: string,
    providerId: string,
    reason: string | undefined,
    user: JwtUser,
  ) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');

    const previousProviderId = report.assignedProviderId;
    if (previousProviderId) {
      await this.cancelAssignment(
        reportId,
        reason?.trim() || 'Reassigned by administrator',
        user,
      );
    }
    const updated = await this.assignProviderById(reportId, providerId, user);
    await this.audit('Report Reassigned', user, {
      targetType: 'Report',
      targetId: reportId,
      previousProviderId,
      newProviderId: providerId,
      reason: reason?.trim() || null,
      organizationId: updated.organizationId,
    });
    await this.recordReportActivity(reportId, 'PROVIDER_REASSIGNED', user, {
      organizationId: updated.organizationId,
      fromStatus: ReportStatus.PENDING,
      toStatus: updated.status,
      providerId,
      reason: reason?.trim() || undefined,
      metadata: { previousProviderId },
    });
    if (previousProviderId) {
      await this.createNotification({
        userId: previousProviderId,
        reportId,
        type: 'assignment_reassigned',
        title: 'Assignment reassigned',
        message: `"${updated.title}" was reassigned to another provider.`,
      });
    }
    await this.createNotification({
      userId: providerId,
      reportId,
      type: 'assignment',
      title: 'New assignment',
      message: `You have been assigned "${updated.title}".`,
    });
    return updated;
  }

  async assignProviderById(
    reportId: string,
    providerId: string,
    user: JwtUser,
    options: Pick<
      AssignProviderDto,
      'overrideOrganizationRouting' | 'overrideReason'
    > = {},
  ) {
    if (
      !this.isAdmin(user) &&
      !this.isDispatch(user) &&
      !this.isSuperAdmin(user)
    ) {
      throw new ForbiddenException('Not allowed');
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) throw new NotFoundException('Report not found');

    const provider = await this.prisma.user.findUnique({
      where: { id: providerId },
      include: { providerOrganizations: true },
    });

    if (!provider || provider.role !== UserRole.PROVIDER) {
      throw new ForbiddenException('Invalid provider');
    }
    if (provider.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('Provider account is not active');
    }

    const providerLinkedToReportOrg = provider.providerOrganizations.some(
      (link) => link.organizationId === report.organizationId && link.active,
    );
    const providerPrimaryInReportOrg =
      provider.organizationId === report.organizationId;
    const providerBelongsToReportOrg =
      providerPrimaryInReportOrg || providerLinkedToReportOrg;
    const requiresSuperAdminOverride =
      this.isSuperAdmin(user) && !providerBelongsToReportOrg;
    const overrideReason = options.overrideReason?.trim();
    if (requiresSuperAdminOverride) {
      if (!options.overrideOrganizationRouting || !overrideReason) {
        throw new ForbiddenException({
          code: 'ORGANIZATION_ROUTING_OVERRIDE_REQUIRED',
          message:
            'Direct provider assignment bypasses the owning organization and requires an override reason.',
        });
      }
    }

    this.assertAssignmentAllowed(
      report,
      provider.organizationId,
      providerLinkedToReportOrg,
      user,
      providerId,
    );

    if (!this.isSuperAdmin(user) && !providerBelongsToReportOrg) {
      throw new ForbiddenException(
        'Provider must have active membership in the report organization',
      );
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        assignedProviderId: providerId,
        status: ReportStatus.ASSIGNED,
        assignedAt: new Date(),
        assignmentDeadlineAt: new Date(
          Date.now() + this.assignmentTimeoutMinutes * 60 * 1000,
        ),
        lastAssignmentOutcome: null,
        lastAssignmentReason: null,
        lastAssignmentAt: null,
        lastAssignmentProviderId: null,
      },
      include: this.includeRelations(),
    });

    await this.notifyStatusChange(updated);
    await this.notifyOrganizationOperators(updated.organizationId, {
      reportId,
      type: 'assignment',
      title: 'Provider assigned',
      message: `A provider was assigned to "${updated.title}".`,
    });
    await this.createNotification({
      userId: providerId,
      reportId,
      type: 'assignment',
      title: 'New assignment',
      message: `You have been assigned "${updated.title}". Accept before ${
        updated.assignmentDeadlineAt?.toISOString() ??
        'the timeout window expires'
      }.`,
    });
    await this.audit('Report Assigned', user, {
      targetType: 'Report',
      targetId: reportId,
      providerId,
      organizationId: updated.organizationId,
      override: requiresSuperAdminOverride,
      overrideReason: overrideReason ?? null,
    });
    await this.recordReportActivity(reportId, 'PROVIDER_ASSIGNED', user, {
      organizationId: updated.organizationId,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId,
      reason: overrideReason,
      metadata: {
        override: requiresSuperAdminOverride,
        assignmentDeadlineAt: updated.assignmentDeadlineAt,
        previousProviderId: report.assignedProviderId,
        actorRole: user.role,
      },
    });
    return updated;
  }

  // ===================== STATUS =====================

  async rejectAssignment(
    reportId: string,
    dto: RejectAssignmentDto,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);
    const reason = dto.reason.trim();

    if (!this.isProvider(user)) {
      throw new ForbiddenException('Only providers can reject assignments');
    }
    await this.assertActiveProvider(userId);

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) throw new NotFoundException('Report not found');
    if (report.assignedProviderId !== userId) {
      throw new ForbiddenException('Not your report');
    }
    await this.assertProviderCanAccessReport(
      user,
      report.organizationId,
      report.assignedProviderId,
    );
    await this.assertAssignmentStillAcceptable(report, user, userId);
    if (report.status !== ReportStatus.ASSIGNED) {
      throw new ForbiddenException('Only new assignments can be rejected');
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.PENDING,
        assignedProviderId: null,
        assignedAt: null,
        assignmentDeadlineAt: null,
        lastAssignmentOutcome: AssignmentOutcome.REJECTED,
        lastAssignmentReason: reason,
        lastAssignmentAt: new Date(),
        lastAssignmentProviderId: userId,
      },
      include: this.includeRelations(),
    });
    await this.audit('Provider Rejected Assignment', user, {
      targetType: 'Report',
      targetId: reportId,
      reason,
    });
    await this.recordReportActivity(reportId, 'PROVIDER_REJECTED', user, {
      organizationId: updated.organizationId,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId: userId,
      reason,
      metadata: { returnedToQueue: true },
    });
    await this.notifyOrganizationOperators(updated.organizationId, {
      reportId,
      type: 'assignment_rejected',
      title: 'Assignment rejected',
      message: `Provider rejected "${updated.title}". Reason: ${reason}`,
    });
    return updated;
  }

  async updateStatus(
    reportId: string,
    dto: UpdateReportStatusDto,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { organization: true },
    });

    if (!report) throw new NotFoundException('Report not found');
    if (this.isProvider(user)) await this.assertActiveProvider(userId);
    if (this.isProvider(user)) {
      await this.assertProviderCanAccessReport(
        user,
        report.organizationId,
        report.assignedProviderId,
      );
    }
    if (
      this.isProvider(user) &&
      report.status === ReportStatus.ASSIGNED &&
      dto.status === ReportStatus.IN_PROGRESS
    ) {
      await this.assertAssignmentStillAcceptable(report, user, userId);
    }
    if (
      this.isProvider(user) &&
      dto.status === ReportStatus.IN_PROGRESS &&
      this.trustService
    ) {
      await this.trustService.assertProviderJobAcceptanceAllowed({
        id: userId,
        role: user.role,
        organizationId: user.organizationId,
        email: user.email,
        fullName: user.fullName,
      });
    }

    this.assertStatusTransitionAllowed(report, dto.status, user, userId);

    const data: Prisma.ReportUpdateInput = { status: dto.status };

    if (dto.status === ReportStatus.COMPLETED_BY_PROVIDER) {
      const completionEvidence = this.normalizeCompletionEvidenceFields({
        imageUrl: dto.completionImageUrl,
        imagePath: dto.completionImagePath,
      });
      const hasCompletionEvidence =
        Boolean(completionEvidence.imagePath || completionEvidence.imageUrl) ||
        (await this.prisma.evidenceRecord.count({
          where: {
            relatedEntityType: EvidenceRelatedEntityType.REPORT,
            relatedEntityId: reportId,
            fileUrl: { contains: 'report-completion' },
          },
        })) > 0;
      if (!hasCompletionEvidence) {
        throw new BadRequestException({
          code: 'COMPLETION_EVIDENCE_REQUIRED',
          message: 'Upload at least one completion evidence image.',
        });
      }
      const policy = await this.resolveCompletionPolicy(report);
      const reviewDeadline = this.reviewDeadlineFor(policy.policy);
      data.completionNote = dto.completionNote?.trim() || null;
      data.completionImageUrl = completionEvidence.imageUrl;
      data.completionImagePath = completionEvidence.imagePath;
      data.completionLatitude = dto.completionLatitude ?? null;
      data.completionLongitude = dto.completionLongitude ?? null;
      data.completionAccuracy = dto.completionAccuracy ?? null;
      data.completionLocationCapturedAt = dto.completionLocationCapturedAt
        ? new Date(dto.completionLocationCapturedAt)
        : null;
      data.completionLocationSource =
        dto.completionLocationSource ?? this.completionLocationSourceFor(dto);
      data.completedByProviderAt = new Date();
      data.completionPolicy = policy.policy;
      data.completionPolicySource = policy.source;
      data.completionReviewState = this.reviewStateFor({
        policy: policy.policy,
        citizenDecision: null,
        organizationDecision: null,
      });
      data.completionReviewDeadlineAt = reviewDeadline;
      data.completionReviewProcessedAt = null;
      data.completionFallbackRule = null;
      data.completionFinalActorType = null;
      data.citizenCompletionDecision = CompletionDecision.PENDING;
      data.citizenCompletionDecidedAt = null;
      data.organizationCompletionDecision = CompletionDecision.PENDING;
      data.organizationCompletionDecidedAt = null;
      data.organizationCompletionDecidedById = null;
      data.organizationCompletionReason = null;
      data.completionFinalizedAt = null;
      data.completionFinalizedById = null;
      data.completionFinalizedByRole = null;
      data.completionClosureReason = null;
      data.completionDisputeReason = null;
      data.completionRejectionReason = null;
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data,
      include: this.includeRelations(),
    });

    if (dto.status === ReportStatus.COMPLETED_BY_PROVIDER) {
      await this.notifyCompletionReviewers(updated);
      await this.workflowOrchestrator?.providerCompletedReport({
        reportId,
        organizationId: updated.organizationId,
        actorId: userId,
        actorRole: user.role,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? null,
        citizenId: updated.citizenId,
        metadata: {
          completionNote: dto.completionNote?.trim() || null,
          completionImagePath: updated.completionImagePath,
          completionLocation: this.completionLocationMetadata(updated),
        },
      });
    } else {
      await this.notifyStatusChange(updated);
    }
    await this.audit('Report Status Changed', user, {
      targetType: 'Report',
      targetId: reportId,
      status: dto.status,
      organizationId: updated.organizationId,
    });
    await this.recordReportActivity(
      reportId,
      this.activityActionForStatus(dto.status),
      user,
      {
        organizationId: updated.organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? undefined,
        note: dto.completionNote?.trim() || undefined,
        metadata: {
          completionImagePath: updated.completionImagePath ?? undefined,
          completionLocation: this.completionLocationMetadata(updated),
        },
      },
    );
    return this.withProtectedEvidenceUrls(updated);
  }

  async uploadCompletionEvidence(
    reportId: string,
    dto: UploadCompletionEvidenceDto,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);

    if (!this.isProvider(user)) {
      throw new ForbiddenException('Only providers allowed');
    }
    await this.assertActiveProvider(userId);

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) throw new NotFoundException('Report not found');
    if (report.assignedProviderId !== userId) {
      throw new ForbiddenException('Not your report');
    }
    await this.assertProviderCanAccessReport(
      user,
      report.organizationId,
      report.assignedProviderId,
    );

    if (report.status !== ReportStatus.IN_PROGRESS) {
      throw new ForbiddenException(
        'Only in-progress jobs can receive completion evidence',
      );
    }

    let images: ReturnType<ReportService['completionEvidencePayloads']>;
    try {
      images = this.completionEvidencePayloads(dto);
    } catch (error) {
      await this.recordGeoAudit(
        reportId,
        'COMPLETION_GEO_METADATA_REJECTED',
        user,
        {
          organizationId: report.organizationId,
          outcome: 'INVALID_METADATA',
          validationOutcome: 'INVALID_METADATA',
          reasons: this.geoRejectionReasons(error),
        },
      );
      throw error;
    }
    await this.assertEvidenceLimit(
      reportId,
      'report-completion',
      images.length,
    );

    const savedItems: SavedEvidenceFile[] = [];
    const unpersistedFiles = new Set<SavedEvidenceFile>();
    try {
      for (const [index, image] of images.entries()) {
        let geo: NormalizedGeoMetadata;
        try {
          geo = this.geoTrust().assessCompletion(
            (image.geoMetadata ?? {}) as GeoInput,
            {
              latitude: report.latitude,
              longitude: report.longitude,
              accuracyMeters: report.locationAccuracy,
            },
          );
        } catch (error) {
          await this.recordGeoAudit(
            reportId,
            'COMPLETION_GEO_METADATA_REJECTED',
            user,
            {
              organizationId: report.organizationId,
              outcome: 'INVALID_METADATA',
              validationOutcome: 'INVALID_METADATA',
              reasons: this.geoRejectionReasons(error),
            },
          );
          throw error;
        }
        const saved = await this.getUploadSecurity().saveBase64Image({
          imageBase64: image.imageBase64,
          contentType: image.contentType,
          folder: 'report-completion',
          reportId,
          invalidSizeMessage: 'Invalid completion image size',
        });
        unpersistedFiles.add(saved);

        await this.createEvidenceRecord({
          reportId,
          organizationId: report.organizationId,
          ownerUserId: report.citizenId,
          uploadedById: userId,
          fileUrl: saved.imageUrl,
          contentType: image.contentType,
          description: 'Provider completion evidence',
          metadata: {
            kind: 'report-completion',
            evidenceType: this.providerEvidenceType(image.classification),
            imagePath: saved.imagePath,
            classification: image.classification ?? 'after',
            order: image.order ?? index,
            sizeBytes: Buffer.from(image.imageBase64, 'base64').length,
            geoTrust: this.geoMetadataForStorage(geo),
          },
          geo,
        });
        unpersistedFiles.delete(saved);

        await this.recordGeoAudit(
          reportId,
          'COMPLETION_GEO_COMPARISON_COMPLETED',
          user,
          {
            organizationId: report.organizationId,
            evidencePath: saved.imagePath,
            outcome: geo.trustOutcome,
            validationOutcome: geo.validationOutcome,
            reasons: geo.validationReasons,
            warnings: geo.warnings,
            distanceMeters: geo.distanceMeters,
          },
        );
        if (geo.trustOutcome === 'REVIEW_RECOMMENDED') {
          await this.recordGeoAudit(
            reportId,
            'COMPLETION_GEO_REVIEW_RECOMMENDED',
            user,
            {
              organizationId: report.organizationId,
              evidencePath: saved.imagePath,
              reasons: geo.validationReasons,
              warnings: geo.warnings,
              distanceMeters: geo.distanceMeters,
            },
          );
        }

        savedItems.push({
          ...saved,
          geoTrust: this.evidenceGeoTrustPayload({
            geoLatitude: geo.latitude,
            geoLongitude: geo.longitude,
            geoAccuracyMeters: geo.accuracyMeters,
            geoCapturedAt: geo.capturedAt,
            geoReceivedAt: geo.receivedAt,
            geoSource: geo.source,
            geoCaptureMethod: geo.captureMethod,
            geoPermissionState: geo.permissionState,
            geoValidationOutcome: geo.validationOutcome,
            geoDistanceMeters: geo.distanceMeters,
            geoTrustOutcome: geo.trustOutcome,
            geoSchemaVersion: geo.schemaVersion,
            metadata: { geoTrust: this.geoMetadataForStorage(geo) },
          }),
        });
      }
    } catch (error) {
      await this.cleanupUnpersistedEvidenceFiles(unpersistedFiles);
      throw error;
    }

    const firstSaved = savedItems[0];
    if (
      firstSaved &&
      !report.completionImagePath &&
      !report.completionImageUrl
    ) {
      await this.prisma.report.update({
        where: { id: reportId },
        data: {
          completionImagePath: firstSaved.imagePath,
          completionImageUrl: firstSaved.imageUrl,
        },
      });
    }

    await this.audit('Provider Completion Evidence Uploaded', user, {
      targetType: 'Report',
      targetId: reportId,
      imagePaths: savedItems.map((item) => item.imagePath),
    });
    await this.recordReportActivity(
      reportId,
      'COMPLETION_EVIDENCE_UPLOADED',
      user,
      {
        organizationId: report.organizationId,
        fromStatus: report.status,
        toStatus: report.status,
        providerId: userId,
        metadata: {
          imagePaths: savedItems.map((item) => item.imagePath),
          imageUrls: savedItems.map((item) => item.imageUrl),
          count: savedItems.length,
        },
      },
    );

    return {
      completionImagePath: firstSaved?.imagePath ?? null,
      completionImageUrl: firstSaved
        ? (this.protectedEvidenceUrl(
            reportId,
            'report-completion',
            firstSaved.imagePath,
          ) ?? firstSaved.imageUrl)
        : null,
      evidenceItems: savedItems.map((item) => ({
        imagePath: item.imagePath,
        imageUrl:
          this.protectedEvidenceUrl(
            reportId,
            'report-completion',
            item.imagePath,
          ) ?? item.imageUrl,
        geoTrust: item.geoTrust,
      })),
    };
  }

  async uploadReportEvidence(
    reportId: string,
    dto: UploadReportEvidenceDto,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);

    if (user.role !== UserRole.CITIZEN) {
      throw new ForbiddenException('Only citizens can upload report evidence');
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) throw new NotFoundException('Report not found');

    if (report.citizenId !== userId) {
      throw new ForbiddenException('Not your report');
    }

    const images = this.reportEvidencePayloads(dto);
    await this.assertEvidenceLimit(reportId, 'report-evidence', images.length);

    const savedItems: SavedEvidenceFile[] = [];
    const unpersistedFiles = new Set<SavedEvidenceFile>();
    try {
      for (const [index, image] of images.entries()) {
        const saved = await this.getUploadSecurity().saveBase64Image({
          imageBase64: image.imageBase64,
          contentType: image.contentType,
          folder: 'report-evidence',
          reportId,
          invalidSizeMessage: 'Invalid report image size',
        });
        unpersistedFiles.add(saved);

        await this.createEvidenceRecord({
          reportId,
          organizationId: report.organizationId,
          ownerUserId: userId,
          uploadedById: userId,
          fileUrl: saved.imageUrl,
          contentType: image.contentType,
          description: 'Citizen report evidence',
          metadata: {
            kind: 'report-evidence',
            evidenceType: 'CITIZEN_REPORT',
            imagePath: saved.imagePath,
            order: image.order ?? index,
            sizeBytes: Buffer.from(image.imageBase64, 'base64').length,
          },
        });
        unpersistedFiles.delete(saved);

        savedItems.push(saved);
      }
    } catch (error) {
      await this.cleanupUnpersistedEvidenceFiles(unpersistedFiles);
      throw error;
    }

    const firstSaved = savedItems[0];
    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data:
        firstSaved && !report.evidenceImagePath && !report.evidenceImageUrl
          ? {
              evidenceImagePath: firstSaved.imagePath,
              evidenceImageUrl: firstSaved.imageUrl,
            }
          : {},
      include: this.includeRelations(),
    });
    await this.audit('Report Evidence Uploaded', user, {
      targetType: 'Report',
      targetId: reportId,
      imagePaths: savedItems.map((item) => item.imagePath),
    });
    await this.recordReportActivity(
      reportId,
      'REPORT_EVIDENCE_UPLOADED',
      user,
      {
        organizationId: report.organizationId,
        fromStatus: report.status,
        toStatus: report.status,
        metadata: {
          imagePaths: savedItems.map((item) => item.imagePath),
          imageUrls: savedItems.map((item) => item.imageUrl),
          count: savedItems.length,
        },
      },
    );
    return {
      ...this.withProtectedEvidenceUrls(updated),
      evidenceItems: savedItems.map((item) => ({
        imagePath: item.imagePath,
        imageUrl:
          this.protectedEvidenceUrl(
            reportId,
            'report-evidence',
            item.imagePath,
          ) ?? item.imageUrl,
      })),
    };
  }

  async confirmCitizenCompletion(
    reportId: string,
    dto: CitizenConfirmCompletionDto,
    user: JwtUser,
  ) {
    const report = await this.getCitizenReviewReport(reportId, user);
    if (report.citizenCompletionDecision === CompletionDecision.CONFIRMED) {
      return this.getReportById(reportId, user);
    }
    this.assertNoActiveCompletionBlockers(report);
    const policy = this.policyForReport(report);
    const organizationDecision =
      report.organizationCompletionDecision ?? CompletionDecision.PENDING;
    const closes = this.isCompletionSatisfied({
      policy,
      citizenDecision: CompletionDecision.CONFIRMED,
      organizationDecision,
    });
    const now = new Date();
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: closes
          ? ReportStatus.CLOSED
          : ReportStatus.COMPLETED_BY_PROVIDER,
        citizenRating: dto.rating,
        citizenFeedback: dto.feedback?.trim() || null,
        citizenCompletionDecision: CompletionDecision.CONFIRMED,
        citizenCompletionDecidedAt: now,
        completionRejectionReason: null,
        completionReviewState: closes
          ? 'CLOSED'
          : this.reviewStateFor({
              policy,
              citizenDecision: CompletionDecision.CONFIRMED,
              organizationDecision,
            }),
        completionFinalizedAt: closes ? now : null,
        completionFinalizedById: closes ? this.getUserId(user) : null,
        completionFinalizedByRole: closes ? user.role : null,
        completionClosureReason: closes
          ? 'Citizen confirmation satisfied completion policy.'
          : null,
      },
      include: this.includeRelations(),
    });

    if (closes) {
      await this.notifyAuthoritativeCompletionClosure(updated);
    } else {
      await this.notifyOrganizationOperators(updated.organizationId, {
        reportId,
        type: 'citizen_completion_confirmed',
        title: 'Citizen confirmed completion',
        message: `Citizen confirmed "${updated.title}". Organization verification is still required.`,
      });
    }
    await this.audit('Citizen Confirmed Completion', user, {
      targetType: 'Report',
      targetId: reportId,
      rating: dto.rating,
      completionPolicy: policy,
      closed: closes,
    });
    await this.recordReportActivity(
      reportId,
      'CITIZEN_CONFIRMED_COMPLETION',
      user,
      {
        organizationId: updated.organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? undefined,
        note: dto.feedback?.trim() || undefined,
        metadata: {
          rating: dto.rating,
          completionPolicy: policy,
          completionReviewState: updated.completionReviewState,
          closed: closes,
        },
      },
    );
    if (closes) {
      await this.workflowOrchestrator?.citizenConfirmedCompletion({
        reportId,
        organizationId: updated.organizationId,
        actorId: this.getUserId(user),
        actorRole: user.role,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? null,
        citizenId: updated.citizenId,
        metadata: {
          rating: dto.rating,
          feedback: dto.feedback?.trim() || null,
          completionPolicy: policy,
        },
      });
    }
    return updated;
  }

  async rejectCitizenCompletion(
    reportId: string,
    dto: CitizenRejectCompletionDto,
    user: JwtUser,
  ) {
    const report = await this.getCitizenReviewReport(reportId, user);
    this.assertCitizenCanRequestCompletionRework(report);
    const reason = this.requiredGovernanceReason(dto.reason);
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.ASSIGNED,
        completionRejectionReason: reason,
        citizenCompletionDecision: CompletionDecision.REWORK_REQUESTED,
        citizenCompletionDecidedAt: new Date(),
        completionReviewState: 'REWORK_REQUESTED',
        completionDisputeReason: reason,
      },
      include: this.includeRelations(),
    });

    await this.notifyStatusChange(updated);
    await this.audit('Citizen Requested Completion Review', user, {
      targetType: 'Report',
      targetId: reportId,
      reason,
    });
    await this.recordReportActivity(
      reportId,
      'CITIZEN_MARKED_WORK_INCOMPLETE',
      user,
      {
        organizationId: updated.organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? undefined,
        reason,
      },
    );
    await this.notifyOrganizationOperators(updated.organizationId, {
      reportId,
      type: 'completion_review_requested',
      title: 'Citizen requested review',
      message: `Citizen marked "${updated.title}" as still incomplete.`,
    });
    await this.workflowOrchestrator?.citizenRejectedCompletion({
      reportId,
      organizationId: updated.organizationId,
      actorId: this.getUserId(user),
      actorRole: user.role,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId: updated.assignedProviderId ?? null,
      citizenId: updated.citizenId,
      metadata: { reason },
    });
    return updated;
  }

  async verifyOrganizationCompletion(
    reportId: string,
    dto: OrganizationCompletionVerificationDto,
    user: JwtUser,
  ) {
    const report = await this.getOrganizationCompletionReviewReport(
      reportId,
      user,
    );
    if (report.organizationCompletionDecision === CompletionDecision.VERIFIED) {
      return this.getReportById(reportId, user);
    }
    this.assertNoActiveCompletionBlockers(report);
    const policy = this.policyForReport(report);
    if (policy === CompletionPolicy.ADMIN_RESOLUTION_REQUIRED) {
      throw new ForbiddenException(
        'This completion requires platform resolution.',
      );
    }
    const citizenDecision =
      report.citizenCompletionDecision ?? CompletionDecision.PENDING;
    const closes = this.isCompletionSatisfied({
      policy,
      citizenDecision,
      organizationDecision: CompletionDecision.VERIFIED,
    });
    const now = new Date();
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: closes
          ? ReportStatus.CLOSED
          : ReportStatus.COMPLETED_BY_PROVIDER,
        organizationCompletionDecision: CompletionDecision.VERIFIED,
        organizationCompletionDecidedAt: now,
        organizationCompletionDecidedById: this.getUserId(user),
        organizationCompletionReason: dto.reason?.trim() || null,
        completionReviewState: closes
          ? 'CLOSED'
          : this.reviewStateFor({
              policy,
              citizenDecision,
              organizationDecision: CompletionDecision.VERIFIED,
            }),
        completionFinalizedAt: closes ? now : null,
        completionFinalizedById: closes ? this.getUserId(user) : null,
        completionFinalizedByRole: closes ? user.role : null,
        completionClosureReason: closes
          ? dto.reason?.trim() ||
            'Organization verification satisfied completion policy.'
          : null,
      },
      include: this.includeRelations(),
    });

    if (closes) {
      await this.notifyAuthoritativeCompletionClosure(updated);
    } else {
      await this.createNotification({
        userId: updated.citizenId,
        reportId,
        type: 'organization_completion_verified',
        title: 'Organization verified completion',
        message: `Organization verified "${updated.title}". Your confirmation is still required.`,
      });
    }
    await this.audit('Organization Verified Completion', user, {
      targetType: 'Report',
      targetId: reportId,
      organizationId: updated.organizationId,
      completionPolicy: policy,
      closed: closes,
    });
    await this.recordReportActivity(
      reportId,
      'ORGANIZATION_VERIFIED_COMPLETION',
      user,
      {
        organizationId: updated.organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? undefined,
        reason: dto.reason?.trim() || undefined,
        metadata: {
          completionPolicy: policy,
          completionReviewState: updated.completionReviewState,
          closed: closes,
        },
      },
    );
    return updated;
  }

  async requestOrganizationCompletionRework(
    reportId: string,
    dto: OrganizationCompletionReworkDto,
    user: JwtUser,
  ) {
    const report = await this.getOrganizationCompletionReviewReport(
      reportId,
      user,
    );
    this.assertOrganizationCanRequestCompletionRework(report);
    const reason = this.requiredGovernanceReason(dto.reason);
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.ASSIGNED,
        organizationCompletionDecision: CompletionDecision.REWORK_REQUESTED,
        organizationCompletionDecidedAt: new Date(),
        organizationCompletionDecidedById: this.getUserId(user),
        organizationCompletionReason: reason,
        completionRejectionReason: reason,
        completionReviewState: 'REWORK_REQUESTED',
        completionDisputeReason: reason,
      },
      include: this.includeRelations(),
    });

    if (updated.assignedProviderId) {
      await this.createNotification({
        userId: updated.assignedProviderId,
        reportId,
        type: 'completion_rework_requested',
        title: 'Completion rework requested',
        message: `Organization requested rework on "${updated.title}".`,
      });
    }
    await this.createNotification({
      userId: updated.citizenId,
      reportId,
      type: 'completion_rework_requested',
      title: 'Completion rework requested',
      message: `Organization requested rework on "${updated.title}".`,
    });
    await this.audit('Organization Requested Completion Rework', user, {
      targetType: 'Report',
      targetId: reportId,
      organizationId: updated.organizationId,
      reason,
    });
    await this.recordReportActivity(
      reportId,
      'ORGANIZATION_REQUESTED_COMPLETION_REWORK',
      user,
      {
        organizationId: updated.organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? undefined,
        reason,
      },
    );
    return updated;
  }

  async getCitizenCompletionReview(reportId: string, user: JwtUser) {
    const userId = this.getUserId(user);
    if (user.role !== UserRole.CITIZEN) {
      throw new ForbiddenException('Only citizens can review completion');
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });

    if (!report) throw new NotFoundException('Report not found');
    if (report.citizenId !== userId) {
      throw new ForbiddenException('Not your report');
    }

    const evidenceRecord =
      this.prismaDelegate<PrismaFindManyDelegate<OptionalEvidenceRecord>>(
        'evidenceRecord',
      );
    const evidenceRecords = evidenceRecord
      ? await evidenceRecord.findMany({
          where: {
            relatedEntityType: EvidenceRelatedEntityType.REPORT,
            relatedEntityId: report.id,
          },
          orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
        })
      : [];

    const awaitingReview = report.status === ReportStatus.COMPLETED_BY_PROVIDER;
    const protectedReport = this.withProtectedEvidenceUrls(report);
    const evidenceItems = this.reportEvidenceItems(
      protectedReport,
      report,
      evidenceRecords,
    );
    const policy = this.policyForReport(report);
    const reviewState = this.reviewStateFor({
      policy,
      citizenDecision: report.citizenCompletionDecision,
      organizationDecision: report.organizationCompletionDecision,
    });
    return {
      ...protectedReport,
      evidenceItems,
      completion: {
        note: protectedReport.completionNote,
        imageUrl: protectedReport.completionImageUrl,
        imagePath: protectedReport.completionImagePath,
        submittedAt: protectedReport.completedByProviderAt,
        location: this.completionLocationMetadata(protectedReport),
      },
      provider: protectedReport.assignedProvider,
      completionGovernance: this.completionGovernanceSummary({
        ...protectedReport,
        completionPolicy: policy,
        completionReviewState: report.completionReviewState ?? reviewState,
      }),
      availableActions: {
        confirm:
          awaitingReview &&
          report.citizenCompletionDecision !== CompletionDecision.CONFIRMED,
        markIncomplete: awaitingReview,
      },
    };
  }

  async getOrganizationCompletionReviewQueue(
    user: JwtUser,
    query: CompletionReviewQueueQueryDto = {},
  ) {
    const organizationId = this.requireUserOrganizationId(user);
    if (!this.isAdmin(user) && !this.isDispatch(user)) {
      throw new ForbiddenException('Organization review access required');
    }
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const stateFilter = query.state?.trim().toUpperCase();
    const actionableWhere: Prisma.ReportWhereInput = {
      status: ReportStatus.COMPLETED_BY_PROVIDER,
      ...(stateFilter && stateFilter !== 'CLOSED'
        ? { completionReviewState: stateFilter }
        : { completionReviewState: { not: 'CLOSED' } }),
      OR: [
        {
          completionPolicy: {
            in: [
              CompletionPolicy.ORGANIZATION_CONFIRMATION_REQUIRED,
              CompletionPolicy.BOTH_REQUIRED,
              CompletionPolicy.CITIZEN_OR_ORGANIZATION,
              CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
              CompletionPolicy.ADMIN_RESOLUTION_REQUIRED,
            ],
          },
        },
        { completionReviewState: { in: ['DISPUTED', 'REWORK_REQUESTED'] } },
      ],
    };
    const closedHistoryWhere: Prisma.ReportWhereInput = {
      status: ReportStatus.CLOSED,
      completionReviewState: 'CLOSED',
      organizationCompletionDecision: CompletionDecision.VERIFIED,
    };
    const where: Prisma.ReportWhereInput = {
      organizationId,
      ...(query.category ? { category: query.category } : {}),
      OR:
        stateFilter === 'CLOSED'
          ? [closedHistoryWhere]
          : stateFilter
            ? [actionableWhere]
            : [actionableWhere, closedHistoryWhere],
    };
    const [total, reports] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        include: this.includeRelations(),
        orderBy: [
          { completionReviewDeadlineAt: 'asc' },
          { completedByProviderAt: 'asc' },
          { createdAt: 'asc' },
        ],
        take: limit,
        skip: offset,
      }),
    ]);
    const evidenceCounts = await this.evidenceCountsForReports(
      reports.map((report) => report.id),
    );
    return {
      workspace: 'Completion Review',
      organizationId,
      total,
      limit,
      offset,
      items: reports.map((report) =>
        this.completionReviewQueueItem(
          report,
          evidenceCounts.get(report.id) ?? 0,
        ),
      ),
    };
  }

  async getOrganizationCompletionReviewDetail(reportId: string, user: JwtUser) {
    const report = await this.getOrganizationCompletionReviewReport(
      reportId,
      user,
      { allowGovernanceStates: true },
    );
    return this.withEnterpriseReportDetails({
      ...report,
      completionGovernance: this.completionGovernanceSummary(report),
    });
  }

  async getAdminCompletionGovernanceQueue(
    user: JwtUser,
    query: CompletionReviewQueueQueryDto = {},
  ) {
    this.assertSuperAdmin(user);
    const now = new Date();
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const stateFilter = query.state?.trim();
    const governanceWhere: Prisma.ReportWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      OR: this.adminGovernanceQueueConditions(stateFilter, now),
    };
    const [total, reports] = await Promise.all([
      this.prisma.report.count({ where: governanceWhere }),
      this.prisma.report.findMany({
        where: governanceWhere,
        include: this.includeRelations(),
        orderBy: [
          { completionReviewDeadlineAt: 'asc' },
          { updatedAt: 'desc' },
          { id: 'asc' },
        ],
        take: limit,
        skip: offset,
      }),
    ]);
    return {
      workspace: 'Completion Governance',
      total,
      limit,
      offset,
      filters: [
        'ADMIN_RESOLUTION_REQUIRED',
        'DISPUTED',
        'REWORK_ESCALATED',
        'ON_HOLD',
        'REVIEW_WINDOW_EXPIRED',
        'APPROVAL_CONFLICT',
        'REOPENED',
        'GOVERNANCE_CLOSED',
      ],
      counters: await this.getCompletionGovernanceCounters(user),
      items: reports.map((report) => this.adminGovernanceQueueItem(report)),
    };
  }

  async adminResolveAndClose(
    reportId: string,
    dto: AdminCompletionGovernanceReasonDto,
    user: JwtUser,
  ) {
    this.assertSuperAdmin(user);
    const report = await this.getAdminGovernanceReport(reportId);
    if (report.status === ReportStatus.CLOSED) {
      throw new ConflictException('Report is already closed');
    }
    if (report.completionGovernanceHoldReason) {
      throw new ConflictException('Remove governance hold before resolving');
    }
    const reason = this.requiredGovernanceReason(dto.reason);
    const now = new Date();
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.CLOSED,
        completionReviewState: 'CLOSED',
        completionFinalizedAt: now,
        completionFinalizedById: this.getUserId(user),
        completionFinalizedByRole: user.role,
        completionFinalActorType: 'SUPER_ADMIN_GOVERNANCE',
        completionClosureReason: reason,
      },
      include: this.includeRelations(),
    });
    await this.recordGovernanceAction(report, updated, user, {
      action: 'ADMIN_COMPLETION_RESOLVED_CLOSED',
      auditAction: 'Admin Completion Resolved And Closed',
      reason,
      notifyType: 'governance_resolution_closed',
      notifyTitle: 'Report closed by governance resolution',
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async adminReturnForCompletionRework(
    reportId: string,
    dto: AdminCompletionGovernanceReasonDto,
    user: JwtUser,
  ) {
    this.assertSuperAdmin(user);
    const report = await this.getAdminGovernanceReport(reportId);
    if (report.status === ReportStatus.CLOSED) {
      throw new ConflictException(
        'Closed reports must be reopened before rework',
      );
    }
    if (report.completionReviewState === 'REWORK_REQUESTED') {
      throw new ConflictException('Report is already returned for rework');
    }
    const reason = this.requiredGovernanceReason(dto.reason);
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.ASSIGNED,
        completionReviewState: 'REWORK_REQUESTED',
        organizationCompletionDecision: CompletionDecision.ESCALATED,
        organizationCompletionReason: reason,
        completionRejectionReason: reason,
        completionDisputeReason: reason,
      },
      include: this.includeRelations(),
    });
    await this.recordGovernanceAction(report, updated, user, {
      action: 'ADMIN_COMPLETION_RETURNED_FOR_REWORK',
      auditAction: 'Admin Completion Returned For Rework',
      reason,
      notifyType: 'governance_rework_requested',
      notifyTitle: 'Report returned for provider rework',
    });
    if (updated.assignedProviderId) {
      await this.createNotification({
        userId: updated.assignedProviderId,
        reportId,
        type: 'governance_rework_requested',
        title: 'Report returned for rework',
        message: `Governance returned "${updated.title}" for provider rework.`,
      });
    }
    return this.withProtectedEvidenceUrls(updated);
  }

  async adminPlaceCompletionHold(
    reportId: string,
    dto: AdminCompletionGovernanceReasonDto,
    user: JwtUser,
  ) {
    this.assertSuperAdmin(user);
    const report = await this.getAdminGovernanceReport(reportId);
    if (report.status === ReportStatus.CLOSED) {
      throw new ConflictException('Reopen closed reports before placing hold');
    }
    const reason = this.requiredGovernanceReason(dto.reason);
    if (report.completionGovernanceHoldReason) {
      throw new ConflictException('Report is already on governance hold');
    }
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        completionGovernanceHoldReason: reason,
        completionReviewState: 'GOVERNANCE_HOLD',
      },
      include: this.includeRelations(),
    });
    await this.recordGovernanceAction(report, updated, user, {
      action: 'ADMIN_COMPLETION_HOLD_PLACED',
      auditAction: 'Admin Completion Hold Placed',
      reason,
      notifyType: 'completion_governance_hold',
      notifyTitle: 'Report placed on governance hold',
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async adminRemoveCompletionHold(
    reportId: string,
    dto: AdminCompletionGovernanceReasonDto,
    user: JwtUser,
  ) {
    this.assertSuperAdmin(user);
    const report = await this.getAdminGovernanceReport(reportId);
    const reason = this.requiredGovernanceReason(dto.reason);
    if (!report.completionGovernanceHoldReason) {
      throw new ConflictException('Report is not on governance hold');
    }
    const policy = this.policyForReport(report);
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        completionGovernanceHoldReason: null,
        completionReviewState:
          report.status === ReportStatus.CLOSED
            ? 'CLOSED'
            : this.reviewStateFor({
                policy,
                citizenDecision: report.citizenCompletionDecision,
                organizationDecision: report.organizationCompletionDecision,
              }),
      },
      include: this.includeRelations(),
    });
    await this.recordGovernanceAction(report, updated, user, {
      action: 'ADMIN_COMPLETION_HOLD_REMOVED',
      auditAction: 'Admin Completion Hold Removed',
      reason,
      notifyType: 'completion_governance_hold_removed',
      notifyTitle: 'Governance hold removed',
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async adminReopenCompletion(
    reportId: string,
    dto: AdminCompletionGovernanceReasonDto,
    user: JwtUser,
  ) {
    this.assertSuperAdmin(user);
    const report = await this.getAdminGovernanceReport(reportId);
    if (report.status !== ReportStatus.CLOSED) {
      throw new ConflictException('Only closed reports can be reopened');
    }
    const reason = this.requiredGovernanceReason(dto.reason);
    const policy = this.policyForReport(report);
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.COMPLETED_BY_PROVIDER,
        completionReviewState: this.reviewStateFor({
          policy,
          citizenDecision: report.citizenCompletionDecision,
          organizationDecision: report.organizationCompletionDecision,
        }),
      },
      include: this.includeRelations(),
    });
    await this.recordGovernanceAction(report, updated, user, {
      action: 'ADMIN_COMPLETION_REOPENED',
      auditAction: 'Admin Completion Reopened',
      reason,
      notifyType: 'completion_governance_reopened',
      notifyTitle: 'Report reopened by governance',
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async adminOverrideCompletionPolicy(
    reportId: string,
    dto: AdminCompletionPolicyOverrideDto,
    user: JwtUser,
  ) {
    this.assertSuperAdmin(user);
    const report = await this.getAdminGovernanceReport(reportId);
    const reason = this.requiredGovernanceReason(dto.reason);
    const previousPolicy = this.policyForReport(report);
    if (report.status === ReportStatus.CLOSED) {
      throw new ConflictException(
        'Reopen closed reports before overriding policy',
      );
    }
    if (previousPolicy === dto.policy) {
      throw new ConflictException('Report already uses this policy');
    }
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        completionPolicy: dto.policy,
        completionPolicySource: 'SUPER_ADMIN_REPORT_OVERRIDE',
        completionReviewState: this.reviewStateFor({
          policy: dto.policy,
          citizenDecision: report.citizenCompletionDecision,
          organizationDecision: report.organizationCompletionDecision,
        }),
      },
      include: this.includeRelations(),
    });
    await this.recordGovernanceAction(report, updated, user, {
      action: 'ADMIN_COMPLETION_POLICY_OVERRIDDEN',
      auditAction: 'Admin Completion Policy Overridden',
      reason,
      notifyType: 'completion_policy_overridden',
      notifyTitle: 'Completion policy overridden',
      metadata: { previousPolicy, newPolicy: dto.policy },
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async setCategoryCompletionPolicy(
    user: JwtUser,
    dto: AdminCategoryCompletionPolicyDto,
  ) {
    this.assertSuperAdmin(user);
    const reason = this.requiredGovernanceReason(dto.reason);
    const normalizedCategory = this.normalizeResponsibilityCategory(
      dto.category,
    );
    if (!normalizedCategory) {
      throw new BadRequestException('Category is required');
    }
    await this.assertKnownCompletionCategory(normalizedCategory);
    if (dto.organizationId) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (!organization) throw new NotFoundException('Organization not found');
      const profile =
        organization.profileData &&
        typeof organization.profileData === 'object' &&
        !Array.isArray(organization.profileData)
          ? { ...(organization.profileData as Record<string, unknown>) }
          : {};
      const current =
        profile.completionPoliciesByCategory &&
        typeof profile.completionPoliciesByCategory === 'object' &&
        !Array.isArray(profile.completionPoliciesByCategory)
          ? {
              ...(profile.completionPoliciesByCategory as Record<
                string,
                unknown
              >),
            }
          : {};
      const previous = current[normalizedCategory] ?? null;
      current[normalizedCategory] = dto.policy;
      profile.completionPoliciesByCategory = current;
      await this.prisma.organization.update({
        where: { id: organization.id },
        data: { profileData: profile as Prisma.InputJsonValue },
      });
      await this.audit(
        'Organization Category Completion Policy Updated',
        user,
        {
          targetType: 'Organization',
          targetId: organization.id,
          category: normalizedCategory,
          previousPolicy: previous,
          newPolicy: dto.policy,
          reason,
        },
      );
      return {
        scope: 'ORGANIZATION_SERVICE_CATEGORY',
        organizationId: organization.id,
        category: normalizedCategory,
        previousPolicy: previous,
        policy: dto.policy,
      };
    }

    const settingKey = 'completionPoliciesByCategory';
    const existing = await this.prisma.platformSetting.findUnique({
      where: { key: settingKey },
    });
    const current =
      existing?.value &&
      typeof existing.value === 'object' &&
      !Array.isArray(existing.value)
        ? { ...(existing.value as Record<string, unknown>) }
        : {};
    const previous = current[normalizedCategory] ?? null;
    current[normalizedCategory] = dto.policy;
    await this.prisma.platformSetting.upsert({
      where: { key: settingKey },
      create: { key: settingKey, value: current as Prisma.InputJsonValue },
      update: { value: current as Prisma.InputJsonValue },
    });
    await this.audit('Platform Category Completion Policy Updated', user, {
      targetType: 'PlatformSetting',
      targetId: settingKey,
      category: normalizedCategory,
      previousPolicy: previous,
      newPolicy: dto.policy,
      reason,
    });
    return {
      scope: 'PLATFORM_SERVICE_CATEGORY',
      category: normalizedCategory,
      previousPolicy: previous,
      policy: dto.policy,
    };
  }

  async getCategoryCompletionPolicies(user: JwtUser) {
    this.assertSuperAdmin(user);
    const settingKey = 'completionPoliciesByCategory';
    const [setting, reportCategories, providerCategoryUsers] =
      await Promise.all([
        this.prisma.platformSetting.findUnique({ where: { key: settingKey } }),
        this.prisma.report.findMany({
          distinct: ['category'],
          where: { category: { not: '' } },
          select: { category: true },
          orderBy: { category: 'asc' },
        }),
        this.prisma.user.findMany({
          where: { serviceCategories: { not: Prisma.JsonNull } },
          select: { serviceCategories: true },
        }),
      ]);
    const persisted =
      setting?.value &&
      typeof setting.value === 'object' &&
      !Array.isArray(setting.value)
        ? (setting.value as Record<string, unknown>)
        : {};
    const categoryLabels = this.collectStringList([
      ...Object.keys(CATEGORY_CAPABILITY_ALIASES),
      ...reportCategories.map((item) => item.category),
      ...providerCategoryUsers.flatMap((user) =>
        this.jsonStringList(user.serviceCategories),
      ),
    ]);
    return {
      scope: 'PLATFORM_SERVICE_CATEGORY',
      categories: categoryLabels.map((label) => {
        const category = this.normalizeResponsibilityCategory(label);
        const policy = this.policyFromCategoryRecord(persisted, category);
        const fallback = this.normalizeCompletionPolicy(
          process.env.FIXZONE_COMPLETION_POLICY,
        );
        return {
          category,
          label,
          policy,
          source: policy ? 'PLATFORM_SERVICE_CATEGORY' : 'FALLBACK',
          fallbackPolicy:
            fallback ?? CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED,
        };
      }),
      policies: Object.values(CompletionPolicy),
      scheduler: {
        automatedSchedulerActive: false,
        requirement:
          'Invoke the protected deadline endpoint from an approved cron or worker until a scheduler module is enabled.',
      },
    };
  }

  async processCompletionReviewDeadlines(
    user: JwtUser,
    dto: ProcessCompletionReviewDeadlinesDto = {},
  ) {
    const processorRoles: UserRole[] = [
      UserRole.SUPER_ADMIN,
      UserRole.COMPLIANCE_ADMIN,
      UserRole.REGULATORY_ADMIN,
    ];
    if (!processorRoles.includes(user.role)) {
      throw new ForbiddenException('Platform completion processing required');
    }
    const now = new Date();
    const limit = dto.limit ?? 100;
    const dryRun = dto.dryRun === true || dto.dryRun === 'true';
    const executionReason = dryRun
      ? (dto.reason?.trim() ?? null)
      : this.requiredGovernanceReason(dto.reason);
    const candidates = await this.prisma.report.findMany({
      where: {
        completionPolicy: CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
      },
      include: this.includeRelations(),
      orderBy: [{ completionReviewDeadlineAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    const processed: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const counts = {
      eligible: 0,
      blockedByDispute: 0,
      blockedByRework: 0,
      blockedByHold: 0,
      alreadyProcessed: 0,
      alreadyClosed: 0,
      notYetDue: 0,
      invalidIncomplete: 0,
      processed: 0,
      skipped: 0,
    };

    for (const report of candidates) {
      if (!report.completionReviewDeadlineAt) {
        counts.invalidIncomplete += 1;
        skipped.push({ id: report.id, reason: 'missing_deadline' });
        continue;
      }
      if (
        new Date(report.completionReviewDeadlineAt).getTime() > now.getTime()
      ) {
        counts.notYetDue += 1;
        skipped.push({ id: report.id, reason: 'not_yet_due' });
        continue;
      }
      const skipReason = this.completionDeadlineSkipReason(report);
      if (skipReason) {
        if (skipReason === 'active_dispute') counts.blockedByDispute += 1;
        if (skipReason === 'active_rework') counts.blockedByRework += 1;
        if (skipReason === 'governance_hold') counts.blockedByHold += 1;
        if (skipReason === 'already_processed') counts.alreadyProcessed += 1;
        if (skipReason === 'already_closed') counts.alreadyClosed += 1;
        skipped.push({ id: report.id, reason: skipReason });
        continue;
      }
      if (report.status !== ReportStatus.COMPLETED_BY_PROVIDER) {
        counts.invalidIncomplete += 1;
        skipped.push({ id: report.id, reason: 'not_awaiting_review' });
        continue;
      }
      counts.eligible += 1;
      if (dryRun) {
        processed.push(report.id);
        continue;
      }
      const updated = await this.prisma.report.update({
        where: {
          id: report.id,
          status: ReportStatus.COMPLETED_BY_PROVIDER,
        },
        data: {
          status: ReportStatus.CLOSED,
          completionReviewState: 'CLOSED',
          completionReviewProcessedAt: now,
          completionFallbackRule: COMPLETION_REVIEW_WINDOW_FALLBACK_RULE,
          completionFinalActorType: 'SYSTEM_REVIEW_WINDOW',
          completionFinalizedAt: now,
          completionFinalizedById: this.getUserId(user),
          completionFinalizedByRole: user.role,
          completionClosureReason:
            'Review window expired; fallback closure authority applied without recording citizen or organization approval.',
        },
        include: this.includeRelations(),
      });
      await this.notifyStatusChange(updated);
      await this.recordReportActivity(
        updated.id,
        'COMPLETION_REVIEW_WINDOW_FALLBACK_CLOSED',
        user,
        {
          organizationId: updated.organizationId,
          fromStatus: ReportStatus.COMPLETED_BY_PROVIDER,
          toStatus: ReportStatus.CLOSED,
          providerId: updated.assignedProviderId ?? undefined,
          reason: updated.completionClosureReason ?? undefined,
          metadata: {
            policy: CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
            deadlineAt: updated.completionReviewDeadlineAt,
            processedAt: now,
            fallbackRule: COMPLETION_REVIEW_WINDOW_FALLBACK_RULE,
            finalActorType: 'SYSTEM_REVIEW_WINDOW',
          },
        },
      );
      await this.audit('Completion Review Window Fallback Closed', user, {
        targetType: 'Report',
        targetId: updated.id,
        organizationId: updated.organizationId,
        completionPolicy: CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
        fallbackRule: COMPLETION_REVIEW_WINDOW_FALLBACK_RULE,
      });
      processed.push(updated.id);
      counts.processed += 1;
    }
    counts.skipped = skipped.length;
    await this.audit('Completion Review Deadline Processor Executed', user, {
      targetType: 'Report',
      targetId: 'completion-review-deadline-processor',
      dryRun,
      limit,
      reason: executionReason,
      counts,
    });
    return {
      processedCount: processed.length,
      skippedCount: skipped.length,
      counts,
      processed,
      skipped,
      dryRun,
      automatedSchedulerActive: false,
      schedulerRequirement:
        'Invoke this protected endpoint from an approved cron or worker until a scheduler module is enabled.',
    };
  }

  // ===================== DASHBOARD =====================

  async getDashboardSummary(user: JwtUser, query?: AdminDashboardQueryDto) {
    const where = this.buildOrgScope(user, query?.period);
    await this.expireOverdueAssignments({
      organizationId: this.isSuperAdmin(user)
        ? undefined
        : this.requireUserOrganizationId(user),
      actor: user,
    });

    const [
      total,
      pending,
      awaitingOrganizationDecision,
      triage,
      assigned,
      inProgress,
      completed,
      closed,
    ] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.count({
        where: {
          ...where,
          status: { in: [ReportStatus.PENDING, ReportStatus.ORG_REVIEW] },
        },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.ORG_REVIEW },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.TRIAGE },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.ASSIGNED },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.IN_PROGRESS },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.COMPLETED_BY_PROVIDER },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.CLOSED },
      }),
    ]);

    return {
      total,
      pending,
      awaitingOrganizationDecision,
      triage,
      assigned,
      inProgress,
      completed,
      closed,
      completionGovernance: await this.getCompletionGovernanceCounters(user),
    };
  }

  // ===================== CHART ANALYTICS =====================

  async getReportTrends(user: JwtUser) {
    const reports = await this.prisma.report.findMany({
      where: this.buildOrgScope(user),
      select: { createdAt: true, status: true },
    });

    const created: Record<string, number> = {};
    const completed: Record<string, number> = {};

    for (const r of reports) {
      const d = r.createdAt.toISOString().split('T')[0];

      created[d] = (created[d] || 0) + 1;

      if (
        r.status === ReportStatus.CLOSED ||
        r.status === ReportStatus.COMPLETED_BY_PROVIDER
      ) {
        completed[d] = (completed[d] || 0) + 1;
      }
    }

    return {
      created: this.formatChart(created),
      completed: this.formatChart(completed),
    };
  }

  async getCategoryTrends(user: JwtUser) {
    const reports = await this.prisma.report.findMany({
      where: this.buildOrgScope(user),
      select: { category: true, createdAt: true },
    });

    const map: Record<string, Record<string, number>> = {};

    for (const r of reports) {
      const d = r.createdAt.toISOString().split('T')[0];

      if (!map[r.category]) map[r.category] = {};
      map[r.category][d] = (map[r.category][d] || 0) + 1;
    }

    return Object.keys(map).map((cat) => ({
      category: cat,
      data: this.formatChart(map[cat]),
    }));
  }

  // ===================== ADVANCED ANALYTICS =====================

  async getAdvancedAnalytics(user: JwtUser) {
    const reports = await this.prisma.report.findMany({
      where: this.buildOrgScope(user),
    });

    let totalTime = 0;
    let count = 0;
    const providerMap: Record<string, number> = {};

    for (const r of reports) {
      if (r.status === ReportStatus.CLOSED) {
        const diff =
          new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime();

        totalTime += diff;
        count++;
      }

      if (r.assignedProviderId) {
        providerMap[r.assignedProviderId] =
          (providerMap[r.assignedProviderId] || 0) + 1;
      }
    }

    const avgHours = count === 0 ? 0 : totalTime / count / (1000 * 60 * 60);

    return {
      avgResolutionHours: Number(avgHours.toFixed(2)),
      totalCompleted: count,
      topProviders: Object.entries(providerMap)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 5)
        .map(([id, jobs]) => ({ providerId: id, jobs })),
    };
  }

  async getProviderPerformance(user: JwtUser) {
    const where: Prisma.UserWhereInput = { role: UserRole.PROVIDER };
    if (!this.isSuperAdmin(user)) {
      const organizationId = this.requireUserOrganizationId(user);
      where.OR = [
        { organizationId },
        {
          providerOrganizations: {
            some: {
              organizationId,
              active: true,
            },
          },
        },
      ];
    }
    const reportScope = this.isSuperAdmin(user)
      ? undefined
      : { organizationId: this.requireUserOrganizationId(user) };
    const providers = await this.prisma.user.findMany({
      where,
      include: {
        assignedReports: {
          ...(reportScope ? { where: reportScope } : {}),
          include: {
            activities: {
              where: { action: 'PROVIDER_STARTED_WORK' },
              orderBy: { createdAt: 'asc' },
              select: {
                actorUserId: true,
                providerId: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    return providers.map((p) => {
      const completed = p.assignedReports.filter(
        (report) => report.status === ReportStatus.CLOSED,
      );
      const rated = completed.filter(
        (report) => typeof report.citizenRating === 'number',
      );
      const ratingTotal = rated.reduce(
        (sum, report) => sum + (report.citizenRating ?? 0),
        0,
      );
      const responseMetric = this.calculateProviderAverageResponse(
        p.assignedReports,
        p.id,
      );

      return {
        providerId: p.id,
        fullName: p.fullName,
        email: p.email,
        assignedCount: p.assignedReports.length,
        completedJobs: completed.length,
        averageRating:
          rated.length === 0
            ? 0
            : Number((ratingTotal / rated.length).toFixed(2)),
        ratingCount: rated.length,
        averageResponseHours:
          responseMetric.averageHours == null
            ? null
            : Number(responseMetric.averageHours.toFixed(2)),
        averageResponseReason: responseMetric.reason,
        averageResponseSampleCount: responseMetric.sampleCount,
        recentReviews: rated
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, 5)
          .map((report) => ({
            reportId: report.id,
            title: report.title,
            rating: report.citizenRating,
            feedback: report.citizenFeedback,
            reviewedAt: report.updatedAt,
          })),
      };
    });
  }

  private calculateProviderAverageResponse(
    reports: Array<{
      assignedAt?: Date | null;
      assignedProviderId?: string | null;
      status?: string | null;
      activities?: Array<{
        actorUserId?: string | null;
        providerId?: string | null;
        createdAt?: Date | null;
      }>;
    }>,
    providerId: string,
  ): {
    averageHours: number | null;
    sampleCount: number;
    reason: string | null;
  } {
    const acceptedReports = reports.filter((report) =>
      [
        ReportStatus.IN_PROGRESS as string,
        ReportStatus.COMPLETED_BY_PROVIDER as string,
        ReportStatus.CLOSED as string,
      ].includes(String(report.status)),
    );

    if (acceptedReports.length === 0) {
      return {
        averageHours: null,
        sampleCount: 0,
        reason: 'NO_ACCEPTED_ASSIGNMENTS',
      };
    }

    let missingAssignmentTimestamp = 0;
    let missingAcceptanceTimestamp = 0;
    const durations: number[] = [];

    for (const report of acceptedReports) {
      if (!report.assignedAt) {
        missingAssignmentTimestamp += 1;
        continue;
      }

      const acceptance = (report.activities ?? []).find(
        (activity) =>
          activity.createdAt &&
          (activity.actorUserId === providerId ||
            activity.providerId === providerId),
      );

      if (!acceptance?.createdAt) {
        missingAcceptanceTimestamp += 1;
        continue;
      }

      const durationMs =
        acceptance.createdAt.getTime() - report.assignedAt.getTime();
      if (durationMs > 0) durations.push(durationMs);
    }

    if (durations.length === 0) {
      return {
        averageHours: null,
        sampleCount: 0,
        reason:
          missingAcceptanceTimestamp >= missingAssignmentTimestamp
            ? 'MISSING_ACCEPTANCE_TIMESTAMP'
            : 'MISSING_ASSIGNMENT_TIMESTAMP',
      };
    }

    return {
      averageHours:
        durations.reduce((sum, value) => sum + value, 0) /
        durations.length /
        (1000 * 60 * 60),
      sampleCount: durations.length,
      reason: null,
    };
  }

  async getRecentReports(user: JwtUser) {
    const where = this.buildOrgScope(user);
    await this.expireOverdueAssignments({
      organizationId: this.isSuperAdmin(user)
        ? undefined
        : this.requireUserOrganizationId(user),
      actor: user,
    });
    const reports = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      include: this.includeRelations(),
    });
    return reports.map((report) => this.withProtectedEvidenceUrls(report));
  }

  // ===================== HELPERS =====================

  private formatChart(map: Record<string, number>) {
    return Object.keys(map)
      .sort()
      .map((date) => ({ date, count: map[date] }));
  }

  private async getCitizenReviewReport(reportId: string, user: JwtUser) {
    const userId = this.getUserId(user);
    if (user.role !== UserRole.CITIZEN) {
      throw new ForbiddenException('Only citizens can review completion');
    }
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.citizenId !== userId)
      throw new ForbiddenException('Not your report');
    const duplicateClosedConfirmation =
      report.status === ReportStatus.CLOSED &&
      report.citizenCompletionDecision === CompletionDecision.CONFIRMED;
    if (
      report.status !== ReportStatus.COMPLETED_BY_PROVIDER &&
      !duplicateClosedConfirmation
    ) {
      throw new ForbiddenException('Report is not awaiting citizen review');
    }
    return report;
  }

  private async getOrganizationCompletionReviewReport(
    reportId: string,
    user: JwtUser,
    options: { allowGovernanceStates?: boolean } = {},
  ) {
    if (!this.isAdmin(user) && !this.isDispatch(user)) {
      throw new ForbiddenException('Only organization operators can verify');
    }
    const organizationId = this.requireUserOrganizationId(user);
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.organizationId !== organizationId) {
      throw new ForbiddenException('Organization cannot verify this report');
    }
    const duplicateClosedVerification =
      report.status === ReportStatus.CLOSED &&
      report.organizationCompletionDecision === CompletionDecision.VERIFIED;
    const governanceReviewState =
      options.allowGovernanceStates &&
      report.status === ReportStatus.COMPLETED_BY_PROVIDER &&
      ['DISPUTED', 'REWORK_REQUESTED', 'AWAITING_ADMIN_RESOLUTION'].includes(
        report.completionReviewState ?? '',
      );
    if (
      report.status !== ReportStatus.COMPLETED_BY_PROVIDER &&
      !duplicateClosedVerification &&
      !governanceReviewState
    ) {
      throw new ForbiddenException(
        'Report is not awaiting completion verification',
      );
    }
    return report;
  }

  private async resolveCompletionPolicy(report: {
    completionPolicy?: CompletionPolicy | null;
    category?: string | null;
    organization?: { profileData?: Prisma.JsonValue | null } | null;
  }): Promise<CompletionPolicyResolution> {
    if (report.completionPolicy) {
      return { policy: report.completionPolicy, source: 'REPORT_OVERRIDE' };
    }

    const organizationCategoryPolicy = this.completionPolicyFromCategoryMap(
      report.organization?.profileData,
      report.category,
    );
    if (organizationCategoryPolicy) {
      return {
        policy: organizationCategoryPolicy,
        source: 'ORGANIZATION_SERVICE_CATEGORY',
      };
    }

    const platformCategoryPolicy =
      await this.completionPolicyFromPlatformCategory(report.category);
    if (platformCategoryPolicy) {
      return {
        policy: platformCategoryPolicy,
        source: 'PLATFORM_SERVICE_CATEGORY',
      };
    }

    const organizationPolicy = this.completionPolicyFromProfile(
      report.organization?.profileData,
    );
    if (organizationPolicy) {
      return { policy: organizationPolicy, source: 'ORGANIZATION_PROFILE' };
    }

    const configured = this.normalizeCompletionPolicy(
      process.env.FIXZONE_COMPLETION_POLICY,
    );
    if (configured) return { policy: configured, source: 'PLATFORM_ENV' };

    if (this.requiresDualCompletionByDefault(report.category)) {
      return {
        policy: CompletionPolicy.BOTH_REQUIRED,
        source: 'BUILT_IN_OPERATIONAL_CATEGORY_DEFAULT',
      };
    }

    return {
      policy: CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED,
      source: 'PLATFORM_DEFAULT',
    };
  }

  private policyForReport(report: {
    completionPolicy?: CompletionPolicy | null;
  }) {
    return (
      report.completionPolicy ??
      this.normalizeCompletionPolicy(process.env.FIXZONE_COMPLETION_POLICY) ??
      CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED
    );
  }

  private completionPolicyFromProfile(profileData?: Prisma.JsonValue | null) {
    if (!profileData || typeof profileData !== 'object') return null;
    if (Array.isArray(profileData)) return null;
    const profile = profileData as Record<string, unknown>;
    return this.normalizeCompletionPolicy(profile.completionPolicy);
  }

  private completionPolicyFromCategoryMap(
    profileData: Prisma.JsonValue | null | undefined,
    category: string | null | undefined,
  ) {
    const normalizedCategory = this.normalizeResponsibilityCategory(
      category ?? '',
    );
    if (
      !normalizedCategory ||
      !profileData ||
      typeof profileData !== 'object'
    ) {
      return null;
    }
    if (Array.isArray(profileData)) return null;
    const profile = profileData as Record<string, unknown>;
    const maps = [
      profile.completionPoliciesByCategory,
      profile.categoryCompletionPolicies,
      this.profilePath(profile, [
        'serviceConfiguration',
        'completionPoliciesByCategory',
      ]),
    ];
    for (const map of maps) {
      const policy = this.policyFromCategoryRecord(map, normalizedCategory);
      if (policy) return policy;
    }
    return null;
  }

  private async completionPolicyFromPlatformCategory(
    category: string | null | undefined,
  ) {
    const normalizedCategory = this.normalizeResponsibilityCategory(
      category ?? '',
    );
    if (!normalizedCategory) return null;
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: 'completionPoliciesByCategory' },
    });
    if (
      setting?.value &&
      typeof setting.value === 'object' &&
      !Array.isArray(setting.value)
    ) {
      const persisted = this.policyFromCategoryRecord(
        setting.value,
        normalizedCategory,
      );
      if (persisted) return persisted;
    }
    const raw =
      process.env.FIXZONE_COMPLETION_CATEGORY_POLICIES ??
      process.env.FIXZONE_SERVICE_CATEGORY_COMPLETION_POLICIES;
    if (!raw) return null;
    try {
      return this.policyFromCategoryRecord(JSON.parse(raw), normalizedCategory);
    } catch {
      return null;
    }
  }

  private async assertKnownCompletionCategory(normalizedCategory: string) {
    if (CATEGORY_CAPABILITY_ALIASES[normalizedCategory]) return;
    const reports = await this.prisma.report.findMany({
      where: { category: { not: '' } },
      select: { category: true },
      take: 250,
    });
    if (
      reports.some((report) =>
        this.categoriesCompatible(
          this.normalizeResponsibilityCategory(report.category),
          normalizedCategory,
        ),
      )
    ) {
      return;
    }
    const providers = await this.prisma.user.findMany({
      where: { serviceCategories: { not: Prisma.JsonNull } },
      select: { serviceCategories: true },
      take: 250,
    });
    const providerCategories = providers.flatMap((provider) =>
      this.jsonStringList(provider.serviceCategories),
    );
    if (
      providerCategories.some((item) =>
        this.categoriesCompatible(
          this.normalizeResponsibilityCategory(item),
          normalizedCategory,
        ),
      )
    ) {
      return;
    }
    throw new BadRequestException('Unknown service category');
  }

  private policyFromCategoryRecord(value: unknown, normalizedCategory: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const record = value as Record<string, unknown>;
    for (const [key, policy] of Object.entries(record)) {
      if (
        this.categoriesCompatible(
          this.normalizeResponsibilityCategory(key),
          normalizedCategory,
        )
      ) {
        const normalizedPolicy = this.normalizeCompletionPolicy(policy);
        if (normalizedPolicy) return normalizedPolicy;
      }
    }
    return null;
  }

  private profilePath(value: Record<string, unknown>, path: string[]): unknown {
    return path.reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return null;
      }
      return (current as Record<string, unknown>)[key];
    }, value);
  }

  private normalizeCompletionPolicy(value: unknown) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    return Object.values(CompletionPolicy).includes(
      normalized as CompletionPolicy,
    )
      ? (normalized as CompletionPolicy)
      : null;
  }

  private requiresDualCompletionByDefault(category?: string | null) {
    const normalized = this.normalizeResponsibilityCategory(category ?? '');
    return [
      'road',
      'roads',
      'road maintenance',
      'road infrastructure',
      'infrastructure',
      'civil works',
      'drainage',
      'bridge',
      'street lighting',
      'public works',
    ].some((item) =>
      this.categoriesCompatible(
        normalized,
        this.normalizeResponsibilityCategory(item),
      ),
    );
  }

  private reviewDeadlineFor(policy: CompletionPolicy) {
    if (policy !== CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW) return null;
    const hours = Number(
      process.env.FIXZONE_COMPLETION_REVIEW_WINDOW_HOURS || 72,
    );
    const deadline = new Date();
    deadline.setHours(
      deadline.getHours() + (Number.isFinite(hours) ? hours : 72),
    );
    return deadline;
  }

  private reviewStateFor(input: {
    policy: CompletionPolicy;
    citizenDecision?: CompletionDecision | null;
    organizationDecision?: CompletionDecision | null;
  }) {
    if (
      input.citizenDecision === CompletionDecision.DISPUTED ||
      input.organizationDecision === CompletionDecision.ESCALATED
    ) {
      return 'DISPUTED';
    }
    if (
      input.citizenDecision === CompletionDecision.REWORK_REQUESTED ||
      input.organizationDecision === CompletionDecision.REWORK_REQUESTED
    ) {
      return 'REWORK_REQUESTED';
    }
    if (
      input.policy === CompletionPolicy.BOTH_REQUIRED &&
      input.citizenDecision === CompletionDecision.CONFIRMED
    ) {
      return 'AWAITING_ORGANIZATION_VERIFICATION';
    }
    if (
      input.policy === CompletionPolicy.BOTH_REQUIRED &&
      input.organizationDecision === CompletionDecision.VERIFIED
    ) {
      return 'AWAITING_CITIZEN_REVIEW';
    }
    if (input.policy === CompletionPolicy.ORGANIZATION_CONFIRMATION_REQUIRED) {
      return 'AWAITING_ORGANIZATION_VERIFICATION';
    }
    if (input.policy === CompletionPolicy.ADMIN_RESOLUTION_REQUIRED) {
      return 'AWAITING_ADMIN_RESOLUTION';
    }
    if (input.policy === CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW) {
      return 'AWAITING_REVIEW_WINDOW';
    }
    if (input.policy === CompletionPolicy.BOTH_REQUIRED) {
      return 'AWAITING_BOTH';
    }
    return 'AWAITING_CITIZEN_REVIEW';
  }

  private isCompletionSatisfied(input: {
    policy: CompletionPolicy;
    citizenDecision?: CompletionDecision | null;
    organizationDecision?: CompletionDecision | null;
  }) {
    const citizenConfirmed =
      input.citizenDecision === CompletionDecision.CONFIRMED;
    const organizationVerified =
      input.organizationDecision === CompletionDecision.VERIFIED;
    switch (input.policy) {
      case CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED:
        return citizenConfirmed;
      case CompletionPolicy.ORGANIZATION_CONFIRMATION_REQUIRED:
        return organizationVerified;
      case CompletionPolicy.BOTH_REQUIRED:
        return citizenConfirmed && organizationVerified;
      case CompletionPolicy.CITIZEN_OR_ORGANIZATION:
        return citizenConfirmed || organizationVerified;
      case CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW:
        return citizenConfirmed || organizationVerified;
      case CompletionPolicy.ADMIN_RESOLUTION_REQUIRED:
      default:
        return false;
    }
  }

  private assertNoActiveCompletionBlockers(report: {
    completionReviewState?: string | null;
    citizenCompletionDecision?: CompletionDecision | null;
    organizationCompletionDecision?: CompletionDecision | null;
    completionGovernanceHoldReason?: string | null;
    status?: ReportStatus | null;
  }) {
    if (report.status === ReportStatus.CLOSED) {
      throw new ConflictException('Report is already closed');
    }
    if (
      report.completionReviewState === 'DISPUTED' ||
      report.citizenCompletionDecision === CompletionDecision.DISPUTED ||
      report.organizationCompletionDecision === CompletionDecision.ESCALATED
    ) {
      throw new ConflictException('Completion is under dispute');
    }
    if (report.completionGovernanceHoldReason) {
      throw new ConflictException('Completion is on governance hold');
    }
    if (
      report.completionReviewState === 'REWORK_REQUESTED' ||
      report.citizenCompletionDecision ===
        CompletionDecision.REWORK_REQUESTED ||
      report.organizationCompletionDecision ===
        CompletionDecision.REWORK_REQUESTED
    ) {
      throw new ConflictException('Completion rework is required');
    }
  }

  private assertCitizenCanRequestCompletionRework(report: {
    citizenCompletionDecision?: CompletionDecision | null;
  }) {
    if (report.citizenCompletionDecision === CompletionDecision.CONFIRMED) {
      throw new ConflictException(
        'Citizen completion decision has already been submitted for this attempt',
      );
    }
    if (
      report.citizenCompletionDecision === CompletionDecision.REWORK_REQUESTED
    ) {
      throw new ConflictException(
        'Citizen completion rework has already been requested for this attempt',
      );
    }
  }

  private assertOrganizationCanRequestCompletionRework(report: {
    organizationCompletionDecision?: CompletionDecision | null;
  }) {
    if (report.organizationCompletionDecision === CompletionDecision.VERIFIED) {
      throw new ConflictException(
        'Organization completion decision has already been submitted for this attempt',
      );
    }
    if (
      report.organizationCompletionDecision ===
      CompletionDecision.REWORK_REQUESTED
    ) {
      throw new ConflictException(
        'Organization completion rework has already been requested for this attempt',
      );
    }
  }

  private completionGovernanceSummary(report: {
    completionPolicy?: CompletionPolicy | null;
    completionPolicySource?: string | null;
    completionReviewState?: string | null;
    completionReviewDeadlineAt?: Date | string | null;
    completionReviewProcessedAt?: Date | string | null;
    completionFallbackRule?: string | null;
    completionFinalActorType?: string | null;
    completionGovernanceHoldReason?: string | null;
    citizenCompletionDecision?: CompletionDecision | null;
    citizenCompletionDecidedAt?: Date | string | null;
    organizationCompletionDecision?: CompletionDecision | null;
    organizationCompletionDecidedAt?: Date | string | null;
    organizationCompletionDecidedById?: string | null;
    organizationCompletionReason?: string | null;
    completionFinalizedAt?: Date | string | null;
    completionFinalizedById?: string | null;
    completionFinalizedByRole?: UserRole | null;
    completionClosureReason?: string | null;
    completionDisputeReason?: string | null;
  }) {
    return {
      policy:
        report.completionPolicy ??
        CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED,
      policySource: report.completionPolicySource ?? 'LEGACY_DEFAULT',
      reviewState:
        report.completionReviewState ??
        (report.completionFinalizedAt ? 'CLOSED' : 'AWAITING_CITIZEN_REVIEW'),
      reviewDeadlineAt: report.completionReviewDeadlineAt ?? null,
      reviewProcessedAt: report.completionReviewProcessedAt ?? null,
      fallbackRule: report.completionFallbackRule ?? null,
      finalActorType: report.completionFinalActorType ?? null,
      governanceHoldReason: report.completionGovernanceHoldReason ?? null,
      citizenDecision: report.citizenCompletionDecision ?? null,
      citizenDecidedAt: report.citizenCompletionDecidedAt ?? null,
      organizationDecision: report.organizationCompletionDecision ?? null,
      organizationDecidedAt: report.organizationCompletionDecidedAt ?? null,
      organizationDecidedById: report.organizationCompletionDecidedById ?? null,
      organizationReason: report.organizationCompletionReason ?? null,
      finalizedAt: report.completionFinalizedAt ?? null,
      finalizedById: report.completionFinalizedById ?? null,
      finalizedByRole: report.completionFinalizedByRole ?? null,
      closureReason: report.completionClosureReason ?? null,
      disputeReason: report.completionDisputeReason ?? null,
    };
  }

  private async evidenceCountsForReports(reportIds: string[]) {
    const counts = new Map<string, number>();
    if (reportIds.length === 0) return counts;
    const grouped = await this.prisma.evidenceRecord.groupBy({
      by: ['relatedEntityId'],
      where: {
        relatedEntityType: EvidenceRelatedEntityType.REPORT,
        relatedEntityId: { in: reportIds },
      },
      _count: { _all: true },
    });
    grouped.forEach((item) =>
      counts.set(item.relatedEntityId, item._count._all),
    );
    return counts;
  }

  private completionReviewQueueItem(
    report: EnterpriseReportWithEvidence,
    evidenceCount: number,
  ) {
    const governance = this.completionGovernanceSummary(report);
    const deadlineAt = report.completionReviewDeadlineAt
      ? new Date(report.completionReviewDeadlineAt)
      : null;
    const submittedAt = report.completedByProviderAt
      ? new Date(report.completedByProviderAt)
      : null;
    const now = Date.now();
    return {
      id: report.id,
      trackingId: report.id,
      title: report.title,
      category: report.category,
      status: report.status,
      location: this.humanReportLocation(report),
      provider: report.assignedProvider
        ? {
            id: report.assignedProvider.id,
            name: report.assignedProvider.fullName,
            email: report.assignedProvider.email,
          }
        : null,
      providerCompletedAt: report.completedByProviderAt ?? null,
      completionNote: report.completionNote ?? null,
      policy: this.humanCompletionPolicy(governance.policy),
      policyCode: governance.policy,
      policySource: governance.policySource,
      citizenDecisionStatus: this.humanCompletionDecision(
        governance.citizenDecision,
      ),
      organizationDecisionStatus: this.humanCompletionDecision(
        governance.organizationDecision,
      ),
      reviewState: this.humanCompletionReviewState(
        governance.reviewState,
        governance,
      ),
      reviewStateCode: governance.reviewState,
      reviewAgeHours: submittedAt
        ? Math.max(0, Math.floor((now - submittedAt.getTime()) / 36_000) / 100)
        : null,
      reviewDeadlineAt: report.completionReviewDeadlineAt ?? null,
      reviewDeadlineStatus: deadlineAt
        ? deadlineAt.getTime() <= now
          ? 'Expired'
          : 'Pending'
        : 'No deadline',
      dispute: governance.reviewState === 'DISPUTED',
      rework: governance.reviewState === 'REWORK_REQUESTED',
      evidenceCount,
    };
  }

  private humanReportLocation(report: {
    locationName?: string | null;
    locationAddress?: string | null;
    locationLandmark?: string | null;
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }) {
    return (
      [
        report.locationName,
        report.locationAddress,
        report.locationLandmark,
        report.location,
      ]
        .filter(Boolean)
        .join(', ') ||
      (report.latitude && report.longitude
        ? `${report.latitude}, ${report.longitude}`
        : 'Location unavailable')
    );
  }

  private humanCompletionPolicy(policy: string | null) {
    switch (policy) {
      case CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED:
        return 'Citizen confirmation required';
      case CompletionPolicy.ORGANIZATION_CONFIRMATION_REQUIRED:
        return 'Organization verification required';
      case CompletionPolicy.BOTH_REQUIRED:
        return 'Citizen and organization approval required';
      case CompletionPolicy.CITIZEN_OR_ORGANIZATION:
        return 'Citizen or organization approval required';
      case CompletionPolicy.ADMIN_RESOLUTION_REQUIRED:
        return 'Administrator resolution required';
      case CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW:
        return 'Review window with fallback closure';
      default:
        return 'Completion policy pending';
    }
  }

  private humanCompletionDecision(decision: string | null) {
    switch (decision) {
      case CompletionDecision.CONFIRMED:
        return 'Confirmed';
      case CompletionDecision.VERIFIED:
        return 'Verified';
      case CompletionDecision.REWORK_REQUESTED:
        return 'Rework requested';
      case CompletionDecision.DISPUTED:
        return 'Disputed';
      case CompletionDecision.ESCALATED:
        return 'Escalated';
      case CompletionDecision.PENDING:
        return 'Pending';
      default:
        return 'Not recorded';
    }
  }

  private humanCompletionReviewState(
    state: string | null,
    governance: ReturnType<ReportService['completionGovernanceSummary']>,
  ) {
    if (state === 'DISPUTED') return 'Disputed';
    if (state === 'REWORK_REQUESTED') return 'Citizen requested rework';
    if (state === 'AWAITING_ADMIN_RESOLUTION') {
      return 'Administrative resolution required';
    }
    if (state === 'AWAITING_REVIEW_WINDOW') return 'Review window expiring';
    if (state === 'AWAITING_BOTH') return 'Awaiting both approvals';
    if (
      state === 'AWAITING_ORGANIZATION_VERIFICATION' &&
      governance.citizenDecision === CompletionDecision.CONFIRMED
    ) {
      return 'Citizen confirmed - organization pending';
    }
    if (state === 'AWAITING_ORGANIZATION_VERIFICATION') {
      return 'Awaiting organization verification';
    }
    if (state === 'AWAITING_CITIZEN_REVIEW') {
      return 'Organization verified - citizen pending';
    }
    if (state === 'CLOSED') return 'Closed';
    return 'Awaiting completion review';
  }

  private completionDeadlineSkipReason(report: {
    status?: ReportStatus | null;
    completionReviewState?: string | null;
    citizenCompletionDecision?: CompletionDecision | null;
    organizationCompletionDecision?: CompletionDecision | null;
    completionGovernanceHoldReason?: string | null;
    completionReviewProcessedAt?: Date | string | null;
  }) {
    if (report.status === ReportStatus.CLOSED) return 'already_closed';
    if (report.completionReviewProcessedAt) return 'already_processed';
    if (report.completionGovernanceHoldReason) return 'governance_hold';
    if (
      report.completionReviewState === 'DISPUTED' ||
      report.citizenCompletionDecision === CompletionDecision.DISPUTED ||
      report.organizationCompletionDecision === CompletionDecision.ESCALATED
    ) {
      return 'active_dispute';
    }
    if (
      report.completionReviewState === 'REWORK_REQUESTED' ||
      report.citizenCompletionDecision ===
        CompletionDecision.REWORK_REQUESTED ||
      report.organizationCompletionDecision ===
        CompletionDecision.REWORK_REQUESTED
    ) {
      return 'active_rework';
    }
    return null;
  }

  private adminGovernanceQueueConditions(
    stateFilter: string | undefined,
    now: Date,
  ): Prisma.ReportWhereInput[] {
    const conditions: Record<string, Prisma.ReportWhereInput> = {
      ADMIN_RESOLUTION_REQUIRED: {
        completionPolicy: CompletionPolicy.ADMIN_RESOLUTION_REQUIRED,
        status: ReportStatus.COMPLETED_BY_PROVIDER,
      },
      DISPUTED: { completionReviewState: 'DISPUTED' },
      REWORK_ESCALATED: {
        OR: [
          { completionReviewState: 'REWORK_REQUESTED' },
          { organizationCompletionDecision: CompletionDecision.ESCALATED },
        ],
      },
      ON_HOLD: { completionGovernanceHoldReason: { not: null } },
      REVIEW_WINDOW_EXPIRED: {
        status: ReportStatus.COMPLETED_BY_PROVIDER,
        completionPolicy: CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
        completionReviewDeadlineAt: { lte: now },
      },
      APPROVAL_CONFLICT: {
        OR: [
          {
            citizenCompletionDecision: CompletionDecision.CONFIRMED,
            organizationCompletionDecision: CompletionDecision.REWORK_REQUESTED,
          },
          {
            citizenCompletionDecision: CompletionDecision.REWORK_REQUESTED,
            organizationCompletionDecision: CompletionDecision.VERIFIED,
          },
        ],
      },
      REOPENED: { completionReviewState: { startsWith: 'AWAITING_' } },
      GOVERNANCE_CLOSED: {
        status: ReportStatus.CLOSED,
        completionFinalActorType: 'SUPER_ADMIN_GOVERNANCE',
      },
    };
    const normalized = stateFilter?.trim().toUpperCase();
    if (normalized && conditions[normalized]) return [conditions[normalized]];
    return Object.values(conditions);
  }

  private adminGovernanceQueueItem(report: EnterpriseReportWithEvidence) {
    const governance = this.completionGovernanceSummary(report);
    return {
      id: report.id,
      trackingId: report.id,
      title: report.title,
      category: report.category,
      organization: report.organization
        ? { id: report.organization.id, name: report.organization.name }
        : null,
      provider: report.assignedProvider
        ? {
            id: report.assignedProvider.id,
            name: report.assignedProvider.fullName,
            email: report.assignedProvider.email,
          }
        : null,
      policy: this.humanCompletionPolicy(governance.policy),
      policyCode: governance.policy,
      policySource: governance.policySource,
      citizenDecision: this.humanCompletionDecision(governance.citizenDecision),
      organizationDecision: this.humanCompletionDecision(
        governance.organizationDecision,
      ),
      reviewState: this.humanCompletionReviewState(
        governance.reviewState,
        governance,
      ),
      reviewStateCode: governance.reviewState,
      hold: Boolean(governance.governanceHoldReason),
      reviewDeadlineAt: governance.reviewDeadlineAt,
      reviewProcessedAt: governance.reviewProcessedAt,
      finalActorType: governance.finalActorType,
      closureReason: governance.closureReason,
      actions: this.adminGovernanceActionsFor(report),
    };
  }

  private adminGovernanceActionsFor(report: {
    status?: ReportStatus | null;
    completionGovernanceHoldReason?: string | null;
    completionReviewState?: string | null;
  }) {
    const closed = report.status === ReportStatus.CLOSED;
    return {
      resolveAndClose: !closed,
      returnForRework: !closed,
      placeHold: !report.completionGovernanceHoldReason,
      removeHold: Boolean(report.completionGovernanceHoldReason),
      reopen: closed,
      overridePolicy: true,
    };
  }

  private async getAdminGovernanceReport(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  private async getCompletionGovernanceCounters(user: JwtUser) {
    const where = this.buildOrgScope(user);
    const now = new Date();
    const [
      adminResolutionRequired,
      onHold,
      approvalConflict,
      deadlineExpired,
      disputed,
      reopened,
      awaitingCompletionReview,
      citizenConfirmedOrganizationPending,
      reworkRequired,
      verifiedClosed,
    ] = await Promise.all([
      this.prisma.report.count({
        where: {
          ...where,
          completionPolicy: CompletionPolicy.ADMIN_RESOLUTION_REQUIRED,
          status: ReportStatus.COMPLETED_BY_PROVIDER,
        },
      }),
      this.prisma.report.count({
        where: { ...where, completionGovernanceHoldReason: { not: null } },
      }),
      this.prisma.report.count({
        where: {
          ...where,
          OR: [
            {
              citizenCompletionDecision: CompletionDecision.CONFIRMED,
              organizationCompletionDecision:
                CompletionDecision.REWORK_REQUESTED,
            },
            {
              citizenCompletionDecision: CompletionDecision.REWORK_REQUESTED,
              organizationCompletionDecision: CompletionDecision.VERIFIED,
            },
          ],
        },
      }),
      this.prisma.report.count({
        where: {
          ...where,
          status: ReportStatus.COMPLETED_BY_PROVIDER,
          completionPolicy: CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
          completionReviewDeadlineAt: { lte: now },
        },
      }),
      this.prisma.report.count({
        where: { ...where, completionReviewState: 'DISPUTED' },
      }),
      this.prisma.report.count({
        where: {
          ...where,
          status: ReportStatus.COMPLETED_BY_PROVIDER,
          completionFinalizedAt: { not: null },
        },
      }),
      this.prisma.report.count({
        where: {
          ...where,
          status: ReportStatus.COMPLETED_BY_PROVIDER,
          completionReviewState: { not: 'CLOSED' },
        },
      }),
      this.prisma.report.count({
        where: {
          ...where,
          completionReviewState: 'AWAITING_ORGANIZATION_VERIFICATION',
          citizenCompletionDecision: CompletionDecision.CONFIRMED,
        },
      }),
      this.prisma.report.count({
        where: { ...where, completionReviewState: 'REWORK_REQUESTED' },
      }),
      this.prisma.report.count({
        where: {
          ...where,
          status: ReportStatus.CLOSED,
          organizationCompletionDecision: CompletionDecision.VERIFIED,
        },
      }),
    ]);
    return {
      superAdmin: {
        adminResolutionRequired,
        onHold,
        approvalConflict,
        deadlineExpired,
        disputed,
        reopened,
      },
      organization: {
        awaitingCompletionReview,
        citizenConfirmedOrganizationPending,
        reworkRequired,
        disputed,
        verifiedClosed,
      },
      provider: {
        awaitingReview: awaitingCompletionReview,
        reworkRequired,
        underDispute: disputed,
        closed: verifiedClosed,
      },
      citizen: {
        readyForReview: awaitingCompletionReview,
        confirmationRecorded: citizenConfirmedOrganizationPending,
        awaitingOrganization: citizenConfirmedOrganizationPending,
        reworkOrDisputed: reworkRequired + disputed,
        closed: verifiedClosed,
      },
    };
  }

  private requiredGovernanceReason(reason?: string | null) {
    const trimmed = reason?.trim();
    if (!trimmed) throw new BadRequestException('Reason is required');
    return trimmed;
  }

  private assertSuperAdmin(user: JwtUser) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Super Admin completion governance required',
      );
    }
  }

  private async recordGovernanceAction(
    previous: EnterpriseReportWithEvidence,
    updated: EnterpriseReportWithEvidence,
    user: JwtUser,
    input: {
      action: string;
      auditAction: string;
      reason: string;
      notifyType: string;
      notifyTitle: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const metadata = {
      previousState: {
        status: previous.status,
        completionReviewState: previous.completionReviewState,
        completionPolicy: previous.completionPolicy,
        hold: Boolean(previous.completionGovernanceHoldReason),
      },
      newState: {
        status: updated.status,
        completionReviewState: updated.completionReviewState,
        completionPolicy: updated.completionPolicy,
        hold: Boolean(updated.completionGovernanceHoldReason),
      },
      actorId: this.getUserId(user),
      actorRole: user.role,
      timestamp: new Date().toISOString(),
      ...input.metadata,
    };
    await this.recordReportActivity(updated.id, input.action, user, {
      organizationId: updated.organizationId,
      fromStatus: previous.status,
      toStatus: updated.status,
      providerId: updated.assignedProviderId ?? undefined,
      reason: input.reason,
      metadata,
    });
    await this.audit(input.auditAction, user, {
      targetType: 'Report',
      targetId: updated.id,
      organizationId: updated.organizationId,
      reason: input.reason,
      ...metadata,
    });
    await this.createNotification({
      userId: updated.citizenId,
      reportId: updated.id,
      type: input.notifyType,
      title: input.notifyTitle,
      message: `Governance updated "${updated.title}".`,
    });
    await this.notifyOrganizationOperators(updated.organizationId, {
      reportId: updated.id,
      type: input.notifyType,
      title: input.notifyTitle,
      message: `Governance updated "${updated.title}".`,
    });
  }

  private getUserId(user: JwtUser) {
    const id = user.id ?? user.userId ?? user.sub;
    if (!id) throw new ForbiddenException('User id missing');
    return id;
  }

  private requireUserOrganizationId(user: JwtUser) {
    if (!user.organizationId) throw new ForbiddenException('No org');
    return user.organizationId;
  }

  private buildOrgScope(
    user: JwtUser,
    period?: string,
  ): Prisma.ReportWhereInput {
    const where: Prisma.ReportWhereInput = {};

    if (!this.isSuperAdmin(user)) {
      if (!user.organizationId) throw new ForbiddenException('No org');
      where.OR = [
        {
          organizationId: user.organizationId,
          status: { not: ReportStatus.TRIAGE },
        },
        {
          assignedOrganizationId: user.organizationId,
          status: ReportStatus.ORG_REVIEW,
        },
      ];
    }

    if (period) {
      const date = new Date();
      if (period === '7d') date.setDate(date.getDate() - 7);
      if (period === '30d') date.setDate(date.getDate() - 30);
      where.createdAt = { gte: date };
    }

    return where;
  }

  private async getDashboardOrganizationMetrics(user: JwtUser) {
    if (this.isSuperAdmin(user)) {
      const [total, active, suspended, archived] = await Promise.all([
        this.prisma.organization.count(),
        this.prisma.organization.count({ where: { status: 'ACTIVE' } }),
        this.prisma.organization.count({ where: { status: 'SUSPENDED' } }),
        this.prisma.organization.count({ where: { status: 'ARCHIVED' } }),
      ]);
      return { total, active, suspended, archived };
    }

    if (!user.organizationId) return null;
    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: {
        id: true,
        name: true,
        status: true,
        subscriptionPlan: true,
        billingStatus: true,
        allowedReportsPerMonth: true,
      },
    });
    return organization;
  }

  private includeRelations() {
    return {
      citizen: true,
      assignedProvider: true,
      organization: true,
      assignedOrganization: true,
    };
  }

  private serializeOrganizationCandidate(
    organization: ResponsibilityOrganizationProfile,
    category: string,
    report?: {
      location?: string | null;
      locationName?: string | null;
      locationAddress?: string | null;
      locationLandmark?: string | null;
      description?: string | null;
      title?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    },
  ): OrganizationCandidate {
    const profileData =
      organization?.profileData && typeof organization.profileData === 'object'
        ? (organization.profileData as Record<string, unknown>)
        : {};
    const routingProfile =
      profileData.responsibilityRouting &&
      typeof profileData.responsibilityRouting === 'object'
        ? (profileData.responsibilityRouting as Record<string, unknown>)
        : {};
    const mandateCategories = this.collectStringList([
      ...this.jsonStringList(profileData.mandates),
      ...this.jsonStringList(profileData.supportedCategories),
      ...this.jsonStringList(routingProfile.mandateCategories),
      ...this.jsonStringList(routingProfile.supportedCategories),
    ]);
    const excludedCategories = this.collectStringList([
      ...this.jsonStringList(profileData.excludedCategories),
      ...this.jsonStringList(routingProfile.excludedCategories),
    ]);
    const activeProviders = this.organizationActiveProviders(organization);
    const acceptedProviders = this.organizationAcceptedProviders(organization);
    const normalizedCategory = this.normalizeResponsibilityCategory(category);
    const requiredCapabilityIds =
      this.capabilityIdsForCategory(normalizedCategory);
    const explicitCapabilityProviders = activeProviders.filter((provider) =>
      this.activeProviderCapabilityIds(provider).some((id) =>
        requiredCapabilityIds.length
          ? requiredCapabilityIds.includes(id)
          : ACTIVE_MAINTENANCE_CAPABILITIES.has(id),
      ),
    );
    const inheritedProfileProviders = activeProviders.filter(
      (provider) => this.jsonStringList(provider.serviceCategories).length > 0,
    );
    const inheritedCategories = this.collectStringList(
      activeProviders.flatMap((provider) =>
        this.jsonStringList(provider.serviceCategories),
      ),
    );
    const explicitCapabilities = this.collectStringList(
      activeProviders.flatMap((provider) =>
        this.activeProviderCapabilityIds(provider),
      ),
    );
    const coverageAreas = this.collectStringList(
      activeProviders.flatMap((provider) =>
        this.jsonStringList(provider.coverageAreas),
      ),
    );
    const jurisdictionMatchResult = evaluateRoutingJurisdiction(
      organization,
      report,
    );
    const serviceModuleReady = this.maintenanceModuleEnabled(
      organization.enabledModules,
    );
    const normalizedInheritedCategories = inheritedCategories.map((item) =>
      this.normalizeResponsibilityCategory(item),
    );
    const normalizedMandateCategories = mandateCategories.map((item) =>
      this.normalizeResponsibilityCategory(item),
    );
    const normalizedExcludedCategories = excludedCategories.map((item) =>
      this.normalizeResponsibilityCategory(item),
    );
    const inheritedCategoryMatch =
      !normalizedCategory ||
      normalizedInheritedCategories.some((item) =>
        this.categoriesCompatible(item, normalizedCategory),
      );
    const mandateCategoryMatch =
      mandateCategories.length > 0 &&
      normalizedMandateCategories.some((item) =>
        this.categoriesCompatible(item, normalizedCategory),
      );
    const capabilityCategoryMatch =
      requiredCapabilityIds.length > 0 &&
      explicitCapabilityProviders.length > 0;
    const explicitlyExcludedCategory = normalizedExcludedCategories.some(
      (item) => this.categoriesCompatible(item, normalizedCategory),
    );
    const explicitCapabilityBacked = explicitCapabilityProviders.length > 0;
    const jurisdiction = jurisdictionMatchResult.jurisdictionAreas.map((item) =>
      item.toLowerCase(),
    );
    const jurisdictionMatch = jurisdictionMatchResult.matched;
    const responsibilityCategoryConfigured =
      mandateCategoryMatch || inheritedCategoryMatch || capabilityCategoryMatch;
    const reasons: string[] = [];
    if (organization.status !== OrganizationStatus.ACTIVE) {
      reasons.push('Organization is not active.');
    }
    if (!serviceModuleReady) {
      reasons.push(
        'Maintenance Services is not enabled for this organization.',
      );
    }
    if (
      organization.billingStatus === BillingStatus.SUSPENDED ||
      organization.billingStatus === BillingStatus.CANCELLED
    ) {
      reasons.push('Organization billing status blocks dispatch.');
    }
    if (!organization.contactEmail && !organization.contactPhone) {
      reasons.push('Organization contact channel is missing.');
    }
    if (!jurisdictionMatchResult.configured) {
      reasons.push('Organization jurisdiction or address is missing.');
    }
    if (!jurisdictionMatchResult.comparableLocationAvailable) {
      reasons.push(
        'Report has no comparable textual locality for jurisdiction matching.',
      );
    }
    if (
      !inheritedCategories.length &&
      !mandateCategories.length &&
      !explicitCapabilityBacked
    ) {
      reasons.push(
        'No mandate or inherited provider profile categories are configured.',
      );
    } else if (
      !inheritedCategoryMatch &&
      !mandateCategoryMatch &&
      !capabilityCategoryMatch
    ) {
      reasons.push(
        `No organization mandate or provider profile covers ${category}.`,
      );
    }
    if (explicitlyExcludedCategory) {
      reasons.push(
        `Organization has an explicit responsibility exclusion for ${category}.`,
      );
    }
    if (!jurisdictionMatch) {
      reasons.push(
        'Organization jurisdiction does not match the report location.',
      );
    }
    const eligible = reasons.length === 0;
    const confidence = !eligible
      ? explicitCapabilityBacked ||
        inheritedCategoryMatch ||
        mandateCategoryMatch
        ? 'LOW'
        : 'NONE'
      : explicitCapabilityBacked && jurisdictionMatch
        ? 'HIGH'
        : 'MEDIUM';
    const providerCapabilitySource = explicitCapabilityBacked
      ? 'EXPLICIT_PROVIDER_CAPABILITY'
      : inheritedCategoryMatch
        ? 'INHERITED_PROVIDER_PROFILE'
        : 'NONE';
    const organizationCapabilitySource = mandateCategoryMatch
      ? 'ORGANIZATION_MANDATE'
      : 'NONE';
    const categorySource = explicitCapabilityBacked
      ? 'EXPLICIT_CAPABILITY_METADATA'
      : mandateCategoryMatch
        ? 'ORGANIZATION_MANDATE'
        : inheritedCategoryMatch
          ? 'INHERITED_PROVIDER_PROFILE'
          : capabilityCategoryMatch
            ? 'GOVERNED_FALLBACK_MAPPING'
            : 'NONE';
    const diagnostics = {
      organizationId: organization.id,
      organizationName: organization.name,
      organizationStatus: organization.status ?? null,
      organizationVerificationState:
        organization.identityVerificationStatus ??
        organization.verificationStatus ??
        null,
      originalCategory: category,
      normalizedCategory,
      matchedMaintenanceCapabilities: requiredCapabilityIds,
      providerCapabilitySource,
      organizationCapabilitySource,
      capabilitySource: categorySource,
      coverageComparison: {
        reportLocation: report?.location ?? null,
        organizationCoverage: coverageAreas,
        matched:
          coverageAreas.length === 0 ||
          !jurisdictionMatchResult.diagnosticText ||
          coverageAreas.some((item) =>
            jurisdictionMatchResult.diagnosticText.includes(item.toLowerCase()),
          ),
      },
      jurisdictionComparison: {
        reportText: jurisdictionMatchResult.locationText,
        diagnosticText: jurisdictionMatchResult.diagnosticText,
        organizationJurisdiction: jurisdiction,
        configuredZones: jurisdictionMatchResult.configuredZones,
        source: jurisdictionMatchResult.source,
        level: jurisdictionMatchResult.level,
        reason: jurisdictionMatchResult.reason,
        comparableLocationAvailable:
          jurisdictionMatchResult.comparableLocationAvailable,
        legacyFallback: jurisdictionMatchResult.legacyFallback,
        matched: jurisdictionMatch,
      },
      confidence,
      finalEligibilityDecision: eligible,
      rejectedReasons: reasons,
      providerDiagnostics: activeProviders.map((provider) => {
        const providerCategories = this.jsonStringList(
          provider.serviceCategories,
        );
        const providerCapabilities = this.activeProviderCapabilityIds(provider);
        const providerCategoryMatch = providerCategories
          .map((item) => this.normalizeResponsibilityCategory(item))
          .some((item) => this.categoriesCompatible(item, normalizedCategory));
        const providerCapabilityMatch = providerCapabilities.some((id) =>
          requiredCapabilityIds.length
            ? requiredCapabilityIds.includes(id)
            : ACTIVE_MAINTENANCE_CAPABILITIES.has(id),
        );
        return {
          providerId: provider.id,
          categories: providerCategories,
          capabilities: providerCapabilities,
          categoryMatch: providerCategoryMatch,
          capabilityMatch: providerCapabilityMatch,
          acceptedMembership: acceptedProviders.some(
            (accepted) => accepted.id === provider.id,
          ),
          rejectedReasons: [
            ...(providerCategoryMatch || providerCapabilityMatch
              ? []
              : [
                  'Provider category/capability does not match report category',
                ]),
          ],
        };
      }),
    };

    this.logger.debug(
      diagnostics,
      'Organization responsibility eligibility decision',
    );

    return {
      type: 'ORGANIZATION',
      id: organization.id,
      name: organization.name,
      eligible,
      ready: eligible,
      reasons,
      exclusionReasons: reasons,
      categoryMatch: {
        requestedCategory: category,
        normalizedCategory,
        matched:
          inheritedCategoryMatch ||
          mandateCategoryMatch ||
          capabilityCategoryMatch,
        matchedMaintenanceCapabilities: requiredCapabilityIds,
        source: categorySource,
      },
      jurisdictionMatch,
      serviceModuleReady,
      confidence,
      activeProviderCount: activeProviders.length,
      acceptedProviderCount: acceptedProviders.length,
      capabilityBackedProviderCount: explicitCapabilityProviders.length,
      inheritedProfileProviderCount: inheritedProfileProviders.length,
      verifiedCapabilityProviderCount: explicitCapabilityProviders.length,
      coveredCategories: inheritedCategories,
      mandateCategories,
      excludedCategories,
      inheritedProfileCategories: inheritedCategories,
      explicitCapabilities,
      readiness: {
        organizationMembers: (organization.users ?? []).length,
        acceptedProviders: acceptedProviders.length,
        activeProviders: activeProviders.length,
        providersWithExplicitCapabilityMetadata:
          explicitCapabilityProviders.length,
        providersWithInheritedProfileCategories:
          inheritedProfileProviders.length,
        verifiedCapabilities: explicitCapabilities,
        maintenanceServicesEnabled: serviceModuleReady,
        responsibilityCategoryConfigured,
        providerDispatchCapacityAvailable: activeProviders.length > 0,
        jurisdictionConfigured: jurisdictionMatchResult.configured,
        jurisdictionSource: jurisdictionMatchResult.source,
        jurisdictionLevel: jurisdictionMatchResult.level,
        comparableLocationAvailable:
          jurisdictionMatchResult.comparableLocationAvailable,
        legacyJurisdictionFallback: jurisdictionMatchResult.legacyFallback,
        mandateCategories,
      },
      diagnostics,
      jurisdictionSummary: {
        country: organization.country,
        state: organization.state,
        lga: organization.lga,
        address: organization.address,
        configuredZones: jurisdictionMatchResult.jurisdictionAreas,
        configuredZoneDetails: jurisdictionMatchResult.configuredZones,
        source: jurisdictionMatchResult.source,
        level: jurisdictionMatchResult.level,
        reason: jurisdictionMatchResult.reason,
        comparableLocationAvailable:
          jurisdictionMatchResult.comparableLocationAvailable,
        legacyFallback: jurisdictionMatchResult.legacyFallback,
        coverageAreas,
      },
    };
  }

  private organizationActiveProviders(
    organization: ResponsibilityOrganizationProfile,
  ): ResponsibilityProviderProfile[] {
    const providers = new Map<string, ResponsibilityProviderProfile>();
    for (const link of organization.providerLinks ?? []) {
      const provider = link.provider;
      if (provider?.id && provider.accountStatus === 'ACTIVE') {
        providers.set(provider.id, provider);
      }
    }
    for (const provider of organization.users ?? []) {
      if (provider.id && provider.accountStatus === 'ACTIVE') {
        providers.set(provider.id, provider);
      }
    }
    return Array.from(providers.values());
  }

  private organizationAcceptedProviders(
    organization: ResponsibilityOrganizationProfile,
  ): ResponsibilityProviderProfile[] {
    const providers = new Map<string, ResponsibilityProviderProfile>();
    for (const link of organization.providerLinks ?? []) {
      const provider = link.provider;
      if (provider?.id && provider.accountStatus === 'ACTIVE') {
        providers.set(provider.id, provider);
      }
    }
    return Array.from(providers.values());
  }

  private activeProviderCapabilityIds(provider: ResponsibilityProviderProfile) {
    const profileData =
      provider?.profileData && typeof provider.profileData === 'object'
        ? (provider.profileData as Record<string, unknown>)
        : {};
    const assignments = profileData[PROVIDER_CAPABILITIES_KEY];
    if (!Array.isArray(assignments)) return [];
    return (assignments as unknown[])
      .filter((item): item is Record<string, unknown> => {
        if (!item || typeof item !== 'object') return false;
        const record = item as Record<string, unknown>;
        const status = record['status'];
        if (status == null) return true;
        if (
          typeof status !== 'string' &&
          typeof status !== 'number' &&
          typeof status !== 'boolean'
        ) {
          return false;
        }
        return String(status) === 'ACTIVE';
      })
      .map((item) => item.id?.toString().trim() ?? '')
      .filter((item) => item.length > 0);
  }

  private maintenanceModuleEnabled(value: unknown) {
    if (value == null) return true;
    if (Array.isArray(value)) {
      return value.length === 0 || value.map(String).includes('maintenance');
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.maintenance === false) return false;
      const modules = record.modules;
      if (Array.isArray(modules))
        return modules.map(String).includes('maintenance');
      const enabledModules = record.enabledModules;
      if (Array.isArray(enabledModules)) {
        return enabledModules.map(String).includes('maintenance');
      }
    }
    return true;
  }

  private routingDiagnostics(
    report: { status: string; organizationAssignmentSource?: string | null },
    candidates: OrganizationCandidate[],
  ) {
    const eligible = candidates.filter((candidate) => candidate.eligible);
    return {
      status: report.status,
      automaticRouting: {
        source: report.organizationAssignmentSource ?? null,
        skipped: report.status === ReportStatus.TRIAGE,
        matchCount: eligible.length,
        reason:
          report.status !== ReportStatus.TRIAGE
            ? 'Report was routed to organization review.'
            : eligible.length === 0
              ? 'Automatic routing skipped because no deterministic eligible organization matched.'
              : eligible.length === 1
                ? 'Automatic routing is available for one eligible organization but was not applied to this existing report.'
                : 'Automatic routing skipped because multiple eligible organizations matched.',
      },
      eligibleOrganizationCount: eligible.length,
      candidateCount: candidates.length,
    };
  }

  private async resolveReportResponsibility(
    dto: CreateReportDto,
  ): Promise<ResponsibilityResolution> {
    if (!dto.category?.trim()) {
      return this.responsibilityResolutionResult(dto, {
        outcome: 'NO_CATEGORY',
        organization: null,
        candidates: [],
        allCandidates: [],
        reasons: ['Report category is missing'],
        matchFactors: [],
      });
    }

    if (!this.hasResponsibilityLocation(dto)) {
      return this.responsibilityResolutionResult(dto, {
        outcome: 'NO_LOCATION',
        organization: null,
        candidates: [],
        allCandidates: [],
        reasons: ['Report location is missing'],
        matchFactors: [],
      });
    }

    const organizations = await this.prisma.organization.findMany({
      where: { status: OrganizationStatus.ACTIVE },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        providerLinks: {
          where: { active: true },
          include: {
            provider: {
              select: {
                id: true,
                accountStatus: true,
                serviceCategories: true,
                coverageAreas: true,
                profileData: true,
              },
            },
          },
        },
        users: {
          where: { role: UserRole.PROVIDER, accountStatus: 'ACTIVE' },
          select: {
            id: true,
            accountStatus: true,
            serviceCategories: true,
            coverageAreas: true,
            profileData: true,
          },
        },
      },
    });
    const jurisdictionZones = await this.prisma.jurisdictionZone.findMany({
      where: {
        active: true,
        organizationId: {
          in: organizations.map((organization) => organization.id),
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const zonesByOrganization = new Map<string, typeof jurisdictionZones>();
    for (const zone of jurisdictionZones) {
      if (!zone.organizationId) continue;
      zonesByOrganization.set(zone.organizationId, [
        ...(zonesByOrganization.get(zone.organizationId) ?? []),
        zone,
      ]);
    }
    const assetOrganizationIds =
      await this.assetResponsibilityOrganizationIds(dto);
    const allCandidates = organizations.map((organization) => ({
      organization,
      candidate: this.serializeOrganizationCandidate(
        {
          ...organization,
          jurisdictionZones: zonesByOrganization.get(organization.id) ?? [],
        },
        dto.category,
        dto,
      ),
    }));
    const evaluated = allCandidates.filter(
      ({ candidate }) => candidate.eligible,
    );

    const restricted = allCandidates
      .map(({ candidate }) => candidate)
      .filter((candidate) =>
        candidate.reasons.some((reason: string) =>
          reason.toLowerCase().includes('explicit responsibility exclusion'),
        ),
      );
    if (restricted.length > 0) {
      return this.responsibilityResolutionResult(dto, {
        outcome: 'RESTRICTED_OR_CONFLICTED',
        organization: null,
        candidates: restricted,
        allCandidates: allCandidates.map(({ candidate }) => candidate),
        reasons: restricted.flatMap((candidate) => candidate.reasons),
        matchFactors: ['explicit_exclusion_or_restriction'],
      });
    }

    const assetBacked = assetOrganizationIds.length
      ? evaluated.filter(({ organization }) =>
          assetOrganizationIds.includes(organization.id),
        )
      : [];
    const decisive = assetBacked.length > 0 ? assetBacked : evaluated;
    const matchFactors = [
      ...(assetBacked.length > 0 ? ['asset_or_ownership_responsibility'] : []),
      'organization_active_status',
      'operational_availability',
      'organization_jurisdiction',
      'mandate_or_supported_category',
    ];

    if (decisive.length === 1) {
      return this.responsibilityResolutionResult(dto, {
        outcome: 'HIGH_CONFIDENCE',
        organization: decisive[0].organization,
        candidates: decisive.map(({ candidate }) => candidate),
        allCandidates: allCandidates.map(({ candidate }) => candidate),
        reasons: decisive[0].candidate.reasons,
        matchFactors,
      });
    }

    if (decisive.length > 1) {
      return this.responsibilityResolutionResult(dto, {
        outcome: 'AMBIGUOUS',
        organization: null,
        candidates: decisive.map(({ candidate }) => candidate),
        allCandidates: allCandidates.map(({ candidate }) => candidate),
        reasons: ['Multiple responsible organizations qualified'],
        matchFactors,
      });
    }

    return this.responsibilityResolutionResult(dto, {
      outcome: 'UNMATCHED',
      organization: null,
      candidates: [],
      allCandidates: allCandidates.map(({ candidate }) => candidate),
      reasons: ['No active operational organization matched deterministically'],
      matchFactors,
    });
  }

  private responsibilityResolutionResult(
    dto: CreateReportDto,
    input: {
      outcome: ResponsibilityOutcome;
      organization: { id: string } | null;
      candidates: OrganizationCandidate[];
      allCandidates: OrganizationCandidate[];
      reasons: string[];
      matchFactors: string[];
    },
  ): ResponsibilityResolution {
    return {
      outcome: input.outcome,
      organization: input.organization,
      candidates: input.candidates,
      reasons: input.reasons,
      matchFactors: input.matchFactors,
      diagnostics: this.responsibilityResolutionDiagnostics(dto, input),
    };
  }

  private hasResponsibilityLocation(dto: CreateReportDto) {
    return routingLocationText(dto).length > 0;
  }

  private responsibilityResolutionDiagnostics(
    dto: CreateReportDto,
    input: {
      outcome: ResponsibilityOutcome;
      organization: { id: string } | null;
      candidates: OrganizationCandidate[];
      allCandidates: OrganizationCandidate[];
      reasons: string[];
      matchFactors: string[];
    },
  ): ResponsibilityResolutionDiagnostics {
    const normalizedCategory = dto.category?.trim()
      ? this.normalizeResponsibilityCategory(dto.category)
      : null;
    const candidates = input.allCandidates.length
      ? input.allCandidates
      : input.candidates;
    return {
      outcome: this.canonicalResponsibilityOutcome(input.outcome),
      candidateCount: candidates.length,
      eligibleCandidateCount: candidates.filter(
        (candidate) => candidate.eligible,
      ).length,
      proposedOrganizationId: input.organization?.id,
      selectedCandidateId: input.organization?.id,
      reasonCode: this.responsibilityReasonCode(input.outcome, candidates),
      evaluatedAt: new Date().toISOString(),
      report: {
        category: dto.category?.trim() || null,
        normalizedCategory,
        normalizedCategoryAliases: normalizedCategory
          ? this.normalizedCategoryAliases(normalizedCategory)
          : [],
        coordinates: {
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
        },
        location: {
          text: dto.location?.trim() || null,
          name: dto.locationName?.trim() || null,
          address: dto.locationAddress?.trim() || null,
          landmark: dto.locationLandmark?.trim() || null,
          source: dto.locationSource ?? this.locationSourceFor(dto),
        },
      },
      candidates: candidates.map((candidate) => ({
        organizationId: candidate.id,
        organizationName: candidate.name,
        organizationStatus:
          candidate.diagnostics?.organizationStatus == null
            ? null
            : String(candidate.diagnostics.organizationStatus),
        organizationVerificationState:
          candidate.diagnostics?.organizationVerificationState == null
            ? null
            : String(candidate.diagnostics.organizationVerificationState),
        mandateCategories: candidate.mandateCategories ?? [],
        providerCategories: candidate.inheritedProfileCategories ?? [],
        coverageAreas: candidate.jurisdictionSummary?.coverageAreas ?? [],
        jurisdictionSource: candidate.jurisdictionSummary?.source,
        jurisdictionLevel: candidate.jurisdictionSummary?.level,
        eligible: Boolean(candidate.eligible),
        confidence: candidate.confidence ?? null,
        reasons: candidate.reasons ?? [],
      })),
    };
  }

  private canonicalResponsibilityOutcome(
    outcome: ResponsibilityOutcome,
  ): CanonicalResponsibilityOutcome {
    switch (outcome) {
      case 'HIGH_CONFIDENCE':
        return 'MATCHED';
      case 'RESTRICTED_OR_CONFLICTED':
        return 'RESTRICTED';
      case 'NO_CATEGORY':
      case 'NO_LOCATION':
      case 'AMBIGUOUS':
      case 'UNMATCHED':
        return outcome;
    }
  }

  private responsibilityReasonCode(
    outcome: ResponsibilityOutcome,
    candidates: OrganizationCandidate[],
  ) {
    switch (outcome) {
      case 'HIGH_CONFIDENCE':
        return 'MATCHED_DETERMINISTIC';
      case 'AMBIGUOUS':
        return 'MULTIPLE_ELIGIBLE_CANDIDATES';
      case 'RESTRICTED_OR_CONFLICTED':
        return 'EXPLICIT_EXCLUSION_OR_RESTRICTION';
      case 'NO_LOCATION':
        return 'NO_LOCATION_PROVIDED';
      case 'NO_CATEGORY':
        return 'NO_CATEGORY_PROVIDED';
      case 'UNMATCHED':
      default:
        return candidates.length === 0
          ? 'NO_ORGANIZATION_CANDIDATES'
          : 'NO_ELIGIBLE_ORGANIZATION';
    }
  }

  private normalizedCategoryAliases(normalizedCategory: string) {
    const aliases = Object.keys(CATEGORY_CAPABILITY_ALIASES).filter((alias) =>
      this.categoriesCompatible(alias, normalizedCategory),
    );
    return this.collectStringList([normalizedCategory, ...aliases]);
  }

  private async assetResponsibilityOrganizationIds(dto: CreateReportDto) {
    const category = dto.category?.trim();
    const location = dto.location?.trim();
    const potentialAsset =
      this.prismaDelegate<PrismaFindManyDelegate<PotentialAssetRecord>>(
        'potentialAsset',
      );
    if (!potentialAsset || !category) return [];

    const potentialAssets = await potentialAsset.findMany({
      where: {
        category,
        OR: [
          { organizationId: { not: null } },
          ...(location ? [{ locationText: { contains: location } }] : []),
        ],
      },
      select: { id: true, organizationId: true, ownershipStatus: true },
      take: 25,
    });
    const ids = new Set<string>();
    for (const asset of potentialAssets) {
      if (
        asset.organizationId &&
        asset.ownershipStatus !== 'DISPUTED' &&
        asset.ownershipStatus !== 'UNKNOWN'
      ) {
        ids.add(asset.organizationId);
      }
    }

    const assetIds = potentialAssets.map((asset) => asset.id);
    const assetCandidateOwner = this.prismaDelegate<
      PrismaFindManyDelegate<AssetCandidateOwnerRecord>
    >('assetCandidateOwner');
    if (assetIds.length && assetCandidateOwner) {
      const owners = await assetCandidateOwner.findMany({
        where: {
          potentialAssetId: { in: assetIds },
          organizationId: { not: null },
          ownershipStatus: { in: ['VERIFIED', 'PENDING'] },
        },
        select: { organizationId: true },
        take: 25,
      });
      for (const owner of owners) {
        if (owner.organizationId) ids.add(owner.organizationId);
      }
    }

    const assetClaim =
      this.prismaDelegate<PrismaFindManyDelegate<AssetClaimRecord>>(
        'assetClaim',
      );
    if (assetIds.length && assetClaim) {
      const claims = await assetClaim.findMany({
        where: {
          potentialAssetId: { in: assetIds },
          claimantOrganizationId: { not: null },
          status: 'APPROVED',
        },
        select: { claimantOrganizationId: true },
        take: 25,
      });
      for (const claim of claims) {
        if (claim.claimantOrganizationId) ids.add(claim.claimantOrganizationId);
      }
    }

    return [...ids];
  }

  private providerMatchesCategory(
    provider: { serviceCategories?: unknown },
    category: string,
  ) {
    const categories = this.jsonStringList(provider.serviceCategories);
    const normalizedCategory = this.normalizeResponsibilityCategory(category);
    return (
      categories.length === 0 ||
      categories
        .map((item) => this.normalizeResponsibilityCategory(item))
        .some((item) => this.categoriesCompatible(item, normalizedCategory))
    );
  }

  private normalizeResponsibilityCategory(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private capabilityIdsForCategory(normalizedCategory: string) {
    if (!normalizedCategory) return [];
    const direct = CATEGORY_CAPABILITY_ALIASES[normalizedCategory] ?? [];
    const fuzzy = Object.entries(CATEGORY_CAPABILITY_ALIASES)
      .filter(
        ([category]) =>
          normalizedCategory.includes(category) ||
          category.includes(normalizedCategory),
      )
      .flatMap(([, capabilities]) => capabilities);
    return Array.from(new Set([...direct, ...fuzzy]));
  }

  private categoriesCompatible(left: string, right: string) {
    if (!left || !right) return true;
    if (left === right) return true;
    if (left.includes(right) || right.includes(left)) return true;
    const leftCapabilities = this.capabilityIdsForCategory(left);
    const rightCapabilities = this.capabilityIdsForCategory(right);
    return leftCapabilities.some((item) => rightCapabilities.includes(item));
  }

  private jsonStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0);
  }

  private collectStringList(values: string[]) {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }

  private locationSourceFor(dto: {
    latitude?: number | null;
    longitude?: number | null;
    locationName?: string | null;
    locationAddress?: string | null;
    locationLandmark?: string | null;
  }) {
    const hasCoordinates = dto.latitude != null && dto.longitude != null;
    const hasText = Boolean(
      dto.locationName?.trim() ||
      dto.locationAddress?.trim() ||
      dto.locationLandmark?.trim(),
    );
    if (hasCoordinates && hasText) return 'COMBINED';
    if (hasCoordinates) return 'DEVICE_GPS';
    if (hasText) return 'TYPED_LOCATION';
    return 'UNKNOWN';
  }

  private async enforceMonthlyReportQuota(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { allowedReportsPerMonth: true },
    });
    if (organization?.allowedReportsPerMonth == null) return;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const reportsThisMonth = await this.prisma.report.count({
      where: { organizationId, createdAt: { gte: monthStart } },
    });
    if (reportsThisMonth >= organization.allowedReportsPerMonth) {
      throw new ConflictException({
        code: 'REPORT_QUOTA_EXCEEDED',
        message: 'This organization has reached its monthly report quota.',
      });
    }
  }

  private completionLocationSourceFor(dto: {
    completionLatitude?: number | null;
    completionLongitude?: number | null;
  }) {
    return dto.completionLatitude != null && dto.completionLongitude != null
      ? 'DEVICE_GPS'
      : 'UNKNOWN';
  }

  private completionLocationMetadata(report: {
    completionLatitude?: number | null;
    completionLongitude?: number | null;
    completionAccuracy?: number | null;
    completionLocationCapturedAt?: Date | string | null;
    completionLocationSource?: string | null;
  }) {
    return {
      latitude: report.completionLatitude ?? null,
      longitude: report.completionLongitude ?? null,
      accuracy: report.completionAccuracy ?? null,
      capturedAt: report.completionLocationCapturedAt ?? null,
      source: report.completionLocationSource ?? 'UNKNOWN',
    };
  }

  private normalizeCompletionEvidenceFields(params: {
    imageUrl?: string | null;
    imagePath?: string | null;
  }) {
    const imagePath =
      this.extractLocalUploadPath(params.imagePath) ??
      this.extractLocalUploadPath(params.imageUrl);
    const imageUrl = imagePath
      ? `/uploads/${imagePath}`
      : this.normalizeExternalImageUrl(params.imageUrl);

    return {
      imageUrl,
      imagePath,
    };
  }

  private normalizeExternalImageUrl(value?: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    const localPath = this.extractLocalUploadPath(trimmed);
    if (localPath) return `/uploads/${localPath}`;

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    return null;
  }

  private extractLocalUploadPath(value?: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    let path = trimmed.replace(/\\/g, '/');

    try {
      const parsed = new URL(trimmed);
      path = parsed.pathname;
    } catch {
      // Keep non-URL values as-is.
    }

    path = path.replace(/^\/+/, '');
    if (path.startsWith('uploads/')) {
      path = path.slice('uploads/'.length);
    }

    if (!/^(report-completion|report-evidence|demo)\//.test(path)) {
      return null;
    }

    const segments = path.split('/');
    if (
      segments.some(
        (segment) => segment === '' || segment === '.' || segment === '..',
      )
    ) {
      return null;
    }

    if (!/^[A-Za-z0-9._~/-]+$/.test(path)) {
      return null;
    }

    return path;
  }

  private async withEnterpriseReportDetails<
    T extends EnterpriseReportWithEvidence,
  >(report: T) {
    const notification =
      this.prismaDelegate<PrismaFindManyDelegate<OptionalNotificationRecord>>(
        'notification',
      );
    const evidenceRecord =
      this.prismaDelegate<PrismaFindManyDelegate<OptionalEvidenceRecord>>(
        'evidenceRecord',
      );
    const [timeline, notifications, evidenceRecords, providerPerformance] =
      await Promise.all([
        this.reportActivityTimeline(report.id),
        notification
          ? notification.findMany({
              where: { reportId: report.id },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 25,
            })
          : Promise.resolve([]),
        evidenceRecord
          ? evidenceRecord.findMany({
              where: {
                relatedEntityType: EvidenceRelatedEntityType.REPORT,
                relatedEntityId: report.id,
              },
              orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
            })
          : Promise.resolve([]),
        this.providerPerformanceForReportDetail(report),
      ]);

    const protectedReport = this.withProtectedEvidenceUrls(report);
    const evidenceItems = this.reportEvidenceItems(
      protectedReport,
      report,
      evidenceRecords,
    );
    const responsibilityResolution =
      this.responsibilityResolutionFromActivity(timeline);
    const routingReason = this.responsibilityRoutingReason(
      protectedReport,
      responsibilityResolution,
    );
    const queueState = this.responsibilityQueueState(
      protectedReport,
      responsibilityResolution,
    );
    const locationTrust = this.reportLocationTrustPayload(protectedReport);
    return {
      ...protectedReport,
      locationTrust,
      responsibilityReason: routingReason,
      resolverConfidence: this.responsibilityResolverConfidence(
        responsibilityResolution,
      ),
      responsibilityResolution,
      diagnosticsAvailable: responsibilityResolution !== null,
      eligibleForResponsibilityReview:
        queueState.eligibleForResponsibilityReview,
      eligibilityReason: queueState.eligibilityReason,
      queueOrganizationId: queueState.queueOrganizationId,
      dispatchAllowed: queueState.dispatchAllowed,
      manualOverrideOccurred: queueState.manualOverrideOccurred,
      evidenceCount: evidenceItems.length,
      evidenceItems,
      enterpriseDetails: {
        evidenceItems,
        originalEvidence: {
          imageUrl: protectedReport.evidenceImageUrl ?? null,
          imagePath: protectedReport.evidenceImagePath ?? null,
          locationTrust,
        },
        completionEvidence: {
          note: protectedReport.completionNote ?? null,
          imageUrl: protectedReport.completionImageUrl ?? null,
          imagePath: protectedReport.completionImagePath ?? null,
          submittedAt: protectedReport.completedByProviderAt ?? null,
          location: this.completionLocationMetadata(protectedReport),
          geoTrust: evidenceItems
            .filter((item) => item.kind === 'report-completion')
            .map((item) => item.geoTrust)
            .filter(Boolean),
        },
        citizenReview: {
          rating: protectedReport.citizenRating ?? null,
          feedback: protectedReport.citizenFeedback ?? null,
          incompleteReason: protectedReport.completionRejectionReason ?? null,
        },
        completionGovernance: this.completionGovernanceSummary(protectedReport),
        providerPerformance,
        assignment: {
          assignedAt: protectedReport.assignedAt ?? null,
          deadlineAt: protectedReport.assignmentDeadlineAt ?? null,
          status: this.assignmentPresentationStatus(protectedReport),
          lastOutcome: protectedReport.lastAssignmentOutcome ?? null,
          lastReason: protectedReport.lastAssignmentReason ?? null,
          lastProviderId: protectedReport.lastAssignmentProviderId ?? null,
        },
        timeline,
        notifications,
      },
    };
  }

  private async providerPerformanceForReportDetail(report: {
    assignedProviderId?: string | null;
    organizationId: string;
  }) {
    if (!report.assignedProviderId) return null;

    const userDelegate = (
      this.prisma as unknown as {
        user?: {
          findUnique(args: {
            where: { id: string };
            select: {
              id: true;
              fullName: true;
              email: true;
              providerId: true;
            };
          }): Promise<{
            id: string;
            fullName: string | null;
            email: string | null;
            providerId: string | null;
          } | null>;
        };
      }
    ).user;
    if (!userDelegate) return null;

    const provider = await userDelegate.findUnique({
      where: { id: report.assignedProviderId },
      select: {
        id: true,
        fullName: true,
        email: true,
        providerId: true,
      },
    });
    if (!provider) return null;

    const assignedReports = await this.prisma.report.findMany({
      where: {
        assignedProviderId: provider.id,
        organizationId: report.organizationId,
      },
      include: {
        activities: {
          where: { action: 'PROVIDER_STARTED_WORK' },
          orderBy: { createdAt: 'asc' },
          select: {
            actorUserId: true,
            providerId: true,
            createdAt: true,
          },
        },
      },
    });
    const completed = assignedReports.filter(
      (item) => item.status === ReportStatus.CLOSED,
    );
    const rated = completed.filter(
      (item) => typeof item.citizenRating === 'number',
    );
    const ratingTotal = rated.reduce(
      (sum, item) => sum + (item.citizenRating ?? 0),
      0,
    );
    const responseMetric = this.calculateProviderAverageResponse(
      assignedReports,
      provider.id,
    );

    return {
      providerId: provider.id,
      publicProviderId: provider.providerId,
      fullName: provider.fullName,
      email: provider.email,
      organizationId: report.organizationId,
      assignedCount: assignedReports.length,
      completedJobs: completed.length,
      totalCompleted: completed.length,
      averageRating:
        rated.length === 0
          ? 0
          : Number((ratingTotal / rated.length).toFixed(2)),
      ratingCount: rated.length,
      averageResponseHours:
        responseMetric.averageHours == null
          ? null
          : Number(responseMetric.averageHours.toFixed(2)),
      averageResponseReason: responseMetric.reason,
      averageResponseSampleCount: responseMetric.sampleCount,
    };
  }

  private async reportActivityTimeline(reportId: string) {
    const activity =
      this.prismaDelegate<PrismaFindManyDelegate<OptionalReportActivityRecord>>(
        'reportActivity',
      );
    return activity
      ? activity.findMany({
          where: { reportId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve([]);
  }

  private assignmentPresentationStatus(report: {
    status?: ReportStatus | null;
    assignmentDeadlineAt?: Date | string | null;
    assignedProviderId?: string | null;
  }) {
    if (report.status === ReportStatus.CLOSED) return 'Closed';
    if (
      report.status === ReportStatus.COMPLETED_BY_PROVIDER ||
      report.status === ReportStatus.IN_PROGRESS
    ) {
      return 'Assignment completed';
    }
    const deadline = report.assignmentDeadlineAt
      ? new Date(report.assignmentDeadlineAt)
      : null;
    if (!deadline || Number.isNaN(deadline.getTime())) {
      return report.assignedProviderId ? 'Assigned' : null;
    }
    const diff = deadline.getTime() - Date.now();
    if (diff < 0) {
      const minutes = Math.max(1, Math.floor(Math.abs(diff) / 60_000));
      if (minutes >= 60) {
        return `Assignment overdue by ${Math.floor(minutes / 60)}h`;
      }
      return `Assignment overdue by ${minutes}m`;
    }
    const minutes = Math.max(1, Math.floor(diff / 60_000));
    if (minutes >= 60) {
      return `Assignment expires in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    }
    return `Assignment expires in ${minutes}m`;
  }

  private responsibilityResolutionFromActivity(
    timeline: OptionalReportActivityRecord[],
  ): ResponsibilityResolutionDiagnostics | null {
    const newestFirst = [...timeline].reverse();
    for (const item of newestFirst) {
      const metadata = this.recordObject(item.metadata);
      const resolution = metadata?.responsibilityResolution;
      if (resolution && typeof resolution === 'object') {
        return resolution as ResponsibilityResolutionDiagnostics;
      }
    }
    return null;
  }

  private responsibilityRoutingReason(
    report: { organizationAssignmentSource?: string | null },
    resolution: ResponsibilityResolutionDiagnostics | null,
  ) {
    if (resolution?.reasonCode) return resolution.reasonCode;
    return report.organizationAssignmentSource ?? null;
  }

  private responsibilityResolverConfidence(
    resolution: ResponsibilityResolutionDiagnostics | null,
  ) {
    if (!resolution) return null;
    const proposedId =
      resolution.proposedOrganizationId ?? resolution.selectedCandidateId;
    const candidate = resolution.candidates.find(
      (item) => item.organizationId === proposedId,
    );
    return candidate?.confidence ?? null;
  }

  private responsibilityQueueState(
    report: {
      status?: ReportStatus | null;
      assignedOrganizationId?: string | null;
      organizationId?: string | null;
      organizationAssignedAt?: Date | string | null;
      organizationAssignmentSource?: string | null;
      lastAssignmentOutcome?: AssignmentOutcome | null;
      assignedProviderId?: string | null;
    },
    responsibilityResolution?: ResponsibilityResolutionDiagnostics | null,
  ): {
    eligibleForResponsibilityReview: boolean;
    eligibilityReason: ResponsibilityEligibilityReason;
    queueOrganizationId: string | null;
    dispatchAllowed: boolean;
    manualOverrideOccurred: boolean;
  } {
    const status = normalizeReportStatus(report.status ?? '');
    const source = report.organizationAssignmentSource ?? '';
    const manualOverrideOccurred =
      source.toLowerCase().includes('super admin override') ||
      source.toLowerCase().includes('manual');
    const dispatchAllowed =
      status === ReportStatus.PENDING && !report.assignedProviderId;

    if (status === ReportStatus.CLOSED) {
      return this.queueState(
        false,
        'CLOSED_REPORT',
        null,
        dispatchAllowed,
        manualOverrideOccurred,
      );
    }
    if (
      status === ReportStatus.PENDING &&
      report.organizationId &&
      report.assignedOrganizationId === report.organizationId
    ) {
      return this.queueState(
        false,
        'ACCEPTED_ALREADY',
        null,
        dispatchAllowed,
        manualOverrideOccurred,
      );
    }
    if (manualOverrideOccurred && status !== ReportStatus.ORG_REVIEW) {
      return this.queueState(
        false,
        'MANUALLY_OVERRIDDEN',
        null,
        dispatchAllowed,
        manualOverrideOccurred,
      );
    }
    if (
      report.lastAssignmentOutcome === AssignmentOutcome.REJECTED ||
      source === ORGANIZATION_REJECTED_SOURCE
    ) {
      return this.queueState(
        false,
        'REJECTED_ALREADY',
        null,
        dispatchAllowed,
        manualOverrideOccurred,
      );
    }
    if (
      this.isLegacyMatchedResponsibilityReview(
        report,
        report.organizationId ?? '',
        responsibilityResolution ?? null,
      )
    ) {
      return this.queueState(
        true,
        'LEGACY_MATCHED_ROUTING_STATE',
        report.organizationId ?? null,
        dispatchAllowed,
        manualOverrideOccurred,
      );
    }
    if (status !== ReportStatus.ORG_REVIEW) {
      return this.queueState(
        false,
        'STATUS_NOT_ORG_REVIEW',
        null,
        dispatchAllowed,
        manualOverrideOccurred,
      );
    }
    if (!report.assignedOrganizationId) {
      return this.queueState(
        false,
        'NO_PROPOSED_ORGANIZATION',
        null,
        dispatchAllowed,
        manualOverrideOccurred,
      );
    }
    if (!report.organizationAssignedAt) {
      return this.queueState(
        false,
        'STALE_ASSIGNMENT',
        report.assignedOrganizationId,
        dispatchAllowed,
        manualOverrideOccurred,
      );
    }
    return this.queueState(
      true,
      'MATCHED_PROPOSED_ORGANIZATION',
      report.assignedOrganizationId,
      dispatchAllowed,
      manualOverrideOccurred,
    );
  }

  private queueState(
    eligibleForResponsibilityReview: boolean,
    eligibilityReason: ResponsibilityEligibilityReason,
    queueOrganizationId: string | null,
    dispatchAllowed: boolean,
    manualOverrideOccurred: boolean,
  ) {
    return {
      eligibleForResponsibilityReview,
      eligibilityReason,
      queueOrganizationId,
      dispatchAllowed,
      manualOverrideOccurred,
    };
  }

  private isLegacyMatchedResponsibilityReview(
    report: {
      status?: ReportStatus | null;
      assignedOrganizationId?: string | null;
      organizationId?: string | null;
      organizationAssignmentSource?: string | null;
      lastAssignmentOutcome?: AssignmentOutcome | null;
      assignedProviderId?: string | null;
    },
    organizationId: string,
    responsibilityResolution?: ResponsibilityResolutionDiagnostics | null,
  ) {
    if (!organizationId) return false;
    if (normalizeReportStatus(report.status ?? '') !== ReportStatus.TRIAGE) {
      return false;
    }
    if (report.organizationId !== organizationId) return false;
    if (report.assignedOrganizationId) return false;
    if (report.assignedProviderId) return false;
    if (report.lastAssignmentOutcome === AssignmentOutcome.REJECTED)
      return false;
    if (report.organizationAssignmentSource === ORGANIZATION_REJECTED_SOURCE) {
      return false;
    }
    const proposedOrganizationId =
      responsibilityResolution?.proposedOrganizationId ??
      responsibilityResolution?.selectedCandidateId;
    return (
      responsibilityResolution?.outcome === 'MATCHED' &&
      proposedOrganizationId === organizationId
    );
  }

  private latestResponsibilityActivity(
    timeline: OptionalReportActivityRecord[],
  ) {
    const activity = [...timeline].reverse().find((item) => {
      const action = item.action ?? '';
      return (
        action.includes('RESPONSIBILITY') ||
        action.includes('ORGANIZATION_ACCEPTED') ||
        action.includes('ORGANIZATION_REJECTED') ||
        action.includes('ORGANIZATION_ASSIGNED')
      );
    });
    if (!activity) return null;
    return {
      id: activity.id,
      action: activity.action ?? null,
      fromStatus: activity.fromStatus ?? null,
      toStatus: activity.toStatus ?? null,
      reason: activity.reason ?? null,
      createdAt: activity.createdAt ?? null,
    };
  }

  private safePageLimit(raw: string | undefined, fallback: number) {
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, 100);
  }

  private safePageOffset(raw: string | undefined) {
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  }

  private recordObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private reportEvidencePayloads(dto: UploadReportEvidenceDto) {
    const images = dto.images?.length ? dto.images : [dto];
    return images.map((image) => {
      if (!image.contentType || !image.imageBase64) {
        throw new BadRequestException('Evidence image is required');
      }
      return {
        contentType: image.contentType,
        imageBase64: image.imageBase64,
        order: image.order,
      };
    });
  }

  private completionEvidencePayloads(dto: UploadCompletionEvidenceDto) {
    const images = dto.images?.length ? dto.images : [dto];
    const metadata = dto.images?.length
      ? (dto.imageGeoMetadata ?? images.map((image) => image.geoMetadata))
      : [dto.geoMetadata];
    if (
      dto.images?.length &&
      dto.imageGeoMetadata &&
      dto.imageGeoMetadata.length !== images.length
    ) {
      throw new BadRequestException({
        code: 'GEO_METADATA_IMAGE_COUNT_MISMATCH',
        message: 'Completion geo metadata must match the image count.',
      });
    }
    return images.map((image, index) => {
      if (!image.contentType || !image.imageBase64) {
        throw new BadRequestException('Completion evidence image is required');
      }
      return {
        contentType: image.contentType,
        imageBase64: image.imageBase64,
        classification: image.classification,
        order: image.order,
        geoMetadata: metadata[index],
      };
    });
  }

  private providerEvidenceType(classification?: string | null) {
    switch (classification) {
      case 'before':
        return 'BEFORE_WORK';
      case 'during':
        return 'DURING_WORK';
      case 'after':
      case 'completion':
      default:
        return 'AFTER_WORK';
    }
  }

  private evidenceLimitFor(kind: EvidenceKind) {
    return kind === 'report-evidence' ? 5 : 10;
  }

  private async assertEvidenceLimit(
    reportId: string,
    kind: EvidenceKind,
    incomingCount = 1,
  ) {
    if (incomingCount < 1) {
      throw new BadRequestException('At least one evidence image is required');
    }
    const limit = this.evidenceLimitFor(kind);
    const currentCount = await this.prisma.evidenceRecord.count({
      where: {
        relatedEntityType: EvidenceRelatedEntityType.REPORT,
        relatedEntityId: reportId,
        fileUrl: { contains: kind },
      },
    });
    if (currentCount + incomingCount > limit) {
      throw new BadRequestException({
        code: 'EVIDENCE_LIMIT_EXCEEDED',
        message:
          kind === 'report-evidence'
            ? 'You can upload up to 5 report evidence images.'
            : 'You can upload up to 10 completion evidence images.',
        limit,
      });
    }
  }

  private async createEvidenceRecord(input: {
    reportId: string;
    organizationId: string;
    ownerUserId: string;
    uploadedById: string;
    fileUrl: string;
    contentType: string;
    description: string;
    metadata: Record<string, unknown>;
    geo?: NormalizedGeoMetadata | null;
  }) {
    return this.prisma.evidenceRecord.create({
      data: {
        ownerUserId: input.ownerUserId,
        organizationId: input.organizationId,
        relatedEntityType: EvidenceRelatedEntityType.REPORT,
        relatedEntityId: input.reportId,
        fileUrl: input.fileUrl,
        fileType: input.contentType,
        uploadedById: input.uploadedById,
        description: input.description,
        metadata: input.metadata as Prisma.InputJsonValue,
        geoLatitude: input.geo?.latitude ?? null,
        geoLongitude: input.geo?.longitude ?? null,
        geoAccuracyMeters: input.geo?.accuracyMeters ?? null,
        geoCapturedAt: input.geo?.capturedAt ?? null,
        geoReceivedAt: input.geo?.receivedAt ?? null,
        geoSource: input.geo?.source ?? null,
        geoCaptureMethod: input.geo?.captureMethod ?? null,
        geoPermissionState: input.geo?.permissionState ?? null,
        geoValidationOutcome: input.geo?.validationOutcome ?? null,
        geoDistanceMeters: input.geo?.distanceMeters ?? null,
        geoTrustOutcome: input.geo?.trustOutcome ?? null,
        geoSchemaVersion: input.geo?.schemaVersion ?? 1,
      },
    });
  }

  private async cleanupUnpersistedEvidenceFiles(files: Set<SavedEvidenceFile>) {
    for (const file of files) {
      await this.cleanupUnpersistedEvidenceFile(file);
    }
  }

  private async cleanupUnpersistedEvidenceFile(file: SavedEvidenceFile) {
    const path = this.extractLocalUploadPath(file.imagePath);
    if (!path) return;

    const root = uploadRoot();
    const absolutePath = resolve(root, path);
    try {
      this.assertInsideUploadRoot(root, absolutePath);
      await unlink(absolutePath);
    } catch (error) {
      this.logger.warn({
        message: 'Failed to clean unpersisted evidence upload',
        imagePath: path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private reportEvidenceItems(
    report: EnterpriseReportWithEvidence,
    storedReport: EnterpriseReportWithEvidence = report,
    evidenceRecords: Array<{
      id: string;
      fileUrl: string;
      fileType?: string | null;
      uploadedAt?: Date | string | null;
      metadata?: unknown;
    }> = [],
  ) {
    const items: Array<{
      id: string;
      kind: EvidenceKind;
      source: 'CITIZEN_REPORT' | 'PROVIDER_COMPLETION';
      url: string;
      imageUrl: string;
      imagePath: string | null;
      filename: string | null;
      mimeType: string | null;
      uploadedAt: Date | string | null;
      uploadedByRole: UserRole;
      classification?: string | null;
      order?: number | null;
      geoTrust?: ReturnType<ReportService['evidenceGeoTrustPayload']>;
    }> = [];
    const seen = new Set<string>();
    const add = (
      kind: EvidenceKind,
      imageUrl?: string | null,
      imagePath?: string | null,
      source: 'CITIZEN_REPORT' | 'PROVIDER_COMPLETION' = 'CITIZEN_REPORT',
      uploadedAt: Date | string | null = null,
      uploadedByRole: UserRole = UserRole.CITIZEN,
      storedImageUrl?: string | null,
      classification: string | null = null,
      order: number | null = null,
      geoTrust?: EvidenceGeoTrustPayload,
    ) => {
      const url = imageUrl?.trim();
      const path =
        this.extractLocalUploadPath(imagePath) ??
        this.extractLocalUploadPath(storedImageUrl) ??
        this.extractLocalUploadPath(url);
      if (!url && !path) return;
      const key = `${kind}:${path ?? url}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const filename = path ? (path.split('/').at(-1) ?? null) : null;
      const canonicalUrl =
        this.protectedEvidenceUrl(report.id, kind, path ?? url) ??
        url ??
        `/uploads/${path}`;
      items.push({
        id: key,
        kind,
        source,
        url: canonicalUrl,
        imageUrl: canonicalUrl,
        imagePath: path,
        filename,
        mimeType: filename ? this.safeEvidenceContentType(filename) : null,
        uploadedAt,
        uploadedByRole,
        classification,
        order,
        geoTrust,
      });
    };

    for (const record of evidenceRecords) {
      const metadata =
        record.metadata &&
        typeof record.metadata === 'object' &&
        !Array.isArray(record.metadata)
          ? (record.metadata as Record<string, unknown>)
          : {};
      const kind =
        metadata.kind === 'report-completion'
          ? 'report-completion'
          : 'report-evidence';
      const path =
        typeof metadata.imagePath === 'string' ? metadata.imagePath : null;
      add(
        kind,
        record.fileUrl,
        path,
        kind === 'report-completion' ? 'PROVIDER_COMPLETION' : 'CITIZEN_REPORT',
        record.uploadedAt ?? null,
        kind === 'report-completion' ? UserRole.PROVIDER : UserRole.CITIZEN,
        record.fileUrl,
        typeof metadata.classification === 'string'
          ? metadata.classification
          : null,
        typeof metadata.order === 'number' ? metadata.order : null,
        this.evidenceGeoTrustPayload(record),
      );
    }

    add(
      'report-evidence',
      report.evidenceImageUrl,
      report.evidenceImagePath ?? storedReport.evidenceImagePath,
      'CITIZEN_REPORT',
      report.createdAt ?? null,
      UserRole.CITIZEN,
      storedReport.evidenceImageUrl,
    );
    add(
      'report-completion',
      report.completionImageUrl,
      report.completionImagePath ?? storedReport.completionImagePath,
      'PROVIDER_COMPLETION',
      report.completedByProviderAt ?? null,
      UserRole.PROVIDER,
      storedReport.completionImageUrl,
    );
    return items;
  }

  private evidenceGeoTrustPayload(record: {
    geoLatitude?: number | null;
    geoLongitude?: number | null;
    geoAccuracyMeters?: number | null;
    geoCapturedAt?: Date | string | null;
    geoReceivedAt?: Date | string | null;
    geoSource?: string | null;
    geoCaptureMethod?: string | null;
    geoPermissionState?: string | null;
    geoValidationOutcome?: string | null;
    geoDistanceMeters?: number | null;
    geoTrustOutcome?: string | null;
    geoSchemaVersion?: number | null;
    metadata?: unknown;
  }): EvidenceGeoTrustPayload {
    if (!record.geoTrustOutcome && !record.geoValidationOutcome) return null;
    const metadata = this.recordObject(record.metadata);
    const geoMetadata = this.recordObject(metadata?.geoTrust);
    return {
      schemaVersion: record.geoSchemaVersion ?? 1,
      source: record.geoSource ?? 'UNAVAILABLE',
      captureMethod: record.geoCaptureMethod ?? 'NOT_PROVIDED',
      permissionState: record.geoPermissionState ?? 'UNKNOWN',
      validationOutcome:
        record.geoValidationOutcome ?? 'INSUFFICIENT_LOCATION_DATA',
      trustOutcome: record.geoTrustOutcome ?? 'INSUFFICIENT_LOCATION_DATA',
      distanceMeters: record.geoDistanceMeters ?? null,
      accuracyMeters: record.geoAccuracyMeters ?? null,
      capturedAt: record.geoCapturedAt ?? null,
      receivedAt: record.geoReceivedAt ?? null,
      warnings: Array.isArray(geoMetadata?.warnings)
        ? geoMetadata.warnings
        : [],
      validationReasons: Array.isArray(geoMetadata?.validationReasons)
        ? geoMetadata.validationReasons
        : [],
      coordinates:
        record.geoLatitude != null && record.geoLongitude != null
          ? {
              latitude: record.geoLatitude,
              longitude: record.geoLongitude,
            }
          : null,
    };
  }

  private geoMetadataForStorage(geo: NormalizedGeoMetadata) {
    return {
      schemaVersion: geo.schemaVersion,
      source: geo.source,
      captureMethod: geo.captureMethod,
      permissionState: geo.permissionState,
      validationOutcome: geo.validationOutcome,
      trustOutcome: geo.trustOutcome,
      distanceMeters: geo.distanceMeters,
      accuracyMeters: geo.accuracyMeters,
      capturedAt: geo.capturedAt?.toISOString() ?? null,
      receivedAt: geo.receivedAt.toISOString(),
      warnings: geo.warnings,
      validationReasons: geo.validationReasons,
      exif: geo.exif
        ? {
            latitude: geo.exif.latitude,
            longitude: geo.exif.longitude,
            capturedAt: geo.exif.capturedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  private geoRejectionReasons(error: unknown) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response && 'code' in response) {
        const code = (response as { code?: unknown }).code;
        return [typeof code === 'string' ? code : 'INVALID_GEO_METADATA'];
      }
    }
    return ['INVALID_GEO_METADATA'];
  }

  private reportLocationTrustPayload(report: EnterpriseReportWithEvidence) {
    return {
      schemaVersion: report.locationSchemaVersion ?? 1,
      source: report.locationSource ?? 'UNAVAILABLE',
      permissionState: report.locationPermissionState ?? 'UNKNOWN',
      validationOutcome:
        report.locationValidationOutcome ?? 'INSUFFICIENT_LOCATION_DATA',
      accuracyMeters: report.locationAccuracy ?? null,
      capturedAt: report.locationCapturedAt ?? null,
      receivedAt: report.locationReceivedAt ?? null,
      coordinates:
        report.latitude != null && report.longitude != null
          ? {
              latitude: report.latitude,
              longitude: report.longitude,
            }
          : null,
      nonClaim:
        'Client-supplied coordinates are compared for consistency and are not independent proof of authenticity.',
    };
  }

  private geoTrust() {
    return this.geoTrustService ?? new GeoTrustService();
  }

  private async recordGeoAudit(
    reportId: string,
    action: string,
    user: JwtUser,
    metadata: {
      organizationId: string;
      evidencePath?: string;
      outcome?: string;
      validationOutcome?: string;
      trustOutcome?: string;
      reasons?: string[];
      warnings?: string[];
      distanceMeters?: number | null;
    },
  ) {
    await this.audit(action, user, {
      targetType: 'Report',
      targetId: reportId,
      organizationId: metadata.organizationId,
      evidencePath: metadata.evidencePath,
      outcome: metadata.outcome,
      validationOutcome: metadata.validationOutcome,
      trustOutcome: metadata.trustOutcome,
      reasons: metadata.reasons,
      warnings: metadata.warnings,
      distanceMeters: metadata.distanceMeters,
    });
  }

  private async assertCanAccessEvidence(
    report: ReportWithEvidence,
    kind: EvidenceKind,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);
    const activeUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, role: true, organizationId: true },
    });

    if (!activeUser || activeUser.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('Evidence not available');
    }

    if (this.isSuperAdmin(user)) return;

    if (user.role === UserRole.CITIZEN && report.citizenId === userId) return;

    if (this.isProvider(user)) {
      if (
        report.assignedProviderId === userId ||
        report.lastAssignmentProviderId === userId
      ) {
        return;
      }
      await this.assertProviderCanAccessReport(
        user,
        report.organizationId,
        report.assignedProviderId,
      );
    }

    const sameOrg =
      activeUser.organizationId &&
      activeUser.organizationId === report.organizationId;
    const assignedReviewOrg =
      activeUser.organizationId &&
      activeUser.organizationId === report.assignedOrganizationId;
    if (
      (this.isAdmin(user) || this.isDispatch(user)) &&
      (sameOrg || assignedReviewOrg)
    ) {
      return;
    }

    throw new ForbiddenException('Evidence not available');
  }

  private withProtectedEvidenceUrls<T extends ReportWithEvidence>(
    report: T,
  ): T {
    return {
      ...report,
      priority: report.priority ?? this.resolveReportPriority(report),
      locationTrust: this.reportLocationTrustPayload(
        report as EnterpriseReportWithEvidence,
      ),
      evidenceImageUrl:
        this.protectedEvidenceUrl(
          report.id,
          'report-evidence',
          report.evidenceImagePath ?? report.evidenceImageUrl,
        ) ?? report.evidenceImageUrl,
      completionImageUrl:
        this.protectedEvidenceUrl(
          report.id,
          'report-completion',
          report.completionImagePath ?? report.completionImageUrl,
        ) ?? report.completionImageUrl,
    } as T;
  }

  private resolveReportPriority(report: {
    description?: string | null;
    createdAt?: Date | string | null;
    status?: string;
  }) {
    const text = (report.description ?? '').toLowerCase();
    let priority = 'Low';

    if (
      text.includes('fire') ||
      text.includes('accident') ||
      text.includes('collapsed') ||
      text.includes('emergency') ||
      text.includes('injury')
    ) {
      priority = 'High';
    } else if (
      text.includes('blocked') ||
      text.includes('flood') ||
      text.includes('outage')
    ) {
      priority = 'Medium';
    }

    const createdAt =
      report.createdAt instanceof Date
        ? report.createdAt
        : report.createdAt
          ? new Date(report.createdAt)
          : null;
    if (
      createdAt &&
      !Number.isNaN(createdAt.getTime()) &&
      normalizeReportStatus(report.status ?? ReportStatus.PENDING) ===
        ReportStatus.PENDING
    ) {
      const ageMinutes = Date.now() - createdAt.getTime();
      const minutes = ageMinutes / (1000 * 60);
      if (minutes >= 60 && priority === 'High') return 'Critical';
      if (minutes >= 30 && priority === 'Medium') return 'High';
      if (minutes >= 20 && priority === 'Low') return 'Medium';
    }

    return priority;
  }

  private protectedEvidenceUrl(
    reportId: string,
    kind: EvidenceKind,
    value?: string | null,
  ) {
    const path = this.extractLocalUploadPath(value);
    if (!path) return null;

    const parts = path.split('/');
    if (parts.length !== 3 || parts[0] !== kind || parts[1] !== reportId) {
      return null;
    }

    return `/api/report/${reportId}/${kind === 'report-evidence' ? 'evidence' : 'completion-evidence'}/${parts[2]}`;
  }

  private assertSafeEvidenceFileName(fileName: string) {
    if (
      fileName !== basename(fileName) ||
      !/^[A-Za-z0-9._~-]+$/.test(fileName)
    ) {
      throw new NotFoundException('Evidence not found');
    }
  }

  private contentTypeForEvidenceFile(fileName: string) {
    switch (extname(fileName).toLowerCase()) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      default:
        throw new NotFoundException('Evidence not found');
    }
  }

  private safeEvidenceContentType(fileName: string) {
    try {
      return this.contentTypeForEvidenceFile(fileName);
    } catch {
      return null;
    }
  }

  private assertInsideUploadRoot(uploadRoot: string, targetPath: string) {
    const relativePath = relative(uploadRoot, targetPath);

    if (
      relativePath === '' ||
      relativePath.startsWith('..') ||
      relativePath.includes(`..${sep}`) ||
      resolve(uploadRoot, relativePath) !== targetPath
    ) {
      throw new NotFoundException('Evidence not found');
    }
  }

  private async createNotification(data: {
    userId: string;
    reportId?: string;
    type: string;
    title: string;
    message: string;
  }) {
    const notification =
      this.prismaDelegate<PrismaNotificationDelegate>('notification');
    if (!notification) return;
    if (notification.findFirst) {
      const existing = await notification.findFirst({
        where: {
          userId: data.userId,
          reportId: data.reportId ?? null,
          type: data.type,
          title: data.title,
          message: data.message,
        },
        select: { id: true },
      });
      if (existing) return;
    }
    await notification.create({ data });
  }

  private async notifyReportMessageParticipants(
    report: {
      id: string;
      title: string;
      organizationId: string;
      citizenId: string;
      assignedProviderId: string | null;
    },
    authorId: string,
    message: string,
  ) {
    const participants = new Set<string>();
    participants.add(report.citizenId);
    if (report.assignedProviderId) participants.add(report.assignedProviderId);

    const operators = await this.prisma.user.findMany({
      where: {
        organizationId: report.organizationId,
        role: { in: [UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER] },
        accountStatus: { not: 'DEACTIVATED' },
      },
      select: { id: true },
      take: 25,
    });
    operators.forEach((operator) => participants.add(operator.id));
    participants.delete(authorId);

    await Promise.all(
      [...participants].map((userId) =>
        this.createNotification({
          userId,
          reportId: report.id,
          type: 'REPORT_DISCUSSION_MESSAGE',
          title: 'New report discussion message',
          message: `"${report.title}": ${message.slice(0, 140)}`,
        }),
      ),
    );
  }

  private async notifyOrganizationOperators(
    organizationId: string,
    data: {
      reportId: string;
      type: string;
      title: string;
      message: string;
    },
  ) {
    if (!this.prisma.user?.findMany) return;
    const operators = await this.prisma.user.findMany({
      where: {
        organizationId,
        role: { in: [UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER] },
        accountStatus: 'ACTIVE',
      },
      select: { id: true },
    });

    await Promise.all(
      operators.map((operator) =>
        this.createNotification({
          userId: operator.id,
          ...data,
        }),
      ),
    );
  }

  private async notifyCompletionReviewers(report: {
    id: string;
    title: string;
    citizenId: string;
    organizationId: string;
    completionPolicy?: CompletionPolicy | null;
  }) {
    const policy =
      report.completionPolicy ?? CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED;
    const citizenRequired = (
      [
        CompletionPolicy.CITIZEN_CONFIRMATION_REQUIRED,
        CompletionPolicy.BOTH_REQUIRED,
        CompletionPolicy.CITIZEN_OR_ORGANIZATION,
        CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
      ] as CompletionPolicy[]
    ).includes(policy);
    const organizationRequired = (
      [
        CompletionPolicy.ORGANIZATION_CONFIRMATION_REQUIRED,
        CompletionPolicy.BOTH_REQUIRED,
        CompletionPolicy.CITIZEN_OR_ORGANIZATION,
        CompletionPolicy.AUTO_CLOSE_AFTER_REVIEW_WINDOW,
      ] as CompletionPolicy[]
    ).includes(policy);

    const tasks: Promise<void>[] = [];
    if (citizenRequired) {
      tasks.push(
        this.createNotification({
          userId: report.citizenId,
          reportId: report.id,
          type: 'completion_review',
          title: 'Ready for review',
          message: `The provider marked "${report.title}" complete. Please review it.`,
        }),
      );
    }
    if (organizationRequired) {
      tasks.push(
        this.notifyOrganizationOperators(report.organizationId, {
          reportId: report.id,
          type: 'organization_completion_review',
          title: 'Completion verification required',
          message: `Provider submitted completion evidence for "${report.title}".`,
        }),
      );
    }
    if (policy === CompletionPolicy.ADMIN_RESOLUTION_REQUIRED) {
      tasks.push(
        this.notifyPlatformResolvers({
          reportId: report.id,
          type: 'admin_completion_resolution_required',
          title: 'Completion resolution required',
          message: `Completion for "${report.title}" requires platform resolution.`,
        }),
      );
    }
    await Promise.all(tasks);
  }

  private async notifyPlatformResolvers(data: {
    reportId: string;
    type: string;
    title: string;
    message: string;
  }) {
    if (!this.prisma.user?.findMany) return;
    const resolvers = await this.prisma.user.findMany({
      where: {
        role: {
          in: [
            UserRole.SUPER_ADMIN,
            UserRole.ASSIGNMENT_ADMIN,
            UserRole.ASSET_ADMIN,
            UserRole.COMPLIANCE_ADMIN,
            UserRole.REGULATORY_ADMIN,
          ],
        },
        accountStatus: 'ACTIVE',
      },
      select: { id: true },
      take: 50,
    });

    await Promise.all(
      resolvers.map((resolver) =>
        this.createNotification({
          userId: resolver.id,
          ...data,
        }),
      ),
    );
  }

  private async expireOverdueAssignments(filter: {
    providerId?: string;
    organizationId?: string;
    actor?: JwtUser;
  }) {
    const overdueReports = await this.prisma.report.findMany({
      where: {
        status: ReportStatus.ASSIGNED,
        assignmentDeadlineAt: { lt: new Date() },
        ...(filter.providerId ? { assignedProviderId: filter.providerId } : {}),
        ...(filter.organizationId
          ? { organizationId: filter.organizationId }
          : {}),
      },
      select: {
        id: true,
        title: true,
        organizationId: true,
        citizenId: true,
        assignedProviderId: true,
      },
    });
    const expired: Array<{
      id: string;
      title: string;
      organizationId: string;
      previousProviderId: string | null;
    }> = [];

    for (const report of overdueReports) {
      await this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.PENDING,
          assignedProviderId: null,
          assignedAt: null,
          assignmentDeadlineAt: null,
          lastAssignmentOutcome: AssignmentOutcome.TIMED_OUT,
          lastAssignmentReason: 'Assignment acceptance window expired',
          lastAssignmentAt: new Date(),
          lastAssignmentProviderId: report.assignedProviderId,
        },
      });
      await this.recordReportActivity(
        report.id,
        'ASSIGNMENT_TIMED_OUT',
        filter.actor ?? {
          role: UserRole.DISPATCH_OFFICER,
          fullName: 'System',
        },
        {
          organizationId: report.organizationId,
          fromStatus: ReportStatus.ASSIGNED,
          toStatus: ReportStatus.PENDING,
          providerId: report.assignedProviderId ?? undefined,
          reason: 'Assignment acceptance window expired',
          metadata: { autoUnassigned: true },
        },
      );
      await this.notifyOrganizationOperators(report.organizationId, {
        reportId: report.id,
        type: 'assignment_timeout',
        title: 'Assignment timed out',
        message: `Assignment for "${report.title}" timed out and returned to dispatch.`,
      });
      if (report.assignedProviderId) {
        await this.createNotification({
          userId: report.assignedProviderId,
          reportId: report.id,
          type: 'assignment_timeout',
          title: 'Assignment timed out',
          message: `Your assignment for "${report.title}" expired and was returned to dispatch.`,
        });
      }
      await this.createNotification({
        userId: report.citizenId,
        reportId: report.id,
        type: 'assignment_timeout',
        title: 'Assignment update',
        message: `The provider assignment for "${report.title}" timed out. Dispatch will reassign it.`,
      });
      await this.audit(
        'Assignment Timed Out',
        filter.actor ?? {
          role: UserRole.DISPATCH_OFFICER,
          fullName: 'System',
        },
        {
          targetType: 'Report',
          targetId: report.id,
          previousProviderId: report.assignedProviderId,
          organizationId: report.organizationId,
        },
      );
      expired.push({
        id: report.id,
        title: report.title,
        organizationId: report.organizationId,
        previousProviderId: report.assignedProviderId,
      });
    }
    return expired;
  }

  private async assertAssignmentStillAcceptable(
    report: {
      status: ReportStatus;
      assignedProviderId: string | null;
      assignmentDeadlineAt: Date | null;
    },
    user: JwtUser,
    userId: string,
  ) {
    if (
      report.status !== ReportStatus.ASSIGNED ||
      report.assignedProviderId !== userId ||
      !report.assignmentDeadlineAt ||
      report.assignmentDeadlineAt.getTime() >= Date.now()
    ) {
      return;
    }

    await this.expireOverdueAssignments({
      providerId: userId,
      actor: user,
    });
    throw new ConflictException('Assignment acceptance window expired');
  }

  private async assertActiveProvider(userId: string) {
    if (!this.prisma.user?.findUnique) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, role: true },
    });
    if (!user || user.role !== UserRole.PROVIDER) {
      throw new ForbiddenException('Provider account not found');
    }
    if (user.accountStatus === 'SUSPENDED') {
      throw new ForbiddenException('Provider account is suspended');
    }
  }

  private async authorizedProviderOrganizationIds(user: JwtUser) {
    const userId = this.getUserId(user);
    const ids = new Set<string>();
    if (user.organizationId) ids.add(user.organizationId);
    const linkModel = this.prismaDelegate<
      PrismaFindManyDelegate<{ organizationId?: string | null }>
    >('providerOrganization');
    if (linkModel) {
      const links = await linkModel.findMany({
        where: { providerId: userId, active: true },
        select: { organizationId: true },
      });
      for (const link of links) {
        if (link.organizationId) ids.add(link.organizationId);
      }
    }
    return [...ids];
  }

  private async assertProviderCanAccessReport(
    user: JwtUser,
    organizationId: string,
    assignedProviderId?: string | null,
  ) {
    if (!this.isProvider(user)) return;
    if (assignedProviderId && assignedProviderId === this.getUserId(user)) {
      return;
    }
    const organizationIds = await this.authorizedProviderOrganizationIds(user);
    if (!organizationIds.includes(organizationId)) {
      throw new ForbiddenException('Provider organization access denied');
    }
  }

  private async audit(
    action: string,
    user: JwtUser,
    metadata: Record<string, unknown> = {},
  ) {
    const actorUserId = user.id ?? user.userId ?? user.sub;
    const complianceAudit =
      this.prismaDelegate<PrismaCreateDelegate>('complianceAuditLog');
    if (complianceAudit) {
      await complianceAudit.create({
        data: {
          action,
          actorId: actorUserId ?? null,
          actorRole: user.role ?? null,
          organizationId:
            typeof metadata.organizationId === 'string'
              ? metadata.organizationId
              : (user.organizationId ?? null),
          entityType:
            typeof metadata.targetType === 'string'
              ? metadata.targetType
              : typeof metadata.entityType === 'string'
                ? metadata.entityType
                : null,
          entityId:
            typeof metadata.targetId === 'string'
              ? metadata.targetId
              : typeof metadata.entityId === 'string'
                ? metadata.entityId
                : null,
          metadata,
        },
      });
    }

    const audit = this.prismaDelegate<PrismaCreateDelegate>('demoAuditLog');
    if (!audit) return;
    if (!actorUserId) return;
    await audit.create({
      data: {
        action,
        actorUserId,
        metadata,
      },
    });
  }

  private async recordReportActivity(
    reportId: string,
    action: string,
    user: JwtUser,
    details: {
      organizationId: string;
      fromStatus?: ReportStatus | null;
      toStatus?: ReportStatus | null;
      providerId?: string;
      reason?: string;
      note?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const activity =
      this.prismaDelegate<PrismaCreateDelegate>('reportActivity');
    if (!activity) return;

    const actorUserId = user.id ?? user.userId ?? user.sub;
    await activity.create({
      data: {
        reportId,
        organizationId: details.organizationId,
        actorUserId: actorUserId ?? null,
        actorRole: user.role ?? null,
        actorName: user.fullName ?? user.email ?? null,
        action,
        fromStatus: details.fromStatus ?? null,
        toStatus: details.toStatus ?? null,
        providerId: details.providerId ?? null,
        reason: details.reason ?? null,
        note: details.note ?? null,
        metadata: details.metadata ?? undefined,
      },
    });
  }

  private activityActionForStatus(status: ReportStatus) {
    switch (status) {
      case ReportStatus.ASSIGNED:
        return 'PROVIDER_ASSIGNED';
      case ReportStatus.IN_PROGRESS:
        return 'PROVIDER_STARTED_WORK';
      case ReportStatus.COMPLETED_BY_PROVIDER:
        return 'PROVIDER_SUBMITTED_COMPLETION';
      case ReportStatus.CLOSED:
        return 'REPORT_CLOSED';
      case ReportStatus.PENDING:
      default:
        return 'REPORT_STATUS_CHANGED';
    }
  }

  private async notifyStatusChange(report: {
    id: string;
    title: string;
    citizenId: string;
    status: ReportStatus;
  }) {
    const messageByStatus: Partial<
      Record<ReportStatus, { title: string; message: string; type: string }>
    > = {
      [ReportStatus.ASSIGNED]: {
        type: 'assigned',
        title: 'Report assigned',
        message: `Your report "${report.title}" has been assigned to a provider.`,
      },
      [ReportStatus.IN_PROGRESS]: {
        type: 'status_update',
        title: 'Work started',
        message: `A provider has started work on "${report.title}".`,
      },
      [ReportStatus.COMPLETED_BY_PROVIDER]: {
        type: 'completion_review',
        title: 'Ready for review',
        message: `The provider marked "${report.title}" complete. Please review it.`,
      },
      [ReportStatus.CLOSED]: {
        type: 'resolved',
        title: 'Report closed',
        message: `Your report "${report.title}" has been closed.`,
      },
    };

    const notification = messageByStatus[report.status];
    if (!notification) return;

    await this.createNotification({
      userId: report.citizenId,
      reportId: report.id,
      ...notification,
    });
  }

  private async notifyAuthoritativeCompletionClosure(report: {
    id: string;
    title: string;
    citizenId: string;
    assignedProviderId?: string | null;
    status: ReportStatus;
  }) {
    await this.notifyStatusChange(report);
    if (!report.assignedProviderId) return;
    await this.createNotification({
      userId: report.assignedProviderId,
      reportId: report.id,
      type: 'completion_confirmed',
      title: 'Completion confirmed',
      message: `Completion for "${report.title}" has been confirmed and the report is closed.`,
    });
  }

  private isSuperAdmin(user: JwtUser) {
    return user.role === UserRole.SUPER_ADMIN;
  }

  private getUploadSecurity() {
    return this.uploadSecurity ?? new UploadSecurityService();
  }

  private isAdmin(user: JwtUser) {
    return user.role === UserRole.ORG_ADMIN;
  }

  private isDispatch(user: JwtUser) {
    return user.role === UserRole.DISPATCH_OFFICER;
  }

  private isProvider(user: JwtUser) {
    return user.role === UserRole.PROVIDER;
  }

  private assertAssignmentAllowed(
    report: {
      id?: string;
      status: string;
      assignedProviderId: string | null;
      organizationId: string;
    },
    providerOrganizationId: string | null,
    providerLinkedToReportOrgOrUser: boolean | JwtUser,
    userOrProviderId?: JwtUser | string,
    providerId?: string,
  ) {
    const providerLinkedToReportOrg =
      typeof providerLinkedToReportOrgOrUser === 'boolean'
        ? providerLinkedToReportOrgOrUser
        : false;
    const user =
      typeof providerLinkedToReportOrgOrUser === 'boolean'
        ? (userOrProviderId as JwtUser)
        : providerLinkedToReportOrgOrUser;
    const resolvedProviderId =
      typeof providerLinkedToReportOrgOrUser === 'boolean'
        ? providerId
        : (userOrProviderId as string | undefined);
    const normalizedCurrentStatus = normalizeReportStatus(report.status);
    const normalizedNextStatus = normalizeReportStatus(ReportStatus.ASSIGNED);

    this.logger.debug({
      message: 'Validating report assignment workflow',
      reportId: report.id,
      currentStatus: report.status,
      assignedProviderId: report.assignedProviderId,
      providerId: resolvedProviderId,
      normalizedCurrentStatus,
      normalizedNextStatus,
    });

    if (normalizedCurrentStatus !== ReportStatus.PENDING) {
      throw new ForbiddenException(
        'Report cannot be assigned in its current status',
      );
    }

    if (report.assignedProviderId) {
      throw new ForbiddenException('Report already has an assigned provider');
    }

    if (!this.isSuperAdmin(user)) {
      if (report.organizationId !== user.organizationId) {
        throw new ForbiddenException('Cross-org not allowed');
      }

      if (
        providerOrganizationId !== user.organizationId &&
        !providerLinkedToReportOrg
      ) {
        throw new ForbiddenException('Provider must be same org');
      }
    }
  }

  private assertStatusTransitionAllowed(
    report: {
      status: ReportStatus;
      assignedProviderId: string | null;
      organizationId: string;
    },
    nextStatus: ReportStatus,
    user: JwtUser,
    userId: string,
  ) {
    if (nextStatus === ReportStatus.ASSIGNED) {
      throw new ForbiddenException(
        'Use provider assignment to move a report to ASSIGNED',
      );
    }

    if (!canTransitionReportStatus(report.status, nextStatus)) {
      throw new ForbiddenException(
        `Invalid status transition from ${report.status} to ${nextStatus}`,
      );
    }

    if (this.isProvider(user)) {
      if (report.assignedProviderId !== userId) {
        throw new ForbiddenException('Not your report');
      }

      if (
        nextStatus !== ReportStatus.IN_PROGRESS &&
        nextStatus !== ReportStatus.COMPLETED_BY_PROVIDER
      ) {
        throw new ForbiddenException('Invalid status for provider');
      }

      return;
    }

    if (this.isAdmin(user) || this.isDispatch(user)) {
      if (report.organizationId !== user.organizationId) {
        throw new ForbiddenException('Wrong org');
      }

      return;
    }

    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException('Not allowed');
    }
  }
}
