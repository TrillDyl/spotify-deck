const test = require('node:test');
const assert = require('node:assert');
const { load, never } = require('./helpers');

const R = load(['js/records.js'], { fetch: never }).Records;
const MIN = 60 * 1000;
const tracks = (mins, disc = 1) => mins.map((m, i) => ({ uri: `d${disc}t${i}`, name: 'T' + i, duration_ms: m * MIN, disc_number: disc }));
const shape = (built) => Array.from(built.sides, (s) => s.tracks.length).join(',');

test('an album splits into two balanced sides, in order', () => {
  const b = R._buildRecord({ type: 'album' }, tracks([4, 4, 4, 4, 4, 4, 4, 4]));
  assert.equal(shape(b), '4,4');
  assert.equal(b.sides[0].label, 'A');
  assert.equal(b.sides[1].tracks[0].uri, 'd1t4');
  assert.equal(b.seven, false);
});

test('a long disc becomes more than one record', () => {
  const b = R._buildRecord({ type: 'album' }, tracks(Array(20).fill(4)));
  assert.equal(b.sides.length, 4);
  assert.equal(b.sides[3].record, 2);
});

test('discs stay on their own records', () => {
  const b = R._buildRecord({ type: 'album' }, tracks([5, 5], 2).concat(tracks([5, 5], 1)));
  assert.equal(b.sides.length, 4);
  assert.equal(b.sides[0].tracks[0].uri, 'd1t0');
  assert.equal(b.sides[2].tracks[0].uri, 'd2t0');
});

test('a short single is a 7"', () => {
  assert.equal(R._buildRecord({ type: 'single' }, tracks([3, 4])).seven, true);
  assert.equal(R._buildRecord({ type: 'single' }, tracks([9, 9])).seven, false);
});

test('one song leaves side B blank', () => {
  assert.equal(shape(R._buildRecord({ type: 'single' }, tracks([3]))), '1,0');
});

test('a song is found by URI, or by name and length if Spotify swapped it for another copy', () => {
  const s = R._buildRecord({ type: 'album' }, tracks([4, 5, 4])).sides[0];
  assert.equal(R._matchTrack(s, { uri: 'd1t1', name: 'x', duration_ms: 0 }), 1);
  assert.equal(R._matchTrack(s, { uri: 'other', name: 'T1', duration_ms: 5 * MIN + 900 }), 1);
  assert.equal(R._matchTrack(s, { uri: 'other', name: 'T1', duration_ms: 7 * MIN }), -1);
});
