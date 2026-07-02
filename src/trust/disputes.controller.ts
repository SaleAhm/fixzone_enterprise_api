import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { CreateDisputeMessageDto } from './dto/create-dispute-message.dto';
import { UpdateDisputeStatusDto } from './dto/update-dispute-status.dto';
import { AssignDisputeDto } from './dto/assign-dispute.dto';
import { TrustService } from './trust.service';
import type { TrustUser } from './trust.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisputesController {
  constructor(private readonly trust: TrustService) {}

  @Post('disputes')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  create(@CurrentUser() user: TrustUser, @Body() dto: CreateDisputeDto) {
    return this.trust.createDispute(user, dto);
  }

  @Get('disputes/my')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  my(@CurrentUser() user: TrustUser) {
    return this.trust.getMyDisputes(user);
  }

  @Get('admin/disputes')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  admin(
    @CurrentUser() user: TrustUser,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.trust.getAdminDisputes(user, query);
  }

  @Get('disputes/:id')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  get(@CurrentUser() user: TrustUser, @Param('id') id: string) {
    return this.trust.getDispute(user, id);
  }

  @Post('disputes/:id/message')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  message(
    @CurrentUser() user: TrustUser,
    @Param('id') id: string,
    @Body() dto: CreateDisputeMessageDto,
  ) {
    return this.trust.addDisputeMessage(user, id, dto);
  }

  @Post('admin/disputes/:id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  status(
    @CurrentUser() user: TrustUser,
    @Param('id') id: string,
    @Body() dto: UpdateDisputeStatusDto,
  ) {
    return this.trust.updateDisputeStatus(user, id, dto);
  }

  @Post('admin/disputes/:id/assign')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  assign(
    @CurrentUser() user: TrustUser,
    @Param('id') id: string,
    @Body() dto: AssignDisputeDto,
  ) {
    return this.trust.assignDispute(user, id, dto);
  }

  @Post('admin/disputes/:id/escalate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  escalate(@CurrentUser() user: TrustUser, @Param('id') id: string) {
    return this.trust.escalateDispute(user, id);
  }

  @Post('admin/disputes/escalate-overdue')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  escalateOverdue(@CurrentUser() user: TrustUser) {
    return this.trust.escalateOverdueDisputes(user);
  }
}
