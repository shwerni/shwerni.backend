// utils
import { AppPresenceService } from './app-presence.service';

describe('AppPresenceService', () => {
  let presence: AppPresenceService;

  beforeEach(() => {
    presence = new AppPresenceService();
  });

  it('online from the first app socket to the last', () => {
    expect(presence.state('k')).toEqual({ online: false, lastSeenAt: null });

    expect(presence.connect('k')).toBe(true);
    expect(presence.connect('k')).toBe(false); // a second phone
    expect(presence.state('k').online).toBe(true);

    expect(presence.disconnect('k', 1_000, 1_000)).toBe(false);
    expect(presence.state('k').online).toBe(true);

    expect(presence.disconnect('k', 2_000, 2_000)).toBe(true);
    expect(presence.state('k')).toEqual({ online: false, lastSeenAt: 2_000 });
  });

  it('last seen is the last activity it was given, not the disconnect time', () => {
    presence.connect('k');
    presence.disconnect('k', 5_000, 50_000);
    expect(presence.state('k').lastSeenAt).toBe(5_000);
  });

  it('a disconnect it never saw connect changes nothing but the last seen', () => {
    expect(presence.disconnect('k', 1_000, 1_000)).toBe(false);
    expect(presence.state('k')).toEqual({ online: false, lastSeenAt: 1_000 });
  });

  it('drops last seen times older than 7 days, at most once an hour', () => {
    const day = 86_400_000;
    presence.connect('old');
    presence.disconnect('old', 0, 0);

    presence.connect('recent');
    presence.disconnect('recent', 8 * day - 1_000, 8 * day);

    expect(presence.state('old').lastSeenAt).toBeNull();
    expect(presence.state('recent').lastSeenAt).toBe(8 * day - 1_000);
  });
});
