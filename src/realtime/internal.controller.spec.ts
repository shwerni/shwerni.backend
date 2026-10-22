// the gateway module loads the notifiers and jose: neither runs here
jest.mock('./presence-notifier.js', () => ({
  notifyPresenceChange: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./instant-snapshot-notifier.js', () => ({
  notifyInstantSnapshot: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../auth/verify-token.js', () => ({
  verifyRealtimeToken: jest.fn(),
}));

// packages
import { BadRequestException } from '@nestjs/common';

// utils
import { InternalController } from './internal.controller';
import { PresenceService } from './presence.service';
import type { RealtimeGateway } from './realtime.gateway';
import type { ConsultantBusyRequest } from './dto/instant-booked.dto';

describe('InternalController consultant-busy body', () => {
  let markConsultantBusy: jest.Mock;
  let controller: InternalController;

  const body = (
    overrides: Partial<ConsultantBusyRequest> = {},
  ): ConsultantBusyRequest => ({
    consultantId: 'owner-1',
    orderId: 7,
    meetingId: 'mid',
    meetingUrl: 'https://shwerni.sa/meetings/mid',
    startsAt: new Date().toISOString(),
    duration: 30,
    busyUntil: Date.now() + 30 * 60_000,
    ...overrides,
  });

  beforeEach(() => {
    markConsultantBusy = jest.fn().mockResolvedValue({ wasOnline: true });
    controller = new InternalController(
      { markConsultantBusy } as unknown as RealtimeGateway,
      new PresenceService(),
    );
  });

  it.each([30, 45, 60])('accepts a %i minute session', async (duration) => {
    await expect(
      controller.markConsultantBusy(body({ duration })),
    ).resolves.toEqual({ ok: true, wasOnline: true });
  });

  it('passes only the broadcast fields on', async () => {
    const valid = body();
    await controller.markConsultantBusy(valid);

    const { consultantId, ...broadcast } = valid;
    expect(markConsultantBusy).toHaveBeenCalledWith(consultantId, broadcast);
  });

  it('accepts busyUntil exactly 4 hours ahead (minus a margin for the clock)', async () => {
    await expect(
      controller.markConsultantBusy(
        body({ busyUntil: Date.now() + 4 * 60 * 60_000 - 1_000 }),
      ),
    ).resolves.toEqual({ ok: true, wasOnline: true });
  });

  it.each([
    ['a duration the site does not sell', { duration: 40 }],
    ['a zero duration', { duration: 0 }],
    ['a negative duration', { duration: -30 }],
    ['a duration given as a string', { duration: '30' as unknown as number }],
    ['startsAt that is not a date', { startsAt: 'soon' }],
    ['an empty startsAt', { startsAt: '' }],
    ['busyUntil in the past', { busyUntil: Date.now() - 1 }],
    [
      'busyUntil more than 4 hours ahead',
      { busyUntil: Date.now() + 4 * 60 * 60_000 + 60_000 },
    ],
    // microseconds instead of milliseconds
    [
      'busyUntil in the wrong unit',
      { busyUntil: (Date.now() + 60_000) * 1000 },
    ],
    ['a missing consultantId', { consultantId: '' }],
  ])('400 for %s', async (_label, overrides) => {
    await expect(
      controller.markConsultantBusy(body(overrides)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(markConsultantBusy).not.toHaveBeenCalled();
  });
});
