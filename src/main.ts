import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { logBootstrapError } from './config/logging';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();
  const configService = app.get(ConfigService);
  await app.listen(configService.getOrThrow<number>('PORT'));
}

void bootstrap().catch((error: unknown) => {
  logBootstrapError(error);
  process.exitCode = 1;
});
