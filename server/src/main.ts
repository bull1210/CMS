import 'reflect-metadata';
import { loadEnv } from './core/env';
loadEnv();
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });
  app.useStaticAssets(join(process.cwd(), process.env.UPLOAD_DIR ?? './storage/uploads'), {
    prefix: '/files/',
  });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`CMS API listening on http://localhost:${port}/api`);
}
bootstrap();
