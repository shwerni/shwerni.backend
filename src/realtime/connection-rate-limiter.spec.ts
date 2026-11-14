// utils
import { ConnectionRateLimiter } from './connection-rate-limiter';

describe('ConnectionRateLimiter', () => {
  let limiter: ConnectionRateLimiter;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    limiter = new ConnectionRateLimiter();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('members (per user)', () => {
    it('allows 20 a minute per user', () => {
      for (let i = 0; i < 20; i++)
        expect(limiter.allowMember('u1', '1.1.1.1')).toBe(true);
      expect(limiter.allowMember('u1', '1.1.1.1')).toBe(false);

      jest.advanceTimersByTime(60_000);
      expect(limiter.allowMember('u1', '1.1.1.1')).toBe(true);
    });

    it('a user over the limit is refused from any ip', () => {
      for (let i = 0; i < 20; i++) limiter.allowMember('u1', `1.1.1.${i}`);
      expect(limiter.allowMember('u1', '9.9.9.9')).toBe(false);
    });

    it('users behind one ip (carrier nat) never share a limit', () => {
      for (let i = 0; i < 20; i++) limiter.allowMember('u1', '1.1.1.1');
      expect(limiter.allowMember('u1', '1.1.1.1')).toBe(false);
      expect(limiter.allowMember('u2', '1.1.1.1')).toBe(true);
    });

    it('one ip opens at most 300 member connections a minute, whatever the users', () => {
      for (let i = 0; i < 300; i++)
        expect(limiter.allowMember(`u${i}`, '1.1.1.1')).toBe(true);
      expect(limiter.allowMember('fresh-user', '1.1.1.1')).toBe(false);
      expect(limiter.allowMember('fresh-user', '2.2.2.2')).toBe(true);
    });

    it('a refusal counts nothing', () => {
      for (let i = 0; i < 20; i++) limiter.allowMember('u1', '1.1.1.1');
      // refused for the user: the ip window must not grow
      for (let i = 0; i < 500; i++) limiter.allowMember('u1', '1.1.1.1');
      expect(limiter['memberIpAttempts'].get('1.1.1.1')).toHaveLength(20);
    });
  });

  describe('guests (per ip)', () => {
    it('allows 120 a minute per ip', () => {
      for (let i = 0; i < 120; i++)
        expect(limiter.allowGuest('1.1.1.1')).toBe(true);
      expect(limiter.allowGuest('1.1.1.1')).toBe(false);
      expect(limiter.allowGuest('2.2.2.2')).toBe(true);

      jest.advanceTimersByTime(60_000);
      expect(limiter.allowGuest('1.1.1.1')).toBe(true);
    });

    it('guests and members never use up each other', () => {
      for (let i = 0; i < 120; i++) limiter.allowGuest('1.1.1.1');
      expect(limiter.allowGuest('1.1.1.1')).toBe(false);
      expect(limiter.allowMember('u1', '1.1.1.1')).toBe(true);

      for (let i = 0; i < 300; i++) limiter.allowMember(`m${i}`, '2.2.2.2');
      expect(limiter.allowMember('m-new', '2.2.2.2')).toBe(false);
      expect(limiter.allowGuest('2.2.2.2')).toBe(true);
    });
  });

  it('drops keys that stopped connecting, in every window', () => {
    for (let i = 0; i < 50; i++) {
      limiter.allowGuest(`10.0.0.${i}`);
      limiter.allowMember(`u${i}`, `10.0.1.${i}`);
    }

    jest.advanceTimersByTime(60_000);
    limiter.allowGuest('3.3.3.3');

    expect(limiter['guestAttempts'].size).toBe(1);
    expect(limiter['memberAttempts'].size).toBe(0);
    expect(limiter['memberIpAttempts'].size).toBe(0);
  });

  it('keeps a key that is still inside its window', () => {
    limiter.allowMember('u1', '1.1.1.1');
    jest.advanceTimersByTime(30_000);
    limiter.allowMember('u2', '2.2.2.2');
    jest.advanceTimersByTime(30_001);
    limiter.allowGuest('3.3.3.3');

    expect(limiter['memberAttempts'].has('u1')).toBe(false);
    expect(limiter['memberAttempts'].has('u2')).toBe(true);
  });
});
