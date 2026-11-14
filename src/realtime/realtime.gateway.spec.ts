// packages
import type { Server, Socket } from 'socket.io';
import { MESSAGE_METADATA } from '@nestjs/websockets/constants';

// the notifiers call next.js and the token check loads jose: neither runs here
jest.mock('./presence-notifier.js', () => ({
  notifyPresenceChange: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./instant-snapshot-notifier.js', () => ({
  notifyInstantSnapshot: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../auth/verify-token.js', () => ({
  verifyRealtimeToken: jest.fn(),
}));

// utils
import { verifyRealtimeToken } from '../auth/verify-token.js';
import { notifyInstantSnapshot } from './instant-snapshot-notifier.js';
import { RealtimeGateway } from './realtime.gateway';
import { PresenceService } from './presence.service';
import { InstantRequestService } from './instant-request.service';
import { ConnectionRateLimiter } from './connection-rate-limiter';

function fakeServer() {
  const emit = jest.fn();
  return {
    to: jest.fn(() => ({ emit, except: jest.fn(() => ({ emit })) })),
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
  } as unknown as Server;
}

function ownerSocket(id: string, userId: string) {
  return {
    id,
    data: { userId, role: 'OWNER' },
    emit: jest.fn(),
  } as unknown as Socket;
}

describe('RealtimeGateway consultant-online', () => {
  let presence: PresenceService;
  let gateway: RealtimeGateway;

  beforeEach(() => {
    presence = new PresenceService();
    gateway = new RealtimeGateway(
      new InstantRequestService(),
      new ConnectionRateLimiter(),
      presence,
    );
    gateway.server = fakeServer();
  });

  it('a second emit from the same socket adds no reference', async () => {
    const socket = ownerSocket('s1', 'owner-1');

    expect(await gateway.onConsultantOnline(socket)).toEqual({ online: true });
    expect(await gateway.onConsultantOnline(socket)).toEqual({ online: true });
    expect(presence.getOnlineIds()).toEqual(['owner-1']);

    await gateway.handleDisconnect(socket);
    expect(presence.getOnlineIds()).not.toContain('owner-1');
  });

  it('two sockets of one consultant still count separately', async () => {
    const first = ownerSocket('s1', 'owner-1');
    const second = ownerSocket('s2', 'owner-1');

    await gateway.onConsultantOnline(first);
    await gateway.onConsultantOnline(second);

    await gateway.handleDisconnect(first);
    expect(presence.getOnlineIds()).toContain('owner-1');

    await gateway.handleDisconnect(second);
    expect(presence.getOnlineIds()).not.toContain('owner-1');
  });

  it('online again after consultant-offline on the same socket', async () => {
    const socket = ownerSocket('s1', 'owner-1');

    await gateway.onConsultantOnline(socket);
    await gateway.onConsultantOffline(socket);
    expect(presence.getOnlineIds()).not.toContain('owner-1');

    expect(await gateway.onConsultantOnline(socket)).toEqual({ online: true });
    expect(presence.getOnlineIds()).toContain('owner-1');
  });

  it('refused while busy, with instant-busy', async () => {
    const emit = jest.fn();
    const socket = {
      id: 's1',
      data: { userId: 'owner-1', role: 'OWNER' },
      emit,
    } as unknown as Socket;
    const busyUntil = Date.now() + 60_000;
    presence.setBusy('owner-1', 7, busyUntil);

    expect(await gateway.onConsultantOnline(socket)).toEqual({
      online: false,
      busyUntil,
    });
    expect(emit).toHaveBeenCalledWith('instant-busy', {
      orderId: 7,
      busyUntil,
    });
    expect(presence.getOnlineIds()).toEqual([]);
  });
});

describe('RealtimeGateway markConsultantBusy', () => {
  it('instant-booked carries the block in force, not a shorter one', async () => {
    const presence = new PresenceService();
    const gateway = new RealtimeGateway(
      new InstantRequestService(),
      new ConnectionRateLimiter(),
      presence,
    );
    const emit = jest.fn();
    gateway.server = {
      to: jest.fn(() => ({ emit })),
      sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    } as unknown as Server;

    const running = Date.now() + 120_000;
    presence.setBusy('owner-1', 7, running);

    await gateway.markConsultantBusy('owner-1', {
      orderId: 8,
      meetingId: 'mid-8',
      meetingUrl: 'https://shwerni.sa/meetings/mid-8',
      startsAt: new Date().toISOString(),
      duration: 30,
      busyUntil: Date.now() + 60_000,
    });

    expect(emit).toHaveBeenCalledWith(
      'instant-booked',
      expect.objectContaining({ orderId: 8, busyUntil: running }),
    );
    expect(presence.getBusy('owner-1')).toEqual({
      orderId: 7,
      busyUntil: running,
    });
  });
});

describe('RealtimeGateway connection rate limit', () => {
  it('limits by the right-most x-forwarded-for entry, not the load balancer', async () => {
    const limiter = new ConnectionRateLimiter();
    const allowGuest = jest.spyOn(limiter, 'allowGuest');
    const gateway = new RealtimeGateway(
      new InstantRequestService(),
      limiter,
      new PresenceService(),
    );
    (verifyRealtimeToken as jest.Mock).mockResolvedValue(null);

    const disconnect = jest.fn();
    const socket = {
      id: 's1',
      data: {},
      disconnect,
      handshake: {
        address: '10.0.0.2',
        auth: {},
        headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
      },
    } as unknown as Socket;

    await gateway.handleConnection(socket);

    // no valid token: counted as a guest of that ip, then refused
    expect(allowGuest).toHaveBeenCalledWith('203.0.113.7');
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  // a connection from one shared ip with the given role (a fresh user unless userId is given);
  // returns whether it was refused
  async function connectFrom(
    gateway: RealtimeGateway,
    role: string | null,
    userId = `${role}-${Math.random()}`,
  ) {
    (verifyRealtimeToken as jest.Mock).mockResolvedValueOnce(
      role ? { userId, role } : null,
    );
    const disconnect = jest.fn();
    const socket = {
      id: 's',
      data: {},
      disconnect,
      join: jest.fn().mockResolvedValue(undefined),
      handshake: {
        address: '10.0.0.2',
        auth: { token: 't' },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      },
    } as unknown as Socket;
    await gateway.handleConnection(socket);
    return disconnect.mock.calls.length > 0;
  }

  it('guests on a shared ip never block consultants or app users', async () => {
    const gateway = new RealtimeGateway(
      new InstantRequestService(),
      new ConnectionRateLimiter(),
      new PresenceService(),
    );
    gateway.server = {
      to: jest.fn(() => ({ emit: jest.fn() })),
      sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    } as unknown as Server;

    for (let i = 0; i < 120; i++)
      expect(await connectFrom(gateway, 'GUEST')).toBe(false);
    expect(await connectFrom(gateway, 'GUEST')).toBe(true);
    // a missing or invalid token counts as a guest too
    expect(await connectFrom(gateway, null)).toBe(true);

    expect(await connectFrom(gateway, 'OWNER')).toBe(false);
    expect(await connectFrom(gateway, 'USER')).toBe(false);
  });

  it('a member keeps 20 a minute per user; others on the ip and guests still connect', async () => {
    const gateway = new RealtimeGateway(
      new InstantRequestService(),
      new ConnectionRateLimiter(),
      new PresenceService(),
    );
    gateway.server = {
      to: jest.fn(() => ({ emit: jest.fn() })),
      sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    } as unknown as Server;

    for (let i = 0; i < 20; i++)
      expect(await connectFrom(gateway, 'USER', 'app-user-1')).toBe(false);
    expect(await connectFrom(gateway, 'USER', 'app-user-1')).toBe(true);

    // the limit is the user's, not the shared ip's
    expect(await connectFrom(gateway, 'USER', 'app-user-2')).toBe(false);
    expect(await connectFrom(gateway, 'OWNER', 'owner-1')).toBe(false);
    expect(await connectFrom(gateway, 'GUEST')).toBe(false);
  });
});

describe('RealtimeGateway get-presence-counts', () => {
  // three sockets in the public room: an owner, a client and a guest
  function gatewayWithSockets() {
    const sockets = new Map<string, { data: { role: string } }>([
      ['o1', { data: { role: 'OWNER' } }],
      ['u1', { data: { role: 'USER' } }],
      ['g1', { data: { role: 'GUEST' } }],
    ]);
    const gateway = new RealtimeGateway(
      new InstantRequestService(),
      new ConnectionRateLimiter(),
      new PresenceService(),
    );
    gateway.server = {
      to: jest.fn(() => ({ emit: jest.fn() })),
      sockets: {
        adapter: {
          rooms: new Map([['public-presence', new Set(sockets.keys())]]),
        },
        sockets,
      },
    } as unknown as Server;
    return gateway;
  }

  const socketWithRole = (role: string) =>
    ({ id: 'x', data: { userId: 'x', role } }) as unknown as Socket;

  it('an owner gets the counts', () => {
    expect(
      gatewayWithSockets().getPresenceCounts(socketWithRole('OWNER')),
    ).toEqual({ counts: { owners: 1, clients: 1, guests: 1, total: 3 } });
  });

  it('clients and guests get { counts: null }', () => {
    const gateway = gatewayWithSockets();
    expect(gateway.getPresenceCounts(socketWithRole('USER'))).toEqual({
      counts: null,
    });
    expect(gateway.getPresenceCounts(socketWithRole('GUEST'))).toEqual({
      counts: null,
    });
  });
});

describe('RealtimeGateway presence-changed', () => {
  // records every send: the room, the room left out (if any), the event and its payload
  function recordingServer() {
    const sends: {
      to: string;
      except: string | null;
      event: string;
      payload: Record<string, unknown>;
    }[] = [];
    const server = {
      to: (to: string) => ({
        emit: (event: string, payload: Record<string, unknown>) =>
          sends.push({ to, except: null, event, payload }),
        except: (except: string) => ({
          emit: (event: string, payload: Record<string, unknown>) =>
            sends.push({ to, except, event, payload }),
        }),
      }),
      sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    } as unknown as Server;
    return { server, sends };
  }

  it('owners get counts, everyone else the same change without them, once each', async () => {
    const gateway = new RealtimeGateway(
      new InstantRequestService(),
      new ConnectionRateLimiter(),
      new PresenceService(),
    );
    const { server, sends } = recordingServer();
    gateway.server = server;

    await gateway.onConsultantOnline(ownerSocket('s1', 'owner-1'));

    const changes = sends.filter((s) => s.event === 'presence-changed');
    expect(changes).toHaveLength(2);

    const toOwners = changes.find((s) => s.to === 'owners');
    expect(toOwners?.except).toBeNull();
    expect(toOwners?.payload).toEqual({
      consultantId: 'owner-1',
      online: true,
      onlineCount: 1,
      counts: { owners: 0, clients: 0, guests: 0, total: 0 },
    });

    // the public send leaves the owners room out, so no owner gets it twice
    const toPublic = changes.find((s) => s.to === 'public-presence');
    expect(toPublic?.except).toBe('owners');
    expect(toPublic?.payload).toEqual({
      consultantId: 'owner-1',
      online: true,
      onlineCount: 1,
    });
    expect(toPublic?.payload).not.toHaveProperty('counts');
  });

  it('only owner sockets join the owners room', async () => {
    const gateway = new RealtimeGateway(
      new InstantRequestService(),
      new ConnectionRateLimiter(),
      new PresenceService(),
    );
    gateway.server = recordingServer().server;

    const joined: Record<string, string[]> = {};
    const connectAs = async (role: string) => {
      (verifyRealtimeToken as jest.Mock).mockResolvedValueOnce({
        userId: `${role}-1`,
        role,
      });
      joined[role] = [];
      const socket = {
        id: role,
        data: {},
        disconnect: jest.fn(),
        join: jest.fn((rooms: string | string[]) => {
          joined[role].push(...([] as string[]).concat(rooms));
          return Promise.resolve();
        }),
        handshake: {
          address: `10.0.0.${role.length}`,
          auth: { token: 't' },
          headers: {},
        },
      } as unknown as Socket;
      await gateway.handleConnection(socket);
    };

    await connectAs('OWNER');
    await connectAs('USER');
    await connectAs('GUEST');

    expect(joined.OWNER).toEqual(
      expect.arrayContaining(['public-presence', 'user:OWNER-1', 'owners']),
    );
    expect(joined.USER).toEqual(['public-presence']);
    expect(joined.GUEST).toEqual(['public-presence']);
  });
});

describe('RealtimeGateway app connections', () => {
  // connects one socket with the given role and handshake purpose; returns it and its rooms
  async function connect(role: string, purpose?: unknown) {
    const presence = new PresenceService();
    const gateway = new RealtimeGateway(
      new InstantRequestService(),
      new ConnectionRateLimiter(),
      presence,
    );
    gateway.server = fakeServer();
    (verifyRealtimeToken as jest.Mock).mockResolvedValueOnce({
      userId: `${role}-app`,
      role,
    });
    const rooms: string[] = [];
    const socket = {
      id: 'app-1',
      data: {},
      emit: jest.fn(),
      disconnect: jest.fn(),
      join: jest.fn((joined: string | string[]) => {
        rooms.push(...([] as string[]).concat(joined));
        return Promise.resolve();
      }),
      handshake: {
        address: '10.0.0.7',
        auth: { token: 't', purpose },
        headers: {},
      },
    } as unknown as Socket;
    (notifyInstantSnapshot as jest.Mock).mockClear();
    await gateway.handleConnection(socket);
    return { gateway, presence, socket, rooms };
  }

  it.each(['USER', 'OWNER'])(
    'a %s app socket joins no instant room and records no snapshot',
    async (role) => {
      const { socket, rooms } = await connect(role, 'app');
      expect(socket.data).toMatchObject({ purpose: 'app', role });
      expect(rooms).toEqual([]);
      expect(notifyInstantSnapshot).not.toHaveBeenCalled();
    },
  );

  it('an owner app socket never goes online or gets the counts', async () => {
    const { gateway, presence, socket } = await connect('OWNER', 'app');
    expect(await gateway.onConsultantOnline(socket)).toEqual({ online: false });
    expect(presence.getOnlineIds()).toEqual([]);
    expect(gateway.getPresenceCounts(socket)).toEqual({ counts: null });
  });

  it('a guest token never becomes an app socket', async () => {
    const { socket, rooms } = await connect('GUEST', 'app');
    expect(socket.data).not.toHaveProperty('purpose');
    expect(rooms).toEqual(['public-presence']);
  });

  it('any other purpose is an ordinary socket, as today', async () => {
    const { socket, rooms } = await connect('OWNER', 'chat');
    expect(socket.data).not.toHaveProperty('purpose');
    expect(rooms).toEqual(['public-presence', 'user:OWNER-app', 'owners']);
    expect(notifyInstantSnapshot).toHaveBeenCalled();
  });
});

describe('RealtimeGateway client events', () => {
  // every event name a client can emit, read from the @SubscribeMessage metadata
  const subscribed = () => {
    const proto = RealtimeGateway.prototype as unknown as Record<
      string,
      unknown
    >;
    return Object.getOwnPropertyNames(proto)
      .map((name) => proto[name])
      .filter((method) => typeof method === 'function')
      .map((method) => Reflect.getMetadata(MESSAGE_METADATA, method) as unknown)
      .filter((message): message is string => typeof message === 'string')
      .sort();
  };

  it('no client can broadcast chat-message to a room', () => {
    expect(subscribed()).not.toContain('chat-message');
  });

  it('the client events are exactly the known ones', () => {
    expect(subscribed()).toEqual([
      'consultant-offline',
      'consultant-online',
      'get-online-consultants',
      'get-presence-counts',
      'instant-response',
    ]);
  });
});
