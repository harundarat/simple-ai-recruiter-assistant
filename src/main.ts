import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  Logger.error(error, 'Application bootstrap failed');
  process.exitCode = 1;
});
