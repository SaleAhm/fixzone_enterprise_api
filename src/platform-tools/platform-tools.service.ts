import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportStatus, UserRole } from '@prisma/client';
import { createReadStream } from 'fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { cpus, freemem, loadavg, totalmem, uptime } from 'os';
import { basename, join, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MaintenanceModeDto } from './dto/maintenance-mode.dto';

type JwtUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role: UserRole;
};

type MaintenanceState = {
  enabled: boolean;
  message: string;
  estimatedCompletionTime: string | null;
  allowAdminBypass: boolean;
  updatedBy?: string;
  updatedAt?: string;
};

@Injectable()
export class PlatformToolsService {
  private readonly backupRoot = join(process.cwd(), 'backups');
  private readonly uploadRoot = join(process.cwd(), 'uploads');
  private readonly tempRoot = join(process.cwd(), '.temp');
  private readonly maintenanceKey = 'maintenance_mode';
  private readonly cacheKey = 'cache_status';

  constructor(private readonly prisma: PrismaService) {}

  async systemHealth(user: JwtUser) {
    this.requireSuperAdmin(user);

    const startedAt = Date.now();
    let database = 'online';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'offline';
    }

    const [uploadStats, backupStats, activeUsers, activeProviders, queueSize] =
      await Promise.all([
        this.safeDirStats(this.uploadRoot),
        this.safeDirStats(this.backupRoot),
        this.prisma.user.count(),
        this.prisma.user.count({ where: { role: UserRole.PROVIDER } }),
        this.prisma.report.count({
          where: {
            status: { in: [ReportStatus.PENDING, ReportStatus.ASSIGNED] },
          },
        }),
      ]);

    const totalMemory = totalmem();
    const freeMemory = freemem();

    return {
      api: {
        status: 'online',
        responseTimeMs: Date.now() - startedAt,
      },
      database: {
        status: database,
      },
      storage: {
        status: uploadStats.exists ? 'online' : 'missing',
        uploadDirectory: this.uploadRoot,
        uploadDirectoryExists: uploadStats.exists,
        uploadDirectorySizeBytes: uploadStats.sizeBytes,
        backupDirectorySizeBytes: backupStats.sizeBytes,
      },
      system: {
        diskUsage: {
          uploadsBytes: uploadStats.sizeBytes,
          backupsBytes: backupStats.sizeBytes,
        },
        memory: {
          totalBytes: totalMemory,
          freeBytes: freeMemory,
          usedBytes: totalMemory - freeMemory,
          usedPercent: Math.round(
            ((totalMemory - freeMemory) / totalMemory) * 100,
          ),
        },
        cpu: {
          cores: cpus().length,
          loadAverage: loadavg(),
        },
        uptimeSeconds: Math.round(uptime()),
      },
      build: {
        version: process.env.npm_package_version ?? '0.0.1',
        environment: process.env.NODE_ENV ?? 'development',
      },
      activity: {
        activeUsers,
        activeProviders,
        queueSize,
      },
    };
  }

  async createBackup(user: JwtUser) {
    const actorUserId = this.requireSuperAdmin(user);
    await mkdir(this.backupRoot, { recursive: true });
    const createdAt = new Date();
    const fileName = `fixzone-backup-${createdAt
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}.json`;
    const filePath = join(this.backupRoot, fileName);

    const data = {
      format: 'fixzone-json-db-backup-v1',
      createdAt: createdAt.toISOString(),
      metadata: {
        applicationName: 'SecureZone Platform',
        activeModule: 'FixZone Maintenance Services',
        applicationVersion: process.env.npm_package_version ?? '0.0.1',
        databaseProvider: 'postgresql',
        schemaVersion: 'prisma-schema-v1',
        createdById: actorUserId,
        futureCloudTargets: ['google_drive', 'microsoft_onedrive'],
      },
      tables: {
        organizations: await this.prisma.organization.findMany(),
        users: await this.prisma.user.findMany(),
        reports: await this.prisma.report.findMany(),
        notifications: await this.prisma.notification.findMany(),
        demoAuditLogs: await this.prisma.demoAuditLog.findMany(),
        platformSettings: await this.prisma.platformSetting.findMany(),
      },
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    const fileStat = await stat(filePath);
    const backup = await this.prisma.platformBackup.create({
      data: {
        fileName,
        filePath,
        sizeBytes: fileStat.size,
        createdById: actorUserId,
      },
    });
    await this.audit('Backup Created', actorUserId, {
      metadata: { backupId: backup.id, fileName, sizeBytes: fileStat.size },
    });
    return backup;
  }

  async listBackups(user: JwtUser) {
    this.requireSuperAdmin(user);
    const backups = await this.prisma.platformBackup.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(
      backups.map(async (backup) => ({
        ...backup,
        metadata: await this.safeBackupMetadata(backup.filePath),
      })),
    );
  }

  async getBackupStream(id: string, user: JwtUser) {
    const actorUserId = this.requireSuperAdmin(user);
    const backup = await this.findBackup(id);
    await this.audit('Backup Downloaded', actorUserId, {
      metadata: { backupId: backup.id, fileName: backup.fileName },
    });
    return {
      backup,
      stream: createReadStream(backup.filePath),
    };
  }

  async deleteBackup(id: string, user: JwtUser) {
    const actorUserId = this.requireSuperAdmin(user);
    const backup = await this.findBackup(id);
    await rm(backup.filePath, { force: true });
    await this.prisma.platformBackup.delete({ where: { id } });
    await this.audit('Backup Deleted', actorUserId, {
      metadata: { backupId: id, fileName: backup.fileName },
    });
    return { deleted: true };
  }

  async restoreBackup(id: string, confirm: boolean, user: JwtUser) {
    const actorUserId = this.requireSuperAdmin(user);
    if (!confirm) {
      throw new BadRequestException('Backup restore requires confirm=true');
    }

    const backup = await this.findBackup(id);
    const parsed = JSON.parse(await readFile(backup.filePath, 'utf8')) as {
      format?: string;
      tables?: Record<string, unknown[]>;
    };
    if (parsed.format !== 'fixzone-json-db-backup-v1' || !parsed.tables) {
      throw new BadRequestException('Invalid FixZone backup file');
    }
    const tables = parsed.tables;

    await this.prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany();
      await tx.report.deleteMany();
      await tx.user.deleteMany();
      await tx.organization.deleteMany();
      await tx.demoAuditLog.deleteMany();
      await tx.platformSetting.deleteMany();

      if (tables.organizations?.length) {
        await tx.organization.createMany({
          data: tables.organizations as Prisma.OrganizationCreateManyInput[],
        });
      }
      if (tables.users?.length) {
        await tx.user.createMany({
          data: tables.users as Prisma.UserCreateManyInput[],
        });
      }
      if (tables.reports?.length) {
        await tx.report.createMany({
          data: tables.reports as Prisma.ReportCreateManyInput[],
        });
      }
      if (tables.notifications?.length) {
        await tx.notification.createMany({
          data: tables.notifications as Prisma.NotificationCreateManyInput[],
        });
      }
      if (tables.demoAuditLogs?.length) {
        await tx.demoAuditLog.createMany({
          data: tables.demoAuditLogs as Prisma.DemoAuditLogCreateManyInput[],
        });
      }
      if (tables.platformSettings?.length) {
        await tx.platformSetting.createMany({
          data: tables.platformSettings as Prisma.PlatformSettingCreateManyInput[],
        });
      }
    });

    await this.prisma.platformBackup.update({
      where: { id },
      data: { restoredAt: new Date(), restoredById: actorUserId },
    });
    await this.audit('Backup Restored', actorUserId, {
      metadata: { backupId: id, fileName: backup.fileName },
    });
    return { restored: true };
  }

  async getMaintenance() {
    return this.getMaintenanceState();
  }

  async setMaintenance(dto: MaintenanceModeDto, user: JwtUser) {
    const actorUserId = this.requireSuperAdmin(user);
    const state: MaintenanceState = {
      enabled: dto.enabled,
      message:
        dto.message?.trim() ||
        'FixZone is temporarily unavailable while maintenance is in progress.',
      estimatedCompletionTime: dto.estimatedCompletionTime ?? null,
      allowAdminBypass: dto.allowAdminBypass ?? true,
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    };
    await this.setJsonSetting(this.maintenanceKey, state);
    await this.audit(
      dto.enabled ? 'Maintenance Enabled' : 'Maintenance Disabled',
      actorUserId,
      {
        metadata: state as unknown as Prisma.InputJsonValue,
      },
    );
    return state;
  }

  async cacheStatus(user: JwtUser) {
    this.requireSuperAdmin(user);
    const [temp, generated, uploadsCache, setting] = await Promise.all([
      this.safeDirStats(this.tempRoot),
      this.safeDirStats(join(this.tempRoot, 'generated-demo-cache')),
      this.safeDirStats(join(this.tempRoot, 'uploads-cache')),
      this.prisma.platformSetting.findUnique({ where: { key: this.cacheKey } }),
    ]);

    return {
      health: 'healthy',
      sizeBytes: temp.sizeBytes + generated.sizeBytes + uploadsCache.sizeBytes,
      temp,
      generatedDemoCache: generated,
      uploadsCache,
      lastCleared: this.objectValue(setting?.value)?.lastCleared ?? null,
    };
  }

  async clearCache(scope: string, user: JwtUser) {
    const actorUserId = this.requireSuperAdmin(user);
    const allowed = new Set(['api', 'demo', 'uploads', 'temporary', 'all']);
    if (!allowed.has(scope))
      throw new BadRequestException('Invalid cache scope');

    await mkdir(this.tempRoot, { recursive: true });
    const targets =
      scope === 'all'
        ? [
            join(this.tempRoot, 'api-cache'),
            join(this.tempRoot, 'generated-demo-cache'),
            join(this.tempRoot, 'uploads-cache'),
            join(this.tempRoot, 'tmp'),
          ]
        : [this.cachePathFor(scope)];

    for (const target of targets) {
      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
    }

    const state = {
      lastCleared: new Date().toISOString(),
      scope,
      clearedBy: actorUserId,
    };
    await this.setJsonSetting(this.cacheKey, state);
    await this.audit('Cache Cleared', actorUserId, {
      metadata: state,
    });
    return { cleared: true, ...state };
  }

  async auditLogs(
    query: {
      user?: string;
      action?: string;
      search?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
    user: JwtUser,
  ) {
    this.requireSuperAdmin(user);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const where: Prisma.DemoAuditLogWhereInput = {
      ...(query.user ? { actorUserId: query.user } : {}),
      ...(query.action
        ? { action: { contains: query.action, mode: 'insensitive' } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { action: { contains: query.search, mode: 'insensitive' } },
              { actorUserId: { contains: query.search, mode: 'insensitive' } },
              { demoBatchId: { contains: query.search, mode: 'insensitive' } },
              { scenario: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      }),
    };

    const [total, items] = await Promise.all([
      this.prisma.demoAuditLog.count({ where }),
      this.prisma.demoAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { page, limit, total, items };
  }

  async exportAuditLogs(user: JwtUser) {
    this.requireSuperAdmin(user);
    const items = await this.prisma.demoAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    return items
      .map((item) =>
        [
          item.createdAt.toISOString(),
          item.actorUserId,
          item.action,
          item.demoBatchId ?? '',
          item.scenario ?? '',
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\n');
  }

  async audit(
    action: string,
    actorUserId: string,
    options: {
      demoBatchId?: string;
      scenario?: string;
      metadata?: Prisma.InputJsonValue;
    } = {},
  ) {
    return this.prisma.demoAuditLog.create({
      data: {
        action,
        actorUserId,
        demoBatchId: options.demoBatchId,
        scenario: options.scenario,
        metadata: options.metadata,
      },
    });
  }

  private async findBackup(id: string) {
    const backup = await this.prisma.platformBackup.findUnique({
      where: { id },
    });
    if (!backup) throw new NotFoundException('Backup not found');
    const resolved = resolve(backup.filePath);
    if (!resolved.startsWith(resolve(this.backupRoot))) {
      throw new ForbiddenException('Backup path is outside backup directory');
    }
    return backup;
  }

  private async safeBackupMetadata(filePath: string) {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
        format?: string;
        createdAt?: string;
        metadata?: Record<string, unknown>;
      };
      return {
        format: parsed.format ?? null,
        createdAt: parsed.createdAt ?? null,
        ...(parsed.metadata ?? {}),
      };
    } catch {
      return {
        format: null,
        createdAt: null,
        unreadable: true,
      };
    }
  }

  private cachePathFor(scope: string) {
    switch (scope) {
      case 'api':
        return join(this.tempRoot, 'api-cache');
      case 'demo':
        return join(this.tempRoot, 'generated-demo-cache');
      case 'uploads':
        return join(this.tempRoot, 'uploads-cache');
      case 'temporary':
      default:
        return join(this.tempRoot, 'tmp');
    }
  }

  private async getMaintenanceState(): Promise<MaintenanceState> {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: this.maintenanceKey },
    });
    const value = this.objectValue(setting?.value);
    return {
      enabled: value.enabled === true,
      message:
        typeof value.message === 'string'
          ? value.message
          : 'FixZone is temporarily unavailable while maintenance is in progress.',
      estimatedCompletionTime:
        typeof value.estimatedCompletionTime === 'string'
          ? value.estimatedCompletionTime
          : null,
      allowAdminBypass: value.allowAdminBypass !== false,
      updatedBy:
        typeof value.updatedBy === 'string' ? value.updatedBy : undefined,
      updatedAt:
        typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    };
  }

  private async setJsonSetting(key: string, value: Prisma.InputJsonValue) {
    return this.prisma.platformSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async safeDirStats(path: string) {
    try {
      const sizeBytes = await this.directorySize(path);
      return { exists: true, path, sizeBytes };
    } catch {
      return { exists: false, path, sizeBytes: 0 };
    }
  }

  private async directorySize(path: string): Promise<number> {
    const entries = await readdir(path, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) return this.directorySize(fullPath);
        const info = await stat(fullPath);
        return info.size;
      }),
    );
    return sizes.reduce((sum, size) => sum + size, 0);
  }

  private requireSuperAdmin(user: JwtUser) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super Admin only');
    }
    const id = user.id ?? user.userId ?? user.sub;
    if (!id) throw new ForbiddenException('User id missing');
    return id;
  }
}
