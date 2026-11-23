// PKCE auth: login redirect, callback handling, token storage and refresh.
// See CLAUDE.md, "Tech decisions → Auth".
var DeckAuth = (function () {
  var STORAGE_KEY = 'deck.tokens';
  var PKCE_KEY = 'deck.pkce';
  var AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
  var TOKEN_URL = 'https://accounts.spotify.com/api/token';
  var REFRESH_EARLY_MS = 5 * 60 * 1000;
  // Spotify refresh tokens last 6 months from login, and refreshing doesn't extend that.
  var LOGIN_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

  var refreshing = null;

  // ---- storage --------------------------------------------------------------
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function write(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function authError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  // ---- PKCE helpers ---------------------------------------------------------
  function randomBytes(n) {
    var a = new Uint8Array(n);
    window.crypto.getRandomValues(a);
    return a;
  }

  function base64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function asciiBytes(str) {
    var a = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) a[i] = str.charCodeAt(i);
    return a;
  }

  // crypto.subtle only exists in secure contexts; fall back to plain JS otherwise.
  function sha256(bytes) {
    var subtle = window.crypto && window.crypto.subtle;
    if (subtle && subtle.digest) {
      return subtle.digest('SHA-256', bytes)
        .then(function (buf) { return new Uint8Array(buf); })
        .catch(function () { return sha256js(bytes); });
    }
    return Promise.resolve(sha256js(bytes));
  }

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256js(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = bytes.length;
    var padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    var bits = len * 8;
    var end = padded.length;
    padded[end - 4] = (bits >>> 24) & 0xff;
    padded[end - 3] = (bits >>> 16) & 0xff;
    padded[end - 2] = (bits >>> 8) & 0xff;
    padded[end - 1] = bits & 0xff;

    var W = new Array(64);
    for (var off = 0; off < end; off += 64) {
      for (var t = 0; t < 16; t++) {
        var j = off + t * 4;
        W[t] = (padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3];
      }
      for (t = 16; t < 64; t++) {
        var w15 = W[t - 15], w2 = W[t - 2];
        var s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        var s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }

    var out = new Uint8Array(32);
    for (var i = 0; i < 8; i++) {
      out[i * 4] = (H[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
      out[i * 4 + 3] = H[i] & 0xff;
    }
    return out;
  }

  // ---- token endpoint -------------------------------------------------------
  function formBody(params) {
    var parts = [];
    for (var k in params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    return parts.join('&');
  }

  function postToken(params) {
    return fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody(params),
      cache: 'no-store'
    }).catch(function () {
      throw authError('network');
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok && data.access_token) return data;
        // invalid_grant means the refresh token is dead: the only fix is logging in again.
        if (res.status === 400 && data.error === 'invalid_grant') throw authError('logged_out', 'invalid_grant');
        throw authError('network', 'token endpoint ' + res.status);
      });
    });
  }

  function saveTokens(data, loginAt) {
    var old = read(STORAGE_KEY) || {};
    var tokens = {
      access_token: data.access_token,
      // Spotify sometimes rotates the refresh token. Keep the old one if it doesn't.
      refresh_token: data.refresh_token || old.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      login_at: loginAt || old.login_at || Date.now()
    };
    write(STORAGE_KEY, tokens);
    return tokens;
  }

  // ---- public ---------------------------------------------------------------
  function login() {
    var verifier = base64url(randomBytes(48));
    var state = base64url(randomBytes(16));
    write(PKCE_KEY, { verifier: verifier, state: state });
    return sha256(asciiBytes(verifier)).then(function (hash) {
      window.location.href = AUTHORIZE_URL + '?' + formBody({
        response_type: 'code',
        client_id: DECK_CONFIG.CLIENT_ID,
        scope: DECK_CONFIG.SCOPES.join(' '),
        redirect_uri: DECK_CONFIG.REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: base64url(hash),
        state: state
      });
    });
  }

  // Resolves to null, or to an error message to show on the login screen.
  function handleCallback() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('code');
    var error = params.get('error');
    if (!code && !error) return Promise.resolve(null);

    window.history.replaceState(null, '', DECK_CONFIG.REDIRECT_URI);
    var pkce = read(PKCE_KEY);
    write(PKCE_KEY, null);

    if (error) return Promise.resolve(error === 'access_denied' ? 'Login was cancelled.' : 'Spotify said: ' + error);
    if (!pkce || pkce.state !== params.get('state')) return Promise.resolve('Login expired. Try again.');

    return postToken({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: DECK_CONFIG.REDIRECT_URI,
      client_id: DECK_CONFIG.CLIENT_ID,
      code_verifier: pkce.verifier
    }).then(function (data) {
      saveTokens(data, Date.now());
      return null;
    }, function () {
      return 'Could not finish logging in. Check the connection and try again.';
    });
  }

  function refresh() {
    if (refreshing) return refreshing;
    var tokens = read(STORAGE_KEY);
    if (!tokens || !tokens.refresh_token) return Promise.reject(authError('logged_out'));

    refreshing = postToken({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: DECK_CONFIG.CLIENT_ID
    }).then(function (data) {
      refreshing = null;
      return saveTokens(data).access_token;
    }, function (err) {
      refreshing = null;
      if (err.code === 'logged_out') write(STORAGE_KEY, null);
      // A network failure isn't fatal: keep using the current token while it's still valid.
      else if (tokens.expires_at > Date.now()) return tokens.access_token;
      throw err;
    });
    return refreshing;
  }

  // Resolves to a valid access token, refreshing it first if it expires within 5 minutes.
  function getAccessToken() {
    var tokens = read(STORAGE_KEY);
    if (!tokens) return Promise.reject(authError('logged_out'));
    if (tokens.expires_at - Date.now() > REFRESH_EARLY_MS) return Promise.resolve(tokens.access_token);
    return refresh();
  }

  // After a 401: throw the current access token away and get a new one.
  function forceRefresh() {
    var tokens = read(STORAGE_KEY);
    if (tokens) { tokens.expires_at = 0; write(STORAGE_KEY, tokens); }
    return refresh();
  }

  function isLoggedIn() {
    return !!read(STORAGE_KEY);
  }

  // Roughly when Spotify will make us log in again (refresh tokens last 6 months).
  function loginExpiresAt() {
    var tokens = read(STORAGE_KEY);
    return tokens && tokens.login_at ? tokens.login_at + LOGIN_LIFETIME_MS : null;
  }

  function logout() {
    write(STORAGE_KEY, null);
  }

  return {
    login: login,
    handleCallback: handleCallback,
    getAccessToken: getAccessToken,
    forceRefresh: forceRefresh,
    isLoggedIn: isLoggedIn,
    loginExpiresAt: loginExpiresAt,
    logout: logout
  };
})();
