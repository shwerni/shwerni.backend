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
