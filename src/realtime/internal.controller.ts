// packages
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';

// utils
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { RealtimeGateway } from './realtime.gateway';
import { PresenceService } from './presence.service';
import type { InstantRequestBroadcast } from './dto/instant-request.dto';
import type { ConsultantBusyRequest } from './dto/instant-booked.dto';

// the session lengths the main site sells (cost30 / cost45 / cost60)
const SESSION_DURATIONS = [30, 45, 60];
// no session runs this long: a later busyUntil is a unit or clock bug
const MAX_BUSY_AHEAD_MS = 4 * 60 * 60 * 1000;

/**
 * next.js calls these routes after writing to the database,
 * so nest never becomes a second source of truth for order state
 */
@Controller('internal')
@UseGuards(InternalSecretGuard)
export class InternalController {
  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly presence: PresenceService,
  ) {}

  @Post('instant-request')
  broadcastInstantRequest(@Body() payload: InstantRequestBroadcast) {
    this.gateway.broadcastInstantRequest(payload);
    return { ok: true };
  }

  // an instant order is paid: the consultant goes offline until the meeting ends
  @Post('consultant-busy')
  async markConsultantBusy(@Body() body: ConsultantBusyRequest) {
    const valid =
      typeof body?.consultantId === 'string' &&
      body.consultantId.length > 0 &&
      Number.isInteger(body.orderId) &&
      typeof body.meetingId === 'string' &&
      typeof body.meetingUrl === 'string' &&
      typeof body.startsAt === 'string' &&
      Number.isFinite(Date.parse(body.startsAt)) &&
      SESSION_DURATIONS.includes(body.duration) &&
      Number.isFinite(body.busyUntil);

    if (!valid) throw new BadRequestException('invalid consultant-busy body');

    const now = Date.now();
    if (body.busyUntil <= now)
      throw new BadRequestException('busyUntil is in the past');
    if (body.busyUntil > now + MAX_BUSY_AHEAD_MS)
      throw new BadRequestException('busyUntil is more than 4 hours ahead');

    // only the broadcast fields reach the consultant's sockets
    const { wasOnline } = await this.gateway.markConsultantBusy(
      body.consultantId,
      {
        orderId: body.orderId,
        meetingId: body.meetingId,
        meetingUrl: body.meetingUrl,
        startsAt: body.startsAt,
        duration: body.duration,
        busyUntil: body.busyUntil,
      },
    );

    return { ok: true, wasOnline };
  }

  @Get('presence/online')
  getOnlinePresence() {
    return { onlineIds: this.presence.getOnlineIds() };
  }
}
