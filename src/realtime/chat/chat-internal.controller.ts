// packages
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';

// utils
import { InternalSecretGuard } from '../../auth/internal-secret.guard';
import { ChatGateway } from './chat.gateway';
import { toChatDelivery, toChatRefresh } from './chat-message';

/**
 * next.js calls these after it saved a message (or changed a chat), so this server only ever
 * delivers what the database already holds
 */
@Controller('internal')
@UseGuards(InternalSecretGuard)
export class ChatInternalController {
  constructor(private readonly chat: ChatGateway) {}

  // { mid, client: message | null, owner: message | null } → each side's room
  @Post('chat-message')
  deliverMessage(@Body() body: unknown) {
    const delivery = toChatDelivery(body);
    if (!delivery) throw new BadRequestException('invalid chat-message body');

    return { ok: true, delivered: this.chat.deliverMessage(delivery) };
  }

  // { mid, side } → chat-refresh to that side's room
  @Post('chat-refresh')
  refresh(@Body() body: unknown) {
    const refresh = toChatRefresh(body);
    if (!refresh) throw new BadRequestException('invalid chat-refresh body');

    return { ok: true, delivered: this.chat.refresh(refresh) };
  }
}
