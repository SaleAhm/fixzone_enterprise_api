import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { rm } from 'fs/promises';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

type HealthBody = {
  api: { status: string };
  database: { status: string };
};
type PublicHealthBody = {
  status: string;
  service: string;
  apiPrefix: string;
};
type OperationalHealthBody = {
  state: string;
  checks: {
    api: { state: string };
    database: { state: string };
    uploadStorage: { state: string; details?: Record<string, unknown> };
  };
};
type CacheBody = { cleared: boolean };
type BackupBody = {
  id: string;
  fileName: string;
  filePath: string;
  metadata?: Record<string, unknown>;
};
type AuditBody = { total: number };
type DeleteBackupBody = { deleted: boolean };
type RestoreBody = { message: string };
type MaintenanceBody = { enabled: boolean; maintenance?: boolean };

function body<T>(response: request.Response): T {
  return response.body as T;
}

describe('Platform Tools (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
  });

  afterEach(async () => {
    await prisma.platformSetting.deleteMany({
      where: { key: { in: ['maintenance_mode', 'cache_status'] } },
    });
    const backups = await prisma.platformBackup.findMany({
      where: { fileName: { startsWith: 'fixzone-backup-' } },
    });
    for (const backup of backups) {
      await prisma.platformBackup.delete({ where: { id: backup.id } });
      await rm(backup.filePath, { force: true });
    }
    await prisma.demoAuditLog.deleteMany({
      where: {
        action: {
          in: [
            'Backup Created',
            'Backup Deleted',
            'Backup Restore Blocked',
            'Maintenance Enabled',
            'Maintenance Disabled',
            'Cache Cleared',
          ],
        },
      },
    });
    if (createdUserIds.length) {
      await prisma.user.deleteMany({
        where: { id: { in: [...createdUserIds] } },
      });
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function createUser(role: UserRole) {
    const user = await prisma.user.create({
      data: {
        email: `platform-${role.toLowerCase()}-${Date.now()}@test.com`,
        fullName: `Platform ${role}`,
        role,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function tokenFor(user: {
    id: string;
    email: string | null;
    fullName: string;
    role: UserRole;
    organizationId: string | null;
  }) {
    return jwtService.signAsync({
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
    });
  }

  it('exposes health, cache, backup, and audit utilities to super admins', async () => {
    const superAdmin = await createUser(UserRole.SUPER_ADMIN);
    const token = await tokenFor(superAdmin);

    const health = await request(app.getHttpServer())
      .get('/api/platform-tools/health')
      .set('Authorization', `Bearer ${token}`);
    expect(health.status).toBe(200);
    expect(body<HealthBody>(health).api.status).toBe('online');
    expect(body<HealthBody>(health).database.status).toBe('online');

    const operationalHealth = await request(app.getHttpServer())
      .get('/api/platform-tools/operational-health')
      .set('Authorization', `Bearer ${token}`);
    expect(operationalHealth.status).toBe(200);
    expect(
      body<OperationalHealthBody>(operationalHealth).checks.api.state,
    ).toBe('HEALTHY');
    expect(
      body<OperationalHealthBody>(operationalHealth).checks.database.state,
    ).toBe('HEALTHY');
    expect(
      JSON.stringify(body<OperationalHealthBody>(operationalHealth)),
    ).not.toContain('DATABASE_URL');

    const cache = await request(app.getHttpServer())
      .post('/api/platform-tools/cache/clear')
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: 'temporary' });
    expect(cache.status).toBe(201);
    expect(body<CacheBody>(cache).cleared).toBe(true);

    const backup = await request(app.getHttpServer())
      .post('/api/platform-tools/backups')
      .set('Authorization', `Bearer ${token}`);
    expect(backup.status).toBe(201);
    const backupBody = body<BackupBody>(backup);
    expect(backupBody.fileName).toMatch(
      /^fixzone-backup-\d{14}-[a-f0-9]{8}\.json$/,
    );

    const list = await request(app.getHttpServer())
      .get('/api/platform-tools/backups')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const listBody = body<BackupBody[]>(list);
    expect(listBody.length).toBeGreaterThanOrEqual(1);
    expect(listBody[0].metadata).toMatchObject({
      backupType: 'metadata_snapshot',
      operationalBackup: false,
      includesPostgresDump: false,
      includesUploadsArchive: false,
    });

    const audit = await request(app.getHttpServer())
      .get('/api/platform-tools/audit?action=Backup')
      .set('Authorization', `Bearer ${token}`);
    expect(audit.status).toBe(200);
    expect(body<AuditBody>(audit).total).toBeGreaterThanOrEqual(1);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/platform-tools/backups/${backupBody.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleted.status).toBe(200);
    expect(body<DeleteBackupBody>(deleted).deleted).toBe(true);
  }, 15000);

  it('keeps public health minimal and protects operational health', async () => {
    const publicHealth = await request(app.getHttpServer()).get('/api/health');
    expect(publicHealth.status).toBe(200);
    expect(body<PublicHealthBody>(publicHealth)).toEqual({
      status: 'ok',
      service: 'fixzone-enterprise-api',
      apiPrefix: '/api',
    });
    expect(JSON.stringify(body<PublicHealthBody>(publicHealth))).not.toContain(
      'upload',
    );
    expect(JSON.stringify(body<PublicHealthBody>(publicHealth))).not.toContain(
      'database',
    );

    const unauthenticated = await request(app.getHttpServer()).get(
      '/api/platform-tools/operational-health',
    );
    expect(unauthenticated.status).toBe(401);

    const orgAdmin = await createUser(UserRole.ORG_ADMIN);
    const orgToken = await tokenFor(orgAdmin);
    const forbidden = await request(app.getHttpServer())
      .get('/api/platform-tools/operational-health')
      .set('Authorization', `Bearer ${orgToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('creates repeated backups without filename collisions', async () => {
    const superAdmin = await createUser(UserRole.SUPER_ADMIN);
    const token = await tokenFor(superAdmin);

    const first = await request(app.getHttpServer())
      .post('/api/platform-tools/backups')
      .set('Authorization', `Bearer ${token}`);
    const second = await request(app.getHttpServer())
      .post('/api/platform-tools/backups')
      .set('Authorization', `Bearer ${token}`);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = body<BackupBody>(first);
    const secondBody = body<BackupBody>(second);
    expect(firstBody.fileName).not.toBe(secondBody.fileName);
    expect(firstBody.filePath).not.toBe(secondBody.filePath);
  }, 15000);

  it('blocks metadata restore in production without explicit governance override', async () => {
    const superAdmin = await createUser(UserRole.SUPER_ADMIN);
    const token = await tokenFor(superAdmin);
    const backup = await request(app.getHttpServer())
      .post('/api/platform-tools/backups')
      .set('Authorization', `Bearer ${token}`);

    expect(backup.status).toBe(201);

    const previousNodeEnv = process.env.NODE_ENV;
    const previousRestoreOverride = process.env.ALLOW_PLATFORM_METADATA_RESTORE;
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PLATFORM_METADATA_RESTORE;

    try {
      const restore = await request(app.getHttpServer())
        .post(
          `/api/platform-tools/backups/${body<BackupBody>(backup).id}/restore`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({ confirm: true });

      expect(restore.status).toBe(403);
      expect(body<RestoreBody>(restore).message).toContain(
        'approved operational backup process',
      );
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousRestoreOverride === undefined) {
        delete process.env.ALLOW_PLATFORM_METADATA_RESTORE;
      } else {
        process.env.ALLOW_PLATFORM_METADATA_RESTORE = previousRestoreOverride;
      }
    }
  });

  it('enforces maintenance mode for citizen/provider APIs while allowing admin bypass', async () => {
    const superAdmin = await createUser(UserRole.SUPER_ADMIN);
    const citizen = await createUser(UserRole.CITIZEN);
    const superToken = await tokenFor(superAdmin);
    const citizenToken = await tokenFor(citizen);

    const enabled = await request(app.getHttpServer())
      .post('/api/platform-tools/maintenance')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        enabled: true,
        message: 'Scheduled platform maintenance',
        allowAdminBypass: true,
      });
    expect(enabled.status).toBe(201);
    expect(body<MaintenanceBody>(enabled).enabled).toBe(true);

    const citizenBlocked = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(citizenBlocked.status).toBe(503);
    expect(body<MaintenanceBody>(citizenBlocked).maintenance).toBe(true);

    const adminAllowed = await request(app.getHttpServer())
      .get('/api/platform-tools/health')
      .set('Authorization', `Bearer ${superToken}`);
    expect(adminAllowed.status).toBe(200);
  });
});
