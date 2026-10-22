// utils
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  let presence: PresenceService;

  beforeEach(() => {
    presence = new PresenceService();
  });

  it('keeps the reference count as before', () => {
    expect(presence.markOnline('a')).toBe(true);
    expect(presence.markOnline('a')).toBe(false);
    expect(presence.markOffline('a')).toBe(false);
    expect(presence.isOnline('a')).toBe(true);
    expect(presence.markOffline('a')).toBe(true);
    expect(presence.isOnline('a')).toBe(false);
  });

  it('clear drops every reference at once', () => {
    presence.markOnline('a');
    presence.markOnline('a');
    expect(presence.clear('a')).toBe(true);
    expect(presence.isOnline('a')).toBe(false);
    expect(presence.getOnlineIds()).toEqual([]);
    expect(presence.clear('a')).toBe(false);
  });

  it('returns an active busy block', () => {
    const busyUntil = Date.now() + 60_000;
    presence.setBusy('a', 7, busyUntil);
    expect(presence.getBusy('a')).toEqual({ orderId: 7, busyUntil });
    expect(presence.getBusy('b')).toBeNull();
  });

  it('drops an expired busy block on read', () => {
    presence.setBusy('a', 7, Date.now() - 1);
    expect(presence.getBusy('a')).toBeNull();
  });

  it('a later booking replaces the block', () => {
    const later = Date.now() + 120_000;
    presence.setBusy('a', 7, Date.now() + 60_000);
    expect(presence.setBusy('a', 8, later)).toEqual({
      orderId: 8,
      busyUntil: later,
    });
    expect(presence.getBusy('a')).toEqual({ orderId: 8, busyUntil: later });
  });

  it('a booking that ends sooner keeps the running block', () => {
    const later = Date.now() + 120_000;
    presence.setBusy('a', 7, later);
    expect(presence.setBusy('a', 8, Date.now() + 60_000)).toEqual({
      orderId: 7,
      busyUntil: later,
    });
    expect(presence.getBusy('a')).toEqual({ orderId: 7, busyUntil: later });
  });

  it('an expired block is replaced whatever its end', () => {
    const next = Date.now() + 60_000;
    presence.setBusy('a', 7, Date.now() - 1);
    expect(presence.setBusy('a', 8, next)).toEqual({
      orderId: 8,
      busyUntil: next,
    });
  });
});
