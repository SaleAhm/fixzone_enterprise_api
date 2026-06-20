import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts', // ✅ ADD THIS LINE
  },

  datasource: {
    url: process.env.DATABASE_URL,
  },
});