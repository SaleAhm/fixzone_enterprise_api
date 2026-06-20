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

  await prisma.report.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  const org = await prisma.organization.create({
    data: {
      name: 'FixZone Demo LGA',
    },
  });

  await prisma.user.create({
    data: {
      fullName: 'Super Admin',
      email: 'superadmin@fixzone.ng',
      passwordHash,
      role: UserRole.SUPER_ADMIN,
    },
  });

  await prisma.user.create({
    data: {
      fullName: 'Org Admin',
      email: 'orgadmin@fixzone.ng',
      passwordHash,
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    },
  });

  await prisma.user.create({
    data: {
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
    const provider = await prisma.user.create({
      data: {
        fullName: providerNames[i],
        email: `provider${i + 1}@fixzone.ng`,
        passwordHash,
        role: UserRole.PROVIDER,
        organizationId: org.id,
        createdAt: daysAgo(20 - i),
      },
    });

    providers.push(provider);
  }

  const citizens: User[] = [];
  for (let i = 0; i < citizenNames.length; i++) {
    const citizen = await prisma.user.create({
      data: {
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
      description:
        'The street light has stopped working for several nights.',
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
      description:
        'Waste has accumulated around the public collection point.',
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
