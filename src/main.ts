// packages
import { NestFactory } from '@nestjs/core';

// utils
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [process.env.ALLOWED_ORIGIN!, 'shwerni://', 'exp://'],
  });
  await app.listen(process.env.PORT ?? 4000);
}

bootstrap();
