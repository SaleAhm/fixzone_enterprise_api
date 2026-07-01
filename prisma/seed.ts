import 'dotenv/config';
import { PrismaClient, ReportStatus, UserRole, User } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set in environment');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

async function main() {
  console.log('Seeding FixZone enterprise demo data...');

  const passwordHash = await bcrypt.hash('Password123!', 10);

  const existingOrg = await prisma.organization.findFirst({
    where: { name: 'FixZone Demo LGA' },
    orderBy: { createdAt: 'asc' },
  });
  const org = existingOrg
    ? await prisma.organization.update({
        where: { id: existingOrg.id },
        data: {
          type: 'LOCAL_GOVERNMENT',
          subscriptionPlan: 'DEMO',
          billingStatus: 'ACTIVE',
        },
      })
    : await prisma.organization.create({
        data: {
          name: 'FixZone Demo LGA',
          type: 'LOCAL_GOVERNMENT',
          subscriptionPlan: 'DEMO',
          billingStatus: 'ACTIVE',
        },
      });

  await prisma.user.upsert({
    where: { email: 'superadmin@fixzone.ng' },
    update: {
      fullName: 'Super Admin',
      passwordHash,
      role: UserRole.SUPER_ADMIN,
    },
    create: {
      fullName: 'Super Admin',
      email: 'superadmin@fixzone.ng',
      passwordHash,
      role: UserRole.SUPER_ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: 'orgadmin@fixzone.ng' },
    update: {
      fullName: 'Org Admin',
      passwordHash,
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    },
    create: {
      fullName: 'Org Admin',
      email: 'orgadmin@fixzone.ng',
      passwordHash,
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'dispatch@fixzone.ng' },
    update: {
      fullName: 'Dispatch Officer',
      passwordHash,
      role: UserRole.DISPATCH_OFFICER,
      organizationId: org.id,
    },
    create: {
      fullName: 'Dispatch Officer',
      email: 'dispatch@fixzone.ng',
      passwordHash,
      role: UserRole.DISPATCH_OFFICER,
      organizationId: org.id,
    },
  });

  const providerNames = [
    'Abdul Kareem',
    'Musa Ibrahim',
    'John Peter',
    'Aliyu Sani',
    'Samuel David',
    'Yusuf Bello',
  ];

  const citizenNames = [
    'Amina Yusuf',
    'Fatima Sani',
    'Ibrahim Lawal',
    'Grace Okeke',
    'Usman Haruna',
    'Zainab Musa',
    'Mary James',
    'Chinedu Okafor',
    'Khadija Bello',
    'Abubakar Umar',
    'Ruth Daniel',
    'Hauwa Isa',
  ];

  const providers: User[] = [];
  for (let i = 0; i < providerNames.length; i++) {
    const provider = await prisma.user.upsert({
      where: { email: `provider${i + 1}@fixzone.ng` },
      update: {
        fullName: providerNames[i],
        phone: `+23480000010${i + 1}`,
        passwordHash,
        role: UserRole.PROVIDER,
        organizationId: org.id,
        providerId: `PRV-2024-${String(i + 1).padStart(3, '0')}`,
        accountStatus: 'ACTIVE',
        providerEngagementType: 'INTERNAL_STAFF',
        serviceCategories: [
          'Roads',
          'Drainage',
          'Electricity',
          'Waste',
          'Water',
        ],
        coverageAreas: ['FixZone Demo LGA'],
        subscriptionPlan: 'DEMO',
        profileData: {
          registrationNumber: `FZ-RC-${String(i + 1).padStart(4, '0')}`,
          performanceBadge: i < 2 ? 'Gold Response Team' : 'Verified Provider',
          profilePhotoUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(providerNames[i])}&background=0f766e&color=fff`,
          activeSubscription: true,
          billingHistory: [
            { plan: 'FREE', status: 'COMPLETED', amount: 0 },
            { plan: 'DEMO', status: 'ACTIVE', amount: 0 },
          ],
        },
      },
      create: {
        fullName: providerNames[i],
        email: `provider${i + 1}@fixzone.ng`,
        phone: `+23480000010${i + 1}`,
        providerId: `PRV-2024-${String(i + 1).padStart(3, '0')}`,
        passwordHash,
        role: UserRole.PROVIDER,
        organizationId: org.id,
        accountStatus: 'ACTIVE',
        providerEngagementType: 'INTERNAL_STAFF',
        serviceCategories: [
          'Roads',
          'Drainage',
          'Electricity',
          'Waste',
          'Water',
        ],
        coverageAreas: ['FixZone Demo LGA'],
        subscriptionPlan: 'DEMO',
        profileData: {
          registrationNumber: `FZ-RC-${String(i + 1).padStart(4, '0')}`,
          performanceBadge: i < 2 ? 'Gold Response Team' : 'Verified Provider',
          profilePhotoUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(providerNames[i])}&background=0f766e&color=fff`,
          activeSubscription: true,
          billingHistory: [
            { plan: 'FREE', status: 'COMPLETED', amount: 0 },
            { plan: 'DEMO', status: 'ACTIVE', amount: 0 },
          ],
        },
        createdAt: daysAgo(20 - i),
      },
    });
    await prisma.providerOrganization.upsert({
      where: {
        providerId_organizationId: {
          providerId: provider.id,
          organizationId: org.id,
        },
      },
      update: { active: true, isPrimary: true },
      create: {
        providerId: provider.id,
        organizationId: org.id,
        active: true,
        isPrimary: true,
      },
    });

    providers.push(provider);
  }

  const citizens: User[] = [];
  for (let i = 0; i < citizenNames.length; i++) {
    const citizen = await prisma.user.upsert({
      where: { email: `citizen${i + 1}@fixzone.ng` },
      update: {
        fullName: citizenNames[i],
        passwordHash,
        role: UserRole.CITIZEN,
        organizationId: org.id,
      },
      create: {
        fullName: citizenNames[i],
        email: `citizen${i + 1}@fixzone.ng`,
        passwordHash,
        role: UserRole.CITIZEN,
        organizationId: org.id,
        createdAt: daysAgo(15 - Math.min(i, 14)),
      },
    });

    citizens.push(citizen);
  }

  const reportTemplates = [
    {
      title: 'Blocked drainage on market road',
      description:
        'Water is no longer flowing freely and flooding is building up.',
      category: 'Drainage',
      location: 'Market Road Junction, Phase 2',
    },
    {
      title: 'Broken street light near junction',
      description: 'The street light has stopped working for several nights.',
      category: 'Electricity',
      location: 'Central Junction by Bus Stop',
    },
    {
      title: 'Pothole causing traffic delay',
      description:
        'A deep pothole is slowing vehicles and causing near misses.',
      category: 'Roads',
      location: 'Old Karu Express Link',
    },
    {
      title: 'Overflowing waste bin at bus stop',
      description: 'Waste has accumulated around the public collection point.',
      category: 'Waste',
      location: 'Main Motor Park Bus Stop',
    },
    {
      title: 'Water leakage near primary school',
      description:
        'A pipe appears damaged and clean water is leaking out daily.',
      category: 'Water',
      location: 'LEA Primary School Road',
    },
  ];

  const statuses: ReportStatus[] = [
    ReportStatus.PENDING,
    ReportStatus.ASSIGNED,
    ReportStatus.IN_PROGRESS,
    ReportStatus.COMPLETED_BY_PROVIDER,
    ReportStatus.CLOSED,
  ];

  const existingReports = await prisma.report.count({
    where: { organizationId: org.id },
  });
  if (existingReports > 0) {
    console.log(
      `Seed users updated. Existing reports preserved (${existingReports}).`,
    );
    return;
  }

  for (let i = 0; i < 36; i++) {
    const citizen = randomFrom(citizens);
    const provider = randomFrom(providers);
    const template = randomFrom(reportTemplates);
    const status = randomFrom(statuses);

    let assignedProviderId: string | null = null;

    if (
      status === ReportStatus.ASSIGNED ||
      status === ReportStatus.IN_PROGRESS ||
      status === ReportStatus.COMPLETED_BY_PROVIDER ||
      status === ReportStatus.CLOSED
    ) {
      assignedProviderId = provider.id;
    }

    const createdAt = daysAgo(Math.floor(Math.random() * 30));
    const updatedAt = new Date(createdAt);
    updatedAt.setDate(createdAt.getDate() + Math.floor(Math.random() * 5));

    await prisma.report.create({
      data: {
        title: `${template.title} #${i + 1}`,
        description: template.description,
        category: template.category,
        location: template.location,
        status,
        citizenId: citizen.id,
        assignedProviderId,
        organizationId: org.id,
        createdAt,
        updatedAt,
      },
    });
  }

  console.log('Seed complete.');
  console.log({
    superAdmin: 'superadmin@fixzone.ng / Password123!',
    orgAdmin: 'orgadmin@fixzone.ng / Password123!',
    dispatchOfficer: 'dispatch@fixzone.ng / Password123!',
    provider: 'PRV-2024-001 / provider1@fixzone.ng / Password123!',
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
