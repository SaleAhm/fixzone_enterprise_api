import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssignProviderDto } from './dto/assign-provider.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { UploadCompletionEvidenceDto } from './dto/upload-completion-evidence.dto';
import { AdminDashboardQueryDto } from './dto/admin-dashboard-query.dto';
import { DispatchAiService } from './services/dispatch-ai.service';
import { ReportService } from './report.service';

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

  // ===================== PROVIDER =====================

  @Get('assigned')
  @Roles(UserRole.PROVIDER)
  getAssignedReports(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getAssignedReports(user);
  }

  // ===================== DASHBOARD =====================

  @Get('admin/dashboard/summary')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getDashboardSummary(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: AdminDashboardQueryDto,
  ) {
    return this.reportService.getDashboardSummary(user, query);
  }

  @Get('admin/dashboard/trends')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getReportTrends(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getReportTrends(user);
  }

  @Get('admin/dashboard/category-trends')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getCategoryTrends(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getCategoryTrends(user);
  }

  @Get('admin/dashboard/provider-performance')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getProviderPerformance(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getProviderPerformance(user);
  }

  @Get('admin/dashboard/advanced')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getAdvancedAnalytics(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getAdvancedAnalytics(user);
  }

  @Get('admin/dashboard/recent')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getRecentReports(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getRecentReports(user);
  }

  // ===================== ORGANIZATION =====================

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getOrganizationReports(@CurrentUser() user: CurrentAuthUser) {
    return this.reportService.getOrganizationReports(user);
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

  // ===================== ACTIONS =====================

  @Patch(':id/assign')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  assignProvider(
    @Param('id') id: string,
    @Body() dto: AssignProviderDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.assignProvider(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
  )
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateReportStatusDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.updateStatus(id, dto, user);
  }

  @Post(':id/completion-evidence')
  @Roles(UserRole.PROVIDER)
  uploadCompletionEvidence(
    @Param('id') id: string,
    @Body() dto: UploadCompletionEvidenceDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.reportService.uploadCompletionEvidence(id, dto, user);
  }

  @Patch(':id/recommend-provider')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  recommendProvider(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.dispatchAiService.recommendProviders(id, user);
  }

  @Patch(':id/auto-assign')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  autoAssignProvider(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.dispatchAiService.autoAssignBestProvider(id, user);
  }
}
