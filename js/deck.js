// UI: boot, polling loop, layouts (themes), controls, sheets (playlists, devices, settings), idle clock.
//
// Each layout is a <template id="tpl-NAME"> in index.html. Its markup names what it shows and
// the engine fills it in, so a layout is just HTML and CSS:
//   data-t="title"           text (see textFor for every key)
//   data-p="w|s|l|r|seg"     song progress as width %, scaleX, left %, rotation, or lit segments
//   data-v="w|l|r"           volume, the same way
//   data-show="weather"      shown only when that data exists ("!q1" = only when it doesn't)
//   img data-art="big|mid|small", img data-q-art="1"   album art, queue art
//   canvas data-pixel="16" data-palette="#a,#b,…"      album art redrawn as pixel art
//   data-action="play|prev|next|like|add|devices"      buttons
//   data-vol-control="slider|knob"                     drag to change the volume
//   data-fit="120"           shrink the text from 120px until it fits its box
// The layout's root gets is-playing, is-liked, is-shuffle, has-volume, has-weather and has-queue.
(function () {
  var C = DECK_CONFIG;
  var SETTINGS_KEY = 'deck.settings';
  var DIM_LEVELS = [0, 0.3, 0.6];
  var BOOT_AT = Date.now();
  var STAGE_W = 1024, STAGE_H = 768;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // fonts: Google Fonts families, loaded only while that layout is showing.
  var THEMES = {
    classic:   { label: 'Classic' },
    cassette:  { label: 'Cassette', fonts: 'Inter:wght@400;600;800&family=Permanent+Marker&family=VT323' },
    hifi:      { label: 'Hi-fi', fonts: 'Inter:wght@500;700&family=VT323' },
    turntable: { label: 'Turntable', fonts: 'DM+Serif+Display&family=Inter:wght@400;600' },
    terminal:  { label: 'Terminal', fonts: 'VT323' },
    handheld:  { label: '8-bit', fonts: 'Press+Start+2P' },
    dashboard: { label: 'Dashboard', fonts: 'Inter:wght@300;400;600;700' },
    bigclock:  { label: 'Big clock', fonts: 'Inter:wght@200;400;600' },
    poster:    { label: 'Poster', fonts: 'Archivo+Black&family=Inter:wght@500;700;800' }
  };

  var state = {
    view: null,          // 'login' | 'deck' | 'idle'
    item: null,          // current track or episode
    uri: null,
    art: { big: '', mid: '', small: '' },
    playing: false,
    shuffle: false,
    liked: false,
    device: '',
    progressMs: 0,
    durationMs: 0,
    progressAt: 0,       // Date.now() when progressMs was measured
    pausedSince: 0,
    wokeAt: 0,           // last tap on the idle clock
    endPolled: false,
    errors: 0,
    volume: null,        // 0–100, or null when the device can't change volume
    volumeHoldUntil: 0,  // ignore polled volume while the user is dragging
    queue: [],
    queueAt: 0,
    weather: null,
    weatherAt: 0,
    me: null,
    playlists: null,
    playlistsAt: 0
  };
  var settings = loadSettings();
  var theme = null;

  function $(id) { return document.getElementById(id); }
  function toggle(el, cls, on) { el.classList[on ? 'add' : 'remove'](cls); }
  function list(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function show(view) {
    if (state.view === view) return;
    state.view = view;
    ['login', 'deck', 'idle'].forEach(function (s) { toggle($(s), 'hidden', s !== view); });
    if (view === 'idle') { closeSheets(); tickClock(true); }
    if (view === 'deck') paint();
  }

  // ---- settings (stored per device) -----------------------------------------
  function loadSettings() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) {}
    s = s || {};
    if (s.dim === undefined) s.dim = 0;
    if (s.idleDim === undefined) s.idleDim = 0;
    if (!s.theme) s.theme = C.DEFAULT_THEME || 'classic';
    return s;
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
    applySettings();
  }
  function applySettings() {
    $('dim').style.opacity = DIM_LEVELS[settings.dim] || 0;
    toggle($('idle'), 'dimmer', settings.idleDim === 1);
    list(document, '[data-setting]').forEach(function (b) {
      toggle(b, 'on', String(settings[b.getAttribute('data-setting')]) === b.getAttribute('data-value'));
    });
  }

  // ---- layouts --------------------------------------------------------------
  function setTheme(name) {
    if (!THEMES[name] || !$('tpl-' + name)) name = 'classic';
    var stage = $('deck');
    stage.innerHTML = '';
    var root = document.importNode($('tpl-' + name).content, true).firstElementChild;
    stage.appendChild(root);
    theme = {
      name: name,
      root: root,
      fixed: root.classList.contains('fixed'),
      needs: root.getAttribute('data-needs') || '',
      texts: list(root, '[data-t]'),
      progs: list(root, '[data-p]'),
      vols: list(root, '[data-v]'),
      shows: list(root, '[data-show]'),
      arts: list(root, 'img[data-art]'),
      queueArts: list(root, 'img[data-q-art]'),
      pixels: list(root, 'canvas[data-pixel]')
    };
    toggle(stage, 'stage-fixed', theme.fixed);
    toggle($('bg0'), 'hidden', name !== 'classic');
    toggle($('bg1'), 'hidden', name !== 'classic');
    loadFonts(THEMES[name].fonts);
    scaleStage();
    setupVolumeControls(root);
    paintArt();
    if (name === 'classic') paintBackground(state.art.small);
    paint();
    state.queueAt = 0;
    state.weatherAt = 0;
    loadExtras();
  }

  function needs(what) { return !!theme && theme.needs.indexOf(what) > -1; }

  function loadFonts(families) {
    var link = $('theme-fonts');
    if (!families) { if (link) link.parentNode.removeChild(link); return; }
    var href = 'https://fonts.googleapis.com/css2?family=' + families + '&display=swap';
    if (!link) {
      link = document.createElement('link');
      link.id = 'theme-fonts';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }

  // Fixed layouts are drawn at 1024×768 (the iPad mini in landscape) and scaled to fit.
  function scaleStage() {
    if (!theme || !theme.fixed) return;
    var s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    theme.root.style.webkitTransform = theme.root.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  // ---- painting -------------------------------------------------------------
  function ratio() {
    if (!state.durationMs) return 0;
    var ms = state.progressMs + (state.playing ? Date.now() - state.progressAt : 0);
    return Math.max(0, Math.min(1, ms / state.durationMs));
  }

  function fmtMs(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + pad2(s % 60);
  }

  function fmt12(hhmm) {
    var p = hhmm.split(':');
    return ((Number(p[0]) % 12) || 12) + ':' + p[1];
  }

  function textFor(key) {
    var item = state.item || {};
    var now = new Date();
    var elapsed = ratio() * state.durationMs;
    var artist = (item.artists || []).map(function (a) { return a.name; }).join(', ') ||
      (item.show && item.show.name) || '';
    var album = (item.album && item.album.name) || '';
    var w = state.weather;
    var m;
    switch (key) {
      case 'title': return item.name || '';
      case 'artist': return artist;
      case 'album': return album;
      case 'artistAlbum': return album ? artist + ' · ' + album : artist;
      case 'device': return state.device;
      case 'status': return state.device ? (state.playing ? 'Playing on ' : 'Paused on ') + state.device : '';
      case 'statusWord': return state.playing ? 'Playing' : 'Paused';
      case 'nowWord': return state.playing ? 'Now playing' : 'Paused';
      case 'spinWord': return state.playing ? 'Now spinning' : 'Paused';
      case 'time': return ((now.getHours() % 12) || 12) + ':' + pad2(now.getMinutes());
      case 'ampm': return now.getHours() < 12 ? 'AM' : 'PM';
      case 'time24': return pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      case 'timeSec': return pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
      case 'date': return now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      case 'dateShort': return DAYS[now.getDay()] + ' ' + now.getDate() + ' ' + MONTHS[now.getMonth()] + ' ' + now.getFullYear();
      case 'dateNum': return DAYS[now.getDay()] + ' ' + (now.getMonth() + 1) + '/' + now.getDate();
      case 'elapsed': return fmtMs(elapsed);
      case 'duration': return fmtMs(state.durationMs);
      case 'remaining': return '−' + fmtMs(state.durationMs - elapsed);
      case 'volume': return state.volume === null ? '' : state.volume + '%';
      case 'volBar':
        var n = state.volume === null ? 0 : Math.round(state.volume / 10);
        return '[' + new Array(n + 1).join('#') + new Array(11 - n).join('-') + ']';
      case 'wTemp': return w ? w.temp + '°' : '';
      case 'wDesc': return w ? w.desc : '';
      case 'wLine': return w ? w.temp + '° ' + w.desc : '';
      case 'wHiLo': return w ? 'H ' + w.hi + '°  L ' + w.lo + '°' : '';
      case 'wSunset': return w && w.sunset ? 'Sunset ' + fmt12(w.sunset) : '';
      case 'wTerm': return w ? w.temp + '° ' + w.desc.toLowerCase() + (w.sunset ? ' · sunset ' + w.sunset : '') : '';
    }
    if ((m = /^q(\d)([ta])$/.exec(key))) {
      var q = state.queue[Number(m[1]) - 1];
      return q ? (m[2] === 't' ? q.title : q.artist) : '';
    }
    if ((m = /^f(\d)([dtc])$/.exec(key))) {
      var d = w && w.days[Number(m[1]) - 1];
      return d ? (m[2] === 'd' ? d.day : m[2] === 't' ? d.temp + '°' : d.desc) : '';
    }
    return '';
  }

  function visible(key) {
    if (key.charAt(0) === '!') return !visible(key.slice(1));
    var m = /^q(\d)$/.exec(key);
    if (m) return state.queue.length >= Number(m[1]);
    if (key === 'weather') return !!state.weather;
    if (key === 'queue') return state.queue.length > 0;
    if (key === 'volume') return state.volume !== null;
    if (key === 'album') return !!(state.item && state.item.album && state.item.album.name);
    return true;
  }

  function meter(el, kind, r) {
    var key = kind + Math.round(r * 1000);
    if (el._m === key) return;
    el._m = key;
    var pct = (r * 100).toFixed(1) + '%';
    if (kind === 'w') el.style.width = pct;
    else if (kind === 'l') el.style.left = pct;
    else if (kind === 's') el.style.webkitTransform = el.style.transform = 'scaleX(' + r + ')';
    else if (kind === 'r') {
      var from = Number(el.getAttribute('data-from')), to = Number(el.getAttribute('data-to'));
      el.style.webkitTransform = el.style.transform = 'rotate(' + (from + (to - from) * r) + 'deg)';
    } else if (kind === 'seg') {
      var kids = el.children, lit = Math.round(r * kids.length);
      for (var i = 0; i < kids.length; i++) toggle(kids[i], 'on', i < lit);
    }
  }

  // Shrink text until it fits its box (long song titles in big type).
  function fit(el) {
    var size = Number(el.getAttribute('data-fit'));
    el.style.fontSize = size + 'px';
    for (var i = 0; i < 30 && size > 12 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1); i++) {
      size = Math.floor(size * 0.92);
      el.style.fontSize = size + 'px';
    }
  }

  function paint() {
    if (!theme || state.view !== 'deck') return;
    var root = theme.root;
    toggle(root, 'is-playing', state.playing);
    toggle(root, 'is-liked', state.liked);
    toggle(root, 'is-shuffle', state.shuffle);
    toggle(root, 'has-volume', state.volume !== null);
    toggle(root, 'has-weather', !!state.weather);
    toggle(root, 'has-queue', state.queue.length > 0);

    theme.shows.forEach(function (el) { toggle(el, 'hidden', !visible(el.getAttribute('data-show'))); });
    theme.texts.forEach(function (el) {
      var v = textFor(el.getAttribute('data-t'));
      if (el._v === v) return;
      el._v = v;
      el.textContent = v;
      if (el.hasAttribute('data-fit')) fit(el);
    });
    var r = ratio();
    theme.progs.forEach(function (el) { meter(el, el.getAttribute('data-p'), r); });
    var vr = (state.volume || 0) / 100;
    theme.vols.forEach(function (el) { meter(el, el.getAttribute('data-v'), vr); });
  }

  function setImg(el, url) {
    if (el._src === url) return;
    el._src = url;
    if (!url) { el.removeAttribute('src'); return; }
    toggle(el, 'fading', true);
    var img = new Image();
    img.onload = img.onerror = function () {
      if (el._src !== url) return;
      el.src = url;
      toggle(el, 'fading', false);
    };
    img.src = url;
  }

  function paintArt() {
    if (!theme) return;
    theme.arts.forEach(function (el) { setImg(el, state.art[el.getAttribute('data-art') || 'big'] || state.art.big); });
    theme.pixels.forEach(function (el) { drawPixels(el, state.art.small); });
    paintQueueArt();
  }

  function paintQueueArt() {
    if (!theme) return;
    theme.queueArts.forEach(function (el) {
      var q = state.queue[Number(el.getAttribute('data-q-art')) - 1];
      setImg(el, q ? q.art : '');
    });
  }

  // Album art as pixel art: shrink it to N×N, map each pixel to the layout's palette with an
  // ordered dither, then draw it back up with hard edges.
  function drawPixels(canvas, url) {
    if (!url || canvas._src === url) return;
    canvas._src = url;
    var n = Number(canvas.getAttribute('data-pixel'));
    var palette = canvas.getAttribute('data-palette').split(',').map(function (hex) {
      var v = parseInt(hex.replace('#', ''), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    });
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      if (canvas._src !== url) return;
      var small = document.createElement('canvas');
      small.width = small.height = n;
      var sctx = small.getContext('2d');
      sctx.drawImage(img, 0, 0, n, n);
      try {
        var data = sctx.getImageData(0, 0, n, n);
        var px = data.data, levels = palette.length - 1;
        // Stretch contrast first so dark covers still use the whole palette.
        var lums = [], lo = 1, hi = 0, i;
        for (i = 0; i < px.length; i += 4) {
          var l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
          lums.push(l);
          if (l < lo) lo = l;
          if (l > hi) hi = l;
        }
        var span = Math.max(0.05, hi - lo);
        for (i = 0; i < lums.length; i++) {
          var x = i % n, y = Math.floor(i / n);
          var t = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5;
          var lvl = Math.max(0, Math.min(levels, Math.round((lums[i] - lo) / span * levels + t)));
          var c = palette[lvl];
          px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
        }
        sctx.putImageData(data, 0, 0);
      } catch (e) {}
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.webkitImageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    };
    img.src = url;
  }

  // ---- toast and offline dot ------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    toggle(t, 'hidden', false);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toggle(t, 'hidden', true); }, 2500);
  }

  function actionError(err) {
    if (err && err.code === 'logged_out') return showLogin();
    var status = err && err.status;
    if (status === 0) toast('No connection');
    else if (status === 429) toast('Spotify is busy. Try again in a moment.');
    else if (err.reason === 'NO_ACTIVE_DEVICE' || (status === 404 && /device/i.test(err.message))) {
      toast('Nothing is playing. Pick a device.');
      openDevices();
    }
    else if (status === 403) toast('Spotify didn’t allow that');
    else toast('Something went wrong');
  }

  // ---- polling --------------------------------------------------------------
  var pollTimer = null, polling = false, pollAgain = false, stopped = false;

  function pollSoon(ms) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms || 0);
  }

  function poll() {
    if (stopped) return;
    if (polling) { pollAgain = true; return; }
    polling = true;
    clearTimeout(pollTimer);
    Spotify.getPlayer().then(function (p) {
      state.errors = 0;
      toggle($('status'), 'hidden', true);
      render(p);
      return state.playing ? C.POLL_PLAYING_MS : C.POLL_IDLE_MS;
    }, onPollError).then(function (delay) {
      polling = false;
      if (delay === null) return;
      if (pollAgain) { pollAgain = false; delay = 0; }
      pollSoon(delay);
    });
  }

  // Never show an error page: keep the last state on screen and back off.
  function onPollError(err) {
    if (err && err.code === 'logged_out') { showLogin(); return null; }
    if (err && err.status === 429) return (err.retryAfter || 5) * 1000;
    state.errors++;
    if (state.errors >= 2) toggle($('status'), 'hidden', false);
    return Math.min(60000, 2000 * Math.pow(2, state.errors - 1));
  }

  // ---- state from Spotify ---------------------------------------------------
  function render(p) {
    var item = p && p.item;
    if (!item) {
      state.uri = null;
      state.item = null;
      state.playing = false;
      show('idle');
      return;
    }

    state.playing = !!p.is_playing;
    state.shuffle = !!p.shuffle_state;
    state.progressMs = p.progress_ms || 0;
    state.durationMs = item.duration_ms || 0;
    state.progressAt = Date.now();
    state.device = (p.device && p.device.name) || '';
    if (Date.now() > state.volumeHoldUntil) {
      state.volume = p.device && p.device.supports_volume !== false && typeof p.device.volume_percent === 'number'
        ? p.device.volume_percent : null;
    }
    state.item = item;
    if (item.uri !== state.uri) newItem(item);

    // Paused for a while: go to the idle clock so the screen doesn't burn in.
    if (state.playing) {
      state.pausedSince = 0;
      show('deck');
    } else {
      if (!state.pausedSince) state.pausedSince = Date.now();
      var since = Math.max(state.pausedSince, state.wokeAt);
      show(Date.now() - since > C.IDLE_AFTER_PAUSE_MS ? 'idle' : 'deck');
    }
    paint();
  }

  function newItem(item) {
    state.uri = item.uri;
    state.endPolled = false;
    state.liked = false;
    var images = (item.album && item.album.images) || item.images || [];
    state.art = {
      big: images.length ? images[0].url : '',
      mid: images.length ? images[Math.min(1, images.length - 1)].url : '',
      small: images.length ? images[images.length - 1].url : ''
    };
    if (theme) toggle(theme.root, 'is-skipping', false);
    paintArt();
    if (theme && theme.name === 'classic') paintBackground(state.art.small);

    var uri = item.uri;
    Spotify.isSaved(uri).then(function (saved) {
      if (state.uri === uri) { state.liked = saved; paint(); }
    }, function () {});
    state.queueAt = 0;
    loadExtras();
  }

  // Queue and weather, only for layouts that show them.
  function loadExtras() {
    var now = Date.now();
    if (needs('queue') && state.item && now - state.queueAt > 2 * 60 * 1000) {
      state.queueAt = now;
      Spotify.getQueue().then(function (d) {
        state.queue = ((d && d.queue) || []).slice(0, 4).map(function (q) {
          var imgs = (q.album && q.album.images) || q.images || [];
          return {
            title: q.name || '',
            artist: (q.artists || []).map(function (a) { return a.name; }).join(', ') || (q.show && q.show.name) || '',
            art: imgs.length ? imgs[imgs.length - 1].url : ''
          };
        });
        paintQueueArt();
        paint();
      }, function () {});
    }
    if (needs('weather') && Weather.configured() && now - state.weatherAt > 30 * 60 * 1000) {
      state.weatherAt = now;
      Weather.get().then(function (w) { state.weather = w; paint(); }, function () {
        state.weatherAt = now - 25 * 60 * 1000;  // try again in 5 minutes
      });
    }
  }

  // Draw the smallest album image onto a tiny canvas and let CSS scale it up.
  // The upscaling makes a soft blur that costs far less than a CSS blur filter.
  var bgFront = 0;
  function paintBackground(url) {
    if (!url) return;
    var img = new Image();
    img.onload = function () {
      var back = $('bg' + (1 - bgFront));
      back.getContext('2d').drawImage(img, 0, 0, back.width, back.height);
      toggle(back, 'on', true);
      toggle($('bg' + bgFront), 'on', false);
      bgFront = 1 - bgFront;
    };
    img.src = url;
  }

  // ---- clock and the 1-second tick ------------------------------------------
  var lastMinute = -1, lastDrift = 0;
  function tickClock(force) {
    var now = new Date();
    if (force || now.getMinutes() !== lastMinute) {
      lastMinute = now.getMinutes();
      $('clock-time').textContent = textFor('time');
      $('clock-date').textContent = textFor('date');
    }
    // Drift a little every minute so no pixel stays lit in the same place.
    if (force || Date.now() - lastDrift > 60000) {
      lastDrift = Date.now();
      var x = Math.round((Math.random() - 0.5) * window.innerWidth * 0.4);
      var y = Math.round((Math.random() - 0.5) * window.innerHeight * 0.4);
      var clock = $('clock');
      clock.style.webkitTransform = clock.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }
  }

  function tick() {
    if (state.view === 'deck') {
      paint();
      loadExtras();
      // Track just ended: ask Spotify what's next instead of waiting for the next poll.
      if (ratio() >= 1 && state.playing && !state.endPolled) { state.endPolled = true; pollSoon(600); }
    }
    if (state.view === 'idle') {
      tickClock(false);
      // Restart once a day while idle to clear any memory buildup in old Safari.
      if (Date.now() - BOOT_AT > 24 * 60 * 60 * 1000) window.location.reload();
    }
    // A paused deck falls back to the idle clock even without a poll.
    if (state.view === 'deck' && !state.playing && state.pausedSince &&
        Date.now() - Math.max(state.pausedSince, state.wokeAt) > C.IDLE_AFTER_PAUSE_MS) show('idle');
  }

  // ---- controls (optimistic, then poll to confirm) --------------------------
  function afterAction() {
    pollSoon(500);
    setTimeout(poll, 1500);
  }

  function onPlayPause() {
    var wasPlaying = state.playing;
    state.progressMs += wasPlaying ? Date.now() - state.progressAt : 0;
    state.progressAt = Date.now();
    state.playing = !wasPlaying;
    paint();
    (wasPlaying ? Spotify.pause() : Spotify.play()).then(afterAction, function (err) {
      state.playing = wasPlaying;
      paint();
      actionError(err);
    });
  }

  function onSkip(next) {
    toggle(theme.root, 'is-skipping', true);
    (next ? Spotify.next() : Spotify.previous()).then(afterAction, function (err) {
      toggle(theme.root, 'is-skipping', false);
      actionError(err);
    });
  }

  function onLike() {
    var uri = state.uri;
    if (!uri) return;
    var was = state.liked;
    state.liked = !was;
    paint();
    (was ? Spotify.removeFromLibrary(uri) : Spotify.saveToLibrary(uri)).then(function () {
      toast(was ? 'Removed from Liked Songs' : 'Added to Liked Songs');
    }, function (err) {
      if (state.uri === uri) { state.liked = was; paint(); }
      actionError(err);
    });
  }

  var ACTIONS = {
    play: onPlayPause,
    prev: function () { onSkip(false); },
    next: function () { onSkip(true); },
    like: onLike,
    add: function () { openPicker(); },
    devices: function () { openDevices(); }
  };

  // Volume: drag a slider sideways or a knob up and down; send it once the finger rests.
  var volTimer = null;
  function setupVolumeControls(root) {
    list(root, '[data-vol-control]').forEach(function (el) {
      var knob = el.getAttribute('data-vol-control') === 'knob';
      var drag = null;
      function point(e) { return e.touches ? e.touches[0] : e; }
      function update(e) {
        var p = point(e), rect = el.getBoundingClientRect(), v;
        if (knob) v = drag.vol + (drag.y - p.clientY) / (rect.height * 1.5) * 100;
        else v = (p.clientX - rect.left) / rect.width * 100;
        setVolume(Math.max(0, Math.min(100, Math.round(v))));
      }
      function start(e) {
        if (state.volume === null) return;
        e.preventDefault();
        drag = { y: point(e).clientY, vol: state.volume };
        if (!knob) update(e);
      }
      function move(e) { if (drag) { e.preventDefault(); update(e); } }
      function end() { drag = null; }
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchmove', move, { passive: false });
      el.addEventListener('touchend', end);
      el.addEventListener('mousedown', start);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', end);
    });
  }

  function setVolume(v) {
    state.volume = v;
    state.volumeHoldUntil = Date.now() + 3000;
    paint();
    clearTimeout(volTimer);
    volTimer = setTimeout(function () {
      Spotify.setVolume(v).then(function () {
        state.volumeHoldUntil = Date.now() + 1500;
      }, function (err) {
        if (err && err.status === 403) { state.volume = null; paint(); toast('This device can’t change volume'); }
        else actionError(err);
      });
    }, 250);
  }

  // ---- sheets ---------------------------------------------------------------
  var sheetTimer = null;
  function openSheet(id) {
    closeSheets();
    toggle($('scrim'), 'hidden', false);
    toggle($(id), 'hidden', false);
    bumpSheetTimer();
  }
  function closeSheets() {
    // This browser handed its login away, so start over at the login screen.
    if (pairing) return window.location.reload();
    ['picker', 'devices', 'settings', 'pairing'].forEach(function (id) { toggle($(id), 'hidden', true); });
    toggle($('scrim'), 'hidden', true);
    clearTimeout(sheetTimer);
    logoutArmed = pairArmed = false;
    $('logout-btn').textContent = 'Log out';
    $('pair-btn').textContent = 'Send login to iPad';
  }
  // Nobody is around to close a forgotten sheet on a kiosk, so close it automatically.
  function bumpSheetTimer() {
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(closeSheets, C.SHEET_TIMEOUT_MS);
  }

  function fillList(listEl, rows, onPick) {
    listEl.innerHTML = '';
    rows.forEach(function (row) {
      var li = document.createElement('li');
      li.textContent = row.label;
      if (row.note) {
        var note = document.createElement('span');
        note.className = 'note';
        note.textContent = row.note;
        li.appendChild(note);
      }
      if (onPick) li.addEventListener('click', function () { onPick(row, li); });
      else li.className = 'empty';
      listEl.appendChild(li);
    });
  }

  // Playlist picker: only playlists you own or collaborate on can take new tracks.
  function loadPlaylists() {
    if (state.playlists && Date.now() - state.playlistsAt < 10 * 60 * 1000) return Promise.resolve(state.playlists);
    var me = state.me ? Promise.resolve(state.me) : Spotify.getMe();
    return me.then(function (user) {
      state.me = user;
      function page(offset, acc) {
        return Spotify.getMyPlaylists(offset).then(function (data) {
          acc = acc.concat((data && data.items) || []);
          return data && data.next && acc.length < 500 ? page(offset + 50, acc) : acc;
        });
      }
      return page(0, []);
    }).then(function (all) {
      state.playlists = all.filter(function (pl) {
        return pl && (pl.collaborative || (pl.owner && pl.owner.id === state.me.id));
      });
      state.playlistsAt = Date.now();
      return state.playlists;
    });
  }

  function openPicker() {
    if (!state.uri) return;
    var listEl = $('picker-list');
    fillList(listEl, [{ label: 'Loading…' }]);
    openSheet('picker');
    loadPlaylists().then(function (pls) {
      if (!pls.length) return fillList(listEl, [{ label: 'No playlists you can add to.' }]);
      fillList(listEl, pls.map(function (pl) { return { label: pl.name, id: pl.id }; }), addToPlaylist);
    }, function (err) {
      closeSheets();
      actionError(err);
    });
  }

  function addToPlaylist(row, li) {
    if (li.className === 'busy') return;
    li.className = 'busy';
    Spotify.addToPlaylist(row.id, state.uri).then(function () {
      closeSheets();
      toast('Added to ' + row.label);
    }, function (err) {
      li.className = '';
      actionError(err);
    });
  }

  // Device sheet: start or move playback to one of your Spotify devices.
  function openDevices() {
    var listEl = $('devices-list');
    fillList(listEl, [{ label: 'Looking for devices…' }]);
    openSheet('devices');
    Spotify.getDevices().then(function (data) {
      var devices = (data && data.devices) || [];
      if (!devices.length) return fillList(listEl, [{ label: 'No devices found. Open Spotify on your Mac or phone.' }]);
      fillList(listEl, devices.map(function (d) {
        return { label: d.name, note: d.is_active ? 'Playing here' : d.type, id: d.id };
      }), function (row) {
        closeSheets();
        Spotify.transfer(row.id, true).then(afterAction, actionError);
      });
    }, function (err) {
      closeSheets();
      actionError(err);
    });
  }

  var logoutArmed = false;
  function openSettings() {
    var expires = DeckAuth.loginExpiresAt();
    $('login-expiry').textContent = expires
      ? 'Spotify will ask you to log in again around ' +
        new Date(expires).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + '.'
      : '';
    applySettings();
    openSheet('settings');
  }

  function onLogout() {
    // Two taps, so a stray touch can't log the kiosk out.
    if (!logoutArmed) {
      logoutArmed = true;
      $('logout-btn').textContent = 'Tap again to log out';
      return;
    }
    DeckAuth.logout();
    window.location.reload();
  }

  // ---- pairing: hand this browser's login to the iPad -----------------------
  var QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  var QR_SRI = 'sha512-CNgIRecGo7nphbeZ04Sc13ka07paqdeTu0WR1IM4kNcpmBAUSHSQX0FslNhTDadL4O5SAGapGt4FodqL8My0mA==';
  var pairArmed = false, pairing = false;

  function loadQrLib() {
    if (window.QRCode) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = QR_LIB;
      s.integrity = QR_SRI;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function onSendLogin() {
    if (!pairArmed) {
      pairArmed = true;
      $('pair-btn').textContent = 'Tap again: this browser will log out';
      return;
    }
    // Only computers need the QR library, so it's loaded on demand rather than on the iPad.
    loadQrLib().then(function () {
      var link = DeckAuth.handOff();
      if (!link) return toast('Log in here first');
      stopped = true;
      openSheet('pairing');
      clearTimeout(sheetTimer);
      pairing = true;
      new QRCode($('pair-qr'), { text: link, width: 320, height: 320, correctLevel: QRCode.CorrectLevel.L });
      // Don't leave a login on screen indefinitely.
      sheetTimer = setTimeout(closeSheets, 5 * 60 * 1000);
    }, function () {
      toast('Couldn’t load the QR code maker. Check the connection.');
    });
  }

  // ---- login ----------------------------------------------------------------
  function showLogin(message) {
    stopped = true;
    closeSheets();
    $('login-msg').textContent = message || (DeckAuth.isLoggedIn() ? '' : 'Spotify needs you to log in again.');
    show('login');
  }

  // ---- input ----------------------------------------------------------------
  function setupSettingsHotspot() {
    var timer = null;
    var spot = $('settings-hotspot');
    function start(e) {
      e.preventDefault();
      clearTimeout(timer);
      timer = setTimeout(openSettings, C.SETTINGS_LONG_PRESS_MS);
    }
    function cancel() { clearTimeout(timer); }
    spot.addEventListener('touchstart', start);
    spot.addEventListener('touchend', cancel);
    spot.addEventListener('touchcancel', cancel);
    spot.addEventListener('mousedown', start);
    spot.addEventListener('mouseup', cancel);
    spot.addEventListener('mouseleave', cancel);
  }

  function setupKioskGuards() {
    // No pinch-zoom, no rubber-band scrolling (except inside scrolling lists), no callouts.
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('touchmove', function (e) {
      var el = e.target;
      while (el && el !== document.body) {
        if (el.classList && el.classList.contains('scroll')) return;
        el = el.parentNode;
      }
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // Catch up straight away after the network or the screen comes back.
    window.addEventListener('online', function () { pollSoon(0); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) pollSoon(0); });
    window.addEventListener('resize', scaleStage);
    window.addEventListener('orientationchange', function () { setTimeout(scaleStage, 300); });
  }

  function setupThemePicker() {
    var box = $('theme-picker');
    Object.keys(THEMES).forEach(function (name) {
      var b = document.createElement('button');
      b.setAttribute('data-setting', 'theme');
      b.setAttribute('data-value', name);
      b.textContent = THEMES[name].label;
      box.appendChild(b);
    });
  }

  function setupControls() {
    // One listener for every layout's buttons.
    $('deck').addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-action]');
      var fn = el && ACTIONS[el.getAttribute('data-action')];
      if (fn) fn();
    });
    $('login-btn').addEventListener('click', function () { DeckAuth.login(); });

    // Tapping the idle clock brings back a paused track, or offers devices to play on.
    $('idle').addEventListener('click', function () {
      if (state.uri) { state.wokeAt = Date.now(); show('deck'); }
      else openDevices();
    });

    $('scrim').addEventListener('click', closeSheets);
    list(document, '.sheet-close').forEach(function (b) { b.addEventListener('click', closeSheets); });
    list(document, '.sheet').forEach(function (s) { s.addEventListener('touchstart', bumpSheetTimer); });

    list(document, '[data-setting]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = this.getAttribute('data-setting'), raw = this.getAttribute('data-value');
        settings[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
        saveSettings();
        if (key === 'theme') setTheme(raw);
      });
    });
    $('devices-btn').addEventListener('click', openDevices);
    $('reload-btn').addEventListener('click', function () { window.location.reload(); });
    $('logout-btn').addEventListener('click', onLogout);
    $('pair-btn').addEventListener('click', onSendLogin);
  }

  function boot() {
    setupKioskGuards();
    setupSettingsHotspot();
    setupThemePicker();
    setupControls();
    applySettings();
    setTheme(settings.theme);
    setInterval(tick, 1000);

    // The Home Screen app doesn't need the pairing button; the iPad is the one receiving logins.
    toggle($('pair-btn'), 'hidden', !!window.navigator.standalone);

    // A pairing link opened in iOS Safari: the login has to land in the Home Screen app, which
    // has its own storage. Keep the link in the address bar so Add to Home Screen captures it.
    var onIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (DeckAuth.hasPairing() && onIOS && !window.navigator.standalone) {
      stopped = true;
      $('login-msg').textContent = 'Almost there. Tap Share, then Add to Home Screen, then open Deck from your Home Screen.';
      toggle($('login-btn'), 'hidden', true);
      toggle($('login-hint'), 'hidden', true);
      show('login');
      return;
    }

    DeckAuth.importPairing().then(function (pairError) {
      return DeckAuth.handleCallback().then(function (error) { return error || pairError; });
    }).then(function (error) {
      if (error || !DeckAuth.isLoggedIn()) {
        stopped = true;
        $('login-msg').textContent = error || '';
        show('login');
        return;
      }
      show('idle');
      poll();
    });
  }

  boot();
})();
