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
import { verifyRealtimeToken } from '../auth/verify-token';
import { InstantRequestService } from './instant-request.service';
import type {
  InstantRequestBroadcast,
  InstantResponseBroadcast,
} from './dto/instant-request.dto';
import { SocketData } from './types/socket-data';
import { ConnectionRateLimiter } from './connection-rate-limiter';

const INSTANT_REQUEST_TIMEOUT_MS = 30_000;

@WebSocketGateway({
  cors: { origin: [process.env.ALLOWED_ORIGIN, 'shwerni://', 'exp://'] },
  maxHttpBufferSize: 1e5,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly instantRequests: InstantRequestService,
    private readonly rateLimiter: ConnectionRateLimiter,
  ) {}

  async handleConnection(socket: Socket) {
    const ip = socket.handshake.address;
    if (!this.rateLimiter.allow(ip)) {
      socket.disconnect(true);
      return;
    }
    const token = socket.handshake.auth?.token as string | undefined;
    const payload = await verifyRealtimeToken(token);

    if (!payload) {
      socket.disconnect(true);
      return;
    }

    // cast once here, socket.io's own data type is a generic default of `any`
    const data = socket.data as SocketData;
    data.userId = payload.userId;
    data.role = payload.role;
    socket.join(`user:${payload.userId}`);
  }

  handleDisconnect(socket: Socket) {
    const data = socket.data as SocketData;
    this.logger.debug(`socket disconnected: ${data.userId ?? 'unknown'}`);
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
