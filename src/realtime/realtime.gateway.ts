// packages
import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

// utils
import { verifyRealtimeToken } from '../auth/verify-token.js';
import { InstantRequestService } from './instant-request.service.js';
import { PresenceService } from './presence.service.js';
import { ConnectionRateLimiter } from './connection-rate-limiter.js';
import { notifyPresenceChange } from './presence-notifier.js';
import type { SocketData } from './types/socket-data.js';
import type {
  InstantRequestBroadcast,
  InstantResponseBroadcast,
} from './dto/instant-request.dto.js';
import type { PresenceChangedBroadcast } from './dto/presence.dto.js';

const INSTANT_REQUEST_TIMEOUT_MS = 30_000;
const PUBLIC_ROOM = 'public-presence';

@WebSocketGateway({
  cors: {
    origin: [
      process.env.ALLOWED_ORIGIN,
      'shwerni://',
      'exp://',
      'http://localhost:3000',
    ],
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly instantRequests: InstantRequestService,
    private readonly rateLimiter: ConnectionRateLimiter,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(socket: Socket) {
    this.logger.log(`incoming connection attempt: ${socket.id}`);

    const forwardedProto = socket.handshake.headers['x-forwarded-proto'];
    if (forwardedProto === 'http') {
      this.logger.warn(`rejected ${socket.id}: plain http handshake`);
      socket.disconnect(true);
      return;
    }

    const ip = socket.handshake.address;
    if (!this.rateLimiter.allow(ip)) {
      this.logger.warn(`rejected ${socket.id}: rate limited (ip: ${ip})`);
      socket.disconnect(true);
      return;
    }

    const token = socket.handshake.auth?.token as string | undefined;
    this.logger.log(
      `verifying token for ${socket.id}: ${token ? 'present' : 'missing'}`,
    );

    const payload = await verifyRealtimeToken(token);

    if (!payload) {
      this.logger.warn(`rejected ${socket.id}: invalid or expired token`);
      socket.disconnect(true);
      return;
    }

    this.logger.log(
      `authenticated ${socket.id} as userId=${payload.userId} role=${payload.role}`,
    );

    const data = socket.data as SocketData;
    data.userId = payload.userId;
    data.role = payload.role;

    await socket.join(PUBLIC_ROOM);
    this.logger.log(`${socket.id} joined ${PUBLIC_ROOM}`);

    if (payload.role === 'OWNER') {
      await socket.join(`user:${payload.userId}`);
      this.logger.log(`${socket.id} joined user:${payload.userId}`);
    }
  }

  async handleDisconnect(socket: Socket) {
    const data = socket.data as SocketData;
    this.logger.log(
      `disconnected: ${socket.id} (userId=${data.userId ?? 'unknown'})`,
    );

    if (data.role === 'OWNER' && data.isOnlineConsultant) {
      const wentOffline = this.presence.markOffline(data.userId);
      this.logger.log(
        `markOffline(${data.userId}) -> wentOffline=${wentOffline}`,
      );

      if (wentOffline) {
        this.broadcastPresence(data.userId, false);
        this.logger.log(`notifying next.js: ${data.userId} offline`);
        await notifyPresenceChange(data.userId, false);
      }
    }
  }

  @SubscribeMessage('consultant-online')
  async onConsultantOnline(@ConnectedSocket() socket: Socket) {
    const data = socket.data as SocketData;
    this.logger.log(
      `consultant-online received from ${socket.id} (role=${data.role})`,
    );

    if (data.role !== 'OWNER') {
      this.logger.warn(
        `ignored consultant-online: ${socket.id} is not an OWNER`,
      );
      return;
    }

    data.isOnlineConsultant = true;
    const wentOnline = this.presence.markOnline(data.userId);
    this.logger.log(`markOnline(${data.userId}) -> wentOnline=${wentOnline}`);

    if (wentOnline) {
      this.broadcastPresence(data.userId, true);
      this.logger.log(`notifying next.js: ${data.userId} online`);
      await notifyPresenceChange(data.userId, true);
    }
  }

  broadcastInstantRequest(payload: InstantRequestBroadcast) {
    this.server
      .to(`user:${payload.consultantId}`)
      .emit('instant-request', payload);

    this.instantRequests.track(
      payload.orderId,
      INSTANT_REQUEST_TIMEOUT_MS,
      () => {
        this.server.to(`user:${payload.clientId}`).emit('instant-response', {
          orderId: payload.orderId,
          clientId: payload.clientId,
          accepted: false,
        } satisfies InstantResponseBroadcast);
      },
    );
  }

  @SubscribeMessage('instant-response')
  onInstantResponse(@MessageBody() payload: InstantResponseBroadcast) {
    const alreadyResolved = !this.instantRequests.resolve(payload.orderId);
    if (alreadyResolved) return;

    this.server
      .to(`user:${payload.clientId}`)
      .emit('instant-response', payload);
  }

  // consultant manually toggles off without disconnecting
  @SubscribeMessage('consultant-offline')
  async onConsultantOffline(@ConnectedSocket() socket: Socket) {
    const data = socket.data as SocketData;
    if (data.role !== 'OWNER' || !data.isOnlineConsultant) return;

    data.isOnlineConsultant = false;
    const wentOffline = this.presence.markOffline(data.userId);

    if (wentOffline) {
      this.broadcastPresence(data.userId, false);
      await notifyPresenceChange(data.userId, false);
    }
  }

  // lets a freshly connected client fetch the current snapshot instantly
  @SubscribeMessage('get-online-consultants')
  getOnlineConsultants() {
    return this.presence.getOnlineIds();
  }

  private broadcastPresence(consultantId: string, online: boolean) {
    this.server.to(PUBLIC_ROOM).emit('presence-changed', {
      consultantId,
      online,
      onlineCount: this.presence.getOnlineIds().length,
    } satisfies PresenceChangedBroadcast);
  }

  @SubscribeMessage('chat-message')
  onChatMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { roomId: string; text: string },
  ) {
    const data = socket.data as SocketData;
    this.server.to(payload.roomId).emit('chat-message', {
      senderId: data.userId,
      text: payload.text,
      sentAt: Date.now(),
    });
  }
}
