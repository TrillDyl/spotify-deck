const test = require('node:test');
const assert = require('node:assert');
const { load, never } = require('./helpers');

const Q = load(['js/queue.js'], { fetch: never }).DeckQueue;
const uris = (list) => Array.from(list, (q) => q.uri).join('');
const queue = (s) => Q.parse({ queue: s.split('').map((uri) => ({ uri, name: uri })) });

test('parses songs and episodes', () => {
  const list = Q.parse({ queue: [
    { uri: 'a', name: 'Song', artists: [{ name: 'X' }, { name: 'Y' }], album: { images: [{ url: 'big' }, { url: 'small' }] } },
    { uri: 'b', name: 'Episode', show: { name: 'Show' }, images: [{ url: 'ep' }] }
  ] });
  assert.equal(list[0].artist, 'X, Y');
  assert.equal(list[0].art, 'small');
  assert.equal(list[1].artist, 'Show');
  assert.equal(list[1].art, 'ep');
  assert.equal(Q.parse(null).length, 0);
});

test('a removal hides only the next appearance', () => {
  assert.equal(uris(Q.visible({ b: 1 }, queue('abab'))), 'aab');
  assert.equal(uris(Q.visible({ b: 2 }, queue('abab'))), 'aa');
});

test('taking a removal uses it up', () => {
  const skip = { b: 2 };
  assert.equal(Q.take(skip, 'a'), false);
  assert.equal(Q.take(skip, 'b'), true);
  assert.equal(skip.b, 1);
  assert.equal(Q.take(skip, 'b'), true);
  assert.equal('b' in skip, false);
});

test('removals are forgotten once the song has left the queue', () => {
  const skip = { a: 1, b: 2, c: 1 };
  Q.prune(skip, queue('bx'), 'c');
  assert.deepEqual(skip, { b: 1, c: 1 });
});
