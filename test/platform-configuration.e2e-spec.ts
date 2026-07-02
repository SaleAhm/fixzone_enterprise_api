import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Platform Configuration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

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
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrgIds } },
    });
    createdUserIds.length = 0;
    createdOrgIds.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function createContext() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organization = await prisma.organization.create({
      data: {
        name: 'Platform Config Tenant',
        enabledModules: ['maintenance'],
      },
    });
    createdOrgIds.push(organization.id);

    const superAdmin = await prisma.user.create({
      data: {
        email: `platform-config-super-${suffix}@test.com`,
        fullName: 'Platform Config Super',
        role: UserRole.SUPER_ADMIN,
        organizationId: organization.id,
      },
    });
    const provider = await prisma.user.create({
      data: {
        email: `platform-config-provider-${suffix}@test.com`,
        fullName: 'Platform Config Provider',
        role: UserRole.PROVIDER,
        organizationId: organization.id,
      },
    });
    createdUserIds.push(superAdmin.id, provider.id);

    const token = await jwtService.signAsync({
      sub: superAdmin.id,
      email: superAdmin.email,
      fullName: superAdmin.fullName,
      role: superAdmin.role,
      organizationId: superAdmin.organizationId,
    });

    return { organization, provider, token };
  }

  it('exposes platform configuration metadata without enabling future workflows', async () => {
    const { token } = await createContext();

    const res = await request(app.getHttpServer())
      .get('/api/platform/config')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      platformName: 'SecureZone Platform',
      activeProductionService: 'maintenance_report',
      activeProductionModule: 'maintenance',
      guardMode: 'non_blocking',
      futureModulesUsable: false,
    });
    expect(res.body.providerCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'electrical', status: 'ACTIVE' }),
        expect.objectContaining({
          id: 'medical',
          status: 'METADATA_ONLY',
          metadataOnly: true,
        }),
      ]),
    );
  });

  it('updates tenant service configuration through organization profile metadata', async () => {
    const { organization, token } = await createContext();

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/platform/service-configuration/${organization.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        enabledServices: ['maintenance_report', 'future_healthcare'],
        serviceOrdering: ['maintenance_report', 'future_healthcare'],
        serviceVisibility: {
          maintenance_report: true,
          future_healthcare: false,
        },
        futureAiPreferences: { dispatchAssist: true },
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.enabledServices).toEqual([
      'maintenance_report',
      'future_healthcare',
    ]);
    expect(updateRes.body.serviceVisibility.future_healthcare).toBe(false);
    expect(updateRes.body.futureAiPreferences.dispatchAssist).toBe(true);

    const getRes = await request(app.getHttpServer())
      .get(`/api/platform/service-configuration/${organization.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.defaultService).toBe('maintenance_report');
    expect(getRes.body.enabledServices).toContain('maintenance_report');

    const audit = await prisma.demoAuditLog.findFirst({
      where: {
        action: 'Tenant Service Configuration Updated',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.metadata).toMatchObject({
      organizationId: organization.id,
      defaultService: 'maintenance_report',
    });
  });

  it('reports non-blocking configuration validation and runtime readiness', async () => {
    const { organization, token } = await createContext();

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/platform/service-configuration/${organization.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        enabledServices: [
          'maintenance_report',
          'future_healthcare',
          'future_healthcare',
          'unknown_future_runtime',
        ],
        serviceOrdering: ['unknown_future_runtime', 'maintenance_report'],
        serviceVisibility: {
          maintenance_report: true,
          future_healthcare: false,
        },
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.validation).toMatchObject({
      valid: false,
      guardMode: 'non_blocking',
    });
    expect(updateRes.body.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown_service' }),
      ]),
    );

    const validationRes = await request(app.getHttpServer())
      .get(`/api/platform/configuration-validation/${organization.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(validationRes.status).toBe(200);
    expect(validationRes.body.validation.valid).toBe(false);
    expect(validationRes.body.validation.knownServices).toContain(
      'maintenance_report',
    );

    const readinessRes = await request(app.getHttpServer())
      .get(`/api/platform/readiness/${organization.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(readinessRes.status).toBe(200);
    expect(readinessRes.body).toMatchObject({
      activeProductionService: 'maintenance_report',
      activeProductionModule: 'maintenance',
      futureModulesOperational: false,
    });
    expect(readinessRes.body.summary).toMatchObject({
      informationalOnly: true,
      enforcementMode: 'non_blocking',
    });
    expect(readinessRes.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'configuration', status: 'warning' }),
        expect.objectContaining({ key: 'module' }),
      ]),
    );
  });

  it('assigns deactivates and removes provider capabilities as metadata', async () => {
    const { provider, token } = await createContext();

    const assignRes = await request(app.getHttpServer())
      .post(`/api/platform/providers/${provider.id}/capabilities`)
      .set('Authorization', `Bearer ${token}`)
      .send({ capabilityIds: ['electrical', 'medical', 'unknown'] });

    expect(assignRes.status).toBe(201);
    expect(assignRes.body.activeCount).toBe(2);
    expect(
      assignRes.body.assignments.map((item: { id: string }) => item.id),
    ).toEqual(expect.arrayContaining(['electrical', 'medical']));
    expect(assignRes.body.futureApprovalCount).toBeGreaterThanOrEqual(1);
    expect(assignRes.body.verificationSummary.highestRequiredLevel).toBe(3);

    const inactiveRes = await request(app.getHttpServer())
      .patch(
        `/api/platform/providers/${provider.id}/capabilities/medical/inactive`,
      )
      .set('Authorization', `Bearer ${token}`);

    expect(inactiveRes.status).toBe(200);
    expect(inactiveRes.body.inactiveCount).toBe(1);

    const removeRes = await request(app.getHttpServer())
      .delete(`/api/platform/providers/${provider.id}/capabilities/medical`)
      .set('Authorization', `Bearer ${token}`);

    expect(removeRes.status).toBe(200);
    expect(
      removeRes.body.assignments.map((item: { id: string }) => item.id),
    ).not.toContain('medical');

    const auditActions = await prisma.demoAuditLog.findMany({
      where: {
        action: {
          in: [
            'Provider Capabilities Assigned',
            'Provider Capability Deactivated',
            'Provider Capability Removed',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditActions.map((item) => item.action)).toEqual(
      expect.arrayContaining([
        'Provider Capabilities Assigned',
        'Provider Capability Deactivated',
        'Provider Capability Removed',
      ]),
    );
  });
});
