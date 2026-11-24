// Playlists and search: the Browse sheet (your playlists, a playlist's songs, song search), the
// add-to-playlist picker, and making a new playlist.
//
// Spotify only lists the songs of playlists you own or collaborate on. Ones you only follow open
// with Play and Shuffle.
var Browse = (function () {
  var PLAYLISTS_FRESH_MS = 10 * 60 * 1000;
  var MAX_PLAYLISTS = 500;
  var MAX_SONGS = 500;      // rows in an open playlist, to keep the DOM small on the iPad
  var MAX_RESULTS = 50;
  var NEAR_END_PX = 1200;

  var ICON_QUEUE = '<svg viewBox="0 0 24 24"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>';
  var ICON_ADD = '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
  var ICON_DONE = '<svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

  var api = null;    // from deck.js
  var state = null;  // the deck's state: uri, item, deviceId, me, playlists, playlistsAt
  var search = { q: '', seq: 0, timer: null };
  var page = null;   // the playlist open in Browse
  var picking = null;  // what the picker or the new-playlist sheet is for: { track, browse, scroll }

  function $(id) { return document.getElementById(id); }
  function toggle(el, cls, on) { el.classList[on ? 'add' : 'remove'](cls); }
  function trim(s) { return s.replace(/^\s+|\s+$/g, ''); }

  // ---- playlists ------------------------------------------------------------
  // Any playlist in your library can be played; only ones you own or collaborate on can be opened
  // or take new songs.
  function isMine(pl) {
    return !!(pl.mine || pl.collaborative || (pl.owner && state.me && pl.owner.id === state.me.id));
  }

  function countOf(pl) {
    var c = pl.items || pl.tracks;
    return c && typeof c.total === 'number' ? c.total : null;
  }

  function songs(n) { return n + (n === 1 ? ' song' : ' songs'); }

  // size: 0 is the smallest cover, 1 about 300px
  function coverOf(pl, size) {
    var imgs = pl.images || [];
    if (!imgs.length) return '';
    return imgs[size ? Math.min(1, imgs.length - 1) : imgs.length - 1].url;
  }

  function noteFor(pl) {
    if (!isMine(pl)) return pl.owner && pl.owner.display_name ? 'by ' + pl.owner.display_name : '';
    var n = countOf(pl);
    return n === null ? '' : songs(n);
  }

  // Everything /me/playlists returns: ones you made and public ones you saved. fresh skips the
  // 10-minute cache.
  function loadPlaylists(fresh) {
    if (!fresh && state.playlists && Date.now() - state.playlistsAt < PLAYLISTS_FRESH_MS) return Promise.resolve(state.playlists);
    var me = state.me ? Promise.resolve(state.me) : Spotify.getMe();
    return me.then(function (user) {
      state.me = user;
      function next(offset, acc) {
        return Spotify.getMyPlaylists(offset).then(function (data) {
          acc = acc.concat((data && data.items) || []);
          return data && data.next && acc.length < MAX_PLAYLISTS ? next(offset + 50, acc) : acc;
        });
      }
      return next(0, []);
    }).then(function (all) {
      state.playlists = all.filter(Boolean);
      state.playlistsAt = Date.now();
      return state.playlists;
    });
  }

  function samePlaylists(a, b) {
    return a.length === b.length && a.every(function (pl, i) {
      return pl.id === b[i].id && pl.name === b[i].name && countOf(pl) === countOf(b[i]) && !coverOf(pl) === !coverOf(b[i]);
    });
  }

  // ---- add to a playlist ----------------------------------------------------
  // track: the song to add, kept from when the picker opened. The song playing may change meanwhile.
  function openPicker(track, fromBrowse) {
    if (!track || !track.uri) return;
    var listEl = $('picker-list');
    var mine = { track: track, browse: !!fromBrowse, scroll: $('browse-list').scrollTop };
    $('picker-song').textContent = track.name || '';
    api.fillList(listEl, [{ label: 'Loading…' }]);
    api.openSheet('picker');
    picking = mine;  // after openSheet, which closes (and so clears) whatever was open
    loadPlaylists().then(function (all) {
      if (picking !== mine) return;
      var rows = [{ label: 'New playlist', plus: true, make: true }];
      all.filter(isMine).forEach(function (pl) {
        rows.push({ label: pl.name, note: noteFor(pl), art: coverOf(pl), pl: pl });
      });
      api.fillList(listEl, rows, function (row, li) {
        if (row.make) return openNew(mine);
        if (li.classList.contains('busy')) return;
        toggle(li, 'busy', true);
        addTo(row.pl, mine.track).then(function () {
          donePicking(mine, 'Added to ' + row.pl.name);
        }, function (err) {
          toggle(li, 'busy', false);
          api.actionError(err);
        });
      });
    }, function (err) {
      if (picking !== mine) return;
      api.closeSheets();
      api.actionError(err);
    });
  }

  function addTo(pl, track) {
    return Spotify.addToPlaylist(pl.id, track.uri).then(function () {
      var c = pl.items || pl.tracks;
      if (c && typeof c.total === 'number') c.total++;
      if (page && page.pl.id === pl.id) page.stale = true;
    });
  }

  // Back to Browse where you left it, or to the deck.
  function donePicking(p, message) {
    if (picking !== p) return api.toast(message);  // closed meanwhile
    api.closeSheets();
    if (p.browse) {
      api.openSheet('browse');
      $('browse-list').scrollTop = p.scroll;
    }
    api.toast(message);
  }

  // ---- new playlist ---------------------------------------------------------
  function openNew(from) {
    var p = from || { track: null, browse: true, scroll: 0 };
    $('newpl-name').value = '';
    $('newpl-msg').textContent = '';
    $('newpl-song').textContent = p.track ? 'with ' + p.track.name : '';
    toggle($('newpl-create'), 'busy', false);
    api.openSheet('newpl');
    picking = p;
    $('newpl-name').focus();
  }

  function createNew() {
    var name = trim($('newpl-name').value), p = picking, btn = $('newpl-create');
    if (!p || btn.classList.contains('busy')) return;
    if (!name) { $('newpl-msg').textContent = 'Give it a name first.'; return; }
    $('newpl-name').blur();
    $('newpl-msg').textContent = '';
    toggle(btn, 'busy', true);
    Spotify.createPlaylist(name).then(function (pl) {
      pl.mine = true;
      if (state.playlists) state.playlists.unshift(pl);
      if (!p.track) {
        if (picking === p) open(pl);
        return;
      }
      return addTo(pl, p.track).then(function () {
        donePicking(p, 'Added to ' + pl.name);
      }, function () {
        donePicking(p, 'Made ' + pl.name + ', but couldn’t add the song');
      });
    }).catch(function (err) {
      toggle(btn, 'busy', false);
      if (err && err.code === 'logged_out') return api.actionError(err);
      $('newpl-msg').textContent = err && err.status === 403
        ? 'Spotify didn’t let the deck make a playlist. Make it in the Spotify app, then add songs here.'
        : err && err.status === 0 ? 'No connection. Try again.'
        : err && err.status === 429 ? 'Spotify is busy. Try again in a moment.'
        : 'That didn’t work. Try again.';
    });
  }

  // ---- browse ---------------------------------------------------------------
  // pl: open straight to a playlist.
  function open(pl) {
    // Start fresh each time: on a kiosk the last search could be hours old.
    $('search-input').value = '';
    page = null;
    api.openSheet('browse');
    if (pl) openPlaylist(pl);
    else setQuery('');
  }

  function showHeader() {
    $('browse-title').textContent = page ? page.pl.name : 'Browse';
    toggle($('browse-back'), 'hidden', !page);
    $('search-input').placeholder = page && !page.denied ? 'Search songs to add' : 'Search songs';
  }

  function setQuery(raw) {
    clearTimeout(search.timer);
    search.timer = null;
    search.q = trim(raw);
    toggle($('search-clear'), 'hidden', !raw);
    if (!search.q) {
      search.seq++;
      if (!page) showPlaylists();
      else if (page.stale) openPlaylist(page.pl);
      else renderPlaylist();
      return;
    }
    // Wait for a pause in typing so each keystroke isn't a request.
    search.timer = setTimeout(function () { search.timer = null; runSearch(0); }, 450);
  }

  function back() {
    var input = $('search-input');
    input.blur();
    if (!search.q) page = null;  // out of the playlist; from a search, back to the playlist first
    input.value = '';
    setQuery('');
    showHeader();
  }

  function showPlaylists() {
    var listEl = $('browse-list');
    var seq = search.seq;
    showHeader();
    // Show what we have right away, then refetch so a playlist saved in the Spotify app since
    // the last look shows up without waiting out the cache.
    var shown = state.playlists && state.playlists.slice();
    if (shown) render(shown);
    else api.fillList(listEl, [{ label: 'Loading…' }]);
    loadPlaylists(true).then(function (pls) {
      if (seq !== search.seq || page) return;  // a search started or the sheet closed meanwhile
      if (shown && samePlaylists(shown, pls)) return;  // unchanged: keep the scroll position
      render(pls);
    }, function (err) {
      if (shown || seq !== search.seq || page) return;  // the cached list is still up
      api.closeSheets();
      api.actionError(err);
    });

    function render(pls) {
      var rows = [];
      if (!state.uri) rows.push({ label: 'Resume on a device…', resume: true });
      rows.push({ label: 'New playlist', plus: true, make: true });
      rows.push({ label: 'Your playlists', cls: 'section', inert: true });
      if (!pls.length) rows.push({ label: 'No playlists yet.', cls: 'empty', inert: true });
      pls.forEach(function (pl) {
        rows.push({ label: pl.name, note: noteFor(pl), art: coverOf(pl), pl: pl });
      });
      api.fillList(listEl, rows, function (row) {
        if (row.resume) api.openDevices();
        else if (row.make) openNew(null);
        else openPlaylist(row.pl);
      });
      listEl.scrollTop = 0;
    }
  }

  // ---- one playlist ---------------------------------------------------------
  function openPlaylist(pl) {
    search.seq++;
    page = { pl: pl, songs: [], offset: 0, total: countOf(pl), more: true, loading: false, failed: false, denied: !isMine(pl), stale: false };
    renderPlaylist();
    $('browse-list').scrollTop = 0;
    loadSongs();
  }

  function renderPlaylist() {
    var listEl = $('browse-list');
    showHeader();
    api.clearList(listEl);
    listEl.appendChild(hero());
    page.songs.forEach(function (s) { listEl.appendChild(playlistRow(s)); });
    addFooter();
    api.watchArt(listEl);
  }

  function hero() {
    var pl = page.pl, li = api.el('li', 'hero');
    li.appendChild(api.thumb(coverOf(pl, 1), 'hero-art'));
    var info = api.el('div', 'hero-info');
    info.appendChild(api.el('div', 'hero-name', pl.name));
    var note = page.denied || page.total === null ? noteFor(pl) : songs(page.total);
    info.appendChild(api.el('div', 'hero-note', note));
    if (page.total !== 0) {
      var buttons = api.el('div', 'hero-buttons');
      [['Play', false], ['Shuffle', true]].forEach(function (b) {
        var btn = api.el('button', 'hero-btn' + (b[1] ? '' : ' main'), b[0]);
        btn.type = 'button';
        btn.addEventListener('click', function () { playPlaylist(pl, b[1]); });
        buttons.appendChild(btn);
      });
      info.appendChild(buttons);
    }
    li.appendChild(info);
    return li;
  }

  // The line under the songs: loading, empty, failed, or why there's no more.
  function addFooter() {
    var listEl = $('browse-list');
    var old = listEl.querySelector('.foot');
    if (old) listEl.removeChild(old);
    var text = page.denied ? 'Spotify doesn’t share this playlist’s songs with apps.'
      : page.failed ? 'Couldn’t load the songs. Tap to try again.'
      : page.more ? (page.offset < MAX_SONGS ? 'Loading…' : 'Showing the first ' + MAX_SONGS + ' songs.')
      : !page.songs.length ? 'No songs yet. Search above and tap + to add some.' : '';
    if (!text) return;
    var li = api.el('li', 'foot', text);
    if (page.failed) li.addEventListener('click', function () { page.failed = false; addFooter(); loadSongs(); });
    listEl.appendChild(li);
  }

  function loadSongs() {
    var p = page;
    if (!p || p.denied || p.loading || p.failed || !p.more || p.offset >= MAX_SONGS) return;
    p.loading = true;
    Spotify.getPlaylistItems(p.pl.id, p.offset).then(function (data) {
      p.loading = false;
      var rows = (data && data.items) || [];
      // position is where Spotify counts from, so songs that can't be shown still take a place.
      var fresh = rows.map(function (r, i) { return { position: p.offset + i, t: r && (r.item || r.track) }; })
        .filter(function (s) { return s.t; });
      p.songs = p.songs.concat(fresh);
      p.offset += rows.length;
      p.more = !!(data && data.next && rows.length);
      var first = p.total === null;
      if (data && typeof data.total === 'number') { first = first || data.total !== p.total; p.total = data.total; }
      if (page !== p || search.q) return;
      var listEl = $('browse-list');
      if (first) listEl.replaceChild(hero(), listEl.firstChild);
      fresh.forEach(function (s) { listEl.appendChild(playlistRow(s)); });
      addFooter();
      api.watchArt(listEl);
      moreIfNear();
    }, function (err) {
      p.loading = false;
      if (err && err.code === 'logged_out') return api.actionError(err);
      if (err && err.status === 403) p.denied = true;
      else p.failed = true;
      if (page === p && !search.q) renderPlaylist();
    });
  }

  function moreIfNear() {
    var listEl = $('browse-list');
    if (!page || search.q || $('browse').classList.contains('hidden')) return;
    if (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < NEAR_END_PX) loadSongs();
  }

  function playlistRow(s) {
    var t = s.t, pl = page.pl;
    if (t.is_local || !t.uri || t.is_playable === false) return songRow(t, null);
    return songRow(t, function () {
      // By position rather than URI, so the right one of two copies plays.
      startPlayback({ context_uri: pl.uri, offset: { position: s.position } }, t.name);
    });
  }

  // Play goes in order, Shuffle starts anywhere.
  function playPlaylist(pl, shuffle) {
    var body = { context_uri: pl.uri }, n = countOf(pl);
    if (page && page.pl === pl && page.total) n = page.total;
    if (shuffle && n) body.offset = { position: Math.floor(Math.random() * n) };
    startPlayback(body, pl.name, shuffle);
  }

  // ---- search ---------------------------------------------------------------
  function runSearch(offset) {
    var q = search.q, seq = ++search.seq, listEl = $('browse-list');
    var target = page && !page.denied ? page.pl : null;
    if (!offset) api.fillList(listEl, [{ label: 'Searching…' }]);
    Spotify.searchTracks(q, offset).then(function (data) {
      if (seq !== search.seq) return;  // a newer search replaced this one
      var found = (data && data.tracks) || {};
      var tracks = (found.items || []).filter(Boolean);
      if (!offset && !tracks.length) return api.fillList(listEl, [{ label: 'No songs found for “' + q + '”.' }]);
      if (!offset) {
        api.clearList(listEl);
        listEl.scrollTop = 0;
        if (target) listEl.appendChild(api.el('li', 'section', 'Tap + to add to ' + target.name));
      }
      var more = listEl.querySelector('.more');
      if (more) listEl.removeChild(more);
      tracks.forEach(function (t) {
        listEl.appendChild(songRow(t, function () {
          // Play it within its album so music keeps going after the song ends.
          startPlayback(t.album && t.album.uri ? { context_uri: t.album.uri, offset: { uri: t.uri } } : { uris: [t.uri] }, t.name);
        }, target));
      });
      api.watchArt(listEl);
      // Spotify returns 10 at a time; stop at 50 to keep the list light on the iPad.
      if (found.next && offset + 10 < MAX_RESULTS) {
        more = api.el('li', 'more', 'More results');
        more.addEventListener('click', function () {
          if (more.textContent !== 'More results') return;
          more.textContent = 'Loading…';
          runSearch(offset + 10);
        });
        listEl.appendChild(more);
      }
    }, function (err) {
      if (seq !== search.seq) return;
      if (err && err.code === 'logged_out') return api.actionError(err);
      var msg = err && err.status === 0 ? 'No connection. Try again.'
        : err && err.status === 429 ? api.busyText(err)
        : 'Search didn’t work. Try again.';
      if (!offset) return api.fillList(listEl, [{ label: msg }]);
      api.toast(msg);
      var more = listEl.querySelector('.more');
      if (more) more.textContent = 'More results';
    });
  }

  // ---- song rows ------------------------------------------------------------
  // onTap null: a song Spotify can't play from here (a local file, or not in this country).
  // target: the playlist + adds to; without one, + opens the picker.
  function songRow(t, onTap, target) {
    var li = api.el('li', onTap ? 'track' : 'track off');
    var imgs = (t.album && t.album.images) || t.images || [];
    li.appendChild(api.thumb(imgs.length ? imgs[imgs.length - 1].url : ''));
    var text = api.el('div', 'track-text');
    text.appendChild(api.el('div', 'track-title', t.name || ''));
    text.appendChild(api.el('div', 'track-artist', (t.artists || []).map(function (a) { return a.name; }).join(', ') ||
      (t.show && t.show.name) || ''));
    li.appendChild(text);
    if (!onTap) return li;
    li.appendChild(iconButton(ICON_QUEUE, 'Add to queue', function () { queueTrack(t, li); }));
    li.appendChild(iconButton(ICON_ADD, 'Add to a playlist', function (btn) {
      if (!target) return openPicker(t, true);
      if (li.classList.contains('busy') || btn.classList.contains('done')) return;
      toggle(li, 'busy', true);
      addTo(target, t).then(function () {
        toggle(li, 'busy', false);
        toggle(btn, 'done', true);
        btn.innerHTML = ICON_DONE;
        api.toast('Added to ' + target.name);
      }, function (err) {
        toggle(li, 'busy', false);
        api.actionError(err);
      });
    }));
    li.addEventListener('click', onTap);
    return li;
  }

  function iconButton(icon, label, fn) {
    var btn = api.el('button', 'track-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      fn(btn);
    });
    return btn;
  }

  function queueTrack(t, li) {
    if (li.classList.contains('busy')) return;
    toggle(li, 'busy', true);
    Spotify.addToQueue(t.uri).then(function () {
      toggle(li, 'busy', false);
      api.toast('Queued ' + t.name);
      state.queueAt = 0;  // refresh Up next
    }, function (err) {
      toggle(li, 'busy', false);
      if (api.isNoDevice(err)) api.toast('Start playing something first, then queue songs.');
      else api.actionError(err);
    });
  }

  // Start a playlist, album or track. Target the last device seen so this works from the idle
  // clock too; if that device is gone, ask which one to play on.
  // shuffle: true or false to set it, or leave it out to keep it as it is.
  function startPlayback(body, label, shuffle) {
    api.closeSheets();
    function quietly() {}
    function go(deviceId) {
      api.command();
      var set = shuffle === undefined ? Promise.resolve(true)
        : Spotify.setShuffle(shuffle, deviceId).then(function () { return true; }, quietly);
      return set.then(function (ok) {
        return Spotify.playItems(body, deviceId).then(function () {
          // Shuffle can only be set on an active device, which it may not have been until now.
          if (!ok) return Spotify.setShuffle(shuffle, deviceId).catch(quietly);
        });
      });
    }
    function done() {
      api.toast('Playing ' + label);
      api.afterAction();
    }
    go(state.deviceId).then(done, function (err) {
      if (!api.isNoDevice(err)) return api.actionError(err);
      api.openDevices(function (device) {
        api.useDevice(device.id);
        go(device.id).then(done, api.actionError);
      });
    });
  }

  // ---- setup ----------------------------------------------------------------
  function onClose() {
    $('search-input').blur();
    $('newpl-name').blur();
    clearTimeout(search.timer);
    search.seq++;  // drop any search still in flight
    picking = null;
  }

  function init(a) {
    api = a;
    state = a.state;

    // Search box. Search runs as you type; the keyboard's Search key just hides the keyboard.
    var input = $('search-input');
    input.addEventListener('input', function () {
      api.bumpSheetTimer();
      setQuery(input.value);
    });
    $('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      input.blur();
      // Typed and hit Search before the pause: search now instead of waiting.
      if (search.q && search.timer) { clearTimeout(search.timer); search.timer = null; runSearch(0); }
    });
    $('search-clear').addEventListener('click', function () {
      input.value = '';
      setQuery('');
    });
    $('browse-back').addEventListener('click', back);
    $('browse-list').addEventListener('scroll', function () {
      api.bumpSheetTimer();
      moreIfNear();
    });

    var name = $('newpl-name');
    name.addEventListener('input', api.bumpSheetTimer);
    $('newpl-form').addEventListener('submit', function (e) {
      e.preventDefault();
      createNew();
    });

    // iOS 12 can leave the page pushed up after the keyboard closes.
    [input, name].forEach(function (i) {
      i.addEventListener('blur', function () { window.scrollTo(0, 0); });
    });
  }

  return {
    init: init,
    open: function () { open(null); },
    openPicker: openPicker,
    onClose: onClose
  };
})();
