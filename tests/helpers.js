// Loads the deck's classic scripts into a sandbox with a fake clock, fetch and localStorage.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const START = Date.UTC(2026, 10, 24, 12, 0, 0);

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeClock() {
  let now = START, seq = 0;
  let timers = [];
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => { timers.push({ id: ++seq, at: now + (ms || 0), fn }); return seq; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    // Move time forward, running timers in order and letting promises settle between them.
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.fn();
        await flush();
      }
      now = end;
      await flush();
    }
  };
  return clock;
}

// files: script paths relative to the project. fetch(url, opts) returns a response promise.
function load(files, { fetch, store = {}, hash = '', search = '' } = {}) {
  const clock = makeClock();
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(clock.now()); }
    static now() { return clock.now(); }
  }
  const data = {};
  Object.keys(store).forEach((k) => { data[k] = JSON.stringify(store[k]); });
  const calls = [];
  const ctx = {
    console, URLSearchParams, Uint8Array, btoa, Date: FakeDate,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    localStorage: {
      getItem: (k) => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: (k) => { delete data[k]; }
    },
    fetch: (url, opts) => { calls.push({ url, opts: opts || {}, at: clock.now() }); return fetch(url, opts || {}); }
  };
  ctx.window = {
    location: { origin: 'http://127.0.0.1:8888', pathname: '/', hash, search },
    history: { replaceState() {} },
    addEventListener() {}
  };
  vm.createContext(ctx);
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  ctx.clock = clock;
  ctx.calls = calls;
  ctx.stored = (k) => (k in data ? JSON.parse(data[k]) : null);
  ctx.dump = () => data;
  return ctx;
}

function response(status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() in headers ? headers[h.toLowerCase()] : null) },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text))
  };
}

// What a promise has done so far: { state: 'pending' | 'resolved' | 'rejected', value, error }.
function watch(promise) {
  const w = { state: 'pending' };
  promise.then((v) => { w.state = 'resolved'; w.value = v; }, (e) => { w.state = 'rejected'; w.error = e; });
  return w;
}

const never = () => new Promise(() => {});
const CORE = ['js/config.js', 'js/log.js', 'js/auth.js', 'js/spotify.js'].filter((f) => fs.existsSync(path.join(ROOT, f)));

module.exports = { ROOT, START, CORE, load, response, watch, flush, never };
