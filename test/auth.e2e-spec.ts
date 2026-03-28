import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let citizenToken: string;
  let providerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: 'admin@test.com' },
          { email: 'citizen@test.com' },
          { email: 'provider@test.com' },
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: 'admin@test.com' },
          { email: 'citizen@test.com' },
          { email: 'provider@test.com' },
        ],
      },
    });

    await app.close();
  });

  it('Register Admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'Admin User',
        email: 'admin@test.com',
        password: '123456',
        role: 'admin',
      });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
  });

  it('Login Admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@test.com',
        password: '123456',
      });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();

    adminToken = res.body.accessToken;
  });

  it('Admin can access /me', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  it('Admin can access admin-only route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/admin-only')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  it('Register Citizen', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'Citizen User',
        email: 'citizen@test.com',
        password: '123456',
        role: 'citizen',
      });

    expect(res.status).toBe(201);
  });

  it('Login Citizen', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'citizen@test.com',
        password: '123456',
      });

    expect(res.status).toBe(201);
    citizenToken = res.body.accessToken;
  });

  it('Citizen cannot access admin-only route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/admin-only')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(res.status).toBe(403);
  });

  it('Register Provider', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'Provider User',
        email: 'provider@test.com',
        password: '123456',
        role: 'provider',
      });

    expect(res.status).toBe(201);
  });

  it('Login Provider', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider@test.com',
        password: '123456',
      });

    expect(res.status).toBe(201);
    providerToken = res.body.accessToken;
  });

  it('Provider can access provider-or-admin route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/provider-or-admin')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(res.status).toBe(200);
  });

  it('Citizen cannot access provider-or-admin route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/provider-or-admin')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(res.status).toBe(403);
  });
});