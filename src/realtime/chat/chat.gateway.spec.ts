// packages
import { Logger } from '@nestjs/common';
import { MESSAGE_METADATA } from '@nestjs/websockets/constants';
import type { Server, Socket } from 'socket.io';

// jose runs in the end-to-end script; here the ticket check answers what each test says
jest.mock('./chat-ticket.js', () => ({ verifyChatTicket: jest.fn() }));

// utils
import { verifyChatTicket } from './chat-ticket.js';
import { ChatGateway } from './chat.gateway';
import { AppPresenceService } from './app-presence.service';

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

describe('ChatGateway peer (only the client sees the consultant, D4)', () => {
  const key = '0123456789abcdef';
  let presence: AppPresenceService;
  let gateway: ChatGateway;

  beforeEach(() => {
    presence = new AppPresenceService();
    gateway = new ChatGateway(presence);
    gateway.server = recordingServer().server;
    verify.mockReset();
  });

  const clientJoin = (socket: Socket, mid: string, peerLastSeenAt?: number) => {
    verify.mockResolvedValueOnce({
      claims: { sub: 'client-1', mid, side: 'USER', peer: key, peerLastSeenAt },
    });
    return gateway.onChatJoin(socket, { mid, ticket: 't' });
  };

  it("a client's join watches the consultant and gets their status", async () => {
    presence.connect(key);
    const socket = appSocket('client-1', 'USER');

    expect(await clientJoin(socket, 'm1')).toEqual({
      ok: true,
      mid: 'm1',
      peer: { key, online: true, lastSeenAt: null },
    });
    expect(socket.rooms.has(`watch:${key}`)).toBe(true);
  });

  it('last seen is the later of this server and the ticket (UserPresence)', async () => {
    presence.connect(key);
    presence.disconnect(key, 5_000, 5_000);
    const socket = appSocket('client-1', 'USER');

    // the ticket's time is older: this server's wins
    expect(await clientJoin(socket, 'm1', 1_000)).toMatchObject({
      peer: { online: false, lastSeenAt: 5_000 },
    });
    // the ticket's time is newer (e.g. after a restart): the ticket's wins
    expect(await clientJoin(socket, 'm2', 9_000)).toMatchObject({
      peer: { online: false, lastSeenAt: 9_000 },
    });
  });

  it("a consultant's join never watches anyone, whatever its ticket claims", async () => {
    verify.mockResolvedValueOnce({
      claims: { sub: 'owner-1', mid: 'm1', side: 'OWNER', peer: key },
    });
    const socket = appSocket('owner-1', 'OWNER');

    expect(
      await gateway.onChatJoin(socket, { mid: 'm1', ticket: 't' }),
    ).toEqual({
      ok: true,
      mid: 'm1',
      peer: null,
    });
    expect([...socket.rooms].some((room) => room.startsWith('watch:'))).toBe(
      false,
    );
  });

  it('leaving one chat keeps the watch while another chat with that consultant is open', async () => {
    const socket = appSocket('client-1', 'USER');
    await clientJoin(socket, 'm1');
    await clientJoin(socket, 'm2');

    await gateway.onChatLeave(socket, { mid: 'm1' });
    expect(socket.rooms.has(`watch:${key}`)).toBe(true);

    await gateway.onChatLeave(socket, { mid: 'm2' });
    expect(socket.rooms.has(`watch:${key}`)).toBe(false);
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
