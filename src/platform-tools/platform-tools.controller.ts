import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MaintenanceModeDto } from './dto/maintenance-mode.dto';
import { PlatformToolsService } from './platform-tools.service';

type CurrentAuthUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role: UserRole;
};

@Controller('platform-tools')
export class PlatformToolsController {
  constructor(private readonly platformTools: PlatformToolsService) {}

  @Get('maintenance/public')
  maintenancePublic() {
    return this.platformTools.getMaintenance();
  }

  @Get('health')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  health(@CurrentUser() user: CurrentAuthUser) {
    return this.platformTools.systemHealth(user);
  }

  @Post('backups')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  createBackup(@CurrentUser() user: CurrentAuthUser) {
    return this.platformTools.createBackup(user);
  }

  @Get('backups')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  listBackups(@CurrentUser() user: CurrentAuthUser) {
    return this.platformTools.listBackups(user);
  }

  @Get('backups/:id/download')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  async downloadBackup(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Res() res: Response,
  ) {
    const { backup, stream } = await this.platformTools.getBackupStream(
      id,
      user,
    );
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${backup.fileName}"`,
    );
    stream.pipe(res);
  }

  @Post('backups/:id/restore')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  restoreBackup(
    @Param('id') id: string,
    @Body('confirm') confirm: boolean,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.platformTools.restoreBackup(id, confirm === true, user);
  }

  @Delete('backups/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  deleteBackup(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.platformTools.deleteBackup(id, user);
  }

  @Get('maintenance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  maintenance(@CurrentUser() user: CurrentAuthUser) {
    return this.platformTools.getMaintenance();
  }

  @Post('maintenance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  setMaintenance(
    @Body() dto: MaintenanceModeDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.platformTools.setMaintenance(dto, user);
  }

  @Get('cache')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  cache(@CurrentUser() user: CurrentAuthUser) {
    return this.platformTools.cacheStatus(user);
  }

  @Post('cache/clear')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  clearCache(
    @Body('scope') scope: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.platformTools.clearCache(scope ?? 'all', user);
  }

  @Get('audit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  audit(
    @Query() query: Record<string, string>,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.platformTools.auditLogs(
      {
        user: query.user,
        action: query.action,
        search: query.search,
        from: query.from,
        to: query.to,
        page: query.page ? Number(query.page) : undefined,
        limit: query.limit ? Number(query.limit) : undefined,
      },
      user,
    );
  }

  @Get('audit/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  async exportAudit(
    @CurrentUser() user: CurrentAuthUser,
    @Res() res: Response,
  ) {
    const csv = await this.platformTools.exportAuditLogs(user);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="fixzone-audit.csv"',
    );
    res.send(`createdAt,actorUserId,action,demoBatchId,scenario\n${csv}`);
  }
}
