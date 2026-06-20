import { ReportStatus } from '@prisma/client';
import {
  ALLOWED_REPORT_TRANSITIONS,
  canTransitionReportStatus,
  normalizeReportStatus,
} from './report-workflow';

describe('report workflow helpers', () => {
  it('defines the strict linear transition map', () => {
    expect(ALLOWED_REPORT_TRANSITIONS).toEqual({
      [ReportStatus.PENDING]: [ReportStatus.ASSIGNED],
      [ReportStatus.ASSIGNED]: [ReportStatus.IN_PROGRESS],
      [ReportStatus.IN_PROGRESS]: [ReportStatus.COMPLETED_BY_PROVIDER],
      [ReportStatus.COMPLETED_BY_PROVIDER]: [ReportStatus.CLOSED],
      [ReportStatus.CLOSED]: [],
    });
  });

  it('allows only the next status in the workflow', () => {
    expect(
      canTransitionReportStatus(ReportStatus.PENDING, ReportStatus.ASSIGNED),
    ).toBe(true);
    expect(
      canTransitionReportStatus(
        ReportStatus.ASSIGNED,
        ReportStatus.IN_PROGRESS,
      ),
    ).toBe(true);
    expect(
      canTransitionReportStatus(
        ReportStatus.IN_PROGRESS,
        ReportStatus.COMPLETED_BY_PROVIDER,
      ),
    ).toBe(true);
    expect(
      canTransitionReportStatus(
        ReportStatus.COMPLETED_BY_PROVIDER,
        ReportStatus.CLOSED,
      ),
    ).toBe(true);
  });

  it('normalizes lowercase status values before comparing workflow states', () => {
    expect(normalizeReportStatus('pending')).toBe(ReportStatus.PENDING);
    expect(normalizeReportStatus('assigned')).toBe(ReportStatus.ASSIGNED);
    expect(canTransitionReportStatus('pending', 'assigned')).toBe(true);
  });

  it('rejects skipped, backward, and terminal transitions', () => {
    expect(
      canTransitionReportStatus(
        ReportStatus.ASSIGNED,
        ReportStatus.COMPLETED_BY_PROVIDER,
      ),
    ).toBe(false);
    expect(
      canTransitionReportStatus(ReportStatus.IN_PROGRESS, ReportStatus.PENDING),
    ).toBe(false);
    expect(
      canTransitionReportStatus(ReportStatus.CLOSED, ReportStatus.IN_PROGRESS),
    ).toBe(false);
    expect(
      canTransitionReportStatus(ReportStatus.CLOSED, ReportStatus.CLOSED),
    ).toBe(false);
  });
});
