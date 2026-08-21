// packages
import { Body, Controller, Post, UseGuards } from '@nestjs/common';

// utils
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { RealtimeGateway } from './realtime.gateway';
import type { InstantRequestBroadcast } from './dto/instant-request.dto';

/**
 * next.js calls these routes after writing to the database,
 * so nest never becomes a second source of truth for order state
 */
@Controller('internal')
@UseGuards(InternalSecretGuard)
export class InternalController {
  constructor(private readonly gateway: RealtimeGateway) {}

  @Post('instant-request')
  broadcastInstantRequest(@Body() payload: InstantRequestBroadcast) {
    this.gateway.broadcastInstantRequest(payload);
    return { ok: true };
  }
}
