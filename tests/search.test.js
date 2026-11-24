const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers');

const artist = (name) => ({ uri: 'spotify:artist:' + name, name });
const album = (name, by, over) => Object.assign({ uri: 'spotify:album:' + name + by, name, artists: [{ name: by }], album_type: 'album', total_tracks: 10 }, over);
const pick = (q, artists, albums) => {
  const { Browse } = load(['js/browse.js'], {});
  return Array.from(Browse._pickOthers(q, { artists: { items: artists }, albums: { items: albums } }),
    (x) => ((x.artist || x.album).name || '?') + (x.close ? ' *' : ''));
};

test('one artist and three albums, with the ones typed first', () => {
  assert.deepEqual(pick('radiohead', [artist('Thom Yorke'), artist('Radiohead')],
    [album('Tribute', 'Strings'), album('Kid A', 'Radiohead'), album('OK Computer', 'Radiohead'), album('In Rainbows', 'Radiohead'), album('Amnesiac', 'Radiohead')]),
  ['Radiohead *', 'Kid A *', 'OK Computer *', 'In Rainbows *']);
});

test('an album can be found by its name and artist together', () => {
  assert.deepEqual(pick('kid a radio', [artist('Radiohead')], [album('Kid A', 'Radiohead')]), ['Radiohead', 'Kid A *']);
});

test('accents, case and punctuation don’t matter', () => {
  assert.deepEqual(pick('beyonce', [artist('Beyoncé')], []), ['Beyoncé *']);
  assert.deepEqual(pick('guns n roses', [artist('Guns N’ Roses')], []), ['Guns N’ Roses *']);
  assert.deepEqual(pick('t.i', [artist('T.I.')], []), ['T.I. *']);
});

test('only whole beginnings of words match', () => {
  assert.deepEqual(pick('art', [artist('Heart')], []), ['Heart']);
  assert.deepEqual(pick('...', [artist('Heart')], []), ['Heart']);
});

test('leaves out short singles and repeated editions', () => {
  assert.deepEqual(pick('x', [], [album('X', 'A', { album_type: 'single', total_tracks: 1 }), album('X', 'A'),
    album('X', 'A', { uri: 'spotify:album:other' }), album('X', 'B'), album('X EP', 'A', { album_type: 'single', total_tracks: 5 })]),
  ['X *', 'X *', 'X EP *']);
});

test('copes with missing pieces', () => {
  const { Browse } = load(['js/browse.js'], {});
  [null, {}, { tracks: { items: [] } }, { artists: { items: [null] }, albums: {} }].forEach((d) => assert.equal(Browse._pickOthers('x', d).length, 0));
  assert.deepEqual(pick('x', [], [{ uri: 'spotify:album:1' }]), ['?']);
});
