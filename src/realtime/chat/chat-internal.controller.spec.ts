// packages
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

jest.mock('./chat-ticket.js', () => ({ verifyChatTicket: jest.fn() }));

// utils
import { InternalSecretGuard } from '../../auth/internal-secret.guard';
import { ChatInternalController } from './chat-internal.controller';
import type { ChatGateway } from './chat.gateway';

describe('ChatInternalController', () => {
  const message = {
    id: 'cm1',
    content: 'hi',
    mine: true,
    at: '2026-11-14T10:00:00.000Z',
    file: null,
    blocked: false,
  };

  let deliverMessage: jest.Mock;
  let refresh: jest.Mock;
  let controller: ChatInternalController;

  beforeEach(() => {
    deliverMessage = jest.fn().mockReturnValue({ client: 1, owner: 0 });
    refresh = jest.fn().mockReturnValue(1);
    controller = new ChatInternalController({
      deliverMessage,
      refresh,
    } as unknown as ChatGateway);
  });

  it('every route is behind the internal secret', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ChatInternalController),
    ).toEqual([InternalSecretGuard]);
  });

  it('delivers a valid message, rebuilt with known fields only', () => {
    expect(
      controller.deliverMessage({
        mid: 'm1',
        client: { ...message, extra: 'x' },
        owner: null,
      }),
    ).toEqual({ ok: true, delivered: { client: 1, owner: 0 } });
    expect(deliverMessage).toHaveBeenCalledWith({
      mid: 'm1',
      client: message,
      owner: null,
    });
  });

  it('400 for a bad body, and nothing is delivered', () => {
    expect(() =>
      controller.deliverMessage({
        mid: 'm1',
        client: { id: 'x' },
        owner: null,
      }),
    ).toThrow(BadRequestException);
    expect(deliverMessage).not.toHaveBeenCalled();
  });

  it('refresh: 400 for a bad side', () => {
    expect(controller.refresh({ mid: 'm1', side: 'OWNER' })).toEqual({
      ok: true,
      delivered: 1,
    });
    expect(() => controller.refresh({ mid: 'm1', side: 'ALL' })).toThrow(
      BadRequestException,
    );
  });
});
