// Thin Spotify Web API wrapper. Uses the 2026 endpoints; see CLAUDE.md.
// Errors carry .status (0 = network), .reason (Spotify's reason string) and, on 429, .retryAfter (s).
var Spotify = (function () {
  var BASE = 'https://api.spotify.com/v1';
  var TIMEOUT_MS = 15000;
  var blockedUntil = 0;

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

  function request(method, path, body, retried) {
    var wait = blockedUntil - Date.now();
    if (wait > 0) {
      var e = apiError(429, 'rate limited');
      e.retryAfter = Math.ceil(wait / 1000);
      return Promise.reject(e);
    }

    return DeckAuth.getAccessToken().then(function (token) {
      var opts = { method: method, headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' };
      if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      return withTimeout(fetch(BASE + path, opts).catch(function () { throw apiError(0, 'network'); }));
    }).then(function (res) {
      if (res.status === 401 && !retried) {
        return DeckAuth.forceRefresh().then(function () { return request(method, path, body, true); });
      }
      if (res.status === 429) {
        var secs = parseInt(res.headers.get('Retry-After'), 10);
        if (!(secs > 0)) secs = 5;
        blockedUntil = Date.now() + secs * 1000;
        var e = apiError(429, 'rate limited');
        e.retryAfter = secs;
        throw e;
      }
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (err) {}
        if (!res.ok) {
          var info = (data && data.error) || {};
          throw apiError(res.status, info.message, info.reason);
        }
        return data;
      });
    });
  }

  function uriParam(uri) { return '?uris=' + encodeURIComponent(uri); }

  return {
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
    searchTracks:    function (q, offset)   {
      return request('GET', '/search?type=track&limit=10&offset=' + (offset || 0) + '&q=' + encodeURIComponent(q));
    },
    getDevices:      function ()            { return request('GET',  '/me/player/devices'); },
    getQueue:        function ()            { return request('GET',  '/me/player/queue'); },
    setVolume:       function (percent)     { return request('PUT',  '/me/player/volume?volume_percent=' + Math.round(percent)); },
    transfer:        function (deviceId, play) {
      return request('PUT', '/me/player', { device_ids: [deviceId], play: !!play });
    },
    getMe:           function ()            { return request('GET',  '/me'); },
    getMyPlaylists:  function (offset)      { return request('GET',  '/me/playlists?limit=50&offset=' + (offset || 0)); },
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
