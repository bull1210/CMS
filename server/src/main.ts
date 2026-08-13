import 'reflect-metadata';
import { loadEnv } from './core/env';
loadEnv();
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { tenancy } from './core/tenancy';

async function bootstrap() {
  // rawBody: Meta webhook signatures (X-Hub-Signature-256) are HMACs of the
  // exact bytes received — the parsed JSON isn't enough to verify them.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // /files/* keeps its historical URL shape (stored paths and the Vite proxy
  // depend on it) while being served by the auth-checked FilesController.
  app.setGlobalPrefix('api', { exclude: ['files/(.*)'] });
  app.enableCors({ origin: true, credentials: true });
  // Every request gets a tenant store the AuthGuard fills in. Files are no
  // longer served statically — /api/files checks the caller's clinic first
  // (multi-tenant: an X-ray URL must not be world-readable).
  app.use(tenancy.middleware);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`CMS API listening on http://localhost:${port}/api`);
}
bootstrap();
