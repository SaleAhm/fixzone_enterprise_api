import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
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
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateOrganizationDto, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.create(dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.organizationService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  getMine(@Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getMine(user);
  }
}