// packages
import type { Server, Socket } from 'socket.io';

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
import { RealtimeGateway } from './realtime.gateway';
import { PresenceService } from './presence.service';
import { InstantRequestService } from './instant-request.service';
import { ConnectionRateLimiter } from './connection-rate-limiter';

function fakeServer() {
  const emit = jest.fn();
  return {
    to: jest.fn(() => ({ emit })),
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
    const allow = jest.spyOn(limiter, 'allow');
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

    expect(allow).toHaveBeenCalledWith('203.0.113.7');
    // no token: refused after the limiter, as before
    expect(disconnect).toHaveBeenCalledWith(true);
  });
});
