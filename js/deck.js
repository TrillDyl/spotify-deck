// UI: boot, polling loop, layout, controls, sheets (devices, settings, diagnostics), idle clock.
// Browse, the playlist picker and new playlists are in js/browse.js.
//
// The layout is <template id="tpl-classic"> in index.html. Its markup names what it shows and
// the engine fills it in:
//   data-t="title"           text (see textFor for every key)
//   data-p="s|x"             song progress as scaleX, or as translateX of a full-width element
//   data-v="w|l"             volume as width % or left %
//   data-show="volume"       shown only when that data exists ("!queue" = only when it doesn't)
//   img data-art             album art
//   data-action="play|prev|next|like|add|browse|devices|shuffle|repeat"  buttons. For an episode,
//                            prev and next go back 15 s and on 30 s instead
//   data-action="queue"      shows or hides Up next (root gets queue-open); the queue is only
//                            fetched while it's showing
//   data-queue-list          the whole queue as rows: scroll it, tap a song to skip to it, swipe
//                            left to remove it
//   data-vol-control         drag sideways to change the volume
//   data-seek-control        drag along it to move through the song (root gets can-seek, and
//                            seeking while a finger is down)
// The layout's root gets is-playing, is-liked, is-episode, is-shuffled, is-repeat-all, is-repeat-one,
// can-shuffle, can-repeat, has-device, has-volume, has-queue, queue-open and can-seek.
(function () {
  var C = DECK_CONFIG;
  var SETTINGS_KEY = 'deck.settings';
  var DEVICE_KEY = 'deck.device';
  var DIM_LEVELS = [0, 0.3, 0.6];
  var BOOT_AT = Date.now();
  var HOUR_MS = 60 * 60 * 1000;
  var DAY_MS = 24 * HOUR_MS;
  var ON_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  var state = {
    view: null,          // 'login' | 'deck' | 'idle'
    item: null,          // current track or episode
    uri: null,
    art: { big: '', small: '' },
    playing: false,
    playHoldUntil: 0,    // ignore polled play/pause until Spotify has caught up with a tap
    liked: false,
    likeTouched: false,  // like was tapped, so a late answer to "is it liked?" doesn't count
    shuffle: false,
    repeat: 'off',       // 'off' | 'context' | 'track'
    canShuffle: false,
    canRepeat: false,
    modeHoldUntil: 0,    // the same for shuffle and repeat
    device: '',
    deviceId: loadDevice(),  // last device seen; kept while idle so new playback can target it
    progressMs: 0,
    durationMs: 0,
    progressAt: 0,       // Date.now() when progressMs was measured
    pausedSince: 0,
    quietSince: 0,       // nothing playing and nobody touching since then: poll less
    wokeAt: 0,           // last tap on the idle clock, a sheet or the turntable
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
    if (view === 'idle') { if (!pairing) closeSheets(); Records.closeShelf(); tickClock(true); }
    if (view === 'deck') paint();
  }

  // ---- settings (stored per device) -----------------------------------------
  function loadSettings() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) {}
    s = s || {};
    if (s.dim === undefined) s.dim = 0;
    if (s.idleDim === undefined) s.idleDim = 0;
    if (s.mode !== 'record') s.mode = 'classic';
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

  function loadDevice() {
    try { return localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { return ''; }
  }
  function useDevice(id) {
    if (!id || id === state.deviceId) return;
    state.deviceId = id;
    try { localStorage.setItem(DEVICE_KEY, id); } catch (e) {}
  }

  // ---- layout ---------------------------------------------------------------
  // Classic, or the record player (Settings → Mode), which js/records.js runs.
  function buildLayout() {
    var record = settings.mode === 'record';
    var stage = $('deck');
    stage.innerHTML = '';
    Records.unmount();
    Records.closeShelf();
    var root = document.importNode($(record ? 'tpl-turntable' : 'tpl-classic').content, true).firstElementChild;
    stage.appendChild(root);
    layout = {
      root: root,
      record: record,
      texts: list(root, '[data-t]'),
      progs: list(root, '[data-p]'),
      vols: list(root, '[data-v]'),
      shows: list(root, '[data-show]'),
      arts: list(root, 'img[data-art]'),
      queueList: root.querySelector('[data-queue-list]')
    };
    toggle(stage, 'is-record', record);
    toggle($('bg0'), 'hidden', record);
    toggle($('bg1'), 'hidden', record);
    setupVolumeControls(root);
    setupSeekControls(root);
    if (layout.queueList) setupQueueList(layout.queueList);
    if (record) Records.mount(root);
    renderQueueList();
    paintArt();
    if (!record) paintBackground(state.art.small);
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

  function isEpisode() { return !!state.item && state.item.type === 'episode'; }

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
    else if (kind === 'x') el.style.webkitTransform = el.style.transform = 'translateX(' + pct + ')';
  }

  function paint() {
    if (!layout || state.view !== 'deck') return;
    var root = layout.root;
    toggle(root, 'is-playing', state.playing);
    toggle(root, 'is-liked', state.liked);
    toggle(root, 'is-episode', isEpisode() && state.canSeek);
    toggle(root, 'is-shuffled', state.shuffle);
    toggle(root, 'is-repeat-all', state.repeat === 'context');
    toggle(root, 'is-repeat-one', state.repeat === 'track');
    toggle(root, 'can-shuffle', state.canShuffle);
    toggle(root, 'can-repeat', state.canRepeat);
    toggle(root, 'has-device', !!state.device);
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
    if (layout.record) Records.paint();
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

  // Development Mode quotas can last a while, so say how long.
  function busyText(err) {
    if (!err || err.reason !== 'QUOTA_EXCEEDED') return 'Spotify is busy. Try again in a moment.';
    var mins = Math.max(1, Math.ceil((err.retryAfter || 60) / 60));
    return 'Spotify’s limit for the deck is used up. Try again in ' + mins + ' min.';
  }

  function actionError(err) {
    if (err && err.code === 'logged_out') return showLogin();
    var status = err && err.status;
    if (status === 0) toast('No connection');
    else if (status === 429) toast(busyText(err));
    else if (isNoDevice(err)) {
      toast('Nothing is playing. Pick a device.');
      openDevices();
    }
    else if (status === 403) toast('Spotify didn’t allow that');
    else toast('Something went wrong');
  }

  // ---- polling --------------------------------------------------------------
  var pollTimer = null, polling = false, pollAgain = false, stopped = false;
  var pollSeq = 0, pollStartedAt = 0, nextPollAt = 0, lastGoodPoll = 0;
  var commands = 0;  // goes up when a command is sent and again when it's done

  // Polls sent before or during a command can still show the old state, so they're dropped.
  function command() { commands++; }

  function pollSoon(ms) {
    clearTimeout(pollTimer);
    nextPollAt = Date.now() + (ms || 0);
    pollTimer = setTimeout(poll, ms || 0);
  }

  function pollDelay() {
    if (state.playing) return C.POLL_PLAYING_MS;
    return state.quietSince && Date.now() - state.quietSince > C.QUIET_AFTER_MS ? C.POLL_QUIET_MS : C.POLL_IDLE_MS;
  }

  function poll() {
    if (stopped) return;
    if (polling) { pollAgain = true; return; }
    polling = true;
    clearTimeout(pollTimer);
    var seq = ++pollSeq, before = commands;
    pollStartedAt = Date.now();
    Spotify.getPlayer().then(function (p) {
      if (seq !== pollSeq) return null;  // the watchdog gave up on this one
      state.errors = 0;
      lastGoodPoll = Date.now();
      toggle($('status'), 'hidden', true);
      if (before !== commands) return 500;
      render(p);
      return pollDelay();
    }).catch(function (err) {
      return seq === pollSeq ? onPollError(err) : null;
    }).then(function (delay) {
      if (seq !== pollSeq) return;
      polling = false;
      if (delay === null) return;
      if (pollAgain) { pollAgain = false; delay = 0; }
      pollSoon(delay);
    });
  }

  // Never show an error page: keep the last state on screen and back off.
  function onPollError(err) {
    if (err && err.code === 'logged_out') { showLogin(); return null; }
    if (err && err.status === 429) {
      toggle($('status'), 'hidden', false);
      return (err.retryAfter || 5) * 1000;
    }
    if (!err || typeof err.status !== 'number') DeckLog.add('script', 'poll: ' + ((err && err.message) || err));
    state.errors++;
    if (state.errors >= 2) toggle($('status'), 'hidden', false);
    return Math.min(60000, 2000 * Math.pow(2, state.errors - 1));
  }

  // Old Safari can lose a request or a timer when it's suspended. Polling must never stay stopped.
  function watchPolling() {
    if (stopped) return;
    var now = Date.now();
    if (polling ? now - pollStartedAt > C.POLL_STUCK_MS : nextPollAt && now - nextPollAt > C.POLL_STUCK_MS) {
      DeckLog.add('poll', 'stuck, restarted');
      pollSeq++;
      polling = pollAgain = false;
      pollSoon(0);
    }
  }

  // ---- state from Spotify ---------------------------------------------------
  function render(p) {
    var item = p && p.item, now = Date.now();
    if (p && p.device) useDevice(p.device.id);
    if (layout && layout.record) Records.onPlayer(p);
    if (layout && !state.jumping) toggle(layout.root, 'is-skipping', false);
    // Some things play without any details, like ads and the DJ talking.
    if (!item && p && p.is_playing) {
      item = { name: p.currently_playing_type === 'ad' ? 'Advertisement' : 'Playing on Spotify', uri: '' };
    }
    if (!item) {
      state.uri = null;
      state.item = null;
      state.playing = false;
      if (!state.quietSince) state.quietSince = now;
      // The record player keeps its record on screen until the idle timeout, and a sheet someone
      // is using stays up.
      if (layout && layout.record) settle();
      else if (!openSheetId || state.view !== 'deck') show('idle');
      return;
    }

    var changed = item.uri !== state.uri;
    var old = !changed && now < state.playHoldUntil && !!p.is_playing !== state.playing;
    if (!old) state.playing = !!p.is_playing;
    if (!old && (now > state.seekHoldUntil || changed)) {
      state.progressMs = p.progress_ms || 0;
      state.progressAt = now;
    }
    state.durationMs = item.duration_ms || 0;
    var disallows = (p.actions && p.actions.disallows) || {};
    state.canSeek = !disallows.seeking;
    state.canShuffle = !disallows.toggling_shuffle;
    state.canRepeat = !(disallows.toggling_repeat_context && disallows.toggling_repeat_track);
    if (now > state.modeHoldUntil) {
      state.shuffle = !!p.shuffle_state;
      state.repeat = p.repeat_state || 'off';
    }
    state.device = (p.device && p.device.name) || '';
    if (now > state.volumeHoldUntil) {
      state.volume = p.device && p.device.supports_volume !== false && typeof p.device.volume_percent === 'number'
        ? p.device.volume_percent : null;
    }
    state.item = item;
    // A different playlist or album brings a different queue, so earlier removals no longer apply.
    // (An empty context, e.g. while a queued song plays, isn't a change.)
    var context = (p.context && p.context.uri) || '';
    if (context && state.context && context !== state.context) state.skip = {};
    if (context) state.context = context;
    if (changed) newItem(item);

    // Paused for a while: go to the idle clock so the screen doesn't burn in.
    if (state.playing) {
      state.pausedSince = state.quietSince = 0;
      show('deck');
    } else {
      if (!state.quietSince) state.quietSince = now;
      settle();
    }
    paint();
  }

  function settle() {
    if (!state.pausedSince) state.pausedSince = Date.now();
    var since = Math.max(state.pausedSince, state.wokeAt);
    show(Date.now() - since > C.IDLE_AFTER_PAUSE_MS ? 'idle' : 'deck');
  }

  function newItem(item) {
    state.uri = item.uri;
    state.endPolled = false;
    state.liked = state.likeTouched = false;
    var images = (item.album && item.album.images) || item.images || [];
    state.art = {
      big: images.length ? images[0].url : '',
      small: images.length ? images[images.length - 1].url : ''
    };
    paintArt();
    if (!layout || !layout.record) paintBackground(state.art.small);

    // A song removed from Up next has come up: skip it.
    if (!state.jumping && DeckQueue.take(state.skip, item.uri)) {
      command();
      Spotify.next().then(afterAction, function () {});
    }

    var uri = item.uri;
    if (uri) {
      Spotify.isSaved(uri).then(function (saved) {
        if (state.uri === uri && !state.likeTouched) { state.liked = saved; paint(); }
      }, function () {});
    }
    state.queueAt = 0;
    loadQueue();
  }

  // The queue, only while Classic's Up next is open.
  function loadQueue() {
    var now = Date.now();
    if (layout && layout.queueList && settings.showQueue && state.item && now - state.queueAt > 2 * 60 * 1000) {
      state.queueAt = now;
      Spotify.getQueue().then(setQueue, function () {});
    }
  }

  // ---- queue ----------------------------------------------------------------
  // Spotify's API can't remove a song from the queue or jump to one. So Remove hides the song (see
  // js/queue.js), and tapping a song skips forward to it (as the Spotify app does).
  function setQueue(d) {
    state.queueAll = DeckQueue.parse(d);
    DeckQueue.prune(state.skip, state.queueAll, d && d.currently_playing && d.currently_playing.uri);
    applyQueue();
  }

  function applyQueue() {
    state.queue = DeckQueue.visible(state.skip, state.queueAll);
    renderQueueList();
    paint();
  }

  var openRow = null;  // the Up next row showing its Remove button

  function renderQueueList() {
    if (!layout || !layout.queueList) return;
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
    command();
    toggle(layout.root, 'is-skipping', true);
    toast('Playing ' + q.title);
    var passed = state.queueAll.slice(0, q.index);
    function skip(n) { return n ? Spotify.next().then(function () { return skip(n - 1); }) : Promise.resolve(); }
    skip(q.index + 1).then(function () {
      // The songs skipped on the way have left the queue, removed ones included.
      passed.forEach(function (s) { DeckQueue.take(state.skip, s.uri); });
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
      $('clock-note').textContent = expiryNote();
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
    watchPolling();
    if (state.view === 'deck') {
      paint();
      loadQueue();
      // Track just ended: ask Spotify what's next instead of waiting for the next poll.
      if (ratio() >= 1 && state.playing && !state.endPolled) { state.endPolled = true; pollSoon(600); }
    }
    if (state.view === 'idle') {
      tickClock(false);
      // Restart once a day while idle to clear any memory buildup in old Safari, and to switch to
      // a new version of the deck.
      if (updateReady || Date.now() - BOOT_AT > DAY_MS) restartWhenIdle();
    }
    checkForUpdate();
    // A paused deck falls back to the idle clock even without a poll.
    if (state.view === 'deck' && !state.playing && state.pausedSince &&
        Date.now() - Math.max(state.pausedSince, state.wokeAt) > C.IDLE_AFTER_PAUSE_MS) show('idle');
  }

  // ---- offline copy and reloading -------------------------------------------
  // deck.appcache keeps a copy of the deck on the iPad, so it starts and reloads without a network.
  // Old Safari is the only browser that still has AppCache; everywhere else the network is checked
  // first, because a failed reload would leave an error page that nobody can close.
  var appCache = window.applicationCache;
  var updateReady = false, lastUpdateCheck = Date.now(), lastRestartTry = 0;

  function hasOfflineCopy() {
    return !!appCache && (appCache.status === appCache.IDLE || appCache.status === appCache.UPDATEREADY);
  }

  function safeReload() {
    if (hasOfflineCopy()) {
      window.location.reload();
      return Promise.resolve();
    }
    return fetch(C.REDIRECT_URI, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      window.location.reload();
    });
  }

  function restartWhenIdle() {
    if (openSheetId || Date.now() - lastRestartTry < 10 * 60 * 1000) return;
    lastRestartTry = Date.now();
    safeReload().catch(function () {});  // no network: try again later
  }

  function checkForUpdate() {
    if (!hasOfflineCopy() || Date.now() - lastUpdateCheck < HOUR_MS) return;
    lastUpdateCheck = Date.now();
    try { appCache.update(); } catch (e) {}
  }

  // ---- controls (optimistic, then poll to confirm) --------------------------
  var laterPoll = null;
  function afterAction() {
    command();
    pollSoon(500);
    clearTimeout(laterPoll);
    laterPoll = setTimeout(poll, 1500);
  }

  function onPlayPause() {
    var wasPlaying = state.playing;
    state.progressMs += wasPlaying ? Date.now() - state.progressAt : 0;
    state.progressAt = Date.now();
    state.playing = !wasPlaying;
    state.playHoldUntil = Date.now() + 15000;
    paint();
    command();
    (wasPlaying ? Spotify.pause() : Spotify.play()).then(function () {
      state.playHoldUntil = Date.now() + 2000;
      afterAction();
    }, function (err) {
      state.playHoldUntil = 0;
      state.playing = wasPlaying;
      paint();
      actionError(err);
    });
  }

  function onSkip(next) {
    if (isEpisode() && state.canSeek && state.durationMs) return seekBy(next ? 30000 : -15000);
    toggle(layout.root, 'is-skipping', true);
    command();
    (next ? Spotify.next() : Spotify.previous()).then(afterAction, function (err) {
      toggle(layout.root, 'is-skipping', false);
      actionError(err);
    });
  }

  function onLike() {
    var uri = state.uri;
    if (!uri) return;
    var was = state.liked;
    state.likeTouched = true;
    state.liked = !was;
    paint();
    (was ? Spotify.removeFromLibrary(uri) : Spotify.saveToLibrary(uri)).then(function () {
      toast(was ? 'Removed from Liked Songs' : 'Added to Liked Songs');
    }, function (err) {
      if (state.uri === uri) { state.liked = was; paint(); }
      actionError(err);
    });
  }

  // Shuffle and repeat: change it on screen now, and put it back if Spotify says no.
  function setMode(key, value, send, label) {
    var was = state[key];
    state[key] = value;
    state.modeHoldUntil = Date.now() + 15000;
    paint();
    toast(label);
    command();
    send(value).then(function () {
      state.modeHoldUntil = Date.now() + 2000;
      afterAction();
    }, function (err) {
      state.modeHoldUntil = 0;
      state[key] = was;
      paint();
      actionError(err);
    });
  }

  function onShuffle() {
    setMode('shuffle', !state.shuffle, Spotify.setShuffle, state.shuffle ? 'Shuffle off' : 'Shuffle on');
  }

  function onRepeat() {
    var next = { off: 'context', context: 'track', track: 'off' }[state.repeat] || 'off';
    setMode('repeat', next, Spotify.setRepeat,
      { off: 'Repeat off', context: 'Repeat all', track: 'Repeat this song' }[next]);
  }

  var ACTIONS = {
    play: onPlayPause,
    prev: function () { onSkip(false); },
    next: function () { onSkip(true); },
    like: onLike,
    shuffle: onShuffle,
    repeat: onRepeat,
    add: function () { if (state.uri) Browse.openPicker({ uri: state.uri, name: state.item.name }); },
    browse: function () { Browse.open(); },
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

  function seekBy(ms) {
    seekTo(Math.max(0, Math.min(state.durationMs - 1000, Math.round(ratio() * state.durationMs) + ms)));
  }

  function seekTo(ms) {
    command();
    var before = { ms: state.progressMs, at: state.progressAt };
    state.progressMs = ms;
    state.progressAt = Date.now();
    state.seekHoldUntil = Date.now() + 4000;  // don't let a poll from before the seek pull the bar back
    state.endPolled = false;
    paint();
    Spotify.seek(ms).then(function () { command(); pollSoon(1000); }, function (err) {
      state.seekHoldUntil = 0;
      state.progressMs = before.ms;
      state.progressAt = before.at;
      paint();
      actionError(err);
    });
  }

  // ---- sheets ---------------------------------------------------------------
  var sheetTimer = null, openSheetId = null;
  function openSheet(id) {
    closeSheets();
    openSheetId = id;
    toggle($('scrim'), 'hidden', false);
    toggle($(id), 'hidden', false);
    bumpSheetTimer();
  }
  function closeSheets() {
    // This browser handed its login away, so start over at the login screen.
    if (pairing) return window.location.reload();
    openSheetId = null;
    list(document, '.sheet').forEach(function (s) { toggle(s, 'hidden', true); });
    Browse.onClose();
    toggle($('scrim'), 'hidden', true);
    clearTimeout(sheetTimer);
    logoutArmed = pairArmed = false;
    $('logout-btn').textContent = 'Log out';
    $('pair-btn').textContent = 'Send login to iPad';
  }
  // Nobody is around to close a forgotten sheet on a kiosk, so close it automatically.
  function bumpSheetTimer() {
    if (!openSheetId) return;
    state.wokeAt = Date.now();  // the idle clock shouldn't close a sheet in use
    if (pairing) return;  // it has its own, longer limit
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(closeSheets, C.SHEET_TIMEOUT_MS);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  // Covers in long lists load as they come near the screen and let go once they're far away, like
  // the ones on the record shelf.
  function thumb(url, cls) {
    var img = el(url ? 'img' : 'span', 'row-art' + (cls ? ' ' + cls : ''));  // an img with no src gets an outline
    if (!url) return img;
    img.alt = '';
    img._src = url;
    return img;
  }
  function loadThumb(img, on) {
    if (on && img._src && !img.getAttribute('src')) img.src = img._src;
    else if (!on && img.getAttribute('src')) img.removeAttribute('src');
  }
  function watchArt(listEl) {
    if (window.IntersectionObserver && !listEl._art) {
      listEl._art = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { loadThumb(en.target, en.isIntersecting); });
      }, { root: listEl, rootMargin: '600px 0px' });
    }
    list(listEl, 'img.row-art').forEach(function (img) {
      if (img._watched) return;
      img._watched = true;
      if (listEl._art) listEl._art.observe(img);
      else loadThumb(img, true);
    });
  }
  function clearList(listEl) {
    if (listEl._art) listEl._art.disconnect();
    listEl.innerHTML = '';
  }

  // rows: { label, note?, art?, plus?, cls?, inert? }. art: a cover ('' for a blank one); plus: a +
  // in its place. Rows are tappable when onPick is given, unless inert.
  function fillList(listEl, rows, onPick) {
    clearList(listEl);
    rows.forEach(function (row) {
      var li = el('li');
      var live = onPick && !row.inert;
      li.className = row.cls || (live ? '' : 'empty');
      if (row.plus || row.art !== undefined) {
        toggle(li, 'has-art', true);
        li.appendChild(row.plus ? el('span', 'row-art row-plus', '+') : thumb(row.art));
      }
      li.appendChild(el('span', 'label', row.label));
      if (row.note) li.appendChild(el('span', 'note', row.note));
      if (live) li.addEventListener('click', function () { onPick(row, li); });
      listEl.appendChild(li);
    });
    watchArt(listEl);
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
        command();
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
      ? (expiryNote() ? expiryNote() + ' It ends around ' : 'Spotify will ask you to log in again around ') + day(expires) + '.'
      : '';
    applySettings();
    openSheet('settings');
  }

  function day(ms) {
    return new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // From two weeks out, say the login is about to end, so the iPad can be paired again in time.
  function expiryNote() {
    var expires = DeckAuth.loginExpiresAt();
    var days = expires ? Math.ceil((expires - Date.now()) / DAY_MS) : Infinity;
    if (days > 14) return '';
    if (days < 1) return 'The Spotify login is about to end. Pair again from your Mac.';
    return 'Spotify login ends in ' + (days === 1 ? '1 day' : days + ' days') + '. Pair again from your Mac.';
  }

  // ---- diagnostics ----------------------------------------------------------
  // The iPad has no console, so this is how to see what went wrong on it.
  function ago(ms) {
    if (!ms) return 'never';
    var s = Math.round((Date.now() - ms) / 1000);
    return s < 90 ? s + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago'
      : s < 172800 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago';
  }

  function openDiagnostics() {
    var stats = Spotify.stats(), expires = DeckAuth.loginExpiresAt();
    var rows = [
      { label: 'Version', note: typeof DECK_VERSION === 'string' ? DECK_VERSION : 'unknown' },
      { label: 'Started', note: ago(BOOT_AT) },
      { label: 'Last heard from Spotify', note: ago(lastGoodPoll) },
      { label: 'Requests in the last hour', note: String(stats.callsLastHour) },
      { label: 'Waiting on limits', note: stats.waiting.length ? stats.waiting.map(function (w) {
        return (w.group === 'all' ? 'everything' : w.group) + ' ' + w.secs + ' s';
      }).join(', ') : 'none' },
      { label: 'Offline copy', note: !appCache ? 'not supported' : hasOfflineCopy() ? (updateReady ? 'yes, update ready' : 'yes') : 'no' },
      { label: 'Login ends', note: expires ? day(expires) : 'unknown' },
      { label: 'Recent errors', cls: 'section' }
    ];
    var log = DeckLog.list().reverse();
    if (!log.length) rows.push({ label: 'None.', cls: 'empty' });
    log.forEach(function (e) {
      rows.push({ label: e.text + (e.n > 1 ? ' ×' + e.n : ''), note: ago(e.at), cls: 'err' });
    });
    fillList($('diag-list'), rows);
    openSheet('diag');
  }

  function onLogout() {
    // Two taps, so a stray touch can't log the kiosk out.
    if (!logoutArmed) {
      logoutArmed = true;
      $('logout-btn').textContent = 'Tap again to log out';
      return;
    }
    DeckAuth.logout();
    safeReload().catch(function () { showLogin('Logged out.'); });
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
  // Spotify's login page doesn't run on iOS 12, and there'd be no way back from it, so the iPad
  // shows how to pair again instead of a Connect button.
  function showLogin(message) {
    stopped = true;
    if (!pairing) closeSheets();
    $('login-msg').textContent = message === undefined ? 'Spotify needs you to log in again.' : message;
    toggle($('login-btn'), 'hidden', ON_IOS);
    toggle($('login-hint'), 'hidden', !ON_IOS);
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
        // A list too short to scroll would drag the whole page instead.
        if (el.classList && el.classList.contains('scroll') && el.scrollHeight > el.clientHeight) return;
        el = el.parentNode;
      }
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // Someone's here: go back to polling at the usual rate.
    ['touchstart', 'mousedown'].forEach(function (type) {
      document.addEventListener(type, function () { if (state.quietSince) state.quietSince = Date.now(); });
    });

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

    // Tapping the idle clock brings back a paused track or the turntable, or opens Browse to
    // start something.
    $('idle').addEventListener('click', function () {
      pollSoon(0);
      if (state.uri || layout.record) { state.wokeAt = Date.now(); show('deck'); }
      else Browse.open();
    });

    $('scrim').addEventListener('click', closeSheets);
    list(document, '.sheet-close').forEach(function (b) { b.addEventListener('click', closeSheets); });
    list(document, '.sheet').forEach(function (s) { s.addEventListener('touchstart', bumpSheetTimer); });

    list(document, '[data-setting]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = this.getAttribute('data-setting'), raw = this.getAttribute('data-value');
        settings[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
        saveSettings();
        if (key === 'mode') buildLayout();
      });
    });
    $('devices-btn').addEventListener('click', function () { openDevices(); });
    $('diag-btn').addEventListener('click', openDiagnostics);
    $('reload-btn').addEventListener('click', function () {
      safeReload().catch(function () { toast('No connection, so not reloading'); });
    });
    $('logout-btn').addEventListener('click', onLogout);
    $('pair-btn').addEventListener('click', onSendLogin);
  }

  function boot() {
    setupKioskGuards();
    setupSettingsHotspot();
    setupControls();
    applySettings();
    Browse.init({
      state: state,
      el: el,
      thumb: thumb,
      watchArt: watchArt,
      clearList: clearList,
      fillList: fillList,
      openSheet: openSheet,
      closeSheets: closeSheets,
      bumpSheetTimer: bumpSheetTimer,
      toast: toast,
      busyText: busyText,
      actionError: actionError,
      command: command,
      afterAction: afterAction,
      isNoDevice: isNoDevice,
      openDevices: openDevices,
      useDevice: useDevice
    });
    Records.init({
      state: state,
      toast: toast,
      actionError: actionError,
      command: command,
      afterAction: afterAction,
      isNoDevice: isNoDevice,
      openDevices: openDevices,
      useDevice: useDevice,
      wake: function () { state.wokeAt = Date.now(); }  // using the turntable holds off the idle clock
    });
    buildLayout();
    setInterval(tick, 1000);

    if (appCache) appCache.addEventListener('updateready', function () { updateReady = true; });

    // The Home Screen app doesn't need the pairing button; the iPad is the one receiving logins.
    toggle($('pair-btn'), 'hidden', !!window.navigator.standalone);

    // A pairing link opened in iOS Safari: the login has to land in the Home Screen app, which
    // has its own storage. Keep the link in the address bar so Add to Home Screen captures it.
    if (DeckAuth.hasPairing() && ON_IOS && !window.navigator.standalone) {
      showLogin('Almost there. Tap Share, then Add to Home Screen, then open Deck from your Home Screen.');
      toggle($('login-hint'), 'hidden', true);
      return;
    }

    DeckAuth.importPairing().then(function (pairError) {
      return DeckAuth.handleCallback().then(function (error) { return error || pairError; });
    }).then(function (error) {
      if (error || !DeckAuth.isLoggedIn()) return showLogin(error || '');
      show('idle');
      poll();
    });
  }

  boot();
})();
