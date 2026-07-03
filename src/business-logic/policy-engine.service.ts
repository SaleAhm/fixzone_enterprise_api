import { ForbiddenException, Injectable } from '@nestjs/common';
import { ReportStatus, UserRole } from '@prisma/client';
import { PlatformModulesService } from '../platform-modules/platform-modules.service';

@Injectable()
export class PolicyEngineService {
  constructor(private readonly platformModules: PlatformModulesService) {}

  async assertMaintenanceActive() {
    const access = await this.platformModules.evaluateAccess(
      { role: UserRole.CITIZEN },
      { moduleKey: 'maintenance' },
    );
    if (!access.allowed) {
      throw new ForbiddenException('Maintenance Services is not active');
    }
  }

  assertCitizenCanReviewCompletion(report: {
    citizenId: string;
    status: ReportStatus;
  }, userId: string) {
    if (report.citizenId !== userId) {
      throw new ForbiddenException('Not your report');
    }
    if (report.status !== ReportStatus.COMPLETED_BY_PROVIDER) {
      throw new ForbiddenException('Report is not awaiting citizen review');
    }
  }

  assertRatingAllowed(report: { status: ReportStatus }, rating?: number) {
    if (rating == null) return;
    if (report.status !== ReportStatus.COMPLETED_BY_PROVIDER) {
      throw new ForbiddenException(
        'Provider rating is only allowed during completion approval',
      );
    }
  }
}
