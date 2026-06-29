import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationService } from './organization.service';

type RequestUser = {
  sub: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string;
  role?: string;
  organizationId?: string | null;
};

@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() dto: CreateOrganizationDto, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  findAll(@Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.findAll(user);
  }

  @Get('mine')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getMine(@Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getMine(user);
  }

  @Get('billing/overview')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  getBillingOverview(@Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getBillingOverview(user);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getById(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getById(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: Request,
  ) {
    const user = req.user as RequestUser;
    return this.organizationService.update(id, dto, user);
  }

  @Post(':id/activate')
  @Roles(UserRole.SUPER_ADMIN)
  activate(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.setStatus(id, 'ACTIVE', user);
  }

  @Post(':id/suspend')
  @Roles(UserRole.SUPER_ADMIN)
  suspend(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.setStatus(id, 'SUSPENDED', user);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  archive(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.setStatus(id, 'ARCHIVED', user);
  }

  @Get(':id/users')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getUsers(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getUsers(id, user);
  }

  @Get(':id/providers')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getProviders(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getProviders(id, user);
  }

  @Get(':id/reports')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getReports(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getReports(id, user);
  }

  @Get(':id/billing')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  getBilling(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getBilling(id, user);
  }
}
