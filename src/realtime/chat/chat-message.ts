// utils
import { MID_PATTERN, type ChatSide } from './chat-claims.js';

// a message as one side of the chat sees it (next.js toChatMessage), plus the sender's nonce
export interface ChatMessage {
  id: string;
  content: string;
  mine: boolean;
  at: string;
  file: { url: string; name: string | null; type: string | null } | null;
  blocked: boolean;
  nonce?: string;
}

// POST /internal/chat-message: each side's view, null when that side must not get it
export interface ChatDelivery {
  mid: string;
  client: ChatMessage | null;
  owner: ChatMessage | null;
}

// POST /internal/chat-refresh
export interface ChatRefresh {
  mid: string;
  side: ChatSide;
}

// the website doesn't cap a message's length; this only bounds the payload
const CONTENT_MAX = 10_000;
const ID_MAX = 64;
const NONCE_MAX = 64;
const URL_MAX = 2048;
const FILE_NAME_MAX = 255;
const FILE_TYPE_MAX = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalText = (value: unknown, max: number) =>
  value === null || (typeof value === 'string' && value.length <= max);

function toFile(value: unknown): ChatMessage['file'] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;

  const { url, name, type } = value;
  if (
    typeof url !== 'string' ||
    url.length > URL_MAX ||
    !url.startsWith('https://')
  )
    return undefined;
  if (!optionalText(name, FILE_NAME_MAX) || !optionalText(type, FILE_TYPE_MAX))
    return undefined;

  return { url, name: name as string | null, type: type as string | null };
}

/**
 * one side's message, rebuilt with only the known fields, or undefined when anything is off
 * (null stays null: that side gets nothing)
 * @param value the body's client or owner value
 */
export function toChatMessage(value: unknown): ChatMessage | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;

  const { id, content, mine, at, blocked, nonce } = value;
  if (typeof id !== 'string' || id.length === 0 || id.length > ID_MAX)
    return undefined;
  if (typeof content !== 'string' || content.length > CONTENT_MAX)
    return undefined;
  if (typeof mine !== 'boolean' || typeof blocked !== 'boolean')
    return undefined;
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)))
    return undefined;

  const file = toFile(value.file);
  if (file === undefined) return undefined;
  // a message is text, a file, or both
  if (content.trim().length === 0 && !file) return undefined;

  if (
    nonce !== undefined &&
    (typeof nonce !== 'string' ||
      nonce.length === 0 ||
      nonce.length > NONCE_MAX)
  )
    return undefined;

  return {
    id,
    content,
    mine,
    at,
    file,
    blocked,
    ...(nonce !== undefined ? { nonce } : {}),
  };
}

/**
 * the internal delivery body, or null when it's malformed or delivers to nobody
 * @param body the request body from next.js
 */
export function toChatDelivery(body: unknown): ChatDelivery | null {
  if (!isRecord(body)) return null;
  if (typeof body.mid !== 'string' || !MID_PATTERN.test(body.mid)) return null;

  const client = toChatMessage(body.client);
  const owner = toChatMessage(body.owner);
  if (client === undefined || owner === undefined) return null;
  if (!client && !owner) return null;

  return { mid: body.mid, client, owner };
}

/**
 * the internal refresh body, or null when it's malformed
 * @param body the request body from next.js
 */
export function toChatRefresh(body: unknown): ChatRefresh | null {
  if (!isRecord(body)) return null;
  if (typeof body.mid !== 'string' || !MID_PATTERN.test(body.mid)) return null;
  if (body.side !== 'USER' && body.side !== 'OWNER') return null;

  return { mid: body.mid, side: body.side };
}
