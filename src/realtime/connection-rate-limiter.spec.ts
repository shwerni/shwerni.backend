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

  it('allows 20 a minute per ip, and each ip has its own window', () => {
    for (let i = 0; i < 20; i++) expect(limiter.allow('1.1.1.1')).toBe(true);
    expect(limiter.allow('1.1.1.1')).toBe(false);
    expect(limiter.allow('2.2.2.2')).toBe(true);

    jest.advanceTimersByTime(60_000);
    expect(limiter.allow('1.1.1.1')).toBe(true);
  });

  it('drops ips that stopped connecting', () => {
    for (let i = 0; i < 100; i++) limiter.allow(`10.0.0.${i}`);
    expect(limiter['attempts'].size).toBe(100);

    jest.advanceTimersByTime(60_000);
    limiter.allow('3.3.3.3');

    expect(limiter['attempts'].size).toBe(1);
    expect(limiter['attempts'].has('3.3.3.3')).toBe(true);
  });

  it('keeps an ip that is still inside its window', () => {
    limiter.allow('1.1.1.1');
    jest.advanceTimersByTime(30_000);
    limiter.allow('2.2.2.2');
    jest.advanceTimersByTime(30_001);
    limiter.allow('3.3.3.3');

    expect(limiter['attempts'].has('1.1.1.1')).toBe(false);
    expect(limiter['attempts'].has('2.2.2.2')).toBe(true);
  });
});
