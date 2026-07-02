import { Injectable } from '@nestjs/common';
import { GenericServiceRequest } from './enterprise-services.types';

type ReportLike = {
  id?: string;
  title?: string;
  description?: string;
  category?: string;
  location?: string;
  status?: string;
  citizenId?: string;
  organizationId?: string;
  assignedProviderId?: string | null;
  priority?: string | null;
};

@Injectable()
export class MaintenanceServiceAdapter {
  readonly moduleKey = 'maintenance';
  readonly serviceType = 'maintenance_report';

  describeCompatibility() {
    return {
      sourceEntity: 'Report',
      targetEntity: 'GenericServiceRequest',
      moduleKey: this.moduleKey,
      serviceType: this.serviceType,
      nonBreaking: true,
      dataMigrationRequired: false,
      fieldMapping: {
        id: 'sourceId',
        title: 'title',
        description: 'description',
        category: 'category',
        location: 'location',
        status: 'lifecycleStage',
        citizenId: 'requesterId',
        organizationId: 'organizationId',
        assignedProviderId: 'assignedProfessionalId',
      },
    };
  }

  adaptReport(report: ReportLike): GenericServiceRequest {
    return {
      framework: 'SecureZone Enterprise Service Framework',
      moduleKey: this.moduleKey,
      serviceType: this.serviceType,
      sourceEntity: 'Report',
      sourceId: report.id,
      title: report.title,
      description: report.description,
      category: report.category,
      location: report.location,
      lifecycleStage: report.status,
      requesterId: report.citizenId,
      organizationId: report.organizationId,
      assignedProfessionalId: report.assignedProviderId ?? null,
      priority: report.priority ?? 'normal',
      metadata: {
        compatibilityAdapter: 'MaintenanceServiceAdapter',
        preservesReportWorkflow: true,
      },
    };
  }
}
