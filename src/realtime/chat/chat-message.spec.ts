// utils
import { toChatDelivery, toChatMessage, toChatRefresh } from './chat-message';

const message = {
  id: 'cm1',
  content: 'مرحبا',
  mine: false,
  at: '2026-11-14T10:00:00.000Z',
  file: null,
  blocked: false,
};

describe('toChatMessage', () => {
  it('keeps only the known fields', () => {
    expect(
      toChatMessage({ ...message, sender: 'USER', participant: 'secret' }),
    ).toEqual(message);
  });

  it('keeps a nonce and a file', () => {
    const file = {
      url: 'https://x.ufs.sh/f/a',
      name: 'a.pdf',
      type: 'application/pdf',
    };
    expect(toChatMessage({ ...message, nonce: 'n1', file })).toEqual({
      ...message,
      nonce: 'n1',
      file,
    });
  });

  it('accepts a file-only message', () => {
    expect(
      toChatMessage({
        ...message,
        content: '',
        file: { url: 'https://x.ufs.sh/f/a', name: null, type: null },
      }),
    ).toMatchObject({ content: '' });
  });

  it('null stays null (that side gets nothing)', () => {
    expect(toChatMessage(null)).toBeNull();
  });

  it.each([
    ['no id', { ...message, id: undefined }],
    ['an empty id', { ...message, id: '' }],
    ['an id too long', { ...message, id: 'x'.repeat(65) }],
    ['content too long', { ...message, content: 'x'.repeat(10_001) }],
    ['neither text nor file', { ...message, content: '  ' }],
    ['mine not a boolean', { ...message, mine: 'true' }],
    ['blocked missing', { ...message, blocked: undefined }],
    ['at not a date', { ...message, at: 'now' }],
    [
      'a file over http',
      { ...message, file: { url: 'http://x/a', name: null, type: null } },
    ],
    [
      'a javascript: file url',
      {
        ...message,
        file: { url: 'javascript:alert(1)', name: null, type: null },
      },
    ],
    [
      'a file name too long',
      {
        ...message,
        file: { url: 'https://x/a', name: 'n'.repeat(256), type: null },
      },
    ],
    ['a file with no url', { ...message, file: { name: 'a' } }],
    ['an empty nonce', { ...message, nonce: '' }],
    ['a nonce too long', { ...message, nonce: 'n'.repeat(65) }],
    ['a string', 'hello'],
    ['an array', [message]],
  ])('refuses %s', (_label, value) => {
    expect(toChatMessage(value)).toBeUndefined();
  });
});

describe('toChatDelivery', () => {
  it('accepts one side or both', () => {
    expect(toChatDelivery({ mid: 'm1', client: message, owner: null })).toEqual(
      {
        mid: 'm1',
        client: message,
        owner: null,
      },
    );
    expect(
      toChatDelivery({
        mid: 'm1',
        client: message,
        owner: { ...message, mine: true },
      }),
    ).toMatchObject({ owner: { mine: true } });
  });

  it.each([
    ['nobody to deliver to', { mid: 'm1', client: null, owner: null }],
    ['a missing side (not null)', { mid: 'm1', client: message }],
    [
      'a bad message on one side',
      { mid: 'm1', client: message, owner: { id: 1 } },
    ],
    [
      'a malformed meeting id',
      { mid: 'chat:m1:USER', client: message, owner: null },
    ],
    ['no meeting id', { client: message, owner: null }],
    ['no body', undefined],
  ])('refuses %s', (_label, body) => {
    expect(toChatDelivery(body)).toBeNull();
  });
});

describe('toChatRefresh', () => {
  it('accepts one side', () => {
    expect(toChatRefresh({ mid: 'm1', side: 'OWNER' })).toEqual({
      mid: 'm1',
      side: 'OWNER',
    });
  });

  it.each([
    ['an unknown side', { mid: 'm1', side: 'GUEST' }],
    ['no side', { mid: 'm1' }],
    ['a malformed meeting id', { mid: 'm 1', side: 'USER' }],
  ])('refuses %s', (_label, body) => {
    expect(toChatRefresh(body)).toBeNull();
  });
});
