// packages
import { ConfigModule } from '@nestjs/config';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

// utils
import { RealtimeModule } from './realtime/realtime.module';
import { AppController } from './app.controller';

// utils
import { HttpsRedirectMiddleware } from './https-redirect.middleware';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RealtimeModule],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpsRedirectMiddleware).forRoutes('*');
  }
}
