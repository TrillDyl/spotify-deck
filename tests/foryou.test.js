const test = require('node:test');
const assert = require('node:assert');
const { CORE, START, load, response, watch } = require('./helpers');

const MIN = 60 * 1000;
const FILES = CORE.concat('js/foryou.js');
const store = () => ({ 'deck.tokens': { access_token: 'acc', refresh_token: 'ref', expires_at: START + 24 * 60 * MIN, login_at: START } });
const song = (n) => ({ uri: 'spotify:track:' + n, name: 'S' + n, artists: [{ name: 'Artist ' + n }], album: { images: [{ url: 'big' }, { url: 'small' + n }] } });
const playing = (uri, n = 1) => ({ is_playing: true, item: song(n), context: { uri } });
const mix = (n) => 'spotify:playlist:37i9dQZF1E' + n;
const no = async () => response(404);
const names = (c) => Array.from(c.ForYou.mixes(), (m) => m.name);

test('remembers playlists Spotify makes, and nothing else', async () => {
  const c = load(FILES, { fetch: no });
  ['spotify:playlist:5abc', 'spotify:album:37i9dQZF1E', 'spotify:artist:1', ''].forEach((u) => c.ForYou.see(playing(u)));
  c.ForYou.see(null);
  c.ForYou.see({ is_playing: true, item: song(1) });
  c.ForYou.see(Object.assign(playing(mix('a')), { is_playing: false }));
  assert.equal(c.ForYou.mixes().length, 0);
  c.ForYou.see(playing(mix('a')));
  c.ForYou.see(playing('spotify:user:spotify:playlist:37i9dQZEVXcb', 2));
  assert.deepEqual(Array.from(c.ForYou.mixes(), (m) => m.uri).sort(), [mix('a'), 'spotify:playlist:37i9dQZEVXcb'].sort());
});

test('a mix takes its real name and cover when Spotify gives them', async () => {
  const c = load(FILES, { fetch: async () => response(200, { title: 'Discover Weekly', thumbnail_url: 'cover' }) });
  c.ForYou.see(playing(mix('a')));
  await c.clock.advance(0);
  assert.deepEqual(names(c), ['Discover Weekly']);
  assert.equal(c.stored('deck.mixes')[0].cover, 'cover');
  assert.match(c.calls[0].url, /oembed\?url=spotify%3Aplaylist%3A37i9/);
  assert.equal(c.calls[0].opts.headers, undefined, 'no login is sent');
});

test('without a name, a mix is called after an artist in it', async () => {
  const c = load(FILES, { fetch: no });
  c.ForYou.see(playing(mix('a'), 7));
  await c.clock.advance(0);
  assert.deepEqual(names(c), ['Mix with Artist 7']);
  assert.equal(c.ForYou.mixes()[0].songArt, 'small7');
});

test('polls don’t write or look it up again', async () => {
  const c = load(FILES, { fetch: no });
  for (let i = 0; i < 100; i++) { c.ForYou.see(playing(mix('a'), i)); await c.clock.advance(3000); }
  assert.equal(c.ForYou.mixes().length, 1);
  assert.equal(c.calls.length, 1);
});

test('a lookup with no network is tried again later', async () => {
  let up = false;
  const c = load(FILES, { fetch: async () => { if (!up) throw new Error('offline'); return response(200, { title: 'Daily Mix 1' }); } });
  c.ForYou.see(playing(mix('a')));
  await c.clock.advance(11 * MIN);
  up = true;
  c.ForYou.see(playing(mix('a')));
  await c.clock.advance(0);
  assert.deepEqual(names(c), ['Daily Mix 1']);
});

test('your own name sticks, even over a late lookup', async () => {
  let answer;
  const c = load(FILES, { fetch: () => new Promise((r) => { answer = r; }) });
  c.ForYou.see(playing(mix('a')));
  c.ForYou.rename('37i9dQZF1Ea', 'Gym');
  answer(response(200, { title: 'Daily Mix 1', thumbnail_url: 'cover' }));
  await c.clock.advance(0);
  assert.deepEqual(names(c), ['Gym']);
  assert.equal(c.ForYou.mixes()[0].cover, 'cover');
});

test('last played first, at most 24, and forgetting works', async () => {
  const c = load(FILES, { fetch: no });
  for (let i = 0; i < 30; i++) { c.ForYou.see(playing(mix('m' + i), i)); await c.clock.advance(MIN); }
  assert.equal(c.ForYou.mixes().length, 24);
  assert.equal(names(c)[0], 'Mix with Artist 29');
  c.ForYou.see(playing(mix('m20')));
  assert.equal(c.ForYou.mixes()[0].id, '37i9dQZF1Em20');
  c.ForYou.forget('37i9dQZF1Em20');
  assert.equal(c.ForYou.mixes().length, 23);
  assert.equal(c.stored('deck.mixes').length, 23);
});

test('mixes survive a reload', async () => {
  const a = load(FILES, { fetch: no });
  a.ForYou.see(playing(mix('a'), 3));
  const b = load(FILES, { fetch: no, store: { 'deck.mixes': a.stored('deck.mixes') } });
  assert.deepEqual(names(b), ['Mix with Artist 3']);
});

test('recently played lists each song once and picks up mixes', async () => {
  const at = (m) => new Date(START - m * MIN).toISOString();
  const c = load(FILES, { store: store(), fetch: async (url) => (/recently/.test(url) ? response(200, { items: [
    { track: song(1), played_at: at(5), context: { uri: mix('a') } }, { track: song(2), played_at: at(9), context: null },
    { track: song(1), played_at: at(12), context: { uri: mix('b') } }, { track: null }
  ] }) : response(404)) });
  const w = watch(c.ForYou.load('recent'));
  await c.clock.advance(0);
  assert.deepEqual(Array.from(w.value, (t) => t.name), ['S1', 'S2']);
  assert.deepEqual(Array.from(c.ForYou.mixes(), (m) => m.id), ['37i9dQZF1Ea', '37i9dQZF1Eb']);
});

test('top songs are kept for half an hour', async () => {
  const c = load(FILES, { store: store(), fetch: async () => response(200, { items: [song(1), null] }) });
  for (const wait of [0, 10, 25]) { await c.clock.advance(wait * MIN); watch(c.ForYou.load('tracks', 'short_term')); await c.clock.advance(0); }
  assert.equal(c.calls.length, 2);
  assert.match(c.calls[0].url, /\/me\/top\/tracks\?time_range=short_term&limit=50/);
  watch(c.ForYou.load('artists', 'long_term'));
  await c.clock.advance(0);
  assert.equal(c.calls.length, 3);
});

test('an old login without the new permissions fails with Spotify’s reason', async () => {
  const c = load(FILES, { store: store(), fetch: async () => response(403, { error: { status: 403, message: 'Insufficient client scope' } }) });
  const w = watch(c.ForYou.load('tracks', 'short_term'));
  await c.clock.advance(0);
  assert.equal(w.error.status, 403);
  assert.match(w.error.message, /scope/);
});
