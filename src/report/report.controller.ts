import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssignProviderDto } from './dto/assign-provider.dto';
import { AssignOrganizationDto } from './dto/assign-organization.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { UploadCompletionEvidenceDto } from './dto/upload-completion-evidence.dto';
import { UploadReportEvidenceDto } from './dto/upload-report-evidence.dto';
import { RejectAssignmentDto } from './dto/reject-assignment.dto';
import { CitizenConfirmCompletionDto } from './dto/citizen-confirm-completion.dto';
import { CitizenRejectCompletionDto } from './dto/citizen-reject-completion.dto';
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
import {
  OrganizationAcceptReportDto,
  OrganizationRejectReportDto,
} from './dto/organization-intake-decision.dto';
import {
  OrganizationCompletionReworkDto,
  OrganizationCompletionVerificationDto,
} from './dto/organization-completion-decision.dto';
import { DispatchAiService } from './services/dispatch-ai.service';
import { ReportService } from './report.service';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';

type CurrentAuthUser = {
  id: string;
  userId?: string;
  sub?: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  role: UserRole;
  organizationId?: string | null;
};

@Controller('report')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly dispatchAiService: DispatchAiService,
  ) {}

  // ===================== CITIZEN =====================

  @Post()
  @Roles(UserRole.CITIZEN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  createReport(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportService.createReport(user, dto);
  }

  @Get('my')
  @Roles(UserRole.CITIZEN)
  getMyReports(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getMyReports(user);
  }

  @Get('citizen/my')
  @Roles(UserRole.CITIZEN)
  getCitizenReports(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getMyReports(user);
  }

  @Get('citizen/dashboard/summary')
  @Roles(UserRole.CITIZEN)
  getCitizenDashboardSummary(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getCitizenDashboardSummary(user);
  }

  // ===================== PROVIDER =====================

  @Get('assigned')
  @Roles(UserRole.PROVIDER)
  getAssignedReports(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getAssignedReports(user);
  }

  @Patch(':id/reject-assignment')
  @Roles(UserRole.PROVIDER)
  rejectAssignment(
    @Param('id') id: string,
    @Body() dto: RejectAssignmentDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.rejectAssignment(id, dto, user);
  }

  // ===================== DASHBOARD =====================

  @Get('admin/dashboard/summary')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getDashboardSummary(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: AdminDashboardQueryDto,
  ) {
    return this.reportService.getDashboardSummary(user, query);
  }

  @Get('admin/dashboard/trends')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getReportTrends(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getReportTrends(user);
  }

  @Get('admin/dashboard/category-trends')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getCategoryTrends(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getCategoryTrends(user);
  }

  @Get('admin/dashboard/provider-performance')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getProviderPerformance(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getProviderPerformance(user);
  }

  @Get('admin/dashboard/advanced')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getAdvancedAnalytics(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getAdvancedAnalytics(user);
  }

  @Get('admin/dashboard/recent')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getRecentReports(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getRecentReports(user);
  }

  @Get(':id/timeline')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  getReportTimeline(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.getReportTimeline(id, user);
  }

  @Get(':id/messages')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  @EnterpriseRateLimit(RateLimitTier.NotificationRead)
  getReportMessages(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.getReportMessages(id, user);
  }

  @Post(':id/messages')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  @EnterpriseRateLimit(RateLimitTier.NotificationMutation)
  createReportMessage(
    @Param('id') id: string,
    @Body() dto: { message?: unknown },
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.createReportMessage(id, dto, user);
  }

  // ===================== ORGANIZATION =====================

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getOrganizationReports(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getOrganizationReports(user);
  }

  @Get('organization/responsibility-review')
  @Roles(UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getResponsibilityReviewReports(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: { limit?: string; offset?: string },
  ) {
    return this.reportService.getResponsibilityReviewReports(user, query);
  }

  @Get('admin/responsibility-diagnostics/:id')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getResponsibilityDiagnostics(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.getResponsibilityDiagnostics(id, user);
  }

  @Get('organization/completion-review')
  @Roles(UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getOrganizationCompletionReviewQueue(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: CompletionReviewQueueQueryDto,
  ) {
    return this.reportService.getOrganizationCompletionReviewQueue(user, query);
  }

  @Get('organization/completion-review/:id')
  @Roles(UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getOrganizationCompletionReviewDetail(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.getOrganizationCompletionReviewDetail(id, user);
  }

  @Post('admin/completion-review/process-deadlines')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.COMPLIANCE_ADMIN,
    UserRole.REGULATORY_ADMIN,
  )
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  processCompletionReviewDeadlines(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: ProcessCompletionReviewDeadlinesDto,
  ) {
    return this.reportService.processCompletionReviewDeadlines(user, dto);
  }

  @Get('admin/completion-governance')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getAdminCompletionGovernanceQueue(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: CompletionReviewQueueQueryDto,
  ) {
    return this.reportService.getAdminCompletionGovernanceQueue(user, query);
  }

  @Post('admin/completion-governance/category-policy')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  setCategoryCompletionPolicy(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: AdminCategoryCompletionPolicyDto,
  ) {
    return this.reportService.setCategoryCompletionPolicy(user, dto);
  }

  @Get('admin/completion-governance/category-policy')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getCategoryCompletionPolicies(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getCategoryCompletionPolicies(user);
  }

  @Post(':id/admin-completion/resolve-close')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  adminResolveAndClose(
    @Param('id') id: string,
    @Body() dto: AdminCompletionGovernanceReasonDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.adminResolveAndClose(id, dto, user);
  }

  @Post(':id/admin-completion/rework')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  adminReturnForCompletionRework(
    @Param('id') id: string,
    @Body() dto: AdminCompletionGovernanceReasonDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.adminReturnForCompletionRework(id, dto, user);
  }

  @Post(':id/admin-completion/hold')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  adminPlaceCompletionHold(
    @Param('id') id: string,
    @Body() dto: AdminCompletionGovernanceReasonDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.adminPlaceCompletionHold(id, dto, user);
  }

  @Post(':id/admin-completion/remove-hold')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  adminRemoveCompletionHold(
    @Param('id') id: string,
    @Body() dto: AdminCompletionGovernanceReasonDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.adminRemoveCompletionHold(id, dto, user);
  }

  @Post(':id/admin-completion/reopen')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  adminReopenCompletion(
    @Param('id') id: string,
    @Body() dto: AdminCompletionGovernanceReasonDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.adminReopenCompletion(id, dto, user);
  }

  @Post(':id/admin-completion/policy')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  adminOverrideCompletionPolicy(
    @Param('id') id: string,
    @Body() dto: AdminCompletionPolicyOverrideDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.adminOverrideCompletionPolicy(id, dto, user);
  }

  // ===================== SINGLE REPORT =====================

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  getReportById(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getReportById(id, user);
  }

  @Get(':id/evidence/:fileName')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  async getReportEvidence(
    @Param('id') id: string,
    @Param('fileName') fileName: string,
    @CurrentUser() user: CurrentAuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const evidence = await this.reportService.openEvidenceFile(
      id,
      'report-evidence',
      fileName,
      user,
    );
    res.set({
      'Content-Type': evidence.contentType,
      'Content-Disposition': `inline; filename="${evidence.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(evidence.stream);
  }

  @Get(':id/completion-evidence/:fileName')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  async getCompletionEvidence(
    @Param('id') id: string,
    @Param('fileName') fileName: string,
    @CurrentUser() user: CurrentAuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const evidence = await this.reportService.openEvidenceFile(
      id,
      'report-completion',
      fileName,
      user,
    );
    res.set({
      'Content-Type': evidence.contentType,
      'Content-Disposition': `inline; filename="${evidence.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(evidence.stream);
  }

  // ===================== ACTIONS =====================

  @Patch(':id/assign')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  assignProvider(
    @Param('id') id: string,
    @Body() dto: AssignProviderDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.assignProvider(id, dto, user);
  }

  @Get(':id/assignment-candidates')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getAssignmentCandidates(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.getAssignmentCandidates(id, user);
  }

  @Patch(':id/assign-organization')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  assignOrganization(
    @Param('id') id: string,
    @Body() dto: AssignOrganizationDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.assignOrganization(id, dto, user);
  }

  @Patch(':id/organization-accept')
  @Roles(UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  acceptOrganizationReport(
    @Param('id') id: string,
    @Body() dto: OrganizationAcceptReportDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.acceptOrganizationReport(id, dto, user);
  }

  @Patch(':id/organization-reject')
  @Roles(UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  rejectOrganizationReport(
    @Param('id') id: string,
    @Body() dto: OrganizationRejectReportDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.rejectOrganizationReport(id, dto, user);
  }

  @Post('admin/assignments/expire-overdue')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.HeavyJob)
  expireOverdueAssignments(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.processOverdueAssignments(user);
  }

  @Post(':id/cancel-assignment')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  cancelAssignment(
    @Param('id') id: string,
    @Body() dto: { reason?: string },
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.cancelAssignment(id, dto?.reason, user);
  }

  @Patch(':id/reassign')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  reassignProvider(
    @Param('id') id: string,
    @Body() dto: AssignProviderDto & { reason?: string },
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.reassignProvider(
      id,
      dto.providerId,
      dto.reason,
      user,
    );
  }

  @Patch(':id/status')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
  )
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateReportStatusDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.updateStatus(id, dto, user);
  }

  @Post(':id/completion-evidence')
  @Roles(UserRole.PROVIDER)
  @EnterpriseRateLimit(RateLimitTier.Upload)
  uploadCompletionEvidence(
    @Param('id') id: string,
    @Body() dto: UploadCompletionEvidenceDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.uploadCompletionEvidence(id, dto, user);
  }

  @Post(':id/evidence')
  @Roles(UserRole.CITIZEN)
  @EnterpriseRateLimit(RateLimitTier.Upload)
  uploadReportEvidence(
    @Param('id') id: string,
    @Body() dto: UploadReportEvidenceDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.uploadReportEvidence(id, dto, user);
  }

  @Post('provider/:id/reject')
  @Roles(UserRole.PROVIDER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  rejectProviderAssignment(
    @Param('id') id: string,
    @Body() dto: RejectAssignmentDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.rejectAssignment(id, dto, user);
  }

  @Post(':id/reject-assignment')
  @Roles(UserRole.PROVIDER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  rejectAssignmentPostAlias(
    @Param('id') id: string,
    @Body() dto: RejectAssignmentDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.rejectAssignment(id, dto, user);
  }

  @Get('citizen/:id/completion-review')
  @Roles(UserRole.CITIZEN)
  getCitizenCompletionReview(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.getCitizenCompletionReview(id, user);
  }

  @Post('citizen/:id/confirm-completion')
  @Roles(UserRole.CITIZEN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  confirmCitizenCompletionAlias(
    @Param('id') id: string,
    @Body() dto: CitizenConfirmCompletionDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.confirmCitizenCompletion(id, dto, user);
  }

  @Post('citizen/:id/reject-completion')
  @Roles(UserRole.CITIZEN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  rejectCitizenCompletionAlias(
    @Param('id') id: string,
    @Body() dto: CitizenRejectCompletionDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.rejectCitizenCompletion(id, dto, user);
  }

  @Patch(':id/citizen-confirm')
  @Roles(UserRole.CITIZEN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  confirmCompletion(
    @Param('id') id: string,
    @Body() dto: CitizenConfirmCompletionDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.confirmCitizenCompletion(id, dto, user);
  }

  @Patch(':id/citizen-reject')
  @Roles(UserRole.CITIZEN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  rejectCompletion(
    @Param('id') id: string,
    @Body() dto: CitizenRejectCompletionDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.rejectCitizenCompletion(id, dto, user);
  }

  @Post(':id/organization-completion/verify')
  @Roles(UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  verifyOrganizationCompletion(
    @Param('id') id: string,
    @Body() dto: OrganizationCompletionVerificationDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.verifyOrganizationCompletion(id, dto, user);
  }

  @Post(':id/organization-completion/rework')
  @Roles(UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  requestOrganizationCompletionRework(
    @Param('id') id: string,
    @Body() dto: OrganizationCompletionReworkDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.requestOrganizationCompletionRework(
      id,
      dto,
      user,
    );
  }

  @Patch(':id/recommend-provider')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  recommendProvider(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.dispatchAiService.recommendProviders(id, user);
  }

  @Patch(':id/auto-assign')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  autoAssignProvider(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.dispatchAiService.autoAssignBestProvider(id, user);
  }
}
