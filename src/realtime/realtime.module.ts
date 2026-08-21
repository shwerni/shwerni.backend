// packages
import { Module } from '@nestjs/common';

// utils
import { RealtimeGateway } from './realtime.gateway';
import { InternalController } from './internal.controller';
import { InstantRequestService } from './instant-request.service';
import { ConnectionRateLimiter } from './connection-rate-limiter';

@Module({
  controllers: [InternalController],
  providers: [RealtimeGateway, InstantRequestService, ConnectionRateLimiter],
})
export class RealtimeModule {}
