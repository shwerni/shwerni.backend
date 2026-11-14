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
    });
  });

  it('lets the consultant join its own side', () => {
    expect(toChatJoin(ownerTicket, owner, 'mid_AB-12')).toEqual({
      mid: 'mid_AB-12',
      side: 'OWNER',
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
});
