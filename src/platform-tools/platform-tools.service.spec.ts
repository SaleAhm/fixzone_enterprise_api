import { UserRole } from '@prisma/client';
import { readdirSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformToolsService } from './platform-tools.service';

type OperationalHealthBody = {
  state: string;
  checks: {
    database: { state: string; details?: Record<string, unknown> };
    uploadStorage: { state: string; details?: Record<string, unknown> };
    diskCapacity: { state: string };
    backupFreshness: { state: string };
  };
  limitations: { mountIdentity: string; backupFreshness: string };
};

function superAdmin() {
  return { id: 'super-admin-id', role: UserRole.SUPER_ADMIN };
}

function createPrismaMock() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
    platformBackup: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

describe('PlatformToolsService operational health', () => {
  const previousUploadRoot = process.env.UPLOAD_ROOT;
  let uploadRoot: string;
  let tempRoots: string[] = [];

  beforeEach(async () => {
    jest.restoreAllMocks();
    uploadRoot = await mkdtemp(join(tmpdir(), 'fixzone-operational-health-'));
    tempRoots.push(uploadRoot);
    process.env.UPLOAD_ROOT = uploadRoot;
  });

  afterEach(async () => {
    if (previousUploadRoot === undefined) {
      delete process.env.UPLOAD_ROOT;
    } else {
      process.env.UPLOAD_ROOT = previousUploadRoot;
    }
    for (const root of tempRoots) {
      await rm(root, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  function createService(prisma = createPrismaMock()) {
    return new PlatformToolsService(prisma as unknown as PrismaService);
  }

  it('reports healthy database and writable upload root without exposing host paths', async () => {
    await writeFile(join(uploadRoot, 'existing-evidence-probe.txt'), 'safe');
    const result = (await createService().operationalHealth(
      superAdmin(),
    )) as OperationalHealthBody;

    expect(result.checks.database.state).toBe('HEALTHY');
    expect(result.checks.uploadStorage.state).toBe('HEALTHY');
    expect(result.checks.uploadStorage.details).toMatchObject({
      configured: true,
      canaryRemoved: true,
    });
    expect(result.limitations.mountIdentity).toContain(
      'cannot prove the Docker host bind source path',
    );
    expect(JSON.stringify(result)).not.toContain(
      '/srv/securezone-data/fixzone/uploads',
    );
    expect(JSON.stringify(result)).not.toContain('DATABASE_URL');
    expect(
      readdirSync(uploadRoot).some((name) =>
        name.startsWith('.fixzone-operational-health-canary-'),
      ),
    ).toBe(false);
  });

  it('marks database unavailable as critical without leaking connection details', async () => {
    const prisma = createPrismaMock();
    prisma.$queryRaw.mockRejectedValueOnce(
      new Error('private connection detail must not be returned'),
    );

    const result = (await createService(prisma).operationalHealth(
      superAdmin(),
    )) as OperationalHealthBody;

    expect(result.checks.database.state).toBe('CRITICAL');
    expect(result.checks.database.details).toMatchObject({
      errorCategory: 'Error',
    });
    expect(JSON.stringify(result)).not.toContain('private connection detail');
  });

  it('marks a missing upload root as critical', async () => {
    await rm(uploadRoot, { recursive: true, force: true });

    const result = (await createService().operationalHealth(
      superAdmin(),
    )) as OperationalHealthBody;

    expect(result.checks.uploadStorage.state).toBe('CRITICAL');
    expect(result.checks.uploadStorage.details).toMatchObject({
      configured: true,
      canaryRemoved: true,
    });
  });

  it('marks upload root as critical when the write canary cannot be created', async () => {
    const service = createService();
    await rm(uploadRoot, { recursive: true, force: true });
    await writeFile(uploadRoot, 'not a directory');

    const result = (await service.operationalHealth(
      superAdmin(),
    )) as OperationalHealthBody;

    expect(result.checks.uploadStorage.state).toBe('CRITICAL');
    expect(result.checks.uploadStorage.details).toMatchObject({
      configured: true,
    });
  });

  it('returns backup freshness as unknown without an invented SLA', async () => {
    const result = (await createService().operationalHealth(
      superAdmin(),
    )) as OperationalHealthBody;

    expect(result.checks.backupFreshness.state).toBe('UNKNOWN');
    expect(result.limitations.backupFreshness).toContain(
      'external backup monitor',
    );
  });

  it('rejects non-super-admin users', async () => {
    await expect(
      createService().operationalHealth({
        id: 'org-admin-id',
        role: UserRole.ORG_ADMIN,
      }),
    ).rejects.toThrow('Super Admin only');
  });
});
