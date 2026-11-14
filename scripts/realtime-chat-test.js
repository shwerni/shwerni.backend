/**
 * end-to-end check of the app's live chat on a running realtime server: app connections kept out
 * of the counts, chat-join with signed tickets (signature, audience, issuer, expiry, age, user,
 * role, meeting, the app connection only, the room limit), POST /internal/chat-message and
 * /internal/chat-refresh (secret, body, each side's own room), chat-leave and reconnects, and the
 * consultant's "متصل الآن" / "آخر ظهور" (peer-presence, only to a client's joined chat).
 *
 * run from the repo root, in any terminal, after npm install:
 *   node scripts/realtime-chat-test.js http://127.0.0.1:4000
 *
 * the server address is required. the secrets come from the repo's .env (REALTIME_JWT_SECRET
 * signs the test tokens and tickets, INTERNAL_SHARED_SECRET is the x-internal-secret); a variable
 * already set in the terminal wins over .env. they must match the server under test. the values
 * are never printed. it uses throwaway test ids and meeting ids. exits 1 on any failure
 */
const crypto = require('crypto');
const path = require('path');
const { io } = require('socket.io-client');

function stop(message) {
  console.error(message);
  process.exit(1);
}

const USAGE =
  'usage: node scripts/realtime-chat-test.js <server url>\n' +
  '  e.g. node scripts/realtime-chat-test.js http://127.0.0.1:4000';

const args = process.argv.slice(2);
if (args.length !== 1) stop(`one server address, please.\n${USAGE}`);
let BASE;
try {
  const url = new URL(args[0]);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
  BASE = url.origin;
} catch {
  stop(`"${args[0]}" isn't an http(s) address.\n${USAGE}`);
}

// node's own .env loader (node 20.12+): it never overrides a variable already set
const ENV_FILE = path.join(__dirname, '..', '.env');
try {
  process.loadEnvFile(ENV_FILE);
} catch (err) {
  if (err.code !== 'ENOENT') stop(`couldn't read ${ENV_FILE}: ${err.message}`);
}
const JWT_SECRET = process.env.REALTIME_JWT_SECRET;
const INTERNAL = process.env.INTERNAL_SHARED_SECRET;
const missing = [
  !JWT_SECRET && 'REALTIME_JWT_SECRET',
  !INTERNAL && 'INTERNAL_SHARED_SECRET',
].filter(Boolean);
if (missing.length)
  stop(`${missing.join(' and ')} not set: add to ${ENV_FILE} or set in the terminal`);

console.log(`testing ${BASE}\n`);

// ---------- helpers ----------

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

// an HS256 jwt with these claims (iat and exp default to now and now + 60s)
function jwt(claims, { secret = JWT_SECRET, alg = 'HS256' } = {}) {
  const body = `${b64({ alg, typ: 'JWT' })}.${b64({ iat: now(), exp: now() + 60, ...claims })}`;
  if (alg === 'none') return `${body}.`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

// a join ticket as next.js mints it
const ticket = (sub, mid, side, extra = {}, options) =>
  jwt({ sub, mid, side, aud: 'chat-join', iss: 'shwerni-next', ...extra }, options);

// a user's opaque presence key, as next.js computes it for a ticket's peer claim
const peerKey = (userId) =>
  crypto.createHmac('sha256', JWT_SECRET).update(`peer:${userId}`).digest('hex').slice(0, 16);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
}

const opened = [];

// a connection; app = the app's shared socket (auth.purpose "app"). resolves once connected and
// the server has had time to check the token (or null when it refused the connection)
function connect(userId, role, { app = true, token = undefined } = {}) {
  return new Promise((resolve) => {
    const s = io(BASE, {
      auth: { token: token ?? jwt({ userId, role }), ...(app ? { purpose: 'app' } : {}) },
      transports: ['websocket'],
      reconnection: false,
    });
    opened.push(s);
    s.once('connect_error', () => resolve(null));
    s.once('connect', () => setTimeout(() => resolve(s.connected ? s : null), 300));
  });
}

const join = (s, mid, t) => s.timeout(3000).emitWithAck('chat-join', { mid, ticket: t });

// everything a socket receives for an event, from now on
function record(s, event) {
  const got = [];
  s.on(event, (payload) => got.push(payload));
  return got;
}

async function post(route, body, secret = INTERNAL) {
  const res = await fetch(`${BASE}/internal/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret !== null ? { 'x-internal-secret': secret } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function counts() {
  return (await fetch(`${BASE}/presence/counts`)).json();
}

const id = (label) => `test-${label}-${crypto.randomUUID()}`;
const newMid = () => `t${crypto.randomBytes(6).toString('base64url')}`;

const message = (mine, extra = {}) => ({
  id: `cm-${crypto.randomUUID().slice(0, 8)}`,
  content: 'رسالة تجريبية',
  mine,
  at: new Date().toISOString(),
  file: null,
  blocked: false,
  ...extra,
});

// ---------- run ----------

(async () => {
  const clientId = id('client');
  const ownerId = id('owner');
  const mid = newMid();

  // 1. app connections stay out of the counts
  const before = await counts();
  const client = await connect(clientId, 'USER');
  const owner = await connect(ownerId, 'OWNER');
  check('app sockets connect (client and consultant)', !!client && !!owner);
  const after = await counts();
  check('app sockets change no counts', after.owners === before.owners && after.clients === before.clients, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  const ownerOnline = await owner.timeout(3000).emitWithAck('consultant-online');
  check('an app socket is refused consultant-online', ownerOnline?.online === false, JSON.stringify(ownerOnline));

  // 2. join: the right tickets
  check('client joins its side with its ticket', (await join(client, mid, ticket(clientId, mid, 'USER'))).ok === true);
  check('consultant joins its side with its ticket', (await join(owner, mid, ticket(ownerId, mid, 'OWNER'))).ok === true);

  // 3. join: every wrong ticket is refused
  const intruderId = id('intruder');
  const intruder = await connect(intruderId, 'USER');
  const refused = async (label, s, m, t, error = 'invalid') => {
    const ack = await join(s, m, t);
    check(`refused: ${label}`, ack?.ok === false && ack.error === error, JSON.stringify(ack));
  };
  await refused("another user's ticket", intruder, mid, ticket(clientId, mid, 'USER'));
  await refused("the consultant's side with a client ticket", intruder, mid, ticket(intruderId, mid, 'OWNER'));
  await refused('a ticket signed with another secret', intruder, mid, ticket(intruderId, mid, 'USER', {}, { secret: 'not-the-secret' }));
  await refused('alg none', intruder, mid, ticket(intruderId, mid, 'USER', {}, { alg: 'none' }));
  await refused('the attachment audience', intruder, mid, ticket(intruderId, mid, 'USER', { aud: 'chat-attachment' }));
  await refused('no audience (a connection token)', intruder, mid, jwt({ userId: intruderId, role: 'USER', sub: intruderId, mid, side: 'USER', iss: 'shwerni-next' }));
  await refused('another issuer', intruder, mid, ticket(intruderId, mid, 'USER', { iss: 'someone-else' }));
  await refused('an expired ticket', intruder, mid, ticket(intruderId, mid, 'USER', { iat: now() - 300, exp: now() - 120 }), 'expired');
  {
    const ack = await join(intruder, mid, ticket(intruderId, mid, 'USER', { iat: now() - 300, exp: now() + 60 }));
    check('refused: a ticket minted more than 60s ago', ack?.ok === false, JSON.stringify(ack));
  }
  await refused('a ticket for another meeting', intruder, mid, ticket(intruderId, newMid(), 'USER'));
  await refused('no ticket', intruder, mid, undefined);
  const plainClient = await connect(clientId, 'USER', { app: false });
  await refused('a socket that is not the app connection', plainClient, mid, ticket(clientId, mid, 'USER'));
  const chatTicketAsToken = await connect(clientId, 'USER', { token: ticket(clientId, mid, 'USER') });
  check('a join ticket never opens a connection', chatTicketAsToken === null);

  // 4. delivery: each side its own view, nobody else
  const atClient = record(client, 'chat-message');
  const atOwner = record(owner, 'chat-message');
  const atIntruder = record(intruder, 'chat-message');
  const atPlain = record(plainClient, 'chat-message');

  check('no secret → 401', (await post('chat-message', { mid, client: message(true), owner: null }, null)).status === 401);
  check('a wrong secret → 401', (await post('chat-message', { mid, client: message(true), owner: null }, 'x'.repeat(INTERNAL.length))).status === 401);
  check('a bad body → 400', (await post('chat-message', { mid, client: { id: 'x' }, owner: null })).status === 400);
  check('nobody to deliver to → 400', (await post('chat-message', { mid, client: null, owner: null })).status === 400);
  check('an http file url → 400', (await post('chat-message', { mid, client: message(true, { file: { url: 'http://x/a', name: null, type: null } }), owner: null })).status === 400);

  const clientView = message(true, { nonce: 'n-1' });
  const ownerView = { ...clientView, mine: false };
  delete ownerView.nonce;
  const sent = await post('chat-message', { mid, client: clientView, owner: ownerView });
  check('chat-message → 201 { delivered: { client: 1, owner: 1 } }', sent.status === 201 && sent.json?.delivered?.client === 1 && sent.json?.delivered?.owner === 1, JSON.stringify(sent));
  await wait(300);
  check('the client got its view (mine, with its nonce)', atClient.length === 1 && atClient[0].mid === mid && atClient[0].message.mine === true && atClient[0].message.nonce === 'n-1', JSON.stringify(atClient));
  check('the consultant got its view (not mine, no nonce)', atOwner.length === 1 && atOwner[0].message.mine === false && !('nonce' in atOwner[0].message), JSON.stringify(atOwner));
  check('nobody else got it (another user, a non-app socket)', atIntruder.length === 0 && atPlain.length === 0);

  // a blocked client's message: next.js sends the consultant nothing
  const blockedSend = await post('chat-message', { mid, client: message(true), owner: null });
  await wait(300);
  check('a side sent null gets nothing', blockedSend.json?.delivered?.owner === 0 && atOwner.length === 1 && atClient.length === 2, JSON.stringify(blockedSend.json));

  // 5. chat-refresh: one side
  const refreshAtOwner = record(owner, 'chat-refresh');
  const refreshAtClient = record(client, 'chat-refresh');
  check('chat-refresh: a bad side → 400', (await post('chat-refresh', { mid, side: 'ALL' })).status === 400);
  const refreshed = await post('chat-refresh', { mid, side: 'OWNER' });
  await wait(300);
  check('chat-refresh reaches the consultant only', refreshed.json?.delivered === 1 && refreshAtOwner.length === 1 && refreshAtClient.length === 0, JSON.stringify(refreshed.json));

  // 6. leave and reconnect
  await client.timeout(3000).emitWithAck('chat-leave', { mid });
  const afterLeave = await post('chat-message', { mid, client: message(true), owner: message(false) });
  check('after chat-leave the client is no longer delivered to', afterLeave.json?.delivered?.client === 0 && afterLeave.json?.delivered?.owner === 1, JSON.stringify(afterLeave.json));

  owner.disconnect();
  const ownerAgain = await connect(ownerId, 'OWNER');
  const beforeRejoin = await post('chat-message', { mid, client: null, owner: message(false) });
  check('a new connection is in no chat until it joins again', beforeRejoin.json?.delivered?.owner === 0, JSON.stringify(beforeRejoin.json));
  check('it joins again with a fresh ticket', (await join(ownerAgain, mid, ticket(ownerId, mid, 'OWNER'))).ok === true);

  // 7. the room limit
  const busyId = id('busy');
  const busy = await connect(busyId, 'USER');
  let joined = 0;
  for (let i = 0; i < 20; i++) if ((await join(busy, `lim${i}`, ticket(busyId, `lim${i}`, 'USER'))).ok) joined++;
  check('20 chats per socket', joined === 20);
  await refused('the 21st chat', busy, 'lim20', ticket(busyId, 'lim20', 'USER'), 'limit');

  // 8. "متصل الآن" / "آخر ظهور": only a client's chat watches its consultant (D4)
  const consultantId = id('consultant');
  const watcherId = id('watcher');
  const strangerId = id('stranger');
  const pmid = newMid();
  const key = peerKey(consultantId);
  const ticketLastSeen = Date.now() - 3_600_000;

  const watcher = await connect(watcherId, 'USER');
  const stranger = await connect(strangerId, 'USER');
  const atWatcher = record(watcher, 'peer-presence');
  const atStranger = record(stranger, 'peer-presence');

  const ack = await join(watcher, pmid, ticket(watcherId, pmid, 'USER', { peer: key, peerLastSeenAt: ticketLastSeen }));
  check('the join ack has the consultant offline, last seen from the ticket (UserPresence)', ack?.ok && ack.peer?.key === key && ack.peer.online === false && ack.peer.lastSeenAt === ticketLastSeen, JSON.stringify(ack));

  const instantSocket = await connect(consultantId, 'OWNER', { app: false });
  await wait(300);
  check('the consultant\'s instant socket alone changes nothing', atWatcher.length === 0, JSON.stringify(atWatcher));

  const consultantApp = await connect(consultantId, 'OWNER');
  const atConsultant = record(consultantApp, 'peer-presence');
  await wait(300);
  check('the consultant opens the app → the client hears "online"', atWatcher.length === 1 && atWatcher[0].key === key && atWatcher[0].online === true, JSON.stringify(atWatcher));

  const ownerAck = await join(consultantApp, pmid, ticket(consultantId, pmid, 'OWNER', { peer: peerKey(watcherId), peerLastSeenAt: Date.now() }));
  check('the consultant\'s join never watches the client, whatever its ticket says', ownerAck?.ok === true && ownerAck.peer === null, JSON.stringify(ownerAck));

  const secondWatcher = await connect(watcherId, 'USER');
  const lateAck = await join(secondWatcher, pmid, ticket(watcherId, pmid, 'USER', { peer: key }));
  check('a client joining while the consultant has the app open sees "online"', lateAck?.peer?.online === true, JSON.stringify(lateAck));

  // the client's own app coming and going is never announced to the consultant
  const clientAppAgain = await connect(watcherId, 'USER');
  clientAppAgain.disconnect();

  const closedAt = Date.now();
  consultantApp.disconnect();
  await wait(500);
  const offline = atWatcher[1];
  check('the consultant closes the app → the client hears offline, last seen just now', atWatcher.length === 2 && offline?.online === false && Math.abs(offline.lastSeenAt - closedAt) < 5_000, JSON.stringify(atWatcher));
  check('a client that never joined that chat heard nothing', atStranger.length === 0, JSON.stringify(atStranger));
  check('the consultant\'s socket never got a client\'s status', atConsultant.length === 0, JSON.stringify(atConsultant));
  check('no user id in any peer-presence or ack', ![JSON.stringify(atWatcher), JSON.stringify(ack), JSON.stringify(lateAck)].some((text) => text.includes(consultantId) || text.includes(watcherId)));

  const afterClose = await join(stranger, newMid(), ticket(strangerId, 'pm2', 'USER', { peer: key, peerLastSeenAt: ticketLastSeen }));
  check('refused: a ticket for another meeting, even with a peer', afterClose?.ok === false);
  const strangerMid = newMid();
  const memoryAck = await join(stranger, strangerMid, ticket(strangerId, strangerMid, 'USER', { peer: key, peerLastSeenAt: ticketLastSeen }));
  check('after a close, this server\'s last seen beats an older ticket', memoryAck?.peer?.online === false && memoryAck.peer.lastSeenAt === offline?.lastSeenAt, JSON.stringify(memoryAck));
  instantSocket.disconnect();

  for (const s of opened) s.disconnect();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
