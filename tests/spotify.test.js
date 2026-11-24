const test = require('node:test');
const assert = require('node:assert');
const { CORE, START, load, response, watch, never } = require('./helpers');

const store = () => ({ 'deck.tokens': { access_token: 'acc', refresh_token: 'ref', expires_at: START + 24 * 3600 * 1000, login_at: START } });
const SEC = 1000, MIN = 60 * SEC;
const quota = () => response(429, { error: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' } });

async function run(c, promise) { const w = watch(promise); await c.clock.advance(0); return w; }

test('a request that never answers times out', async () => {
  const c = load(CORE, { store: store(), fetch: never });
  const w = watch(c.Spotify.getPlayer());
  await c.clock.advance(16 * SEC);
  assert.equal(w.error.status, 0);
});

test('finding 1: a body that never arrives times out', async () => {
  const c = load(CORE, {
    store: store(),
    fetch: async () => Object.assign(response(200, {}), { text: never })
  });
  const w = watch(c.Spotify.getPlayer());
  await c.clock.advance(16 * SEC);
  assert.equal(w.state, 'rejected');
  assert.equal(w.error.status, 0);
});

test('a 401 refreshes once and retries', async () => {
  let n = 0;
  const c = load(CORE, {
    store: store(),
    fetch: async (url) => {
      if (/api\/token/.test(url)) return response(200, { access_token: 'new', expires_in: 3600 });
      return ++n === 1 ? response(401, {}) : response(200, { is_playing: true });
    }
  });
  const w = await run(c, c.Spotify.getPlayer());
  assert.equal(w.value.is_playing, true);
  assert.equal(n, 2);
});

test('429: obeys Retry-After when it can be read', async () => {
  const c = load(CORE, { store: store(), fetch: async () => response(429, {}, { 'retry-after': '40' }) });
  const w = await run(c, c.Spotify.getPlayer());
  assert.equal(w.error.retryAfter, 40);
});

test('finding 2: unreadable Retry-After backs off further each time, then resets', async () => {
  let status = 429;
  const c = load(CORE, { store: store(), fetch: async () => response(status, {}) });
  const waits = [];
  for (let i = 0; i < 9; i++) {
    const w = await run(c, c.Spotify.getPlayer());
    waits.push(w.error.retryAfter);
    await c.clock.advance(w.error.retryAfter * SEC + 1);
  }
  assert.deepEqual(waits.slice(0, 4), [5, 10, 20, 40]);
  assert.equal(waits[8], 300);
  status = 200;
  assert.equal((await run(c, c.Spotify.getPlayer())).state, 'resolved');
  status = 429;
  assert.equal((await run(c, c.Spotify.getPlayer())).error.retryAfter, 5);
});

test('finding 2: a reload keeps the block', async () => {
  const a = load(CORE, { store: store(), fetch: async () => response(429, {}, { 'retry-after': '600' }) });
  await run(a, a.Spotify.getPlayer());
  const saved = Object.fromEntries(Object.entries(a.dump()).map(([k, v]) => [k, JSON.parse(v)]));
  const b = load(CORE, { store: saved, fetch: async () => response(200, {}) });
  const w = await run(b, b.Spotify.getPlayer());
  assert.equal(w.error.status, 429);
  assert.equal(b.calls.length, 0);
});

test('finding 3: a search quota does not stop polling or other calls', async () => {
  const c = load(CORE, {
    store: store(),
    fetch: async (url) => (/\/search/.test(url) ? quota() : response(200, {}))
  });
  const s = await run(c, c.Spotify.search('x', 'track'));
  assert.equal(s.error.reason, 'QUOTA_EXCEEDED');
  assert.equal(s.error.retryAfter, 60);
  assert.equal((await run(c, c.Spotify.getPlayer())).state, 'resolved');
  assert.equal((await run(c, c.Spotify.pause())).state, 'resolved');
  const before = c.calls.length;
  assert.equal((await run(c, c.Spotify.search('x', 'track'))).error.reason, 'QUOTA_EXCEEDED');
  assert.equal(c.calls.length, before, 'blocked without a request');
});

test('a polling quota leaves the controls working and tops out at 30 min', async () => {
  const c = load(CORE, {
    store: store(),
    fetch: async (url, o) => (o.method === 'GET' ? quota() : response(204))
  });
  let last;
  for (let i = 0; i < 8; i++) {
    last = (await run(c, c.Spotify.getPlayer())).error.retryAfter;
    assert.equal((await run(c, c.Spotify.next())).state, 'resolved');
    await c.clock.advance(last * SEC + 1);
  }
  assert.equal(last, 30 * 60);
});

test('a success already in flight does not lift a newer block', async () => {
  let slow;
  const c = load(CORE, {
    store: store(),
    fetch: (url) => (/devices/.test(url) ? new Promise((r) => { slow = r; }) : Promise.resolve(response(429, {}, { 'retry-after': '60' })))
  });
  watch(c.Spotify.getDevices());
  await c.clock.advance(10);
  await run(c, c.Spotify.getPlayer());
  slow(response(200, {}));
  await c.clock.advance(0);
  assert.equal((await run(c, c.Spotify.getPlayer())).error.status, 429);
});

test('errors carry Spotify’s reason', async () => {
  const c = load(CORE, {
    store: store(),
    fetch: async () => response(404, { error: { status: 404, message: 'Device not found', reason: 'NO_ACTIVE_DEVICE' } })
  });
  const w = await run(c, c.Spotify.play());
  assert.equal(w.error.status, 404);
  assert.equal(w.error.reason, 'NO_ACTIVE_DEVICE');
});
