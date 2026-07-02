import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function identityTypeForRole(role: UserRole) {
  if (role === UserRole.PROVIDER || role === UserRole.PENDING_PROVIDER) {
    return 'PROVIDER_INDIVIDUAL';
  }
  if (role === UserRole.ORG_ADMIN || role === UserRole.DISPATCH_OFFICER) {
    return 'ORGANIZATION_REPRESENTATIVE';
  }
  if (role === UserRole.SUPER_ADMIN) {
    return 'GOVERNMENT_REPRESENTATIVE';
  }
  return 'INDIVIDUAL';
}

async function nextSecureZoneId(year: number, offset: number) {
  return `SZ-${year}-${offset.toString().padStart(6, '0')}`;
}

async function main() {
  const year = new Date().getFullYear();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, secureZoneId: true },
  });

  let sequence = await prisma.user.count({
    where: { secureZoneId: { startsWith: `SZ-${year}-` } },
  });

  let updated = 0;
  for (const user of users) {
    if (!user.secureZoneId) {
      sequence += 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          secureZoneId: await nextSecureZoneId(year, sequence),
          identityType: identityTypeForRole(user.role) as any,
        },
      });
      updated += 1;
    }

    await prisma.userEntitlement.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
  }

  console.log(
    `SecureZone identity backfill complete. Users updated: ${updated}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
