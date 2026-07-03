import { Injectable } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';
import { SlaEngineService } from './sla-engine.service';

@Injectable()
export class BusinessLogicService {
  constructor(
    private readonly rules: RuleEngineService,
    private readonly sla: SlaEngineService,
  ) {}

  describe() {
    return {
      platform: 'SecureZone Platform',
      activeProductionModule: 'maintenance',
      futureModulesOperational: false,
      maintenanceWorkflowStates: this.rules.maintenanceWorkflowStates(),
      assignmentTimeoutMinutes: this.sla.assignmentTimeoutMinutes(),
    };
  }
}
