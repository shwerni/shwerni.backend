// packages
import type { Socket } from 'socket.io';

/**
 * the client's ip behind the aws load balancer: the alb appends the address
 * it saw to x-forwarded-for, so only the right-most entry can't be faked by
 * the client. without the header (a local run) it's the socket's own address
 */
export function clientIp(handshake: Socket['handshake']): string {
  const header = handshake.headers['x-forwarded-for'];
  const value = Array.isArray(header) ? header.join(',') : header;

  const last = value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .pop();

  return last || handshake.address;
}
