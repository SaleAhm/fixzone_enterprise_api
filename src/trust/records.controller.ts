import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { TrustService } from './trust.service';
import type { TrustUser } from './trust.service';

@Controller('records')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecordsController {
  constructor(private readonly trust: TrustService) {}

  @Post('evidence')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  create(@CurrentUser() user: TrustUser, @Body() dto: CreateEvidenceDto) {
    return this.trust.createEvidence(user, dto);
  }

  @Get('evidence')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  list(@CurrentUser() user: TrustUser) {
    return this.trust.listEvidence(user);
  }

  @Get('evidence/:id')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  get(@CurrentUser() user: TrustUser, @Param('id') id: string) {
    return this.trust.getEvidence(user, id);
  }
}
