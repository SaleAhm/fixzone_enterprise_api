import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Enterprise Services Framework (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const createdOrgIds: string[] = [];
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
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
      createdOrgIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function token() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organization = await prisma.organization.create({
      data: { name: 'Enterprise Service Framework Test' },
    });
    createdOrgIds.push(organization.id);
    const user = await prisma.user.create({
      data: {
        email: `enterprise-service-framework-${suffix}@test.com`,
        fullName: 'Enterprise Service Admin',
        role: UserRole.SUPER_ADMIN,
        organizationId: organization.id,
      },
    });
    createdUserIds.push(user.id);
    return jwtService.signAsync({
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
    });
  }

  it('registers Maintenance as the only active service implementation', async () => {
    const accessToken = await token();

    const res = await request(app.getHttpServer())
      .get('/api/enterprise-services')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.framework).toBe('SecureZone Enterprise Service Framework');
    expect(res.body.activeModuleKey).toBe('maintenance');
    expect(res.body.activeServiceType).toBe('maintenance_report');
    expect(res.body.serviceDefinitions).toEqual([
      expect.objectContaining({
        moduleKey: 'maintenance',
        serviceType: 'maintenance_report',
        activeImplementation: true,
        metadataOnly: false,
      }),
    ]);
  });

  it('exposes provider capabilities as metadata without creating workflows', async () => {
    const accessToken = await token();

    const res = await request(app.getHttpServer())
      .get('/api/enterprise-services/provider-capabilities')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'electrical',
          moduleKeys: ['maintenance'],
          metadataOnly: false,
        }),
        expect.objectContaining({
          key: 'medical',
          moduleKeys: ['healthcare'],
          metadataOnly: true,
        }),
      ]),
    );
  });

  it('documents the Report compatibility adapter contract', async () => {
    const accessToken = await token();

    const res = await request(app.getHttpServer())
      .get('/api/enterprise-services/maintenance/registration')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.compatibility).toMatchObject({
      sourceEntity: 'Report',
      targetEntity: 'GenericServiceRequest',
      moduleKey: 'maintenance',
      serviceType: 'maintenance_report',
      nonBreaking: true,
      dataMigrationRequired: false,
    });
    expect(res.body.compatibility.fieldMapping).toMatchObject({
      id: 'sourceId',
      assignedProviderId: 'assignedProfessionalId',
    });
  });
});
