// packages
import { createHmac } from 'crypto';

// utils
import { PEER_KEY_PATTERN, peerKey } from './peer-key';

describe('peerKey', () => {
  const saved = process.env.REALTIME_JWT_SECRET;

  beforeEach(() => {
    process.env.REALTIME_JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.REALTIME_JWT_SECRET;
    else process.env.REALTIME_JWT_SECRET = saved;
  });

  it('is HMAC-SHA256(secret, "peer:" + userId), 16 hex characters (the contract with next.js)', () => {
    const expected = createHmac('sha256', 'test-secret')
      .update('peer:owner-1')
      .digest('hex')
      .slice(0, 16);

    expect(peerKey('owner-1')).toBe(expected);
    expect(peerKey('owner-1')).toMatch(PEER_KEY_PATTERN);
  });

  it("doesn't contain or reveal the user id, and differs per user", () => {
    expect(peerKey('owner-1')).not.toContain('owner');
    expect(peerKey('owner-1')).not.toBe(peerKey('owner-2'));
  });

  it('another secret gives another key', () => {
    const key = peerKey('owner-1');
    process.env.REALTIME_JWT_SECRET = 'another-secret';
    expect(peerKey('owner-1')).not.toBe(key);
  });

  it('no secret, no key', () => {
    delete process.env.REALTIME_JWT_SECRET;
    expect(peerKey('owner-1')).toBeNull();
  });
});
