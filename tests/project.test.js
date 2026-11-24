// Checks on the files themselves: nothing Safari 12.1 can't run, and an up-to-date offline manifest.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, build } = require('../tools/stamp.js');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const inDir = (d, ext) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(ext)).map((f) => d + '/' + f);

function findAll(files, banned) {
  const found = [];
  files.forEach((f) => read(f).split('\n').forEach((line, i) => {
    banned.forEach((re) => { if (re.test(line)) found.push(f + ':' + (i + 1) + ' ' + line.trim()); });
  }));
  return found;
}

test('scripts use nothing missing from Safari 12.1', () => {
  assert.deepEqual(findAll(inDir('js', '.js'), [
    /\?\.[A-Za-z_$[(]/, /\?\?/, /\.replaceAll\(/, /\.allSettled\(/, /\.matchAll\(/, /\.at\(/, /structuredClone/,
    /\bpointer(down|move|up|cancel)\b/, /ResizeObserver/, /wakeLock/, /\.finally\(.*\?\./, /^\s*(import|export)\s/
  ]), []);
});

test('styles use nothing missing from Safari 12.1', () => {
  const bad = findAll(inDir('css', '.css'), [/(^|[\s;{])inset\s*:/, /aspect-ratio\s*:/, /prefers-color-scheme/, /(^|[\s;{])gap\s*:/, /\bclamp\(|[\s:(]m(in|ax)\(/]);
  assert.deepEqual(bad.filter((l) => !/grid/.test(l)), []);
});

test('no secrets', () => {
  assert.deepEqual(findAll(inDir('js', '.js'), [/client_?secret\s*[:=]/i]), []);
});

test('the offline manifest matches the files (if not: node tools/stamp.js)', () => {
  const out = build();
  Object.keys(out).forEach((f) => assert.equal(read(f), out[f], f + ' is out of date. Run: node tools/stamp.js'));
});

test('every file in the manifest exists', () => {
  const cache = read('deck.appcache').split('NETWORK:')[0].split('CACHE:')[1].trim().split('\n').filter((f) => f !== './');
  cache.forEach((f) => assert.ok(fs.existsSync(path.join(ROOT, f)), f));
  inDir('js', '.js').forEach((f) => assert.ok(cache.includes(f), f + ' isn’t loaded by index.html'));
});
