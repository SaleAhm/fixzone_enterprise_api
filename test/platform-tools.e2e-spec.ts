import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

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
    }
    await prisma.demoAuditLog.deleteMany({
      where: {
        action: {
          in: [
            'Backup Created',
            'Backup Deleted',
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
    expect(health.body.api.status).toBe('online');
    expect(health.body.database.status).toBe('online');

    const cache = await request(app.getHttpServer())
      .post('/api/platform-tools/cache/clear')
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: 'temporary' });
    expect(cache.status).toBe(201);
    expect(cache.body.cleared).toBe(true);

    const backup = await request(app.getHttpServer())
      .post('/api/platform-tools/backups')
      .set('Authorization', `Bearer ${token}`);
    expect(backup.status).toBe(201);
    expect(backup.body.fileName).toMatch(/^fixzone-backup-/);

    const list = await request(app.getHttpServer())
      .get('/api/platform-tools/backups')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);

    const audit = await request(app.getHttpServer())
      .get('/api/platform-tools/audit?action=Backup')
      .set('Authorization', `Bearer ${token}`);
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBeGreaterThanOrEqual(1);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/platform-tools/backups/${backup.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
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
    expect(enabled.body.enabled).toBe(true);

    const citizenBlocked = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(citizenBlocked.status).toBe(503);
    expect(citizenBlocked.body.maintenance).toBe(true);

    const adminAllowed = await request(app.getHttpServer())
      .get('/api/platform-tools/health')
      .set('Authorization', `Bearer ${superToken}`);
    expect(adminAllowed.status).toBe(200);
  });
});
