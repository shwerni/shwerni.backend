# Realtime chat for the app: plan

- **status:** approved by Ziad 2026-11-05, with the decisions in section 9. Step 1a (the security fix, `988bcc5`) is deployed; the rest waits, because the Next.js side has other work first.
- **priority:** the app. The website chat stays as it is (it keeps polling every 7s), but it gains nothing it must change for.
- **repos:** this server (`shwerni.backend`), the main site and mobile API (`shwerni.vercel/shwerni.sa`, "Next.js"), the app (`shwerni.app/shwerni-app`).
- **builds on:** the chat work in the Next.js repo that is still uncommitted (`data/chats.ts`, `lib/notifications/mobile/notify/chat.ts`). It should be committed before this starts.

## 1. How it works today (checked in the code)

### This server

- **Connection:** socket.io. The client sends `auth.token`, a 60s HS256 JWT `{ userId, role }` minted by Next.js (`/api/realtime-token`, `/api/mobile/realtime-token`, `/guest`). `verifyRealtimeToken` accepts any token signed with `REALTIME_JWT_SECRET`, with no audience or type check.
- **Rooms:**
  - every socket joins `public-presence`;
  - OWNER sockets also join `user:{userId}` and `owners`.
  - USER sockets join no personal room. So `instant-response`, which is sent to `user:{clientId}`, never reaches a client today; nothing calls `/internal/instant-request` anyway.
- **Presence:** consultants only (`consultant-online` / `consultant-offline`), counted per socket, held in memory, `busy` blocks, and `presence-changed` broadcasts. Nothing tracks app users who aren't consultants.
- **Next.js → this server:**
  - `POST /internal/*` behind `InternalSecretGuard` (`x-internal-secret`);
  - the model is `lib/api/realtime/consultant-busy.ts`: it runs after the response with `after()`, a 3s timeout, never throws, and alerts Telegram on failure.
- **This server → Next.js:** `notifyPresenceChange`, `notifyInstantSnapshot`.
- **No database here.** Next.js is the only source of truth.
- **Security hole:** `@SubscribeMessage('chat-message')` (`realtime.gateway.ts:328`) lets any connected socket, guests included, broadcast a `chat-message` with any text to any room name, including `user:{id}` and `owners`. Nothing in the app or the website uses it.
- **One instance:** rooms and presence are in memory, with no Redis adapter. Running more than one instance would split them (this is true today for presence too).
- **Rate limit:** per IP, in two buckets: members (USER / OWNER) 20 a minute, guests 120 a minute.

### Next.js

- **One send path:** `createMeetingMessage` (`data/chats.ts`). It:
  1. loads the meeting and its participants;
  2. checks the participant token;
  3. runs `checkMessageWithAI` (OpenAI `gpt-4o-mini`, **no timeout**, fails open);
  4. saves `OrderMessage`;
  5. calls `scheduleChatMessageNotice` (push or WhatsApp, in `after()`).

  It is called by the website server action (`actions/site.ts`) and by the two app routes `POST /api/mobile/chats/{mid}/messages` and `POST /api/mobile/owner/chats/{mid}/messages`.
- **What each side sees:**
  - the client never sees block markers (`clientVisibleMessages`);
  - while the meeting is blocked, the consultant doesn't see the client's messages sent after the latest marker, but does see the markers (`ownerVisibleMessages`);
  - `mine` depends on who reads (`toChatMessage(row, reader)`).
- **The app routes:**
  - `GET` the thread: all messages, oldest first;
  - `POST` messages: text only, 1-2000 characters;
  - `POST` read.
  - Access: the client's own PAID order, or the approved owner's own consultant's PAID order. The 72-hour window is checked on send.
- **Files (website only):** the UploadThing `chatAttachment` route takes an image up to 8MB or a PDF up to 16MB, with a participant-token check. The website action takes `fileUrl` from the browser as is.
- **The app's upload router** (`app/api/uploadthing/mobile/core.ts`): owner profile files only (`ownerImage`, `ownerPdf`), with a session header and a rate limit of 30 an hour.
- **Last seen data already exists:** `UserPresence { userId, lastSeenAt, meetingMid }`, written by the app's heartbeat (`POST /api/mobile/room/presence`) every 20s while the app is in the foreground.
- Read state: `Meeting.clientReadAt` / `ownerReadAt` (`data/chat-read.ts`).

### The app

- **The thread:** `components/shared/chat/chat-thread.tsx`, shared by both sides.
  - It polls `GET {endpoint}` every 7s while focused.
  - Send runs `useApiMutation`, then clears the input on success, then **refetches the whole thread** before the message appears.
  - Text only.
- **The list** polls every 30s; a chat push refreshes the chats (`use-notification-received.ts`).
- **Sockets:** `hooks/realtime/use-realtime-socket.ts` opens **one socket per hook instance**, with a fresh token per attempt, connecting when the app is active and disconnecting in the background. It's used by the online list and the owner's instant presence; there's no socket on the chat screens.
- **Uploads:** already installed and used for owner profile files: `@uploadthing/expo`, `expo-image-picker`, `expo-document-picker`, `expo-image`, `expo-image-manipulator` (`lib/uploads.ts`, `components/shared/file-upload-field.tsx`).

## 2. Rules for this work

- **Next.js stays the only source of truth.** This server never stores messages. It only delivers what Next.js saved, after it saved it.
- **Additive only:**
  - no existing event, route path or response shape changes;
  - request bodies only gain optional fields;
  - the instant flow and its counts behave exactly as today.
- **Polling is the safety net.** Everything works, more slowly, when this server is down.
- **Nothing in the app ever receives another user's id** (the same rule as `toCard` in `/api/mobile/online`).
- **Order of release:** this server first, then Next.js, then the app. Each step works with the previous one.

## 3. Feature 1: live messages

### Flow

```
app (client or consultant)                        Next.js                               realtime server
1. opens a chat ------ GET chats/{mid}/realtime --> checks access, mints a 60s join ticket
2. -------------------------------- chat-join { ticket } ----------------------------------> verifies the ticket,
                                                                                               joins chat:{mid}:{side}
3. sends ------------- POST …/messages -----------> saves (unchanged), then in after():
                                                     POST /internal/chat-message ----------> emits chat-message to
                                                     { mid, client: msg|null,                  chat:{mid}:USER and
                                                       owner: msg|null }                       chat:{mid}:OWNER
4. receives chat-message { mid, message } <------------------------------------------------- (only the rooms named)
```

### Rooms and events (shared contract)

| what | direction | payload |
|---|---|---|
| room `chat:{mid}:USER` / `chat:{mid}:OWNER` | — | one room per meeting and per side, so each side gets its own view (`mine`, blocks) |
| `chat-join` (ack) | app → server | `{ ticket }` → ack `{ ok: true, mid, peer }` or `{ ok: false, error: "expired" \| "invalid" \| "limit" }`. `peer` is part of feature 4 |
| `chat-leave` | app → server | `{ mid }` |
| `chat-message` | server → room | `{ mid, message: ChatMessage }`, where `ChatMessage` is exactly the app's type: `{ id, content, mine, at, file, blocked }`, plus an optional `nonce` on the sender's side |
| `chat-refresh` | server → room | `{ mid }`: refetch the thread (the consultant's side after a block or unblock) |
| `POST /internal/chat-message` | Next.js → server | `{ mid, client: ChatMessage \| null, owner: (ChatMessage & { nonce? }) \| null }` → `{ ok, delivered: { client: n, owner: n } }` |
| `POST /internal/chat-refresh` | Next.js → server | `{ mid, side: "USER" \| "OWNER" }` |

### Realtime server work

- **Remove the open `chat-message` handler** (`realtime.gateway.ts:328-339`) and reuse its name for the server-to-room event. It is unused today, and with chat rooms it would let anyone write fake messages into a chat.
- **`chat-join`:**
  - verify the ticket (`jose`, audience `chat-join`, issuer `shwerni-next`, at most 60s old);
  - require `ticket.sub === socket.data.userId`;
  - require the ticket's side to match the socket's role (USER ↔ USER, OWNER ↔ OWNER);
  - require `mid` to match `^[A-Za-z0-9_-]{1,32}$`;
  - then join `chat:{mid}:{side}`, with at most 20 chat rooms per socket.
- **`chat-leave`:** leave the room. Disconnect leaves every room by itself.
- **The connection token must not accept a chat ticket:** `verifyRealtimeToken` refuses any token with an `aud` and checks `role` ∈ USER / OWNER / GUEST and that `userId` is a string. Today it would accept a chat ticket as a connection token.
- **`POST /internal/chat-message`** (guarded):
  - validate the body: `mid` as above; `content` ≤ 2000; `at` a date; `file` null or `{ url: https…, name ≤ 255, type ≤ 100 }`; `nonce` ≤ 64; 400 otherwise;
  - emit to the side rooms that have a message;
  - **never log content**.
- **`POST /internal/chat-refresh`:** emit `chat-refresh` to one side's room.
- **Tests:** a unit spec for each check (ticket owner, side and role, audience, expiry, room limit, body validation, the content never logged), and an end-to-end script in the style of `scripts/realtime-busy-test.js`.

### Next.js work

- **New ticket routes** (the same access as the thread GET, refused once the chat is closed):
  - `GET /api/mobile/chats/{mid}/realtime`: `requireMobileUser` + `getClientChatMeeting`;
  - `GET /api/mobile/owner/chats/{mid}/realtime`: `requireApprovedOwner` + `getOwnerChatMeeting`.
  - Each returns `{ ticket }`, a 60s JWT signed with `REALTIME_JWT_SECRET` and claims `{ sub, mid, side, aud: "chat-join", iss: "shwerni-next" }` (+ the feature 4 claims).
- **`lib/api/realtime/chat.ts`** (new, modelled on `consultant-busy.ts`): `scheduleChatPublish(meeting, row, nonce?)`. It runs in `after()`, with a 2s timeout and never throws; a failure is only logged, because polling and the push still cover it. It builds each side's view:
  - `client`: `toChatMessage(row, USER)`, or null for a block marker;
  - `owner`: `toChatMessage(row, OWNER)`, or null when the meeting is blocked and a client sent it.
- **`createMeetingMessage`:** call `scheduleChatPublish` after the save, before `scheduleChatMessageNotice`.
  - This covers website sends too, so the app sees website messages live.
  - The website's own page keeps polling, unchanged.
- **`toggleUserBlock`:** after the transaction, `POST /internal/chat-refresh` to the OWNER side only. The client is never told about a block.
- **The two app send routes:** accept an optional `nonce` (≤ 64 characters) and pass it to the sender's side only. The response is unchanged.

### App work

- **One shared socket** while signed in and in the foreground: a `RealtimeProvider` at the signed-in root, built on `use-realtime-socket`, with `auth: { token, purpose: "app" }`.
  - The online list and instant presence keep their own sockets for now, so the instant flow doesn't change. Moving them to the shared socket comes later.
- **`hooks/chat/use-chat-live.ts`** (new). While the chat is focused and the socket is connected:
  1. fetch a ticket and emit `chat-join` with an ack;
  2. on every reconnect, join again with a fresh ticket and refetch the thread once, to catch up on anything missed;
  3. leave on blur.

  Incoming `chat-message` events for this `mid` go into the React Query cache: insert by `id`, keep the order by `at`, and drop duplicates. `chat-refresh` refetches.
- **`chat-thread.tsx`:**
  - `refetchInterval` becomes 7s while not live and 60s while live (a slow safety net in case an event is lost);
  - the push handler keeps refreshing the chat as today;
  - `useChatRead` keeps marking read whenever a newer message shows.

### Database

- None.

### Security

- Only Next.js decides who may join, with the same checks as the thread GET.
- The ticket is bound to the user, the meeting and the side, and lives 60s.
- This server refuses a ticket used on another user's socket or with another role. Tickets and connection tokens can't be swapped, because of the audience check both ways.
- Only Next.js (via the internal secret) can put a message in a room. No client event writes to a room once the old handler is removed.
- Block rules are applied in Next.js before delivery, in the same way as the thread GET.

### Risks

- **An event is lost** (this server restarts, the Next.js call fails or times out). Covered by the catch-up on join, the 60s safety poll and the push. A message is never lost, only late.
- **Redeploys:** every push to `main` restarts this server, and every app reconnects and joins again. That's a short burst of ticket requests on Vercel.
- **More than one instance would break the rooms.** The code assumes one instance (I couldn't check Mau's setting from here). If it ever runs more, the socket.io Redis adapter becomes required (this is true for presence too).

## 4. Feature 2: faster send

### Measure first

- **Next.js:** time each stage of the two app send routes and write them to one log line and a `Server-Timing` header:
  - `auth` (better-auth session);
  - `access` (`getClient/OwnerChatMeeting`, which loads **every message** of the meeting just to check access);
  - `participant` (the extra lookup);
  - `meeting` (the lookup inside `createMeetingMessage`);
  - `ai` (OpenAI);
  - `insert`;
  - `total`.

  Example: `[chat-send] mid=… total=1840 auth=120 access=95 participant=30 meeting=40 ai=1420 insert=35`.
- **App (dev only):** log the time from tap to the POST resolving, and from the POST to the refetched thread.
- **Collect about 50 production sends** from the Vercel logs, then decide using the numbers.
- **Expected suspects:**
  1. the OpenAI call (usually 0.4-1.5s, with spikes of several seconds, and no timeout);
  2. the thread refetch after every send (a second round trip before the bubble appears);
  3. several sequential database calls, including loading every message for an access check;
  4. Vercel cold starts.

### Fixes, by size

1. **App, the biggest perceived gain:** show the bubble at once.
   - On send, add an optimistic message (`id: "local-…"`, a `nonce`, `status: "sending"`) with a small clock and "جارٍ الإرسال". Clear the input at once.
   - On success, replace it with the returned `message` (the route already returns it) using `setQueryData`, and **stop refetching the whole thread**.
   - If the socket echo arrives first, the `nonce` matches it and the bubble is replaced instead of shown twice.
   - On failure, keep the bubble in red with the reason ("لم يتم الإرسال" + the server's message, e.g. the contact-details refusal), with retry and delete. The text is never lost.
2. **Next.js app routes:** check access with a light query (no messages) that also returns the participant token. That's one query instead of three.
3. **Next.js `createMeetingMessage`:** start the AI check in parallel with the meeting lookup. Same result, the delays overlap; this helps the website too.
4. **Next.js AI check:**
   - a **3s timeout**, failing open as it does today on any error;
   - a **local pre-check** before the AI: digit runs (Arabic-Indic digits normalized), URLs and domains, emails, `@` handles, and the words واتس / تلجرام / سناب / انستا. When it matches, refuse at once and skip the AI (faster and cheaper).
   - Whether a message the pre-check passes still goes to the AI is **decision D2**.
5. **Retry safety (optional, needs a database change):** a retried send after a timeout can save a message twice. An optional `OrderMessage.clientNonce String? @unique` would let the route return the existing message for a repeated nonce. That's **decision D3**.

### Security

- The AI rule doesn't change unless D2 says so.
- The optimistic bubble is local only. The other side sees a message only after the server saved it and passed every check.

### Risks

- The pre-check can refuse harmless messages (e.g. a session number). Keep it to digit runs of 7 or more and to clear URLs.
- `createMeetingMessage` is shared with the website. Fixes 3 and 4 change its speed, not its results, unless D2 changes the rule.

## 5. Feature 3: images and files in the app

### Start from the website (Ziad, 2026-11-09)

The website chat already sends images and files in production. Build the app's version by replicating the website's, and improve only where it makes the app faster or simpler. Read these first:

- **upload and validation:** UploadThing `chatAttachment` in `app/api/uploadthing/core.ts` (image up to 8MB, PDF up to 16MB, one file, the uploader must be a participant of the meeting);
- **send:** `components/clients/chats/chat.tsx` uploads first (`startUpload` with `{ mid, participant }`), then calls `createMeetingMessage` with `fileUrl` (`ufsUrl`), `fileType` and `fileName`;
- **storage:** the file stays in UploadThing; `OrderMessage` keeps only `fileUrl`, `fileType` and `fileName`;
- **display:** `components/clients/chats/bubble.tsx`, `attachment-preview.tsx` (before sending) and `file-preview.tsx` (in the thread).

Where the plan below departs from the website, and why:

- **Faster:** photos are resized to 1080px JPEG before upload (`pickPhoto`, already in the app).
- **Simpler:** the app's session replaces the participant token; the app never handles participant tokens.
- **Safer, not faster or simpler:** the send route takes a signed attachment token instead of a raw `fileUrl`. On the website a browser can send any URL as `fileUrl`. Confirm this departure when feature 3 starts, or replicate the website's raw `fileUrl`.

### Next.js work

- **Upload route** `chatAttachment` in `app/api/uploadthing/mobile/core.ts`:
  - **types and sizes:** the same as the website (image up to 8MB, PDF up to 16MB, one file);
  - **input:** `{ mid }`;
  - **middleware:**
    - `requireMobileUser`; for an OWNER, also `requireApprovedOwner`;
    - access by side: `getClientChatMeeting(user.id, mid)` or `getOwnerChatMeeting(cid, mid)`;
    - the chat must not be closed;
    - a rate limit of `chat.upload:{userId}`, 30 an hour.
  - **`onUploadComplete`** returns `{ url, name, type, attachment }`. `attachment` is a JWT, valid 30 minutes and signed with `REALTIME_JWT_SECRET`, with audience `chat-attachment` and `{ sub: userId, mid, url, name, type }`.
- **The two app send routes:**
  - accept `{ content?, attachment?, nonce? }`, with content or attachment required;
  - `content` keeps its 2000 limit;
  - verify `attachment` (audience, expiry, `sub` = this user, `mid` = this chat), then pass `fileUrl/fileType/fileName` from the token to `createMeetingMessage`.
  - The app never sends a raw URL, so nobody can attach a file they didn't upload to this chat.
  - Existing text-only requests stay valid.
- **No change to the website router or the website action.** Website backlog note: the website action takes `fileUrl` from the browser unchecked.

### App work

- **Composer:** a paperclip button (the owner design already shows one) opening a small sheet:
  - "صورة" (`pickPhoto`, already resized to 1080px JPEG);
  - "ملف PDF" (`pickPdf`);
  - camera capture is optional (decision D5: it needs camera permission text).
- **Upload with `useUploadThing("chatAttachment")`** and `uploadHeaders`:
  - a "sending" bubble shows a local preview and a progress bar, with cancel;
  - when it finishes, `POST messages { attachment, content?, nonce }`, the same as a text send.
  - Failures use the toast wording of `file-upload-field.tsx`.
- **`message-bubble.tsx`:**
  - an image (`file.type` starts with `image/`) shows as a thumbnail (`expo-image`, rounded, at most 220px), and a tap opens a full-screen viewer;
  - a PDF keeps the current row with the icon and name, and opens in the browser.
- **The client side gets the paperclip too** (the spec said text only; this feature changes that).

### Database

- None. The attachment token replaces any server-side upload log.

### Security

- Access to the upload is the same as to sending in that chat; closed chats can't upload.
- Only files this user uploaded to this meeting in the last 30 minutes can be attached.
- UploadThing checks type and size on the server.
- Rate limited per user.
- File URLs are unguessable but public by URL, the same as the website's files today.

### Risks

- **Files uploaded but never sent** stay in storage. They're few, because of the rate limit; a cleanup can come later (decision D6).
- **Large PDFs on mobile data:** show the size before upload, and allow cancel.

## 6. Feature 4: "متصل الآن" / "آخر ظهور …" in the chat header

### Meaning

- **"متصل الآن":** the other side has the app open in the foreground. That's at least one shared app socket (feature 1), since the app disconnects in the background, as it does today.
- **"آخر ظهور …":** when their last app socket closed. If this server doesn't know (after a restart, or they haven't connected since), it uses `UserPresence.lastSeenAt` from the existing heartbeat, which is accurate to about 20s.
- **Website-only users** have no socket and no heartbeat, so nothing is shown. That's better than a wrong "offline".

### Realtime server work

- **Track app users:** a count of open `purpose: "app"` sockets per `userId` (USER and OWNER), and `lastSeen` per user, set when the count drops to 0.
  - Both maps are in memory.
  - `lastSeen` entries older than 7 days are dropped once an hour.
- **Peers are known only by an opaque key:** `peerKey = HMAC-SHA256(REALTIME_JWT_SECRET, "peer:" + userId)`, first 16 hex characters. Next.js computes the same key and puts it in the join ticket, so the app never sees a user id.
- **On `chat-join`:** the socket also joins `watch:{peerKey}`. The ack has `peer: { key, online, lastSeenAt }`, where `lastSeenAt` is the later of this server's value and the ticket's `peerLastSeenAt`.
- **When a user's app sockets go 0 → 1 or 1 → 0:** emit `peer-presence { key, online, lastSeenAt }` to `watch:{key}`.
- **Killed apps:** a phone that drops off without closing is noticed at the ping timeout, about 45s later. `lastSeenAt` is then the last pong time, not the timeout time.
- **The existing counts stay as they are:** `purpose: "app"` sockets don't join `public-presence` or `owners`, aren't counted in `getConnectionCounts`, and don't call `notifyInstantSnapshot`. Otherwise every open app would change "مستشارون متصلون" / "عملاء متواجدون" and add a Next.js call per connection.

### Next.js work

- The ticket routes add `peer` (the other side's `peerKey`) and `peerLastSeenAt` (their `UserPresence.lastSeenAt`, or null) to the ticket:
  - for a client, the peer is `consultant.userId`;
  - for a consultant, the peer is `order.author`;
  - there's no peer when the consultant has no user (a center consultant) or the author isn't a real user.
- `peerKey` is computed with the same HMAC as this server.

### App work

- **The header** (`ScreenHeader` in `chat-thread.tsx`) gets a second line under the name:
  - a green dot + "متصل الآن";
  - or "آخر ظهور اليوم ٣:٢٠ م" / "آخر ظهور أمس ٩:١٠ م" / "آخر ظهور ٢ نوفمبر", in Riyadh time with `time24ToArabic12`;
  - nothing when unknown, or while this app's own socket is down.
- It listens to `peer-presence` for its `key`.

### Database

- None. `UserPresence` and the 20s heartbeat already exist.

### Security and privacy

- No user ids reach the app; only the HMAC key and times.
- Only a socket joined to that chat learns its peer's state.
- **Who sees whose last seen is decision D4** (a client may not want the consultant to see it, or the other way round).

### Risks

- **Accuracy:** a phone that loses its network shows "متصل الآن" for up to about 45s.
- **Memory:** bounded by connected users plus 7 days of `lastSeen`.

## 7. Shared work and fixes this needs

| # | where | what | why |
|---|---|---|---|
| S1 | realtime server | remove the open `chat-message` handler | anyone could inject chat messages (see 1) |
| S2 | realtime server | `verifyRealtimeToken` refuses tokens with `aud`, checks `role` and `userId` | chat and attachment tickets must not open connections |
| S3 | realtime server | member rate limit per **user id** (after the token check), plus a high per-IP ceiling | one app socket per open app, many app users behind one carrier IP (CGNAT): 20 a minute per IP would refuse real users |
| S4 | realtime server | `purpose: "app"` sockets stay out of the instant rooms, counts and snapshots | keeps the consultant dashboard numbers and the Next.js load as they are |
| S5 | realtime server | (later, separate) the `instant-response` handler accepts any socket's answer for any order | not used today; remove or guard it before it is ever used |

## 8. Order of work

Each step is shippable alone and changes nothing for the users of the previous one.

1. **Realtime server, in two pushes:**
   - **1a, the live security fix, deployed first on its own:** S1 (the open `chat-message` handler removed) and S2 (connection tokens refuse an audience, an unknown role or a missing user id). Built 2026-11-05 (`988bcc5`), deployed 2026-11-09.
   - **1b:** S3, S4, `chat-join` / `chat-leave`, the internal chat routes, peer presence, tests, and the end-to-end script. Nothing calls the new parts yet.
2. **Next.js A:** the send timing logs (feature 2, measure), the AI timeout, and running the AI in parallel. Measure for a few days.
3. **Next.js B:** the ticket routes, `scheduleChatPublish` in `createMeetingMessage`, the refresh after a block, and `nonce`. The app keeps polling until step 4.
4. **App A:** the shared socket, `use-chat-live`, the optimistic send with `setQueryData`, and the slower poll while live.
5. **Next.js C + App B:** the chat upload route, the attachment on send, then the paperclip, the bubbles and the viewer.
6. **App C:** the header presence line.
7. **Then, using the step 2 numbers:** the AI pre-check (D2) and the retry nonce column (D3).

## 9. Decisions

**Ziad's answers (2026-11-05):**

- **D1:** one room per meeting and side, joined with a ticket.
- **D2:** the AI checks every message, with a 3s timeout.
  - A local phone-number pre-check runs as well; a message it flags is refused at once.
  - When the AI times out, the message is accepted if the pre-check passed it.
  - Any other AI error fails open, as today.
- **D3:** yes, the duplicate guard: `OrderMessage.clientNonce String? @unique` (a migration).
- **D4:** only the client sees the consultant's status ("متصل الآن" and last seen). The consultant sees nothing about the client. So the owner ticket carries no peer, and the client ticket carries the consultant as its peer.
- **D5:** camera later.
- **D6:** cleanup later.
- **D7:** yes, as a follow-up after feature 1.

The options as they were put:

- **D1.** Rooms per meeting and per side, joined with a ticket (as asked, and as planned here). The alternative is delivering to each user's own `user:{id}` room with no join step: simpler, and it also updates the chat list live, but there's no "this chat is open" signal for feature 4. **Recommended: per-meeting rooms as planned.**
- **D2.** The AI check. A message the local pre-check passes: (a) always goes to the AI, as today (safe, about 1s slower), or (b) goes to the AI only when it has digits, Latin letters or Arabic number words. **Recommended: (a) until the step 2 numbers show the AI is the main cost.**
- **D3.** The retry-safety column `OrderMessage.clientNonce` (a database migration): yes or no.
- **D4.** Last seen: (a) both sides see each other's, (b) only the client sees the consultant's, or (c) only "متصل الآن", with no last seen. **Recommended: (b)**, because the consultant's availability matters to the client, and a client's habits aren't the consultant's business.
- **D5.** Camera capture in the attachment sheet (needs the camera permission text in `app.json`): now or later.
- **D6.** Cleaning up files uploaded but never sent: later, or never.
- **D7.** Live updates for the chat **list** (unread badges and last message without the 30s poll): out of scope now, or a small follow-up (USER sockets also join `user:{id}`, plus a `chat-activity { mid }` event).

## 10. Out of scope

- The website chat: it keeps polling and gets no socket. It does benefit from fixes 3 and 4 in feature 2, and its messages reach the app live.
- Typing indicators, read ticks, replying from the notification (the spec's decision stands), and pleading-case chats (`OrderMessage.pleadingId`).
- Moving the online list and instant presence onto the shared socket.
