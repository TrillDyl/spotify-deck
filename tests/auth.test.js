const test = require('node:test');
const assert = require('node:assert');
const { CORE, START, load, response, watch, never } = require('./helpers');

const MIN = 60 * 1000;
const tokens = (over) => Object.assign({ access_token: 'acc', refresh_token: 'ref', expires_at: START + 60 * MIN, login_at: START }, over);

test('a valid token is used without a refresh', async () => {
  const c = load(CORE, { store: { 'deck.tokens': tokens() }, fetch: never });
  const w = watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(0);
  assert.equal(w.value, 'acc');
  assert.equal(c.calls.length, 0);
});

test('refreshes early and saves a rotated refresh token', async () => {
  const c = load(CORE, {
    store: { 'deck.tokens': tokens({ expires_at: START + 2 * MIN }) },
    fetch: async () => response(200, { access_token: 'new', refresh_token: 'ref2', expires_in: 3600 })
  });
  const w = watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(0);
  assert.equal(w.value, 'new');
  assert.equal(c.stored('deck.tokens').refresh_token, 'ref2');
  assert.equal(c.stored('deck.tokens').login_at, START);
});

test('finding 1: a refresh that never answers gives up after 30 s', async () => {
  const c = load(CORE, { store: { 'deck.tokens': tokens({ expires_at: 0 }) }, fetch: never });
  const w = watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(31 * 1000);
  assert.equal(w.state, 'rejected');
  assert.equal(w.error.status, 0);
  assert.ok(c.stored('deck.tokens'), 'still logged in');
});

test('a refresh answered late still saves the rotated token', async () => {
  let answer;
  const c = load(CORE, {
    store: { 'deck.tokens': tokens({ expires_at: 0 }) },
    fetch: () => new Promise((resolve) => { answer = resolve; })
  });
  const w = watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(31 * 1000);
  assert.equal(w.state, 'rejected');
  answer(response(200, { access_token: 'late', refresh_token: 'ref2', expires_in: 3600 }));
  await c.clock.advance(0);
  assert.equal(c.stored('deck.tokens').refresh_token, 'ref2');
});

test('a late refresh never overwrites a newer login', async () => {
  let answer;
  const c = load(CORE, {
    store: { 'deck.tokens': tokens({ expires_at: 0 }) },
    fetch: () => new Promise((resolve) => { answer = resolve; })
  });
  watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(31 * 1000);
  c.DeckAuth.logout();
  answer(response(200, { access_token: 'late', refresh_token: 'ref2', expires_in: 3600 }));
  await c.clock.advance(0);
  assert.equal(c.stored('deck.tokens'), null);
});

test('invalid_grant just after a timed-out refresh waits for the late answer', async () => {
  let first, n = 0;
  const c = load(CORE, {
    store: { 'deck.tokens': tokens({ expires_at: 0 }) },
    fetch: () => (++n === 1 ? new Promise((resolve) => { first = resolve; })
      : Promise.resolve(response(400, { error: 'invalid_grant' })))
  });
  watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(31 * 1000);
  const again = watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(0);
  assert.equal(again.error.status, 0);
  assert.ok(c.stored('deck.tokens'));
  first(response(200, { access_token: 'late', refresh_token: 'ref2', expires_in: 3600 }));
  await c.clock.advance(0);
  const third = watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(0);
  assert.equal(third.value, 'late');
});

test('finding 6: invalid_grant keeps the login until the access token runs out', async () => {
  const c = load(CORE, {
    store: { 'deck.tokens': tokens({ expires_at: START + 4 * MIN }) },
    fetch: async () => response(400, { error: 'invalid_grant' })
  });
  const w = watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(0);
  assert.equal(w.value, 'acc');
  watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(0);
  assert.equal(c.calls.length, 1, 'a dead refresh token is not retried');
  await c.clock.advance(5 * MIN);
  const after = watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(0);
  assert.equal(after.error.code, 'logged_out');
  assert.equal(c.stored('deck.tokens'), null);
});

test('a token endpoint 5xx is not a logout', async () => {
  const c = load(CORE, { store: { 'deck.tokens': tokens({ expires_at: 0 }) }, fetch: async () => response(503, {}) });
  const w = watch(c.DeckAuth.getAccessToken());
  await c.clock.advance(0);
  assert.equal(w.error.status, 503);
  assert.ok(c.stored('deck.tokens'));
});

test('a pairing link is imported once, and never over a working login', async () => {
  const ok = async () => response(200, { access_token: 'new', expires_in: 3600 });
  const c = load(CORE, { fetch: ok, hash: '#pair=abcdefghijklmnopqrstuvwxyz&since=' + START });
  watch(c.DeckAuth.importPairing());
  await c.clock.advance(0);
  assert.equal(c.stored('deck.tokens').access_token, 'new');
  assert.equal(c.stored('deck.tokens').login_at, START);

  const busy = load(CORE, { fetch: ok, hash: '#pair=abcdefghijklmnopqrstuvwxyz', store: { 'deck.tokens': tokens() } });
  watch(busy.DeckAuth.importPairing());
  await busy.clock.advance(0);
  assert.equal(busy.stored('deck.tokens').refresh_token, 'ref');
});

test('the SHA-256 fallback matches the platform', async () => {
  const crypto = require('crypto');
  const c = load(CORE, { fetch: never });
  for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(200)]) {
    const got = Buffer.from(c.DeckAuth._sha256js(new Uint8Array(Buffer.from(s)))).toString('hex');
    assert.equal(got, crypto.createHash('sha256').update(s).digest('hex'));
  }
});
