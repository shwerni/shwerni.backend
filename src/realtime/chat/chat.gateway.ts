// packages
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

// utils
import { corsOrigin } from '../../allowed-origins.js';
import { verifyChatTicket } from './chat-ticket.js';
import {
  MID_PATTERN,
  chatRoom,
  toChatJoin,
  type ChatSide,
} from './chat-claims.js';
import type { ChatDelivery, ChatRefresh } from './chat-message.js';
import type { SocketData } from '../types/socket-data.js';

// a socket follows at most this many chats at once
const MAX_CHAT_ROOMS = 20;

export type ChatJoinAck =
  | { ok: true; mid: string; peer: null }
  | { ok: false; error: 'expired' | 'invalid' | 'limit' };

/**
 * the app's live chat: a socket joins one room per meeting and side with a join ticket from
 * next.js, and next.js (POST /internal/chat-message) delivers each side its own view of a saved
 * message. no client event ever writes to a room. shares the socket.io server (and the
 * connection token check) with RealtimeGateway
 */
@WebSocketGateway({
  cors: { origin: corsOrigin },
})
export class ChatGateway {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // the return value is the ack
  @SubscribeMessage('chat-join')
  async onChatJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<ChatJoinAck> {
    const { mid, ticket } = (body ?? {}) as { mid?: unknown; ticket?: unknown };

    const verified = await verifyChatTicket(ticket);
    if ('error' in verified) {
      this.logger.warn(`chat-join refused for ${socket.id}: ${verified.error}`);
      return { ok: false, error: verified.error };
    }

    const join = toChatJoin(
      verified.claims,
      socket.data as Partial<SocketData>,
      mid,
    );
    if (!join) {
      this.logger.warn(
        `chat-join refused for ${socket.id}: the ticket isn't this socket's`,
      );
      return { ok: false, error: 'invalid' };
    }

    const room = chatRoom(join.mid, join.side);
    if (!socket.rooms.has(room)) {
      const chats = [...socket.rooms].filter((r) => r.startsWith('chat:'));
      if (chats.length >= MAX_CHAT_ROOMS) {
        this.logger.warn(`chat-join refused for ${socket.id}: room limit`);
        return { ok: false, error: 'limit' };
      }
      await socket.join(room);
    }

    this.logger.log(`${socket.id} joined ${room}`);
    return { ok: true, mid: join.mid, peer: null };
  }

  @SubscribeMessage('chat-leave')
  async onChatLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ) {
    const { mid } = (body ?? {}) as { mid?: unknown };
    const { role } = socket.data as Partial<SocketData>;
    if (typeof mid !== 'string' || !MID_PATTERN.test(mid)) return { ok: false };
    if (role !== 'USER' && role !== 'OWNER') return { ok: false };

    await socket.leave(chatRoom(mid, role));
    return { ok: true };
  }

  /**
   * a saved message, each side's view to that side's room only. the content is never logged
   * @returns how many sockets each side's room had
   */
  deliverMessage({ mid, client, owner }: ChatDelivery) {
    const delivered = {
      client: client ? this.emitToSide(mid, 'USER', client) : 0,
      owner: owner ? this.emitToSide(mid, 'OWNER', owner) : 0,
    };
    this.logger.log(
      `chat-message mid=${mid} delivered client=${delivered.client} owner=${delivered.owner}`,
    );
    return delivered;
  }

  // tells one side to refetch the thread (the consultant's side after a block or unblock)
  refresh({ mid, side }: ChatRefresh) {
    const room = chatRoom(mid, side);
    this.server.to(room).emit('chat-refresh', { mid });
    return this.roomSize(room);
  }

  private emitToSide(mid: string, side: ChatSide, message: unknown) {
    const room = chatRoom(mid, side);
    this.server.to(room).emit('chat-message', { mid, message });
    return this.roomSize(room);
  }

  private roomSize(room: string) {
    return this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
  }
}
