import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // No global prefix here on purpose: every route path, including the /api prefix,
  // is declared in the ts-rest contracts so the client derives it from the same source.
  const port = process.env.PORT || 3000;
  await app.listen(port);

  Logger.log(`Application is running on: http://localhost:${port}/api`);
}

bootstrap();
