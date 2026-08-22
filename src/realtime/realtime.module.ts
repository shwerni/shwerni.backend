// packages
import { Module } from '@nestjs/common';

// utils
import { RealtimeGateway } from './realtime.gateway';
import { InternalController } from './internal.controller';
import { PresenceController } from './presence.controller';
import { InstantRequestService } from './instant-request.service';
import { ConnectionRateLimiter } from './connection-rate-limiter';
import { PresenceService } from './presence.service';

@Module({
  controllers: [InternalController, PresenceController],
  providers: [
    RealtimeGateway,
    InstantRequestService,
    ConnectionRateLimiter,
    PresenceService,
  ],
})
export class RealtimeModule {}
