import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BusinessLogicService } from './business-logic.service';

@Controller('business-logic')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BusinessLogicController {
  constructor(private readonly businessLogic: BusinessLogicService) {}

  @Get('workflow-engine')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  describe() {
    return this.businessLogic.describe();
  }
}
