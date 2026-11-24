// Stamps the deck with a hash of its files: js/version.js (shown in Settings → Diagnostics) and
// deck.appcache, the list of files the iPad keeps for offline use. The iPad only fetches new files
// when deck.appcache changes, so run this before every commit that changes the deck:
//   node tools/stamp.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VERSION = 'js/version.js';

function build() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [];
  html.replace(/<(?:link|script)[^>]+(?:href|src)="([^":]+)"/g, (_, f) => { if (!files.includes(f)) files.push(f); });
  const hash = crypto.createHash('sha256');
  ['index.html'].concat(files).filter((f) => f !== VERSION).forEach((f) => hash.update(fs.readFileSync(path.join(ROOT, f))));
  const version = hash.digest('hex').slice(0, 10);
  return {
    [VERSION]: '// Written by tools/stamp.js.\nvar DECK_VERSION = \'' + version + '\';\n',
    'deck.appcache': ['CACHE MANIFEST', '# Written by tools/stamp.js: ' + version, '', 'CACHE:', './', 'index.html']
      .concat(files, ['', 'NETWORK:', '*', '']).join('\n')
  };
}

module.exports = { ROOT, build };

if (require.main === module) {
  const out = build();
  Object.keys(out).forEach((f) => fs.writeFileSync(path.join(ROOT, f), out[f]));
  console.log(out['deck.appcache'].split('\n')[1]);
}
