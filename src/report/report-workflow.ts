import { ReportStatus } from '@prisma/client';

export const ALLOWED_REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> =
  {
    [ReportStatus.PENDING]: [ReportStatus.ASSIGNED],
    [ReportStatus.ASSIGNED]: [ReportStatus.IN_PROGRESS],
    [ReportStatus.IN_PROGRESS]: [ReportStatus.COMPLETED_BY_PROVIDER],
    [ReportStatus.COMPLETED_BY_PROVIDER]: [ReportStatus.CLOSED],
    [ReportStatus.CLOSED]: [],
  };

export function normalizeReportStatus(status: ReportStatus | string) {
  const normalizedStatus = status.toString().toUpperCase() as ReportStatus;

  return Object.values(ReportStatus).includes(normalizedStatus)
    ? normalizedStatus
    : null;
}

export function canTransitionReportStatus(
  currentStatus: ReportStatus | string,
  nextStatus: ReportStatus | string,
) {
  const normalizedCurrentStatus = normalizeReportStatus(currentStatus);
  const normalizedNextStatus = normalizeReportStatus(nextStatus);

  if (!normalizedCurrentStatus || !normalizedNextStatus) {
    return false;
  }

  return ALLOWED_REPORT_TRANSITIONS[normalizedCurrentStatus].includes(
    normalizedNextStatus,
  );
}
