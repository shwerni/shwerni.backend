// packages
import { Logger } from '@nestjs/common';
import { MESSAGE_METADATA } from '@nestjs/websockets/constants';
import type { Server, Socket } from 'socket.io';

// jose runs in the end-to-end script; here the ticket check answers what each test says
jest.mock('./chat-ticket.js', () => ({ verifyChatTicket: jest.fn() }));

// utils
import { verifyChatTicket } from './chat-ticket.js';
import { ChatGateway } from './chat.gateway';

const verify = verifyChatTicket as jest.Mock;

// records every emit: the room and the payload
function recordingServer(roomSizes: Record<string, number> = {}) {
  const sends: { room: string; event: string; payload: unknown }[] = [];
  const server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) =>
        sends.push({ room, event, payload }),
    }),
    sockets: {
      adapter: {
        rooms: new Map(
          Object.entries(roomSizes).map(([room, size]) => [
            room,
            new Set(Array.from({ length: size }, (_, i) => `${room}-${i}`)),
          ]),
        ),
      },
    },
  } as unknown as Server;
  return { server, sends };
}

// an app socket of the given user and role, with real room bookkeeping
function appSocket(userId: string, role: 'USER' | 'OWNER') {
  const rooms = new Set<string>(['own-id']);
  return {
    id: `${role}-socket`,
    data: { userId, role, purpose: 'app' },
    rooms,
    join: jest.fn((room: string) => {
      rooms.add(room);
      return Promise.resolve();
    }),
    leave: jest.fn((room: string) => {
      rooms.delete(room);
      return Promise.resolve();
    }),
  } as unknown as Socket & { rooms: Set<string> };
}

describe('ChatGateway chat-join', () => {
  let gateway: ChatGateway;

  beforeEach(() => {
    gateway = new ChatGateway();
    gateway.server = recordingServer().server;
    verify.mockReset();
  });

  it('a valid ticket joins its side of the meeting', async () => {
    verify.mockResolvedValue({
      claims: { sub: 'client-1', mid: 'm1', side: 'USER' },
    });
    const socket = appSocket('client-1', 'USER');

    expect(
      await gateway.onChatJoin(socket, { mid: 'm1', ticket: 't' }),
    ).toEqual({
      ok: true,
      mid: 'm1',
      peer: null,
    });
    expect(socket.rooms.has('chat:m1:USER')).toBe(true);
    expect(socket.rooms.has('chat:m1:OWNER')).toBe(false);
  });

  it.each(['expired', 'invalid'] as const)(
    'an %s ticket joins nothing',
    async (error) => {
      verify.mockResolvedValue({ error });
      const socket = appSocket('client-1', 'USER');

      expect(
        await gateway.onChatJoin(socket, { mid: 'm1', ticket: 't' }),
      ).toEqual({
        ok: false,
        error,
      });
      expect([...socket.rooms]).toEqual(['own-id']);
    },
  );

  it("someone else's valid ticket joins nothing", async () => {
    verify.mockResolvedValue({
      claims: { sub: 'client-1', mid: 'm1', side: 'USER' },
    });
    const socket = appSocket('client-2', 'USER');

    expect(
      await gateway.onChatJoin(socket, { mid: 'm1', ticket: 't' }),
    ).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect([...socket.rooms]).toEqual(['own-id']);
  });

  it("a client can't use its ticket to join the consultant's side", async () => {
    verify.mockResolvedValue({
      claims: { sub: 'u1', mid: 'm1', side: 'OWNER' },
    });
    const socket = appSocket('u1', 'USER');

    expect(
      await gateway.onChatJoin(socket, { mid: 'm1', ticket: 't' }),
    ).toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('at most 20 chats per socket; joining one again is fine', async () => {
    const socket = appSocket('client-1', 'USER');
    for (let i = 0; i < 20; i++) {
      verify.mockResolvedValueOnce({
        claims: { sub: 'client-1', mid: `m${i}`, side: 'USER' },
      });
      expect(
        (await gateway.onChatJoin(socket, { mid: `m${i}`, ticket: 't' })).ok,
      ).toBe(true);
    }

    verify.mockResolvedValueOnce({
      claims: { sub: 'client-1', mid: 'm20', side: 'USER' },
    });
    expect(
      await gateway.onChatJoin(socket, { mid: 'm20', ticket: 't' }),
    ).toEqual({
      ok: false,
      error: 'limit',
    });

    verify.mockResolvedValueOnce({
      claims: { sub: 'client-1', mid: 'm3', side: 'USER' },
    });
    expect(
      (await gateway.onChatJoin(socket, { mid: 'm3', ticket: 't' })).ok,
    ).toBe(true);
  });

  it('chat-leave leaves only its own side', async () => {
    verify.mockResolvedValue({
      claims: { sub: 'client-1', mid: 'm1', side: 'USER' },
    });
    const socket = appSocket('client-1', 'USER');
    await gateway.onChatJoin(socket, { mid: 'm1', ticket: 't' });

    expect(await gateway.onChatLeave(socket, { mid: 'm1' })).toEqual({
      ok: true,
    });
    expect(socket.rooms.has('chat:m1:USER')).toBe(false);
    expect(await gateway.onChatLeave(socket, { mid: 'bad/mid' })).toEqual({
      ok: false,
    });
  });
});

describe('ChatGateway delivery', () => {
  const message = (mine: boolean) => ({
    id: 'cm1',
    content: 'رقمي 0500000000 سري',
    mine,
    at: '2026-11-14T10:00:00.000Z',
    file: null,
    blocked: false,
  });

  it('each side gets its own view, in its own room only', () => {
    const gateway = new ChatGateway();
    const { server, sends } = recordingServer({
      'chat:m1:USER': 1,
      'chat:m1:OWNER': 2,
    });
    gateway.server = server;

    const delivered = gateway.deliverMessage({
      mid: 'm1',
      client: message(true),
      owner: message(false),
    });

    expect(delivered).toEqual({ client: 1, owner: 2 });
    expect(sends).toEqual([
      {
        room: 'chat:m1:USER',
        event: 'chat-message',
        payload: { mid: 'm1', message: message(true) },
      },
      {
        room: 'chat:m1:OWNER',
        event: 'chat-message',
        payload: { mid: 'm1', message: message(false) },
      },
    ]);
  });

  it('a null side gets nothing (a blocked client, a block marker)', () => {
    const gateway = new ChatGateway();
    const { server, sends } = recordingServer();
    gateway.server = server;

    gateway.deliverMessage({ mid: 'm1', client: message(true), owner: null });

    expect(sends.map((s) => s.room)).toEqual(['chat:m1:USER']);
  });

  it('never logs the content', () => {
    const gateway = new ChatGateway();
    gateway.server = recordingServer().server;
    const logged: string[] = [];
    const capture = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };
    const spies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture),
      jest.spyOn(console, 'log').mockImplementation(capture),
      jest.spyOn(console, 'error').mockImplementation(capture),
    ];

    gateway.deliverMessage({
      mid: 'm1',
      client: message(true),
      owner: message(false),
    });

    spies.forEach((spy) => spy.mockRestore());
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toContain('0500000000');
  });

  it('chat-refresh goes to one side', () => {
    const gateway = new ChatGateway();
    const { server, sends } = recordingServer({ 'chat:m1:OWNER': 1 });
    gateway.server = server;

    expect(gateway.refresh({ mid: 'm1', side: 'OWNER' })).toBe(1);
    expect(sends).toEqual([
      { room: 'chat:m1:OWNER', event: 'chat-refresh', payload: { mid: 'm1' } },
    ]);
  });
});

describe('ChatGateway client events', () => {
  it('clients can only join and leave; nothing writes to a room', () => {
    const proto = ChatGateway.prototype as unknown as Record<string, unknown>;
    const events = Object.getOwnPropertyNames(proto)
      .map((name) => proto[name])
      .filter((method) => typeof method === 'function')
      .map((method) => Reflect.getMetadata(MESSAGE_METADATA, method) as unknown)
      .filter((event): event is string => typeof event === 'string')
      .sort();

    expect(events).toEqual(['chat-join', 'chat-leave']);
  });
});
