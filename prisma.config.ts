import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Client generation does not need a live database. Runtime startup still
    // requires DATABASE_URL through ConfigService in PrismaService.
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/evalu8',
  },
});
