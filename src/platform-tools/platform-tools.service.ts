import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import {
  access,
  constants,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  statfs,
  unlink,
  writeFile,
} from 'fs/promises';
import { cpus, freemem, loadavg, totalmem, uptime } from 'os';
import { join, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { uploadRoot } from '../storage/upload-root';
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

type OperationalHealthState = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

type OperationalCheckResult = {
  state: OperationalHealthState;
  checkedAt: string;
  summary: string;
  details?: Record<string, unknown>;
};

type DirectoryStats = {
  exists: boolean;
  path: string;
  sizeBytes: number;
  fileCount: number;
};

@Injectable()
export class PlatformToolsService {
  private readonly logger = new Logger(PlatformToolsService.name);
  private readonly backupRoot = join(process.cwd(), 'backups');
  private readonly uploadRoot = uploadRoot();
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

  async operationalHealth(user: JwtUser) {
    this.requireSuperAdmin(user);
    const checkedAt = new Date().toISOString();
    const [database, uploadStorage, diskCapacity, backupFreshness] =
      await Promise.all([
        this.databaseOperationalCheck(),
        this.uploadStorageOperationalCheck(),
        this.diskCapacityOperationalCheck(),
        this.backupFreshnessOperationalCheck(),
      ]);

    const checks = {
      api: {
        state: 'HEALTHY',
        checkedAt,
        summary: 'API process is alive',
        details: {
          service: 'fixzone-enterprise-api',
          version: process.env.npm_package_version ?? '0.0.1',
          environment: process.env.NODE_ENV ?? 'development',
        },
      } satisfies OperationalCheckResult,
      database,
      uploadStorage,
      diskCapacity,
      backupFreshness,
    };

    const overall = this.worstState(Object.values(checks).map((c) => c.state));

    return {
      state: overall,
      checkedAt,
      checks,
      alerting: {
        model: ['HEALTHY', 'WARNING', 'CRITICAL', 'UNKNOWN'],
        generatedState: overall,
        autoRemediation: false,
      },
      contracts: {
        liveness: 'GET /api/health confirms public API process liveness only.',
        readiness:
          'Operational readiness requires API, database, and upload storage checks to be healthy.',
        operationalHealth:
          'This protected response is for Super Admin operational review and avoids host paths, credentials, and stack traces.',
      },
      limitations: {
        mountIdentity:
          'The API can verify configured upload-root behavior from inside the container, but cannot prove the Docker host bind source path. Host-level mount identity must be checked externally.',
        backupFreshness:
          'Runtime backup visibility is limited to Platform Tools metadata snapshots unless an approved external backup monitor publishes safe metadata to the application.',
      },
    };
  }

  async createBackup(user: JwtUser) {
    const actorUserId = this.requireSuperAdmin(user);
    await mkdir(this.backupRoot, { recursive: true });
    const createdAt = new Date();
    const operationId = randomUUID().slice(0, 8);
    const fileName = `fixzone-backup-${createdAt
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}-${operationId}.json`;
    const filePath = join(this.backupRoot, fileName);

    const data = {
      format: 'fixzone-json-db-backup-v1',
      createdAt: createdAt.toISOString(),
      metadata: {
        backupType: 'metadata_snapshot',
        operationalBackup: false,
        includesPostgresDump: false,
        includesUploadsArchive: false,
        restorePolicy:
          'Governance-controlled metadata restore only; production restore uses the approved VPS backup process.',
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_PLATFORM_METADATA_RESTORE !== 'true'
    ) {
      await this.audit('Backup Restore Blocked', actorUserId, {
        metadata: {
          backupId: id,
          fileName: backup.fileName,
          reason: 'production_metadata_restore_disabled',
        },
      });
      throw new ForbiddenException(
        'Production restore is governed by the approved operational backup process and is disabled in Platform Tools.',
      );
    }

    const parsed = JSON.parse(await readFile(backup.filePath, 'utf8')) as {
      format?: string;
      metadata?: Record<string, unknown>;
      tables?: Record<string, unknown[]>;
    };
    if (parsed.format !== 'fixzone-json-db-backup-v1' || !parsed.tables) {
      throw new BadRequestException('Invalid FixZone backup file');
    }
    if (parsed.metadata?.backupType !== 'metadata_snapshot') {
      throw new BadRequestException(
        'Unsupported backup type for Platform Tools restore',
      );
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { page, limit, total, items };
  }

  async exportAuditLogs(user: JwtUser) {
    this.requireSuperAdmin(user);
    const items = await this.prisma.demoAuditLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
      const { sizeBytes, fileCount } = await this.directoryStats(path);
      return { exists: true, path, sizeBytes, fileCount };
    } catch {
      return { exists: false, path, sizeBytes: 0, fileCount: 0 };
    }
  }

  private async directoryStats(path: string): Promise<DirectoryStats> {
    const entries = await readdir(path, { withFileTypes: true });
    const stats = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) return this.directoryStats(fullPath);
        const info = await stat(fullPath);
        return {
          exists: true,
          path: fullPath,
          sizeBytes: info.size,
          fileCount: 1,
        };
      }),
    );
    return {
      exists: true,
      path,
      sizeBytes: stats.reduce((sum, entry) => sum + entry.sizeBytes, 0),
      fileCount: stats.reduce((sum, entry) => sum + entry.fileCount, 0),
    };
  }

  private async databaseOperationalCheck(): Promise<OperationalCheckResult> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        state: 'HEALTHY',
        checkedAt,
        summary: 'Database connectivity check passed',
        details: { latencyMs: Date.now() - startedAt },
      };
    } catch (error) {
      this.logOperationalCheckFailure('database', 'CRITICAL', error);
      return {
        state: 'CRITICAL',
        checkedAt,
        summary: 'Database connectivity check failed',
        details: { errorCategory: this.safeErrorCategory(error) },
      };
    }
  }

  private async uploadStorageOperationalCheck(): Promise<OperationalCheckResult> {
    const checkedAt = new Date().toISOString();
    const configured = process.env.UPLOAD_ROOT?.trim();
    const canaryPath = join(
      this.uploadRoot,
      `.fixzone-operational-health-canary-${process.pid}-${Date.now()}-${randomUUID()}.tmp`,
    );
    let canaryCreated = false;

    try {
      const info = await stat(this.uploadRoot);
      if (!info.isDirectory()) {
        return {
          state: 'CRITICAL',
          checkedAt,
          summary: 'Configured upload root is not a directory',
          details: { configured: Boolean(configured) },
        };
      }

      await access(this.uploadRoot, constants.R_OK | constants.W_OK);
      await readdir(this.uploadRoot);
      await writeFile(canaryPath, 'fixzone operational health canary\n', {
        encoding: 'utf8',
        flag: 'wx',
      });
      canaryCreated = true;
      await readFile(canaryPath, 'utf8');
      await unlink(canaryPath);
      canaryCreated = false;

      const stats = await this.directoryStats(this.uploadRoot);
      return {
        state: 'HEALTHY',
        checkedAt,
        summary:
          'Upload root exists, is readable, and passed write/delete canary',
        details: {
          configured: Boolean(configured),
          fileCount: stats.fileCount,
          sizeBytes: stats.sizeBytes,
          canaryRemoved: true,
        },
      };
    } catch (error) {
      if (canaryCreated) {
        try {
          await unlink(canaryPath);
          canaryCreated = false;
        } catch (cleanupError) {
          this.logOperationalCheckFailure(
            'upload_storage_canary_cleanup',
            'WARNING',
            cleanupError,
          );
        }
      }
      this.logOperationalCheckFailure('upload_storage', 'CRITICAL', error);
      return {
        state: 'CRITICAL',
        checkedAt,
        summary: 'Upload root check failed',
        details: {
          configured: Boolean(configured),
          errorCategory: this.safeErrorCategory(error),
          canaryRemoved: !canaryCreated,
        },
      };
    }
  }

  private async diskCapacityOperationalCheck(): Promise<OperationalCheckResult> {
    const checkedAt = new Date().toISOString();
    try {
      const info = await statfs(this.uploadRoot);
      const totalBytes = Number(info.blocks) * Number(info.bsize);
      const freeBytes = Number(info.bavail) * Number(info.bsize);
      if (totalBytes <= 0) {
        return {
          state: 'UNKNOWN',
          checkedAt,
          summary: 'Filesystem capacity check returned no total capacity',
        };
      }
      const freePercent = Math.round((freeBytes / totalBytes) * 100);
      const warningPercent = this.readPercentEnv(
        'FIXZONE_UPLOAD_DISK_WARNING_FREE_PERCENT',
        15,
      );
      const criticalPercent = this.readPercentEnv(
        'FIXZONE_UPLOAD_DISK_CRITICAL_FREE_PERCENT',
        5,
      );
      const state: OperationalHealthState =
        freePercent <= criticalPercent
          ? 'CRITICAL'
          : freePercent <= warningPercent
            ? 'WARNING'
            : 'HEALTHY';
      return {
        state,
        checkedAt,
        summary: `Upload filesystem free space is ${freePercent}%`,
        details: {
          freePercent,
          freeBytes,
          totalBytes,
          warningFreePercent: warningPercent,
          criticalFreePercent: criticalPercent,
        },
      };
    } catch (error) {
      this.logOperationalCheckFailure('disk_capacity', 'UNKNOWN', error);
      return {
        state: 'UNKNOWN',
        checkedAt,
        summary: 'Filesystem capacity check is unavailable in this runtime',
        details: { errorCategory: this.safeErrorCategory(error) },
      };
    }
  }

  private async backupFreshnessOperationalCheck(): Promise<OperationalCheckResult> {
    const checkedAt = new Date().toISOString();
    try {
      const latest = await this.prisma.platformBackup.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          fileName: true,
          createdAt: true,
          sizeBytes: true,
          restoredAt: true,
        },
      });

      if (!latest) {
        return {
          state: 'UNKNOWN',
          checkedAt,
          summary:
            'No Platform Tools metadata snapshot is visible to the application runtime',
          details: {
            operationalBackupCovered: false,
            requiresExternalMonitor: true,
          },
        };
      }

      const ageHours =
        Math.round((Date.now() - latest.createdAt.getTime()) / 36_000) / 100;
      const warningHours = this.readPositiveNumberEnv(
        'FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS',
      );
      const criticalHours = this.readPositiveNumberEnv(
        'FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS',
      );
      const thresholdState =
        criticalHours !== null && ageHours >= criticalHours
          ? 'CRITICAL'
          : warningHours !== null && ageHours >= warningHours
            ? 'WARNING'
            : 'UNKNOWN';

      return {
        state: thresholdState,
        checkedAt,
        summary:
          thresholdState === 'UNKNOWN'
            ? 'Latest Platform Tools metadata snapshot is visible; no approved freshness threshold is configured'
            : 'Latest Platform Tools metadata snapshot exceeded configured freshness threshold',
        details: {
          latestSnapshotId: latest.id,
          latestSnapshotFileName: latest.fileName,
          latestSnapshotCreatedAt: latest.createdAt.toISOString(),
          latestSnapshotSizeBytes: latest.sizeBytes,
          latestSnapshotRestoredAt: latest.restoredAt?.toISOString() ?? null,
          ageHours,
          warningHours,
          criticalHours,
          operationalBackupCovered: false,
          requiresExternalMonitor: true,
        },
      };
    } catch (error) {
      this.logOperationalCheckFailure('backup_freshness', 'UNKNOWN', error);
      return {
        state: 'UNKNOWN',
        checkedAt,
        summary:
          'Backup freshness check is unavailable from application runtime',
        details: {
          errorCategory: this.safeErrorCategory(error),
          requiresExternalMonitor: true,
        },
      };
    }
  }

  private worstState(states: OperationalHealthState[]): OperationalHealthState {
    if (states.includes('CRITICAL')) return 'CRITICAL';
    if (states.includes('WARNING')) return 'WARNING';
    if (states.includes('UNKNOWN')) return 'UNKNOWN';
    return 'HEALTHY';
  }

  private readPercentEnv(name: string, fallback: number) {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(100, Math.max(0, value));
  }

  private readPositiveNumberEnv(name: string) {
    const raw = process.env[name];
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }

  private logOperationalCheckFailure(
    checkType: string,
    state: OperationalHealthState,
    error: unknown,
  ) {
    this.logger.warn({
      message: 'Operational health check failed',
      checkType,
      state,
      timestamp: new Date().toISOString(),
      errorCategory: this.safeErrorCategory(error),
    });
  }

  private safeErrorCategory(error: unknown) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    if (error instanceof Error) return error.name;
    return 'UnknownError';
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
