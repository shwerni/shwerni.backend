// packages
import { NestFactory } from '@nestjs/core';

// utils
import { AppModule } from './app.module';
import { corsOrigin } from './allowed-origins';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: corsOrigin });
  await app.listen(process.env.PORT ?? 4000);
}

bootstrap();
