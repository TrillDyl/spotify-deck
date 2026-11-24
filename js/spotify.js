// Thin Spotify Web API wrapper. Uses the 2026 endpoints; see CLAUDE.md.
// Errors carry .status (0 = network), .reason (Spotify's reason string) and, on 429, .retryAfter (s).
var Spotify = (function () {
  var BASE = 'https://api.spotify.com/v1';
  var BLOCKS_KEY = 'deck.blocks';
  var TIMEOUT_MS = 15000;
  var HOUR_MS = 60 * 60 * 1000;

  // Two kinds of 429. A rate limit covers every call. A Development Mode quota (QUOTA_EXCEEDED)
  // covers one group of endpoints, so running out of searches mustn't stop polling.
  // Browsers can't read Retry-After from Spotify, so each 429 in a row doubles the wait.
  var RATE = { first: 5, max: 5 * 60 };
  var QUOTA = { first: 60, max: 30 * 60 };
  var blocks = loadBlocks();  // 'all' or an endpoint group → { until, at, secs, quota }
  var calls = [];             // when each request in the last hour was sent

  function loadBlocks() {
    var b = null;
    try { b = JSON.parse(localStorage.getItem(BLOCKS_KEY)); } catch (e) {}
    return b || {};
  }
  function saveBlocks() {
    try { localStorage.setItem(BLOCKS_KEY, JSON.stringify(blocks)); } catch (e) {}
  }

  function apiError(status, message, reason) {
    var e = new Error(message || ('HTTP ' + status));
    e.status = status;
    e.reason = reason || '';
    return e;
  }

  function withTimeout(promise) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(apiError(0, 'timeout')); }, TIMEOUT_MS);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  // Spotify doesn't publish its quota groups, so guess: each player screen, the player controls,
  // and otherwise the first part of the path.
  function groupOf(method, path) {
    var parts = path.split('?')[0].split('/');
    if (parts[1] !== 'me') return parts[1];
    if (parts[2] === 'player') return method === 'GET' ? parts.slice(1).join('/') : 'controls';
    return 'me/' + (parts[2] || '');
  }

  function blocked(group) {
    var now = Date.now();
    return [blocks.all, blocks[group]].filter(function (b) { return b && b.until > now; })[0];
  }

  function limited(block) {
    var e = apiError(429, 'rate limited', block.quota ? 'QUOTA_EXCEEDED' : '');
    e.retryAfter = Math.ceil((block.until - Date.now()) / 1000);
    return e;
  }

  function block(group, quota, retryAfter) {
    var key = quota ? group : 'all', limits = quota ? QUOTA : RATE, old = blocks[key];
    var secs = retryAfter > 0 ? retryAfter : old ? Math.min(limits.max, old.secs * 2) : limits.first;
    blocks[key] = { until: Date.now() + secs * 1000, at: Date.now(), secs: Math.min(limits.max, secs), quota: quota };
    saveBlocks();
    return blocks[key];
  }

  // A request that worked ends the backoff, unless it was already on its way when the block began.
  function unblock(group, sentAt) {
    var changed = false;
    ['all', group].forEach(function (key) {
      if (blocks[key] && sentAt >= blocks[key].until) { delete blocks[key]; changed = true; }
    });
    if (changed) saveBlocks();
  }

  function countCall(now) {
    calls.push(now);
    while (calls.length && calls[0] < now - HOUR_MS) calls.shift();
  }

  function request(method, path, body, retried) {
    var group = groupOf(method, path);
    var b = blocked(group);
    if (b) return Promise.reject(limited(b));

    var sentAt = 0;
    return DeckAuth.getAccessToken().then(function (token) {
      var opts = { method: method, headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' };
      if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      sentAt = Date.now();
      countCall(sentAt);
      // The time limit covers the body too: on a bad connection it can stall after the headers.
      return withTimeout(fetch(BASE + path, opts).then(function (res) {
        return res.text().then(function (text) { return { res: res, text: text }; });
      }).catch(function () { throw apiError(0, 'network'); }));
    }).then(function (r) {
      var res = r.res, data = null;
      if (res.status === 401 && !retried) {
        return DeckAuth.forceRefresh().then(function () { return request(method, path, body, true); });
      }
      try { data = r.text ? JSON.parse(r.text) : null; } catch (err) {}
      var info = (data && data.error) || {};
      if (res.status === 429) {
        var made = block(group, info.reason === 'QUOTA_EXCEEDED', parseInt(res.headers.get('Retry-After'), 10));
        DeckLog.add('api', method + ' ' + group + ' 429' + (made.quota ? ' quota' : '') + ', waiting ' + made.secs + ' s');
        throw limited(made);
      }
      if (!res.ok) {
        if (res.status !== 404) DeckLog.add('api', method + ' ' + group + ' ' + res.status + ' ' + (info.reason || info.message || ''));
        throw apiError(res.status, info.message, info.reason);
      }
      unblock(group, sentAt);
      return data;
    }, function (err) {
      if (err && err.status === 0) DeckLog.add('network', method + ' ' + group + ': ' + err.message);
      throw err;
    });
  }

  // For Settings → Diagnostics.
  function stats() {
    var now = Date.now();
    return {
      callsLastHour: calls.filter(function (t) { return t > now - HOUR_MS; }).length,
      waiting: Object.keys(blocks).filter(function (k) { return blocks[k].until > now; }).map(function (k) {
        return { group: k, quota: blocks[k].quota, secs: Math.ceil((blocks[k].until - now) / 1000) };
      })
    };
  }

  function uriParam(uri) { return '?uris=' + encodeURIComponent(uri); }

  return {
    stats: stats,
    getPlayer:       function ()            { return request('GET',  '/me/player?additional_types=episode'); },
    play:            function ()            { return request('PUT',  '/me/player/play'); },
    pause:           function ()            { return request('PUT',  '/me/player/pause'); },
    next:            function ()            { return request('POST', '/me/player/next'); },
    previous:        function ()            { return request('POST', '/me/player/previous'); },
    // body: { context_uri, offset } for a playlist or album, or { uris } for tracks.
    // deviceId is optional; without it Spotify uses the active device.
    playItems:       function (body, deviceId) {
      return request('PUT', '/me/player/play' + (deviceId ? '?device_id=' + encodeURIComponent(deviceId) : ''), body);
    },
    addToQueue:      function (uri)         { return request('POST', '/me/player/queue?uri=' + encodeURIComponent(uri)); },
    // Spotify caps search at 10 results per request (2026); page with offset.
    // types: 'track', or several with commas between them; the limit is for each.
    search:          function (q, types, offset) {
      return request('GET', '/search?type=' + types + '&limit=10&offset=' + (offset || 0) + '&q=' + encodeURIComponent(q));
    },
    getDevices:      function ()            { return request('GET',  '/me/player/devices'); },
    getQueue:        function ()            { return request('GET',  '/me/player/queue'); },
    setVolume:       function (percent)     { return request('PUT',  '/me/player/volume?volume_percent=' + Math.round(percent)); },
    seek:            function (ms)          { return request('PUT',  '/me/player/seek?position_ms=' + Math.round(ms)); },
    transfer:        function (deviceId, play) {
      return request('PUT', '/me/player', { device_ids: [deviceId], play: !!play });
    },
    getMe:           function ()            { return request('GET',  '/me'); },
    getMyPlaylists:  function (offset)      { return request('GET',  '/me/playlists?limit=50&offset=' + (offset || 0)); },
    // For you: needs the user-top-read and user-read-recently-played permissions.
    getTop:          function (type, range) { return request('GET',  '/me/top/' + type + '?time_range=' + range + '&limit=50'); },
    getRecent:       function ()            { return request('GET',  '/me/player/recently-played?limit=50'); },
    // Record player: saved albums and their tracks (both cap limit at 50).
    getSavedAlbums:  function (offset)      { return request('GET',  '/me/albums?limit=50&offset=' + (offset || 0)); },
    getAlbumTracks:  function (id, offset)  {
      return request('GET', '/albums/' + encodeURIComponent(id) + '/tracks?limit=50&offset=' + (offset || 0));
    },
    setRepeat:       function (mode)        { return request('PUT',  '/me/player/repeat?state=' + mode); },
    setShuffle:      function (on, deviceId) {
      return request('PUT', '/me/player/shuffle?state=' + (on ? 'true' : 'false') +
        (deviceId ? '&device_id=' + encodeURIComponent(deviceId) : ''));
    },
    // Only for playlists the user owns or collaborates on (403 otherwise).
    getPlaylistItems: function (id, offset) {
      return request('GET', '/playlists/' + encodeURIComponent(id) + '/items?additional_types=track,episode&limit=50&offset=' + (offset || 0));
    },
    createPlaylist:  function (name)        { return request('POST', '/me/playlists', { name: name, public: false }); },
    addToPlaylist:   function (playlistId, uri) {
      return request('POST', '/playlists/' + encodeURIComponent(playlistId) + '/items', { uris: [uri] });
    },
    // The library endpoints take URIs in the query string, not the body.
    isSaved:         function (uri) {
      return request('GET', '/me/library/contains' + uriParam(uri)).then(function (r) { return !!(r && r[0]); });
    },
    saveToLibrary:   function (uri)         { return request('PUT',    '/me/library' + uriParam(uri)); },
    removeFromLibrary: function (uri)       { return request('DELETE', '/me/library' + uriParam(uri)); }
  };
})();
