import { Injectable } from '@nestjs/common';

@Injectable()
export class SlaEngineService {
  assignmentTimeoutMinutes() {
    return Number(process.env.ASSIGNMENT_TIMEOUT_MINUTES || 30);
  }
}
