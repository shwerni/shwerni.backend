// packages
import type { Socket } from 'socket.io';

// utils
import { clientIp } from './client-ip';

const handshake = (forwarded?: string | string[]) =>
  ({
    address: '10.0.0.5',
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  }) as unknown as Socket['handshake'];

describe('clientIp', () => {
  it('takes the right-most entry, the one the load balancer added', () => {
    expect(clientIp(handshake('1.2.3.4, 5.6.7.8'))).toBe('5.6.7.8');
    expect(clientIp(handshake('9.9.9.9'))).toBe('9.9.9.9');
  });

  it('ignores a faked left-most entry', () => {
    expect(clientIp(handshake('6.6.6.6, 1.1.1.1, 5.6.7.8 '))).toBe('5.6.7.8');
  });

  it('handles the header given as an array', () => {
    expect(clientIp(handshake(['1.2.3.4', '5.6.7.8']))).toBe('5.6.7.8');
  });

  it('falls back to the socket address without a usable header', () => {
    expect(clientIp(handshake())).toBe('10.0.0.5');
    expect(clientIp(handshake(''))).toBe('10.0.0.5');
    expect(clientIp(handshake(' , '))).toBe('10.0.0.5');
  });
});
