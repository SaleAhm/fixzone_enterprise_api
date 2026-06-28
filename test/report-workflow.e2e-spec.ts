import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ReportStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Report Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const createdReportIds: string[] = [];
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
    if (createdReportIds.length > 0) {
      await prisma.report.deleteMany({
        where: { id: { in: [...createdReportIds] } },
      });
      createdReportIds.length = 0;
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: [...createdUserIds] } },
      });
      createdUserIds.length = 0;
    }

    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: [...createdOrgIds] } },
      });
      createdOrgIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function createOrganization(name: string) {
    const organization = await prisma.organization.create({
      data: { name },
    });

    createdOrgIds.push(organization.id);

    return organization;
  }

  async function createUser(data: {
    email: string;
    fullName: string;
    role: UserRole;
    organizationId?: string | null;
  }) {
    const user = await prisma.user.create({
      data,
    });

    createdUserIds.push(user.id);

    return user;
  }

  async function createReport(data: {
    title: string;
    status?: ReportStatus;
    organizationId: string;
    citizenId: string;
    assignedProviderId?: string | null;
  }) {
    const report = await prisma.report.create({
      data: {
        title: data.title,
        description: 'Workflow test report',
        category: 'Road',
        location: 'Test Street',
        status: data.status ?? ReportStatus.PENDING,
        organizationId: data.organizationId,
        citizenId: data.citizenId,
        assignedProviderId: data.assignedProviderId ?? null,
      },
    });

    createdReportIds.push(report.id);

    return report;
  }

  async function signToken(user: {
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

  it('allows the strict happy path from PENDING to CLOSED', async () => {
    const org = await createOrganization('Workflow Org A');
    const admin = await createUser({
      email: 'wf-admin-happy@test.com',
      fullName: 'Workflow Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-happy@test.com',
      fullName: 'Workflow Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-happy@test.com',
      fullName: 'Workflow Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF happy path',
      organizationId: org.id,
      citizenId: citizen.id,
    });

    const adminToken = await signToken(admin);
    const providerToken = await signToken(provider);

    const assignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: provider.id });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.status).toBe(ReportStatus.ASSIGNED);

    const inProgressRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(inProgressRes.status).toBe(200);
    expect(inProgressRes.body.status).toBe(ReportStatus.IN_PROGRESS);

    const completedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });

    expect(completedRes.status).toBe(200);
    expect(completedRes.body.status).toBe(ReportStatus.COMPLETED_BY_PROVIDER);

    const closedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: ReportStatus.CLOSED });

    expect(closedRes.status).toBe(200);
    expect(closedRes.body.status).toBe(ReportStatus.CLOSED);
  });

  it('rejects direct ASSIGNED to COMPLETED_BY_PROVIDER transitions', async () => {
    const org = await createOrganization('Workflow Org B');
    const admin = await createUser({
      email: 'wf-admin-direct@test.com',
      fullName: 'Workflow Admin Direct',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-direct@test.com',
      fullName: 'Workflow Provider Direct',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-direct@test.com',
      fullName: 'Workflow Citizen Direct',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF direct completion',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: provider.id,
    });

    const providerToken = await signToken(provider);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Invalid status transition');

    const storedReport = await prisma.report.findUnique({
      where: { id: report.id },
    });

    expect(storedReport?.status).toBe(ReportStatus.ASSIGNED);
  });

  it('rejects provider updates for reports not assigned to them', async () => {
    const org = await createOrganization('Workflow Org C');
    const assignedProvider = await createUser({
      email: 'wf-provider-owner@test.com',
      fullName: 'Assigned Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const otherProvider = await createUser({
      email: 'wf-provider-other@test.com',
      fullName: 'Other Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-owner@test.com',
      fullName: 'Workflow Citizen Owner',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF provider ownership',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: assignedProvider.id,
    });

    const otherProviderToken = await signToken(otherProvider);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${otherProviderToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Not your report');
  });

  it('rejects citizen status updates', async () => {
    const org = await createOrganization('Workflow Org H');
    const citizen = await createUser({
      email: 'wf-citizen-status@test.com',
      fullName: 'Workflow Citizen Status',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-status@test.com',
      fullName: 'Workflow Provider Status',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF citizen cannot update status',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: provider.id,
    });

    const citizenToken = await signToken(citizen);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(res.status).toBe(403);
  });

  it('allows citizens to load their dashboard summary', async () => {
    const org = await createOrganization('Workflow Citizen Dashboard Org');
    const citizen = await createUser({
      email: 'wf-citizen-dashboard@test.com',
      fullName: 'Workflow Citizen Dashboard',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    await createReport({
      title: 'WF citizen dashboard pending',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.PENDING,
    });
    await createReport({
      title: 'WF citizen dashboard assigned',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
    });

    const citizenToken = await signToken(citizen);
    const res = await request(app.getHttpServer())
      .get('/api/report/citizen/dashboard/summary')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 2,
      pending: 1,
      assigned: 1,
      inProgress: 0,
      completed: 0,
      closed: 0,
    });
  });

  it('allows citizens to load their reports from the current citizen endpoint', async () => {
    const org = await createOrganization('Workflow Citizen Reports Org');
    const citizen = await createUser({
      email: 'wf-citizen-current-reports@test.com',
      fullName: 'Workflow Citizen Reports',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    await createReport({
      title: 'WF current citizen report',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.PENDING,
    });

    const citizenToken = await signToken(citizen);
    const res = await request(app.getHttpServer())
      .get('/api/report/citizen/my')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('WF current citizen report');
  });

  it('uses the Prisma user id for Firebase citizen report creation and retrieval', async () => {
    const firebaseUid = `wf-firebase-citizen-${Date.now()}`;
    const phone = `+23480${Date.now().toString().slice(-8)}`;

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/firebase-login')
      .send({
        firebaseUid,
        phone,
        fullName: 'Workflow Firebase Citizen',
        role: 'citizen',
      });

    expect(loginRes.status).toBe(201);
    expect(loginRes.body.accessToken).toBeDefined();
    expect(loginRes.body.user.id).toBeDefined();
    expect(loginRes.body.user.id).not.toBe(firebaseUid);

    const citizen = await prisma.user.findUniqueOrThrow({
      where: { id: loginRes.body.user.id },
    });
    createdUserIds.push(citizen.id);

    const createRes = await request(app.getHttpServer())
      .post('/api/report')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({
        title: 'WF Firebase citizen report',
        description: 'Created through backend citizen report endpoint',
        category: 'Road',
        location: 'Firebase Citizen Street',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.citizenId).toBe(citizen.id);
    expect(createRes.body.citizenId).not.toBe(firebaseUid);
    createdReportIds.push(createRes.body.id);

    const reportsRes = await request(app.getHttpServer())
      .get('/api/report/citizen/my')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);

    expect(reportsRes.status).toBe(200);
    expect(reportsRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createRes.body.id,
          citizenId: citizen.id,
          title: 'WF Firebase citizen report',
        }),
      ]),
    );
  });

  it('rejects provider assignment attempts', async () => {
    const org = await createOrganization('Workflow Org I');
    const provider = await createUser({
      email: 'wf-provider-assign@test.com',
      fullName: 'Workflow Provider Assign',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-assign@test.com',
      fullName: 'Workflow Citizen Assign',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF provider cannot assign',
      organizationId: org.id,
      citizenId: citizen.id,
    });

    const providerToken = await signToken(provider);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ providerId: provider.id });

    expect(res.status).toBe(403);
  });

  it('rejects assigning a report that is already assigned', async () => {
    const org = await createOrganization('Workflow Org D');
    const admin = await createUser({
      email: 'wf-admin-reassign@test.com',
      fullName: 'Workflow Admin Reassign',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const providerA = await createUser({
      email: 'wf-provider-reassign-a@test.com',
      fullName: 'Workflow Provider A',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const providerB = await createUser({
      email: 'wf-provider-reassign-b@test.com',
      fullName: 'Workflow Provider B',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-reassign@test.com',
      fullName: 'Workflow Citizen Reassign',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF already assigned',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: providerA.id,
    });

    const adminToken = await signToken(admin);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: providerB.id });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'Report cannot be assigned in its current status',
    );
  });

  it('rejects assigning non-provider users', async () => {
    const org = await createOrganization('Workflow Org J');
    const admin = await createUser({
      email: 'wf-admin-non-provider@test.com',
      fullName: 'Workflow Admin Non Provider',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-non-provider@test.com',
      fullName: 'Workflow Citizen Non Provider',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const reportCitizen = await createUser({
      email: 'wf-citizen-non-provider-owner@test.com',
      fullName: 'Workflow Citizen Report Owner',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF non-provider assignment',
      organizationId: org.id,
      citizenId: reportCitizen.id,
    });

    const adminToken = await signToken(admin);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: citizen.id });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Invalid provider');
  });

  it('allows admins to assign only within their own organization', async () => {
    const orgA = await createOrganization('Workflow Org E1');
    const orgB = await createOrganization('Workflow Org E2');
    const admin = await createUser({
      email: 'wf-admin-cross-org@test.com',
      fullName: 'Workflow Admin Cross Org',
      role: UserRole.ORG_ADMIN,
      organizationId: orgA.id,
    });
    const provider = await createUser({
      email: 'wf-provider-cross-org@test.com',
      fullName: 'Workflow Provider Cross Org',
      role: UserRole.PROVIDER,
      organizationId: orgB.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-cross-org@test.com',
      fullName: 'Workflow Citizen Cross Org',
      role: UserRole.CITIZEN,
      organizationId: orgA.id,
    });
    const report = await createReport({
      title: 'WF cross org assignment',
      organizationId: orgA.id,
      citizenId: citizen.id,
    });

    const adminToken = await signToken(admin);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: provider.id });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Provider must be same org');
  });

  it('allows super admins to assign across organizations while obeying the workflow', async () => {
    const orgA = await createOrganization('Workflow Org F1');
    const orgB = await createOrganization('Workflow Org F2');
    const superAdmin = await createUser({
      email: 'wf-super-cross-org@test.com',
      fullName: 'Workflow Super Admin',
      role: UserRole.SUPER_ADMIN,
      organizationId: null,
    });
    const provider = await createUser({
      email: 'wf-provider-super-cross@test.com',
      fullName: 'Workflow Provider Super Cross',
      role: UserRole.PROVIDER,
      organizationId: orgB.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-super-cross@test.com',
      fullName: 'Workflow Citizen Super Cross',
      role: UserRole.CITIZEN,
      organizationId: orgA.id,
    });
    const report = await createReport({
      title: 'WF super cross org assignment',
      organizationId: orgA.id,
      citizenId: citizen.id,
    });

    const superAdminToken = await signToken(superAdmin);
    const assignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ providerId: provider.id });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.status).toBe(ReportStatus.ASSIGNED);

    const closeRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: ReportStatus.CLOSED });

    expect(closeRes.status).toBe(403);
    expect(closeRes.body.message).toContain('Invalid status transition');
  });

  it('rejects any change to closed reports', async () => {
    const org = await createOrganization('Workflow Org K');
    const admin = await createUser({
      email: 'wf-admin-closed@test.com',
      fullName: 'Workflow Admin Closed',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-closed@test.com',
      fullName: 'Workflow Provider Closed',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-closed@test.com',
      fullName: 'Workflow Citizen Closed',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF closed report',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.CLOSED,
      assignedProviderId: provider.id,
    });

    const adminToken = await signToken(admin);
    const providerToken = await signToken(provider);

    const adminRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: ReportStatus.CLOSED });

    expect(adminRes.status).toBe(403);

    const providerRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(providerRes.status).toBe(403);
  });

  it('reuses assignment validation for auto-assign', async () => {
    const org = await createOrganization('Workflow Org G');
    const dispatchOfficer = await createUser({
      email: 'wf-dispatch-auto@test.com',
      fullName: 'Workflow Dispatch Auto',
      role: UserRole.DISPATCH_OFFICER,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-auto@test.com',
      fullName: 'Workflow Provider Auto',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-auto@test.com',
      fullName: 'Workflow Citizen Auto',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF auto assign',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: provider.id,
    });

    const dispatchToken = await signToken(dispatchOfficer);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/auto-assign`)
      .set('Authorization', `Bearer ${dispatchToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'Report cannot be assigned in its current status',
    );
  });
});
