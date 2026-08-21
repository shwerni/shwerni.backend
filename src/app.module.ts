// packages
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// utils
import { RealtimeModule } from './realtime/realtime.module';
import { AppController } from './app.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RealtimeModule],
  controllers: [AppController],
})
export class AppModule {}
