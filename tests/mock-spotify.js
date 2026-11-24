// A fake Spotify for tests/mock.html. Change MOCK from the console to set up a situation.
//   MOCK.player     what GET /me/player returns (null for nothing)
//   MOCK.fail       function (method, path) → { status, body, hang, network } to break a call
//   MOCK.log        every call made: 'PUT /me/player/pause'
//   MOCK.delay      ms before each answer
//   ?ios            pretend to be the iPad
//   ?dead           Spotify rejects the login
(function () {
  if (/ios/.test(location.search)) {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPad; CPU OS 12_5_8 like Mac OS X)' });
  }
  var DEAD = /dead/.test(location.search);

  // A login of its own, so this never touches a real one on the same address.
  var kept = {};
  try { kept = JSON.parse(sessionStorage.getItem('mock.store')) || {}; } catch (e) {}
  function keep() { sessionStorage.setItem('mock.store', JSON.stringify(kept)); }
  Object.defineProperty(window, 'localStorage', { value: {
    getItem: function (k) { return k in kept ? kept[k] : null; },
    setItem: function (k, v) { kept[k] = String(v); keep(); },
    removeItem: function (k) { delete kept[k]; keep(); }
  } });
  if (!kept['deck.tokens']) {
    localStorage.setItem('deck.tokens', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 36e5, login_at: Date.now() }));
  }

  function art(i) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="hsl(' + (i * 47 % 360) +
      ',55%,38%)"/><circle cx="150" cy="150" r="' + (40 + i * 13 % 90) + '" fill="hsl(' + (i * 47 + 140) % 360 + ',60%,62%)"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function images(i) { return [{ url: art(i) }, { url: art(i) }, { url: art(i) }]; }
  function track(i, over) {
    var t = { uri: 'spotify:track:t' + i, type: 'track', name: 'Song number ' + i, duration_ms: 200000, artists: [{ name: 'Artist ' + i % 9 }],
      album: { uri: 'spotify:album:al' + i % 12, name: 'Album ' + i % 12, images: images(i) } };
    for (var k in over) t[k] = over[k];
    return t;
  }
  function range(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }

  var M = window.MOCK = {
    log: [], fail: DEAD ? function (m, p) { return p === 'token' ? { status: 400, body: { error: 'invalid_grant' } } : { status: 401 }; } : null, delay: 60, saved: {}, track: track, albumCount: 1000,
    queue: range(20, function (i) { return track(100 + i); }),
    playlists: [
      { id: 'mine', uri: 'spotify:playlist:mine', name: 'Sunday Morning', owner: { id: 'me', display_name: 'Me' }, images: images(3), items: { total: 620 } },
      { id: 'short', uri: 'spotify:playlist:short', name: 'Road Trip', owner: { id: 'me' }, images: images(5), items: { total: 12 } },
      { id: 'nocover', uri: 'spotify:playlist:nocover', name: 'Nothing here', owner: { id: 'me' }, images: null, items: { total: 0 } },
      { id: 'collab', uri: 'spotify:playlist:collab', name: 'With friends', collaborative: true, owner: { id: 'pal', display_name: 'Pal' }, images: images(8), items: { total: 30 } },
      { id: 'followed', uri: 'spotify:playlist:followed', name: 'Deep Focus', owner: { id: 'spotify', display_name: 'Spotify' }, images: images(11) }
    ].concat(range(40, function (i) {
      return { id: 'p' + i, uri: 'spotify:playlist:p' + i, name: 'Playlist ' + i, owner: { id: i % 3 ? 'me' : 'x', display_name: 'Someone' }, images: images(20 + i), items: i % 3 ? { total: i } : undefined };
    })),
    songs: {},
    player: {
      is_playing: true, progress_ms: 42000, shuffle_state: false, repeat_state: 'off', currently_playing_type: 'track',
      device: { id: 'mac', name: 'MacBook Air', volume_percent: 60, supports_volume: true }, item: track(1),
      context: { uri: 'spotify:playlist:mine' }, actions: { disallows: {} }
    }
  };
  M.songs.mine = range(620, function (i) { return i === 4 ? { name: 'A local file', is_local: true, uri: 'spotify:local:x', artists: [{ name: 'Me' }] } : track(i); });
  M.songs.mine[7] = null;
  M.songs.short = range(12, function (i) { return track(40 + i); });
  M.songs.nocover = [];
  M.songs.collab = range(30, function (i) { return track(70 + i); });

  function page(all, q, wrap) {
    var off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 20);
    return { items: all.slice(off, off + lim).map(wrap || function (x) { return x; }), total: all.length, next: off + lim < all.length ? 'more' : null };
  }

  function answer(method, path, q, body) {
    var P = M.player, m;
    if (path === '/me') return { id: 'me' };
    if (path === '/me/player' && method === 'GET') return P;
    if (path === '/me/player/pause') { P.is_playing = false; return null; }
    if (path === '/me/player/play') {
      M.lastPlay = body;
      if (P) { P.is_playing = true; if (body) P.progress_ms = body.position_ms || 0; }
      if (P && body && body.uris) P.item = M.byUri(body.uris[(body.offset || {}).position || 0]) || P.item;
      return null;
    }
    if (path === '/me/player/next' || path === '/me/player/previous') { if (!M.stuckSong) P.item = path.slice(-4) === 'next' ? M.queue.shift() || P.item : track(0); P.progress_ms = 0; return null; }
    if (path === '/me/player/shuffle') { if (P) P.shuffle_state = q.get('state') === 'true'; return null; }
    if (path === '/me/player/repeat') { P.repeat_state = q.get('state'); return null; }
    if (path === '/me/player/seek') { P.progress_ms = Number(q.get('position_ms')); return null; }
    if (path === '/me/player/volume') { P.device.volume_percent = Number(q.get('volume_percent')); return null; }
    if (path === '/me/player/queue') return method === 'GET' ? { currently_playing: P && P.item, queue: M.queue } : null;
    if (path === '/me/player/devices') return { devices: [{ id: 'mac', name: 'MacBook Air', type: 'Computer', is_active: true }, { id: 'ph', name: 'iPhone', type: 'Smartphone' }] };
    if (path === '/me/player') return null;
    if (path === '/me/library/contains') return [!!M.saved[q.get('uris')]];
    if (path === '/me/library') { M.saved[q.get('uris')] = method === 'PUT'; return null; }
    if (path === '/me/playlists' && method === 'GET') return page(M.playlists, q);
    if (path === '/me/playlists') {
      var pl = { id: 'new' + M.playlists.length, name: body.name, owner: { id: 'me' }, images: [], public: body.public, items: { total: 0 } };
      pl.uri = 'spotify:playlist:' + pl.id;
      M.songs[pl.id] = [];
      M.playlists.unshift(pl);
      return pl;
    }
    if ((m = /^\/playlists\/([^/]+)\/items$/.exec(path))) {
      if (method === 'GET') return M.songs[m[1]] ? page(M.songs[m[1]], q, function (t) { return { item: t }; }) : 403;
      M.songs[m[1]] = (M.songs[m[1]] || []).concat(body.uris.map(function (u) { return M.byUri(u); }));
      M.lastAdd = { id: m[1], uris: body.uris };
      return { snapshot_id: 'x' };
    }
    if (path === '/oembed') return /37i9dQZF1E1/.test(q.get('url')) ? { title: 'Daily Mix 1', thumbnail_url: art(31) } : 404;
    if (path === '/me/top/tracks') return { items: range(50, function (i) { return track({ short_term: 400, medium_term: 500, long_term: 600 }[q.get('time_range')] + i); }) };
    if (path === '/me/top/artists') return { items: range(30, function (i) { return { uri: 'spotify:artist:a' + i, name: 'Top artist ' + i, images: images(i + 9) }; }) };
    if (path === '/me/player/recently-played') return { items: range(50, function (i) {
      return { track: track(700 + i % 35), played_at: new Date(Date.now() - i * 2e5).toISOString(), context: i === 3 ? { uri: 'spotify:playlist:37i9dQZF1EKnown' } : null };
    }) };
    if (path === '/search') return { tracks: page(range(35, function (i) { return track(300 + i, { name: q.get('q') + ' ' + i }); }), q) };
    if (path === '/me/albums') return page(range(M.albumCount, function (i) {
      return { album: { id: 'al' + i, uri: 'spotify:album:al' + i, name: String.fromCharCode(65 + i * 7 % 26) + 'lbum ' + i, artists: [{ name: String.fromCharCode(65 + i % 26) + 'rtist' }],
        release_date: '19' + (60 + i % 40), album_type: i % 11 ? 'album' : 'single', total_tracks: i % 11 ? 10 : 2, images: images(i) } };
    }), q);
    if (/^\/albums\//.test(path)) return page(range(10, function (i) { return track(i); }), q);
    return 404;
  }
  M.byUri = function (u) { var m = /t(\d+)$/.exec(u); return m ? track(Number(m[1])) : null; };

  function reply(status, body) {
    return new Response(status === 204 ? null : JSON.stringify(body), { status: status });
  }
  var realFetch = window.fetch;
  window.fetch = function (url, o) {
    o = o || {};
    var u = new URL(url, location.href), method = o.method || 'GET';
    if (u.origin === location.origin) return realFetch(url, o);
    var token = /api\/token/.test(u.pathname);
    var path = token ? 'token' : u.pathname.replace('/v1', '');
    M.log.push(method + ' ' + path + u.search);
    var bad = M.fail && M.fail(method, path);
    if (bad && bad.hang) return new Promise(function () {});
    // Work the answer out now, as Spotify would, and deliver it after the delay.
    var res = bad ? null : token ? { access_token: 'a' + Date.now(), refresh_token: 'r2', expires_in: 3600 }
      : JSON.parse(JSON.stringify(answer(method, path, u.searchParams, o.body ? JSON.parse(o.body) : null)));
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (bad && bad.network) return reject(new TypeError('network'));
        if (bad) return resolve(reply(bad.status, bad.body || {}));
        if (typeof res === 'number') return resolve(reply(res, { error: { status: res, message: 'mock' } }));
        resolve(res === null ? reply(204) : reply(200, res));
      }, (bad && bad.delay) || M.delay);
    });
  };
})();
