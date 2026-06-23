export class ProviderPerformanceDto {
  providerId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  assignedCount: number;
  inProgressCount: number;
  completedCount: number;
}
