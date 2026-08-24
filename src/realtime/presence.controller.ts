// packages
import { Controller, Get } from '@nestjs/common';

// utils
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';

@Controller('presence')
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly gateway: RealtimeGateway,
  ) {}

  @Get('online')
  getOnlinePresence() {
    return { onlineIds: this.presence.getOnlineIds() };
  }

  // cheap counts split by role, computed from room membership + socket data
  @Get('counts')
  getCounts() {
    return this.gateway.getConnectionCounts();
  }
}

// // packages
// import { Controller, Get } from '@nestjs/common';

// // utils
// import { PresenceService } from './presence.service';

// /**
//  * public presence endpoint, no internal secret required since
//  * anyone browsing the site needs to see who's currently online
//  */
// @Controller('presence')
// export class PresenceController {
//   constructor(private readonly presence: PresenceService) {}

//   @Get('online')
//   getOnlinePresence() {
//     return { onlineIds: this.presence.getOnlineIds() };
//   }
// }
