/**
 * end-to-end check of instant presence on a running realtime server: consultant-online (ack and
 * the app's no-ack emit), a double emit from one socket, /internal/consultant-busy (guard and
 * body checks), instant-booked, instant-busy, a second booking that ends sooner, the busy
 * expiry, disconnects, and the rate limit keyed on x-forwarded-for (local servers, or any server
 * with --rate-limit).
 *
 * run from the repo root, in any terminal (cmd, powershell, bash), after npm install:
 *   node scripts/realtime-busy-test.js https://realtime.shwerni.sa
 *   node scripts/realtime-busy-test.js http://127.0.0.1:4000
 *   node scripts/realtime-busy-test.js https://realtime.shwerni.sa --rate-limit
 *
 * the server address is required. --rate-limit runs the rate-limit check against a server that
 * isn't local too: it uses up this machine's connections for the minute, so the server refuses
 * every connection from your ip (the site, the app, anyone sharing it) for about a minute.
 * without it, that check runs only against 127.0.0.1 / localhost. the secrets come from the repo's .env
 * (REALTIME_JWT_SECRET signs the test tokens, INTERNAL_SHARED_SECRET is the x-internal-secret for
 * /internal/*); a variable already set in the terminal wins over .env. they must match the
 * server under test. the values are never printed, and never belong in this file.
 *
 * against production it uses throwaway test-owner-<uuid> ids, but each run blocks that test id
 * for about 6 seconds and sends presence-changed to every connected client. exits 1 on any failure
 */
const crypto = require('crypto');
const path = require('path');
const { io } = require('socket.io-client');

function stop(message) {
  console.error(message);
  process.exit(1);
}

const USAGE =
  'usage: node scripts/realtime-busy-test.js <server url> [--rate-limit]\n' +
  '  e.g. node scripts/realtime-busy-test.js https://realtime.shwerni.sa';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));

const unknown = flags.filter((f) => f !== '--rate-limit');
if (unknown.length) stop(`unknown option ${unknown.join(' ')}.\n${USAGE}`);
const RATE_LIMIT_FLAG = flags.includes('--rate-limit');

// the server under test: never guessed, a typo must not hit another server
if (positional.length === 0) stop(`no server address given.\n${USAGE}`);
if (positional.length > 1) stop(`one server address only.\n${USAGE}`);
let BASE;
try {
  const url = new URL(positional[0]);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
  BASE = url.origin;
} catch {
  stop(`"${positional[0]}" isn't an http(s) address.\n${USAGE}`);
}
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(BASE);

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

// an HS256 token the server's verifyRealtimeToken accepts, valid for 60s
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(userId, role) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256' })}.${b64({ userId, role, iat: now, exp: now + 60 })}`;
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
}

function connect(userId, role) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, {
      auth: { token: token(userId, role) },
      transports: ['websocket'],
    });
    // let the server finish its async token check before the first emit
    s.once('connect', () => setTimeout(() => resolve(s), 300));
    s.once('connect_error', reject);
  });
}

// the guarded list (the public /presence/online is going away)
async function onlineIds() {
  const res = await fetch(`${BASE}/internal/presence/online`, {
    headers: { 'x-internal-secret': INTERNAL },
  });
  if (!res.ok) stop(`/internal/presence/online answered ${res.status}: check INTERNAL_SHARED_SECRET`);
  return (await res.json()).onlineIds;
}

async function busy(body, secret = INTERNAL) {
  const res = await fetch(`${BASE}/internal/consultant-busy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const timeout = (promise, ms = 2000) =>
  Promise.race([promise, wait(ms).then(() => null)]);

// a guest connection with extra handshake headers: refused = the server dropped it
function probe(headers) {
  return new Promise((resolve) => {
    const s = io(BASE, {
      auth: { token: token(`guest:${crypto.randomUUID()}`, 'GUEST') },
      transports: ['websocket'],
      extraHeaders: headers,
      reconnection: false,
    });
    s.once('connect_error', () => resolve({ s, refused: true }));
    s.once('disconnect', () => resolve({ s, refused: true }));
    s.once('connect', () =>
      setTimeout(() => resolve({ s, refused: !s.connected }), 300),
    );
  });
}

(async () => {
  if (RATE_LIMIT_FLAG && !LOCAL) {
    console.warn(
      `WARNING  --rate-limit against ${BASE}: at the end of this run that server refuses\n` +
        '         every new connection from your ip for about a minute (this site, the app, and\n' +
        '         anyone sharing your connection). ctrl+c within 5 seconds to stop.\n',
    );
    await wait(5_000);
  }

  const owner = `test-owner-${crypto.randomUUID()}`;
  const payload = (busyUntil) => ({
    consultantId: owner,
    orderId: 4242,
    meetingId: 'test-mid',
    meetingUrl: 'https://shwerni.sa/meetings/test-mid?participant=test',
    startsAt: new Date().toISOString(),
    duration: 30,
    busyUntil,
  });

  // 1. online as today, plus the ack
  const ownerSocket = await connect(owner, 'OWNER');
  const guest = await connect(`guest:${crypto.randomUUID()}`, 'GUEST');
  const ack1 = await ownerSocket.timeout(3000).emitWithAck('consultant-online');
  check('consultant-online ack', ack1?.online === true, JSON.stringify(ack1));
  check('listed in /internal/presence/online', (await onlineIds()).includes(owner));

  // live counts over the socket: owners only
  const ownerCounts = await ownerSocket.timeout(3000).emitWithAck('get-presence-counts');
  check('get-presence-counts as OWNER → counts', ownerCounts?.counts?.owners >= 1 && ownerCounts.counts.guests >= 1, JSON.stringify(ownerCounts));
  const guestCounts = await guest.timeout(3000).emitWithAck('get-presence-counts');
  check('get-presence-counts as GUEST → { counts: null }', guestCounts !== null && guestCounts.counts === null, JSON.stringify(guestCounts));

  // 2. a double emit from one socket adds no reference: one disconnect takes it offline
  const doubler = `test-owner-${crypto.randomUUID()}`;
  const doubleSocket = await connect(doubler, 'OWNER');
  const d1 = await doubleSocket.timeout(3000).emitWithAck('consultant-online');
  const d2 = await doubleSocket.timeout(3000).emitWithAck('consultant-online');
  doubleSocket.emit('consultant-online'); // and once more the app's way, no ack
  await wait(300);
  check('double emit: both acks online', d1?.online === true && d2?.online === true);
  check('double emit: listed once', (await onlineIds()).filter((id) => id === doubler).length === 1);
  doubleSocket.disconnect();
  await wait(500);
  check('double emit: offline after one disconnect (no ghost)', !(await onlineIds()).includes(doubler));

  // 3. guard and validation
  check('wrong secret → 401', (await busy(payload(Date.now() + 60_000), 'x'.repeat(INTERNAL.length))).status === 401);
  check('bad body → 400', (await busy({ consultantId: owner })).status === 400);
  check('busyUntil in the past → 400', (await busy(payload(Date.now() - 1))).status === 400);
  check('no secret → 401', (await busy(payload(Date.now() + 60_000), '')).status === 401);
  check('a secret of the same length in more bytes → 401 (not 500)', (await busy(payload(Date.now() + 60_000), 'é'.repeat(INTERNAL.length))).status === 401);
  check('duration the site does not sell → 400', (await busy({ ...payload(Date.now() + 60_000), duration: 40 })).status === 400);
  check('startsAt not a date → 400', (await busy({ ...payload(Date.now() + 60_000), startsAt: 'soon' })).status === 400);
  check('busyUntil more than 4h ahead → 400', (await busy(payload(Date.now() + 5 * 3_600_000))).status === 400);
  check('still listed after refused calls', (await onlineIds()).includes(owner));

  // 4. consultant-busy
  const booked = new Promise((r) => ownerSocket.once('instant-booked', r));
  const changed = new Promise((r) => guest.once('presence-changed', r));
  const busyUntil = Date.now() + 6_000;
  const res = await busy(payload(busyUntil));
  check('consultant-busy → 201 { ok, wasOnline: true }', res.status === 201 && res.json?.ok && res.json?.wasOnline === true, JSON.stringify(res));
  const bookedPayload = await timeout(booked);
  check('owner got instant-booked (no consultantId in it)', bookedPayload?.orderId === 4242 && bookedPayload?.busyUntil === busyUntil && !('consultantId' in bookedPayload), JSON.stringify(bookedPayload));
  const changedPayload = await timeout(changed);
  check('guest got presence-changed online:false', changedPayload?.consultantId === owner && changedPayload?.online === false, JSON.stringify(changedPayload));
  check('not listed after busy', !(await onlineIds()).includes(owner));

  // 5. consultant-online while busy: refused, with ack and instant-busy
  const busyEvt = new Promise((r) => ownerSocket.once('instant-busy', r));
  const ack2 = await ownerSocket.timeout(3000).emitWithAck('consultant-online');
  check('refused ack { online:false, busyUntil }', ack2?.online === false && ack2?.busyUntil === busyUntil, JSON.stringify(ack2));
  const busyPayload = await timeout(busyEvt);
  check('instant-busy received', busyPayload?.orderId === 4242 && busyPayload?.busyUntil === busyUntil, JSON.stringify(busyPayload));
  ownerSocket.emit('consultant-online'); // the app's way: no ack
  await wait(500);
  check('no-ack emit while busy stays offline', !(await onlineIds()).includes(owner));

  // 5b. a second booking that ends sooner keeps the running block
  const booked2 = new Promise((r) => ownerSocket.once('instant-booked', r));
  const res2 = await busy({ ...payload(busyUntil - 2_000), orderId: 4243 });
  check('shorter second booking → 201', res2.status === 201, JSON.stringify(res2));
  const booked2Payload = await timeout(booked2);
  check('its instant-booked carries the running block', booked2Payload?.orderId === 4243 && booked2Payload?.busyUntil === busyUntil, JSON.stringify(booked2Payload));
  const ack2b = await ownerSocket.timeout(3000).emitWithAck('consultant-online');
  check('still refused until the first busyUntil', ack2b?.online === false && ack2b?.busyUntil === busyUntil, JSON.stringify(ack2b));

  // 6. a new connection while busy (reconnect, second tab) is refused too
  const second = await connect(owner, 'OWNER');
  const ack3 = await second.timeout(3000).emitWithAck('consultant-online');
  check('second socket refused while busy', ack3?.online === false, JSON.stringify(ack3));

  // 7. after busyUntil: online again, the app's no-ack emit works as today
  await wait(Math.max(0, busyUntil - Date.now()) + 300);
  second.emit('consultant-online');
  await wait(500);
  check('online again after busyUntil (no-ack emit)', (await onlineIds()).includes(owner));

  // 8. disconnect leaves no ghost
  second.disconnect();
  ownerSocket.disconnect();
  await wait(500);
  check('offline after disconnect', !(await onlineIds()).includes(owner));

  guest.disconnect();

  // 9. the rate limit follows the right-most x-forwarded-for entry
  if (LOCAL) {
    const n = () => Math.floor(Math.random() * 250) + 1;
    const limited = `203.0.113.${n()}`;
    const probes = [];
    for (let i = 0; i < 20; i++)
      probes.push(await probe({ 'x-forwarded-for': `6.6.6.${i}, ${limited}` }));
    check('20 connections from one forwarded ip pass', probes.every((p) => !p.refused));

    const over = await probe({ 'x-forwarded-for': `7.7.7.7, ${limited}` });
    check('the 21st is refused, whatever the left-most entry says', over.refused);

    const other = await probe({ 'x-forwarded-for': `${limited}, 198.51.100.${n()}` });
    check('another right-most ip still connects', !other.refused);

    for (const p of [...probes, over, other]) p.s.disconnect();
  } else if (RATE_LIMIT_FLAG) {
    // behind the load balancer the right-most entry is our real ip, appended by the balancer,
    // so every probe counts against it whatever header we send. this run's earlier
    // connections count too, so the refusal comes at or before the 21st probe
    const probes = [];
    let refusedAt = 0;
    for (let i = 1; i <= 25 && !refusedAt; i++) {
      const p = await probe({});
      probes.push(p);
      if (p.refused) refusedAt = i;
    }
    check('this ip is refused after 20 connections in a minute', refusedAt > 0 && refusedAt <= 21, `refused at probe ${refusedAt || 'none of 25'}`);

    // a faked left-most entry must not reset the count
    const spoofed = await probe({ 'x-forwarded-for': '6.6.6.6' });
    probes.push(spoofed);
    check('a faked x-forwarded-for is still refused', spoofed.refused);

    for (const p of probes) p.s.disconnect();
    console.log('\nyour ip is rate limited on this server for about a minute');
  } else {
    console.log('SKIP  rate limit by x-forwarded-for (not a local server; --rate-limit runs it)');
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
