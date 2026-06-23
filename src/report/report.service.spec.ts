import { ForbiddenException } from '@nestjs/common';
import { AssignmentOutcome, ReportStatus, UserRole } from '@prisma/client';
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
        { id: 'provider-1', role: UserRole.PROVIDER },
      ),
    ).rejects.toThrow('Only new assignments can be rejected');
  });
});
