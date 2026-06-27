import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from '../src/configure-app';

describe('Application (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/auth/me requires authentication', () => {
    return request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('/api/health returns JSON from the Nest API', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['x-fixzone-api']).toBe('fixzone-enterprise-api');
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'fixzone-enterprise-api',
      apiPrefix: '/api',
    });
  });

  it('unknown API routes return JSON errors', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/missing');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.text.trim().startsWith('<')).toBe(false);
  });
});
