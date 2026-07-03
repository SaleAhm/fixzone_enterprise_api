import { Injectable } from '@nestjs/common';

@Injectable()
export class EscalationEngineService {
  classifyCompletionReview(overdue: boolean) {
    return overdue ? 'ESCALATE_REVIEW' : 'STANDARD_REVIEW';
  }
}
