// utils
import { chatRoom, toChatJoin } from './chat-claims';
import type { SocketData } from '../types/socket-data';

describe('toChatJoin', () => {
  const client: Partial<SocketData> = {
    userId: 'client-1',
    role: 'USER',
    purpose: 'app',
  };
  const owner: Partial<SocketData> = {
    userId: 'owner-1',
    role: 'OWNER',
    purpose: 'app',
  };
  const clientTicket = { sub: 'client-1', mid: 'mid_AB-12', side: 'USER' };
  const ownerTicket = { sub: 'owner-1', mid: 'mid_AB-12', side: 'OWNER' };

  it('lets the client join its own side', () => {
    expect(toChatJoin(clientTicket, client, 'mid_AB-12')).toEqual({
      mid: 'mid_AB-12',
      side: 'USER',
      peer: null,
    });
  });

  it('lets the consultant join its own side', () => {
    expect(toChatJoin(ownerTicket, owner, 'mid_AB-12')).toEqual({
      mid: 'mid_AB-12',
      side: 'OWNER',
      peer: null,
    });
  });

  it.each([
    [
      "another user's ticket",
      clientTicket,
      { ...client, userId: 'client-2' },
      'mid_AB-12',
    ],
    [
      'a client ticket on a consultant socket (same user id)',
      { ...clientTicket, sub: 'owner-1' },
      owner,
      'mid_AB-12',
    ],
    [
      'a consultant ticket on a client socket (same user id)',
      { ...ownerTicket, sub: 'client-1' },
      client,
      'mid_AB-12',
    ],
    ['a ticket for another meeting', clientTicket, client, 'other-mid'],
    ['no meeting asked', clientTicket, client, undefined],
    ['a malformed meeting id', { ...clientTicket, mid: 'a/b' }, client, 'a/b'],
    [
      'a meeting id too long',
      { ...clientTicket, mid: 'x'.repeat(33) },
      client,
      'x'.repeat(33),
    ],
    [
      'a ticket with no side',
      { sub: 'client-1', mid: 'mid_AB-12' },
      client,
      'mid_AB-12',
    ],
    [
      'a ticket with no subject',
      { mid: 'mid_AB-12', side: 'USER' },
      client,
      'mid_AB-12',
    ],
    [
      'a socket that is not the app connection',
      clientTicket,
      { ...client, purpose: undefined },
      'mid_AB-12',
    ],
    [
      'a guest socket',
      { ...clientTicket, side: 'GUEST' },
      { ...client, role: 'GUEST' as const },
      'mid_AB-12',
    ],
    [
      'a socket whose token was never verified',
      clientTicket,
      { purpose: 'app' as const },
      'mid_AB-12',
    ],
  ])('refuses %s', (_label, claims, socket, mid) => {
    expect(
      toChatJoin(claims as Record<string, unknown>, socket, mid),
    ).toBeNull();
  });

  it('names one room per meeting and side', () => {
    expect(chatRoom('m1', 'USER')).toBe('chat:m1:USER');
    expect(chatRoom('m1', 'OWNER')).toBe('chat:m1:OWNER');
  });

  describe('the peer (only the client sees the consultant, D4)', () => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    const key = '0123456789abcdef';

    it("a client's ticket brings the consultant's key and last seen", () => {
      expect(
        toChatJoin(
          { ...clientTicket, peer: key, peerLastSeenAt: now - 60_000 },
          client,
          'mid_AB-12',
          now,
        )?.peer,
      ).toEqual({ key, lastSeenAt: now - 60_000 });
    });

    it("a consultant's ticket never brings a peer, whatever it claims", () => {
      expect(
        toChatJoin(
          { ...ownerTicket, peer: key, peerLastSeenAt: now },
          owner,
          'mid_AB-12',
          now,
        ),
      ).toEqual({ mid: 'mid_AB-12', side: 'OWNER', peer: null });
    });

    it.each([
      ['a key that is not 16 hex characters', 'not-a-key'],
      ['an uppercase key', key.toUpperCase()],
      ['a user id', 'client-1'],
      ['no key', undefined],
    ])('%s: no peer, the chat still joins', (_label, peer) => {
      expect(
        toChatJoin({ ...clientTicket, peer }, client, 'mid_AB-12', now),
      ).toEqual({ mid: 'mid_AB-12', side: 'USER', peer: null });
    });

    it.each([
      ['in the future', now + 120_000],
      ['not a number', '2026-11-14'],
      ['zero', 0],
      ['missing', undefined],
    ])('a last seen %s is unknown (null)', (_label, peerLastSeenAt) => {
      expect(
        toChatJoin(
          { ...clientTicket, peer: key, peerLastSeenAt },
          client,
          'mid_AB-12',
          now,
        )?.peer,
      ).toEqual({ key, lastSeenAt: null });
    });
  });
});
