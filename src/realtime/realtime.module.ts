// packages
import { Module } from '@nestjs/common';

// utils
import { RealtimeGateway } from './realtime.gateway';
import { InternalController } from './internal.controller';
import { PresenceController } from './presence.controller';
import { InstantRequestService } from './instant-request.service';
import { ConnectionRateLimiter } from './connection-rate-limiter';
import { PresenceService } from './presence.service';
import { ChatGateway } from './chat/chat.gateway';
import { ChatInternalController } from './chat/chat-internal.controller';
import { AppPresenceService } from './chat/app-presence.service';

@Module({
  controllers: [InternalController, PresenceController, ChatInternalController],
  providers: [
    RealtimeGateway,
    InstantRequestService,
    ConnectionRateLimiter,
    PresenceService,
    ChatGateway,
    AppPresenceService,
  ],
})
export class RealtimeModule {}
