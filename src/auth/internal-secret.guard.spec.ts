// packages
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

// utils
import { InternalSecretGuard } from './internal-secret.guard';

const context = (headers: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

describe('InternalSecretGuard', () => {
  const saved = process.env.INTERNAL_SHARED_SECRET;
  const guard = new InternalSecretGuard();

  beforeEach(() => {
    process.env.INTERNAL_SHARED_SECRET = 'test-secret';
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.INTERNAL_SHARED_SECRET;
    else process.env.INTERNAL_SHARED_SECRET = saved;
  });

  it('accepts the right secret', () => {
    expect(
      guard.canActivate(context({ 'x-internal-secret': 'test-secret' })),
    ).toBe(true);
  });

  it.each([
    [
      'a wrong secret of the same length',
      { 'x-internal-secret': 'test-secreX' },
    ],
    ['a different length', { 'x-internal-secret': 'short' }],
    // same character count as test-secret, more bytes: timingSafeEqual would throw
    ['same characters, more bytes', { 'x-internal-secret': 'test-secreé' }],
    ['no header', {}],
    ['an empty header', { 'x-internal-secret': '' }],
    ['an array header', { 'x-internal-secret': ['test-secret'] }],
  ])('401 for %s', (_label, headers) => {
    expect(() => guard.canActivate(context(headers))).toThrow(
      UnauthorizedException,
    );
  });

  it('401, not a crash, when the secret is unset', () => {
    delete process.env.INTERNAL_SHARED_SECRET;
    expect(() =>
      guard.canActivate(context({ 'x-internal-secret': 'anything' })),
    ).toThrow(UnauthorizedException);

    process.env.INTERNAL_SHARED_SECRET = '';
    expect(() =>
      guard.canActivate(context({ 'x-internal-secret': '' })),
    ).toThrow(UnauthorizedException);
  });
});
