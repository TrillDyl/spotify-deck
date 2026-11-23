// UI: boot, polling loop, layout, controls, sheets (playlists, browse, devices, settings), idle clock.
//
// The layout is <template id="tpl-classic"> in index.html. Its markup names what it shows and
// the engine fills it in:
//   data-t="title"           text (see textFor for every key)
//   data-p="s|l"             song progress as scaleX or left %
//   data-v="w|l"             volume as width % or left %
//   data-show="volume"       shown only when that data exists ("!queue" = only when it doesn't)
//   img data-art             album art
//   data-action="play|prev|next|like|add|browse|devices"  buttons
//   data-action="queue"      shows or hides Up next (root gets queue-open); the queue is only
//                            fetched while it's showing
//   data-queue-list          the whole queue as rows: scroll it, tap a song to skip to it, swipe
//                            left to remove it
//   data-vol-control         drag sideways to change the volume
//   data-seek-control        drag along it to move through the song (root gets can-seek, and
//                            seeking while a finger is down)
// The layout's root gets is-playing, is-liked, has-volume, has-queue, queue-open and can-seek.
(function () {
  var C = DECK_CONFIG;
  var SETTINGS_KEY = 'deck.settings';
  var DIM_LEVELS = [0, 0.3, 0.6];
  var BOOT_AT = Date.now();

  var state = {
    view: null,          // 'login' | 'deck' | 'idle'
    item: null,          // current track or episode
    uri: null,
    art: { big: '', small: '' },
    playing: false,
    liked: false,
    device: '',
    deviceId: '',        // last device seen playing; kept while idle so new playback can target it
    progressMs: 0,
    durationMs: 0,
    progressAt: 0,       // Date.now() when progressMs was measured
    pausedSince: 0,
    wokeAt: 0,           // last tap on the idle clock
    endPolled: false,
    errors: 0,
    volume: null,        // 0–100, or null when the device can't change volume
    volumeHoldUntil: 0,  // ignore polled volume while the user is dragging
    canSeek: false,      // Spotify allows seeking in this item (not during ads, on some speakers)
    seekRatio: null,     // 0–1 while a finger is on the progress bar
    seekHoldUntil: 0,    // ignore polled progress until Spotify has caught up with a seek
    queue: [],           // what Up next shows: Spotify's queue minus songs removed here
    queueAll: [],        // Spotify's queue as fetched
    queueAt: 0,
    skip: {},            // URI → how many upcoming plays to skip (songs removed from Up next)
    context: '',         // playlist or album playing, so removals can be dropped when it changes
    jumping: false,      // skipping forward to a tapped song
    me: null,
    playlists: null,
    playlistsAt: 0
  };
  var settings = loadSettings();
  var layout = null;

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
    delete s.theme;  // left over from when there were several layouts
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

  // ---- layout ---------------------------------------------------------------
  function buildLayout() {
    var stage = $('deck');
    stage.innerHTML = '';
    var root = document.importNode($('tpl-classic').content, true).firstElementChild;
    stage.appendChild(root);
    layout = {
      root: root,
      texts: list(root, '[data-t]'),
      progs: list(root, '[data-p]'),
      vols: list(root, '[data-v]'),
      shows: list(root, '[data-show]'),
      arts: list(root, 'img[data-art]'),
      queueList: root.querySelector('[data-queue-list]')
    };
    setupVolumeControls(root);
    setupSeekControls(root);
    setupQueueList(layout.queueList);
    renderQueueList();
    paintArt();
    paintBackground(state.art.small);
    paint();
    state.queueAt = 0;
    loadQueue();
  }

  // ---- painting -------------------------------------------------------------
  function ratio() {
    if (state.seekRatio !== null) return state.seekRatio;
    if (!state.durationMs) return 0;
    var ms = state.progressMs + (state.playing ? Date.now() - state.progressAt : 0);
    return Math.max(0, Math.min(1, ms / state.durationMs));
  }

  function fmtMs(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + pad2(s % 60);
  }

  function textFor(key) {
    var item = state.item || {};
    var now = new Date();
    switch (key) {
      case 'title': return item.name || '';
      case 'artist':
        return (item.artists || []).map(function (a) { return a.name; }).join(', ') ||
          (item.show && item.show.name) || '';
      case 'album': return (item.album && item.album.name) || '';
      case 'status': return state.device ? (state.playing ? 'Playing on ' : 'Paused on ') + state.device : '';
      case 'time': return ((now.getHours() % 12) || 12) + ':' + pad2(now.getMinutes());
      case 'date': return now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      case 'elapsed': return fmtMs(ratio() * state.durationMs);
      case 'duration': return fmtMs(state.durationMs);
    }
    return '';
  }

  function visible(key) {
    if (key.charAt(0) === '!') return !visible(key.slice(1));
    if (key === 'queue') return state.queue.length > 0;
    if (key === 'volume') return state.volume !== null;
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
  }

  function paint() {
    if (!layout || state.view !== 'deck') return;
    var root = layout.root;
    toggle(root, 'is-playing', state.playing);
    toggle(root, 'is-liked', state.liked);
    toggle(root, 'can-seek', state.canSeek && state.durationMs > 0);
    toggle(root, 'has-volume', state.volume !== null);
    toggle(root, 'has-queue', state.queue.length > 0);
    toggle(root, 'queue-open', !!settings.showQueue);

    layout.shows.forEach(function (el) { toggle(el, 'hidden', !visible(el.getAttribute('data-show'))); });
    layout.texts.forEach(function (el) {
      var v = textFor(el.getAttribute('data-t'));
      if (el._v === v) return;
      el._v = v;
      el.textContent = v;
    });
    var r = ratio();
    layout.progs.forEach(function (el) { meter(el, el.getAttribute('data-p'), r); });
    var vr = (state.volume || 0) / 100;
    layout.vols.forEach(function (el) { meter(el, el.getAttribute('data-v'), vr); });
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
    if (!layout) return;
    layout.arts.forEach(function (el) { setImg(el, state.art.big); });
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

  function isNoDevice(err) {
    return !!err && (err.reason === 'NO_ACTIVE_DEVICE' || (err.status === 404 && /device/i.test(err.message)));
  }

  function actionError(err) {
    if (err && err.code === 'logged_out') return showLogin();
    var status = err && err.status;
    if (status === 0) toast('No connection');
    else if (status === 429) toast('Spotify is busy. Try again in a moment.');
    else if (isNoDevice(err)) {
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
    if (p && p.device && p.device.id) state.deviceId = p.device.id;
    if (!item) {
      state.uri = null;
      state.item = null;
      state.playing = false;
      show('idle');
      return;
    }

    state.playing = !!p.is_playing;
    if (Date.now() > state.seekHoldUntil || item.uri !== state.uri) {
      state.progressMs = p.progress_ms || 0;
      state.progressAt = Date.now();
    }
    state.durationMs = item.duration_ms || 0;
    var disallows = p.actions && p.actions.disallows;
    state.canSeek = !(disallows && disallows.seeking);
    state.device = (p.device && p.device.name) || '';
    if (Date.now() > state.volumeHoldUntil) {
      state.volume = p.device && p.device.supports_volume !== false && typeof p.device.volume_percent === 'number'
        ? p.device.volume_percent : null;
    }
    state.item = item;
    // A different playlist or album brings a different queue, so earlier removals no longer apply.
    // (An empty context, e.g. while a queued song plays, isn't a change.)
    var context = (p.context && p.context.uri) || '';
    if (context && state.context && context !== state.context) state.skip = {};
    if (context) state.context = context;
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
      small: images.length ? images[images.length - 1].url : ''
    };
    if (layout) toggle(layout.root, 'is-skipping', false);
    paintArt();
    paintBackground(state.art.small);

    // A song removed from Up next has come up: skip it.
    if (!state.jumping && takeSkip(item.uri)) Spotify.next().then(afterAction, function () {});

    var uri = item.uri;
    Spotify.isSaved(uri).then(function (saved) {
      if (state.uri === uri) { state.liked = saved; paint(); }
    }, function () {});
    state.queueAt = 0;
    loadQueue();
  }

  // The queue, only while Up next is open.
  function loadQueue() {
    var now = Date.now();
    if (settings.showQueue && state.item && now - state.queueAt > 2 * 60 * 1000) {
      state.queueAt = now;
      Spotify.getQueue().then(setQueue, function () {});
    }
  }

  // ---- queue ----------------------------------------------------------------
  // Spotify's API can't remove a song from the queue or jump to one. So Remove hides the song and
  // the deck skips it when it comes up, and tapping a song skips forward to it (as the Spotify
  // app does).
  function setQueue(d) {
    state.queueAll = ((d && d.queue) || []).map(function (q, i) {
      var imgs = (q.album && q.album.images) || q.images || [];
      return {
        index: i,  // position in Spotify's queue
        uri: q.uri,
        title: q.name || '',
        artist: (q.artists || []).map(function (a) { return a.name; }).join(', ') || (q.show && q.show.name) || '',
        art: imgs.length ? imgs[imgs.length - 1].url : ''
      };
    });
    // Forget removals for songs that have left the queue some other way.
    var playing = d && d.currently_playing && d.currently_playing.uri;
    Object.keys(state.skip).forEach(function (uri) {
      var left = state.queueAll.filter(function (q) { return q.uri === uri; }).length + (uri === playing ? 1 : 0);
      state.skip[uri] = Math.min(state.skip[uri], left);
      if (!state.skip[uri]) delete state.skip[uri];
    });
    applyQueue();
  }

  // Hide removed songs. A removal hides (and later skips) that song's next appearance.
  function applyQueue() {
    var hide = {};
    Object.keys(state.skip).forEach(function (uri) { hide[uri] = state.skip[uri]; });
    state.queue = state.queueAll.filter(function (q) {
      if (!hide[q.uri]) return true;
      hide[q.uri]--;
      return false;
    });
    renderQueueList();
    paint();
  }

  function takeSkip(uri) {
    if (!state.skip[uri]) return false;
    if (!--state.skip[uri]) delete state.skip[uri];
    return true;
  }

  var openRow = null;  // the Up next row showing its Remove button

  function renderQueueList() {
    if (!layout) return;
    var listEl = layout.queueList;
    // Rebuilding resets the scroll position and reloads art, so skip it when nothing changed.
    var key = state.queue.map(function (q) { return q.uri; }).join(' ');
    if (listEl._key === key) return;
    listEl._key = key;
    openRow = null;
    listEl.innerHTML = '';
    state.queue.forEach(function (q, i) {
      var row = el('div', 'c-qrow');
      row.setAttribute('data-i', i);
      var slide = el('div', 'c-qslide');
      var art = el('img');
      art.alt = '';
      if (q.art) art.src = q.art;
      var text = el('div', 'c-qtext');
      text.appendChild(el('div', 'c-qt', q.title));
      text.appendChild(el('div', 'c-qa', q.artist));
      slide.appendChild(art);
      slide.appendChild(text);
      var remove = el('button', 'c-qremove', 'Remove');
      remove.type = 'button';
      row.appendChild(slide);
      row.appendChild(remove);
      listEl.appendChild(row);
    });
  }

  // Tap a song to skip to it; swipe it left to reveal Remove.
  function setupQueueList(listEl) {
    var drag = null;
    function point(e) { return e.touches ? e.touches[0] : e; }
    function removeWidth(row) { return row.lastChild.offsetWidth; }
    function slideTo(row, d, animate) {
      toggle(row, 'dragging', !animate);
      var slide = row.firstChild.style, remove = row.lastChild.style;
      slide.webkitTransform = slide.transform = 'translateX(' + (-d) + 'px)';
      remove.webkitTransform = remove.transform = 'translateX(' + (removeWidth(row) - d) + 'px)';
    }
    function closeOpen() {
      if (openRow) slideTo(openRow, 0, true);
      openRow = null;
    }
    function start(e) {
      var row = e.target.closest && e.target.closest('.c-qrow');
      if (!row || e.target.closest('.c-qremove')) return;
      var p = point(e);
      drag = { row: row, x: p.clientX, y: p.clientY, base: row === openRow ? removeWidth(row) : 0, d: 0, axis: '' };
    }
    function move(e) {
      if (!drag) return;
      var p = point(e), dx = p.clientX - drag.x, dy = p.clientY - drag.y;
      if (!drag.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (drag.axis === 'x' && openRow !== drag.row) closeOpen();
      }
      if (drag.axis !== 'x') return;
      e.preventDefault();  // swiping a row, not scrolling the list
      drag.d = Math.max(0, Math.min(removeWidth(drag.row), drag.base - dx));
      slideTo(drag.row, drag.d, false);
    }
    function end() {
      if (!drag) return;
      var row = drag.row;
      if (drag.axis === 'x') {
        row._swipedAt = Date.now();  // the click that follows a swipe isn't a tap
        if (drag.d > removeWidth(row) / 2) {
          openRow = row;
          slideTo(row, removeWidth(row), true);
        } else {
          if (openRow === row) openRow = null;
          slideTo(row, 0, true);
        }
      }
      drag = null;
    }
    listEl.addEventListener('touchstart', start);
    listEl.addEventListener('touchmove', move, { passive: false });
    listEl.addEventListener('touchend', end);
    listEl.addEventListener('touchcancel', end);
    listEl.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    listEl.addEventListener('click', function (e) {
      var row = e.target.closest && e.target.closest('.c-qrow');
      if (!row || Date.now() - (row._swipedAt || 0) < 400) return;
      var q = state.queue[Number(row.getAttribute('data-i'))];
      if (!q) return;
      if (e.target.closest('.c-qremove')) return removeQueued(q);
      if (openRow) return closeOpen();  // with Remove showing, a tap just hides it
      jumpTo(q);
    });
  }

  function removeQueued(q) {
    state.skip[q.uri] = (state.skip[q.uri] || 0) + 1;
    applyQueue();
    toast('Removed ' + q.title);
  }

  function jumpTo(q) {
    if (state.jumping) return;
    state.jumping = true;
    toggle(layout.root, 'is-skipping', true);
    toast('Playing ' + q.title);
    var passed = state.queueAll.slice(0, q.index);
    function skip(n) { return n ? Spotify.next().then(function () { return skip(n - 1); }) : Promise.resolve(); }
    skip(q.index + 1).then(function () {
      // The songs skipped on the way have left the queue, removed ones included.
      passed.forEach(function (s) { takeSkip(s.uri); });
      state.queueAll = state.queueAll.slice(q.index + 1);
      state.queueAll.forEach(function (s, i) { s.index = i; });
      applyQueue();
    }, function (err) {
      toggle(layout.root, 'is-skipping', false);
      actionError(err);
    }).then(function () {
      state.jumping = false;
      state.queueAt = 0;  // fetch the real queue again
      afterAction();
    });
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
      loadQueue();
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
    toggle(layout.root, 'is-skipping', true);
    (next ? Spotify.next() : Spotify.previous()).then(afterAction, function (err) {
      toggle(layout.root, 'is-skipping', false);
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
    browse: function () { openBrowse(); },
    queue: function () {
      settings.showQueue = !settings.showQueue;
      saveSettings();
      state.queueAt = 0;  // fetch it now rather than showing an old list
      loadQueue();
      paint();
    },
    devices: function () { openDevices(); }
  };

  // Volume: drag the slider sideways; send it once the finger rests.
  var volTimer = null;
  function setupVolumeControls(root) {
    list(root, '[data-vol-control]').forEach(function (el) {
      var dragging = false;
      function point(e) { return e.touches ? e.touches[0] : e; }
      function update(e) {
        var rect = el.getBoundingClientRect();
        var v = (point(e).clientX - rect.left) / rect.width * 100;
        setVolume(Math.max(0, Math.min(100, Math.round(v))));
      }
      function start(e) {
        if (state.volume === null) return;
        e.preventDefault();
        dragging = true;
        update(e);
      }
      function move(e) { if (dragging) { e.preventDefault(); update(e); } }
      function end() { dragging = false; }
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

  // Seek: drag along the progress bar to preview the spot; the song jumps there when the finger lifts.
  function setupSeekControls(root) {
    list(root, '[data-seek-control]').forEach(function (el) {
      var dragging = false;
      function point(e) {
        if (e.touches && e.touches.length) return e.touches[0];
        return e.changedTouches ? e.changedTouches[0] : e;  // touchend only has changedTouches
      }
      function at(e) {
        var rect = el.getBoundingClientRect();
        return Math.max(0, Math.min(1, (point(e).clientX - rect.left) / rect.width));
      }
      function start(e) {
        if (!state.canSeek || !state.durationMs) return;
        e.preventDefault();
        dragging = true;
        state.seekRatio = at(e);
        toggle(root, 'seeking', true);
        paint();
      }
      function move(e) {
        if (!dragging) return;
        e.preventDefault();
        state.seekRatio = at(e);
        paint();
      }
      function stop() {
        dragging = false;
        state.seekRatio = null;
        toggle(root, 'seeking', false);
      }
      function end(e) {
        if (!dragging) return;
        var r = at(e);
        stop();
        seekTo(Math.round(r * state.durationMs));
      }
      function cancel() {
        if (!dragging) return;
        stop();
        paint();
      }
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchmove', move, { passive: false });
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', cancel);
      el.addEventListener('mousedown', start);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', end);
    });
  }

  function seekTo(ms) {
    var before = { ms: state.progressMs, at: state.progressAt };
    state.progressMs = ms;
    state.progressAt = Date.now();
    state.seekHoldUntil = Date.now() + 4000;  // don't let a poll from before the seek pull the bar back
    state.endPolled = false;
    paint();
    Spotify.seek(ms).then(function () { pollSoon(1000); }, function (err) {
      state.seekHoldUntil = 0;
      state.progressMs = before.ms;
      state.progressAt = before.at;
      paint();
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
    // This browser handed its login away, so start over at the login screen.
    if (pairing) return window.location.reload();
    ['picker', 'browse', 'devices', 'settings', 'pairing'].forEach(function (id) { toggle($(id), 'hidden', true); });
    $('search-input').blur();
    clearTimeout(search.timer);
    search.seq++;  // drop any search still in flight
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

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  // rows: { label, note?, cls?, inert? }. Rows are tappable when onPick is given, unless inert.
  function fillList(listEl, rows, onPick) {
    listEl.innerHTML = '';
    rows.forEach(function (row) {
      var li = el('li');
      var live = onPick && !row.inert;
      li.className = row.cls || (live ? '' : 'empty');
      li.appendChild(el('span', 'label', row.label));
      if (row.note) li.appendChild(el('span', 'note', row.note));
      if (live) li.addEventListener('click', function () { onPick(row, li); });
      listEl.appendChild(li);
    });
  }

  // Every playlist in your library. Any of them can be played; only playlists you own or
  // collaborate on can take new tracks.
  function canAddTo(pl) {
    return pl.collaborative || (pl.owner && pl.owner.id === state.me.id);
  }

  // Everything /me/playlists returns: ones you made and public ones you saved. fresh skips the
  // 10-minute cache.
  function loadPlaylists(fresh) {
    if (!fresh && state.playlists && Date.now() - state.playlistsAt < 10 * 60 * 1000) return Promise.resolve(state.playlists);
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
      state.playlists = all.filter(Boolean);
      state.playlistsAt = Date.now();
      return state.playlists;
    });
  }

  function openPicker() {
    if (!state.uri) return;
    var listEl = $('picker-list');
    fillList(listEl, [{ label: 'Loading…' }]);
    openSheet('picker');
    loadPlaylists().then(function (all) {
      var pls = all.filter(canAddTo);
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

  // ---- browse: play one of your playlists, or search for a song -------------
  var search = { q: '', seq: 0, timer: null };

  function openBrowse() {
    // Start fresh each time: on a kiosk the last search could be hours old.
    $('search-input').value = '';
    openSheet('browse');
    setQuery('');
  }

  function setQuery(raw) {
    clearTimeout(search.timer);
    search.timer = null;
    search.q = raw.replace(/^\s+|\s+$/g, '');
    toggle($('search-clear'), 'hidden', !raw);
    if (!search.q) {
      search.seq++;
      showPlaylists();
      return;
    }
    // Wait for a pause in typing so each keystroke isn't a request.
    search.timer = setTimeout(function () { search.timer = null; runSearch(0); }, 450);
  }

  function showPlaylists() {
    var listEl = $('browse-list');
    var seq = search.seq;
    // Show what we have right away, then refetch so a playlist saved in the Spotify app since
    // the last look shows up without waiting out the cache.
    var shown = state.playlists;
    if (shown) render(shown);
    else fillList(listEl, [{ label: 'Loading…' }]);
    loadPlaylists(true).then(function (pls) {
      if (seq !== search.seq) return;  // a search started or the sheet closed meanwhile
      if (shown && samePlaylists(shown, pls)) return;  // unchanged: keep the scroll position
      render(pls);
    }, function (err) {
      if (shown) return;  // the cached list is still up
      closeSheets();
      actionError(err);
    });

    function render(pls) {
      var rows = [];
      if (!state.uri) rows.push({ label: 'Resume on a device…', resume: true });
      rows.push({ label: 'Your playlists', cls: 'section', inert: true });
      if (!pls.length) rows.push({ label: 'No playlists yet.', cls: 'empty', inert: true });
      pls.forEach(function (pl) {
        var mine = canAddTo(pl);
        var count = pl.items || pl.tracks;
        rows.push({
          label: pl.name,
          note: !mine && pl.owner && pl.owner.display_name ? 'by ' + pl.owner.display_name
            : count && typeof count.total === 'number' ? count.total + ' songs' : '',
          uri: pl.uri
        });
      });
      fillList(listEl, rows, function (row) {
        if (row.resume) openDevices();
        else startPlayback({ context_uri: row.uri }, row.label);
      });
    }
  }

  function samePlaylists(a, b) {
    return a.length === b.length && a.every(function (pl, i) { return pl.id === b[i].id && pl.name === b[i].name; });
  }

  function runSearch(offset) {
    var q = search.q, seq = ++search.seq, listEl = $('browse-list');
    if (!offset) fillList(listEl, [{ label: 'Searching…' }]);
    Spotify.searchTracks(q, offset).then(function (data) {
      if (seq !== search.seq) return;  // a newer search replaced this one
      var page = (data && data.tracks) || {};
      var tracks = (page.items || []).filter(Boolean);
      if (!offset && !tracks.length) return fillList(listEl, [{ label: 'No songs found for “' + q + '”.' }]);
      if (!offset) listEl.innerHTML = '';
      var more = listEl.querySelector('.more');
      if (more) listEl.removeChild(more);
      tracks.forEach(function (t) { listEl.appendChild(trackRow(t)); });
      // Spotify returns 10 at a time; stop at 50 to keep the list light on the iPad.
      if (page.next && offset + 10 < 50) {
        more = el('li', 'more', 'More results');
        more.addEventListener('click', function () {
          if (more.textContent !== 'More results') return;
          more.textContent = 'Loading…';
          runSearch(offset + 10);
        });
        listEl.appendChild(more);
      }
    }, function (err) {
      if (seq !== search.seq) return;
      if (err && err.code === 'logged_out') return actionError(err);
      var msg = err && err.status === 0 ? 'No connection. Try again.'
        : err && err.status === 429 ? 'Spotify is busy. Try again in a moment.'
        : 'Search didn’t work. Try again.';
      if (!offset) return fillList(listEl, [{ label: msg }]);
      toast(msg);
      var more = listEl.querySelector('.more');
      if (more) more.textContent = 'More results';
    });
  }

  function trackRow(t) {
    var li = el('li', 'track');
    var imgs = (t.album && t.album.images) || [];
    var art = el('img', 'track-art');
    art.alt = '';
    if (imgs.length) art.src = imgs[imgs.length - 1].url;  // the smallest (64px)
    var text = el('div', 'track-text');
    text.appendChild(el('div', 'track-title', t.name || ''));
    text.appendChild(el('div', 'track-artist', (t.artists || []).map(function (a) { return a.name; }).join(', ')));
    var queue = el('button', 'track-queue', '+ Queue');
    queue.type = 'button';
    queue.setAttribute('aria-label', 'Add to queue');
    queue.addEventListener('click', function (e) {
      e.stopPropagation();
      queueTrack(t, li);
    });
    li.appendChild(art);
    li.appendChild(text);
    li.appendChild(queue);
    li.addEventListener('click', function () {
      // Play it within its album so music keeps going after the song ends.
      startPlayback(t.album && t.album.uri ? { context_uri: t.album.uri, offset: { uri: t.uri } } : { uris: [t.uri] }, t.name);
    });
    return li;
  }

  function queueTrack(t, li) {
    if (li.classList.contains('busy')) return;
    toggle(li, 'busy', true);
    Spotify.addToQueue(t.uri).then(function () {
      toggle(li, 'busy', false);
      toast('Queued ' + t.name);
      state.queueAt = 0;  // refresh Up next
    }, function (err) {
      toggle(li, 'busy', false);
      if (isNoDevice(err)) toast('Start playing something first, then queue songs.');
      else actionError(err);
    });
  }

  // Start a playlist, album or track. Target the last device seen so this works from the idle
  // clock too; if that device is gone, ask which one to play on.
  function startPlayback(body, label) {
    closeSheets();
    function done() {
      toast('Playing ' + label);
      afterAction();
    }
    Spotify.playItems(body, state.deviceId).then(done, function (err) {
      if (!isNoDevice(err)) return actionError(err);
      openDevices(function (device) {
        state.deviceId = device.id;
        Spotify.playItems(body, device.id).then(done, actionError);
      });
    });
  }

  // Device sheet: start or move playback to one of your Spotify devices, or with onPick, choose
  // a device for something else (like starting a playlist).
  function openDevices(onPick) {
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
        if (onPick) return onPick(row);
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
  }

  function setupControls() {
    // One listener for all the layout's buttons.
    $('deck').addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-action]');
      var fn = el && ACTIONS[el.getAttribute('data-action')];
      if (fn) fn();
    });
    $('login-btn').addEventListener('click', function () { DeckAuth.login(); });

    // Tapping the idle clock brings back a paused track, or opens Browse to start something.
    $('idle').addEventListener('click', function () {
      if (state.uri) { state.wokeAt = Date.now(); show('deck'); }
      else openBrowse();
    });

    // Search box. Search runs as you type; the keyboard's Search key just hides the keyboard.
    var input = $('search-input');
    input.addEventListener('input', function () {
      bumpSheetTimer();
      setQuery(input.value);
    });
    $('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      input.blur();
      // Typed and hit Search before the pause: search now instead of waiting.
      if (search.q && search.timer) { clearTimeout(search.timer); search.timer = null; runSearch(0); }
    });
    // iOS 12 can leave the page pushed up after the keyboard closes.
    input.addEventListener('blur', function () { window.scrollTo(0, 0); });
    $('search-clear').addEventListener('click', function () {
      input.value = '';
      setQuery('');
    });

    $('scrim').addEventListener('click', closeSheets);
    list(document, '.sheet-close').forEach(function (b) { b.addEventListener('click', closeSheets); });
    list(document, '.sheet').forEach(function (s) { s.addEventListener('touchstart', bumpSheetTimer); });

    list(document, '[data-setting]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = this.getAttribute('data-setting'), raw = this.getAttribute('data-value');
        settings[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
        saveSettings();
      });
    });
    $('devices-btn').addEventListener('click', function () { openDevices(); });
    $('reload-btn').addEventListener('click', function () { window.location.reload(); });
    $('logout-btn').addEventListener('click', onLogout);
    $('pair-btn').addEventListener('click', onSendLogin);
  }

  function boot() {
    setupKioskGuards();
    setupSettingsHotspot();
    setupControls();
    applySettings();
    buildLayout();
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
