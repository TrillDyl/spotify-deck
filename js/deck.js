// UI: boot, polling loop, rendering, controls, sheets (playlists, devices, settings), idle clock.
(function () {
  var C = DECK_CONFIG;
  var SETTINGS_KEY = 'deck.settings';
  var DIM_LEVELS = [0, 0.3, 0.6];
  var BOOT_AT = Date.now();

  var state = {
    view: null,          // 'login' | 'deck' | 'idle'
    uri: null,           // current track/episode URI
    playing: false,
    liked: false,
    progressMs: 0,
    durationMs: 0,
    progressAt: 0,       // Date.now() when progressMs was measured
    pausedSince: 0,
    wokeAt: 0,           // last tap on the idle clock
    endPolled: false,
    errors: 0,
    me: null,
    playlists: null,
    playlistsAt: 0
  };
  var settings = loadSettings();

  function $(id) { return document.getElementById(id); }
  function toggle(el, cls, on) { el.classList[on ? 'add' : 'remove'](cls); }

  function show(view) {
    if (state.view === view) return;
    state.view = view;
    ['login', 'deck', 'idle'].forEach(function (s) { toggle($(s), 'hidden', s !== view); });
    if (view === 'idle') { closeSheets(); tickClock(true); }
  }

  // ---- settings (stored per device) -----------------------------------------
  function loadSettings() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) {}
    return s || { dim: 0, idleDim: 0 };
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
    applySettings();
  }
  function applySettings() {
    $('dim').style.opacity = DIM_LEVELS[settings.dim] || 0;
    toggle($('idle'), 'dimmer', settings.idleDim === 1);
    var buttons = document.querySelectorAll('[data-setting]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      toggle(b, 'on', settings[b.getAttribute('data-setting')] === Number(b.getAttribute('data-value')));
    }
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

  // ---- rendering ------------------------------------------------------------
  function render(p) {
    var item = p && p.item;
    if (!item) {
      state.uri = null;
      state.playing = false;
      show('idle');
      return;
    }

    state.playing = !!p.is_playing;
    state.progressMs = p.progress_ms || 0;
    state.durationMs = item.duration_ms || 0;
    state.progressAt = Date.now();
    if (item.uri !== state.uri) renderItem(item);

    toggle($('btn-play'), 'is-playing', state.playing);
    var device = p.device && p.device.name;
    $('device').textContent = device ? (state.playing ? 'Playing on ' : 'Paused on ') + device : '';
    tickProgress();

    // Paused for a while: go to the idle clock so the screen doesn't burn in.
    if (state.playing) {
      state.pausedSince = 0;
      show('deck');
    } else {
      if (!state.pausedSince) state.pausedSince = Date.now();
      var since = Math.max(state.pausedSince, state.wokeAt);
      show(Date.now() - since > C.IDLE_AFTER_PAUSE_MS ? 'idle' : 'deck');
    }
  }

  function renderItem(item) {
    state.uri = item.uri;
    state.endPolled = false;
    setLiked(false);

    var images = (item.album && item.album.images) || item.images || [];
    var artists = (item.artists || []).map(function (a) { return a.name; }).join(', ');
    $('title').textContent = item.name || '';
    $('artist').textContent = artists || (item.show && item.show.name) || '';
    $('album').textContent = (item.album && item.album.name) || '';
    setArt(images.length ? images[0].url : '');
    paintBackground(images.length ? images[images.length - 1].url : '');

    var uri = item.uri;
    Spotify.isSaved(uri).then(function (saved) {
      if (state.uri === uri) setLiked(saved);
    }, function () {});
  }

  function setArt(url) {
    var art = $('art');
    if (!url) { art.removeAttribute('src'); return; }
    toggle(art, 'fading', true);
    var img = new Image();
    img.onload = img.onerror = function () {
      art.src = url;
      toggle(art, 'fading', false);
    };
    img.src = url;
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

  function setLiked(on) {
    state.liked = on;
    toggle($('btn-like'), 'is-liked', on);
  }

  // ---- progress bar and clock (one timer for both) --------------------------
  function tickProgress() {
    if (!state.durationMs) return;
    var ms = state.progressMs + (state.playing ? Date.now() - state.progressAt : 0);
    var ratio = Math.max(0, Math.min(1, ms / state.durationMs));
    var fill = $('progress-fill');
    fill.style.webkitTransform = fill.style.transform = 'scaleX(' + ratio + ')';
    // Track just ended: ask Spotify what's next instead of waiting for the next poll.
    if (ratio >= 1 && state.playing && !state.endPolled) { state.endPolled = true; pollSoon(600); }
  }

  var lastMinute = -1, lastDrift = 0;
  function tickClock(force) {
    var now = new Date();
    if (force || now.getMinutes() !== lastMinute) {
      lastMinute = now.getMinutes();
      var h = now.getHours() % 12 || 12;
      $('clock-time').textContent = h + ':' + String(now.getMinutes()).padStart(2, '0');
      $('clock-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
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
    if (state.view === 'deck') tickProgress();
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
    state.playing = !wasPlaying;
    state.progressMs += wasPlaying ? Date.now() - state.progressAt : 0;
    state.progressAt = Date.now();
    toggle($('btn-play'), 'is-playing', state.playing);
    (wasPlaying ? Spotify.pause() : Spotify.play()).then(afterAction, function (err) {
      state.playing = wasPlaying;
      toggle($('btn-play'), 'is-playing', wasPlaying);
      actionError(err);
    });
  }

  function onSkip(next) {
    toggle($('art'), 'fading', true);
    (next ? Spotify.next() : Spotify.previous()).then(afterAction, function (err) {
      toggle($('art'), 'fading', false);
      actionError(err);
    });
  }

  function onLike() {
    var uri = state.uri;
    if (!uri) return;
    var was = state.liked;
    setLiked(!was);
    (was ? Spotify.removeFromLibrary(uri) : Spotify.saveToLibrary(uri)).then(function () {
      toast(was ? 'Removed from Liked Songs' : 'Added to Liked Songs');
    }, function (err) {
      if (state.uri === uri) setLiked(was);
      actionError(err);
    });
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
    ['picker', 'devices', 'settings'].forEach(function (id) { toggle($(id), 'hidden', true); });
    toggle($('scrim'), 'hidden', true);
    clearTimeout(sheetTimer);
    logoutArmed = false;
    $('logout-btn').textContent = 'Log out';
  }
  // Nobody is around to close a forgotten sheet on a kiosk, so close it automatically.
  function bumpSheetTimer() {
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(closeSheets, C.SHEET_TIMEOUT_MS);
  }

  function fillList(list, rows, onPick) {
    list.innerHTML = '';
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
      list.appendChild(li);
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
    var list = $('picker-list');
    fillList(list, [{ label: 'Loading…' }]);
    openSheet('picker');
    loadPlaylists().then(function (pls) {
      if (!pls.length) return fillList(list, [{ label: 'No playlists you can add to.' }]);
      fillList(list, pls.map(function (pl) { return { label: pl.name, id: pl.id }; }), addToPlaylist);
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
    var list = $('devices-list');
    fillList(list, [{ label: 'Looking for devices…' }]);
    openSheet('devices');
    Spotify.getDevices().then(function (data) {
      var devices = (data && data.devices) || [];
      if (!devices.length) return fillList(list, [{ label: 'No devices found. Open Spotify on your Mac or phone.' }]);
      fillList(list, devices.map(function (d) {
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
  }

  function setupControls() {
    $('btn-play').addEventListener('click', onPlayPause);
    $('btn-next').addEventListener('click', function () { onSkip(true); });
    $('btn-prev').addEventListener('click', function () { onSkip(false); });
    $('btn-like').addEventListener('click', onLike);
    $('btn-add').addEventListener('click', openPicker);
    $('login-btn').addEventListener('click', function () { DeckAuth.login(); });

    // Tapping the idle clock brings back a paused track, or offers devices to play on.
    $('idle').addEventListener('click', function () {
      if (state.uri) { state.wokeAt = Date.now(); show('deck'); }
      else openDevices();
    });

    $('scrim').addEventListener('click', closeSheets);
    var closers = document.querySelectorAll('.sheet-close');
    for (var i = 0; i < closers.length; i++) closers[i].addEventListener('click', closeSheets);
    var sheets = document.querySelectorAll('.sheet');
    for (i = 0; i < sheets.length; i++) sheets[i].addEventListener('touchstart', bumpSheetTimer);

    var settingButtons = document.querySelectorAll('[data-setting]');
    for (i = 0; i < settingButtons.length; i++) {
      settingButtons[i].addEventListener('click', function () {
        settings[this.getAttribute('data-setting')] = Number(this.getAttribute('data-value'));
        saveSettings();
      });
    }
    $('devices-btn').addEventListener('click', openDevices);
    $('reload-btn').addEventListener('click', function () { window.location.reload(); });
    $('logout-btn').addEventListener('click', onLogout);
  }

  function boot() {
    setupKioskGuards();
    setupSettingsHotspot();
    setupControls();
    applySettings();
    setInterval(tick, 1000);

    DeckAuth.handleCallback().then(function (error) {
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
