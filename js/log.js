// The last few errors, kept across reloads so they can be read on the iPad (Settings → Diagnostics).
var DeckLog = (function () {
  var KEY = 'deck.log';
  var MAX = 30;
  var entries = null;

  function load() {
    if (entries) return entries;
    try { entries = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!Array.isArray(entries)) entries = [];
    return entries;
  }

  // Anything long enough to be a token or a login code is dropped.
  function clean(text) {
    return String(text).replace(/[A-Za-z0-9_\-]{40,}/g, '…').slice(0, 200);
  }

  function add(kind, text) {
    var all = load(), msg = clean(text), last = all[all.length - 1];
    if (last && last.kind === kind && last.text === msg) {
      last.n++;
      last.at = Date.now();
    } else {
      all.push({ at: Date.now(), kind: kind, text: msg, n: 1 });
      if (all.length > MAX) all.splice(0, all.length - MAX);
    }
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  }

  window.addEventListener('error', function (e) {
    // Images and other files that fail to load have no message, and aren't worth logging.
    if (e.message) add('script', e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    if (r && r.code === 'logged_out') return;
    add('promise', (r && r.message) || r);
  });

  return {
    add: add,
    list: function () { return load().slice(); }
  };
})();
