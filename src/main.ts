// packages
import { NestFactory } from '@nestjs/core';

// utils
import { AppModule } from './app.module';
import { allowedOrigins } from './allowed-origins';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      ...allowedOrigins(),
      'http://localhost:3000',
      'shwerni://',
      'exp://',
    ],
  });
  await app.listen(process.env.PORT ?? 4000);
}

bootstrap();
