// utils
import { toRealtimePayload } from './realtime-claims';

describe('toRealtimePayload', () => {
  const base = { userId: 'u1', role: 'USER', iat: 1, exp: 2 };

  it.each(['USER', 'OWNER', 'GUEST'])(
    'accepts a %s connection token',
    (role) => {
      expect(toRealtimePayload({ ...base, role })).toEqual({
        userId: 'u1',
        role,
      });
    },
  );

  it('keeps only userId and role', () => {
    expect(toRealtimePayload({ ...base, extra: 'x' })).toEqual({
      userId: 'u1',
      role: 'USER',
    });
  });

  it.each([
    ['a chat join ticket', { ...base, aud: 'chat-join' }],
    ['an attachment token', { ...base, aud: 'chat-attachment' }],
    ['an empty audience list', { ...base, aud: [] }],
    ['an unknown role', { ...base, role: 'ADMIN' }],
    ['no role', { userId: 'u1' }],
    ['a role that is not a string', { ...base, role: 1 }],
    ['no userId', { role: 'USER' }],
    ['an empty userId', { ...base, userId: '' }],
    ['a userId that is not a string', { ...base, userId: 42 }],
  ])('refuses %s', (_label, claims) => {
    expect(toRealtimePayload(claims)).toBeNull();
  });
});
