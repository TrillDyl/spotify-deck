// Playlists and search: the Browse sheet (your playlists, a playlist's songs, the For you tab, search
// for songs, artists and albums), the add-to-playlist picker, and making a new playlist. js/foryou.js
// has For you's data.
//
// Spotify only lists the songs of playlists you own or collaborate on. Ones you only follow open
// with Play and Shuffle.
var Browse = (function () {
  var PLAYLISTS_FRESH_MS = 10 * 60 * 1000;
  var MAX_PLAYLISTS = 500;
  var MAX_SONGS = 500;      // rows in an open playlist, to keep the DOM small on the iPad
  var MAX_RESULTS = 50;
  var MAX_ALBUMS = 3;       // and one artist, with the songs a search finds
  var NEAR_END_PX = 1200;
  var TAB_KEY = 'deck.browseTab';
  var RANGES = [['short_term', '4 weeks'], ['medium_term', '6 months'], ['long_term', '1 year']];

  var ICON_QUEUE = '<svg viewBox="0 0 24 24"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>';
  var ICON_ADD = '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
  var ICON_RADIO = '<svg viewBox="0 0 24 24"><path d="M3.24 6.15C2.51 6.43 2 7.17 2 8v12c0 1.1.89 2 2 2h16c1.11 0 2-.9 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34-.67-1.66L3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z"/></svg>';
  var ICON_SONGS = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
  var ICON_ARTISTS = '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  var ICON_RECENT = '<svg viewBox="0 0 24 24"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>';
  var ICON_RENAME = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  var ICON_FORGET = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  var ICON_DONE = '<svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

  var api = null;    // from deck.js
  var state = null;  // the deck's state: uri, item, deviceId, me, playlists, playlistsAt, queueAt
  var search = { q: '', seq: 0, timer: null };
  var page = null;   // the playlist open in Browse
  var mine = null;     // a For you page open in Browse: { kind, title, range, items, error }
  var tab = 'playlists';  // or 'foryou'
  var naming = null;   // what the name sheet is for: { picking } for a new playlist, { mix } to rename one
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
    var job = { track: track, browse: !!fromBrowse, scroll: $('browse-list').scrollTop };
    $('picker-song').textContent = track.name || '';
    api.fillList(listEl, [{ label: 'Loading…' }]);
    api.openSheet('picker');
    picking = job;  // after openSheet, which closes (and so clears) whatever was open
    loadPlaylists().then(function (all) {
      if (picking !== job) return;
      var rows = [{ label: 'New playlist', icon: '+', make: true }];
      all.filter(isMine).forEach(function (pl) {
        rows.push({ label: pl.name, note: noteFor(pl), art: coverOf(pl), pl: pl });
      });
      api.fillList(listEl, rows, function (row, li) {
        if (row.make) return openNew(job);
        if (li.classList.contains('busy')) return;
        toggle(li, 'busy', true);
        addTo(row.pl, job.track).then(function () {
          donePicking(job, 'Added to ' + row.pl.name);
        }, function (err) {
          toggle(li, 'busy', false);
          api.actionError(err);
        });
      });
    }, function (err) {
      if (picking !== job) return;
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
  function openName(title, sub, value, button) {
    $('newpl-title').textContent = title;
    $('newpl-song').textContent = sub;
    $('newpl-name').value = value;
    $('newpl-create').textContent = button;
    $('newpl-msg').textContent = '';
    toggle($('newpl-create'), 'busy', false);
    api.openSheet('newpl');
    $('newpl-name').focus();
  }

  function openNew(from) {
    var p = from || { track: null, browse: true, scroll: 0 };
    openName('New playlist', p.track ? 'with ' + p.track.name : '', '', 'Create');
    picking = p;
    naming = { picking: p };
  }

  function openRename(m) {
    openName('Rename mix', '', m.name, 'Save');
    naming = { mix: m };
  }

  function onNamed() {
    var name = trim($('newpl-name').value), btn = $('newpl-create');
    if (!naming || btn.classList.contains('busy')) return;
    if (!name) { $('newpl-msg').textContent = 'Give it a name first.'; return; }
    $('newpl-name').blur();
    $('newpl-msg').textContent = '';
    if (naming.mix) {
      ForYou.rename(naming.mix.id, name);
      open(null);
      return;
    }
    createNew(name, naming.picking, btn);
  }

  function createNew(name, p, btn) {
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
    page = mine = null;
    api.openSheet('browse');
    if (pl) openPlaylist(pl);
    else setQuery('');
  }

  function showHeader() {
    $('browse-title').textContent = page ? page.pl.name : mine ? mine.title : 'Browse';
    toggle($('browse-back'), 'hidden', !page && !mine);
    toggle($('browse-tabs'), 'hidden', !!(page || mine || search.q));
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      toggle(b, 'on', b.getAttribute('data-tab') === tab);
    });
    $('search-input').placeholder = page && !page.denied ? 'Search songs to add' : 'Search songs, artists and albums';
  }

  function setQuery(raw) {
    clearTimeout(search.timer);
    search.timer = null;
    search.q = trim(raw);
    toggle($('search-clear'), 'hidden', !raw);
    if (!search.q) {
      search.seq++;
      if (page) { if (page.stale) openPlaylist(page.pl); else renderPlaylist(); }
      else if (mine) renderMine();
      else if (tab === 'foryou') showForYou();
      else showPlaylists();
      return;
    }
    showHeader();
    // Wait for a pause in typing so each keystroke isn't a request.
    search.timer = setTimeout(function () { search.timer = null; runSearch(0); }, 450);
  }

  function back() {
    var input = $('search-input');
    input.blur();
    if (!search.q) page = mine = null;  // out of the page; from a search, back to the page first
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
      if (seq !== search.seq || page || mine || tab !== 'playlists') return;  // something else is showing
      if (shown && samePlaylists(shown, pls)) return;  // unchanged: keep the scroll position
      render(pls);
    }, function (err) {
      if (shown || seq !== search.seq || page || mine || tab !== 'playlists') return;  // the cached list is still up
      api.closeSheets();
      api.actionError(err);
    });

    function render(pls) {
      var rows = [];
      if (!state.uri) rows.push({ label: 'Resume on a device…', resume: true });
      rows.push({ label: 'New playlist', icon: '+', make: true });
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

  // ---- for you --------------------------------------------------------------
  function showForYou() {
    var listEl = $('browse-list'), rows = [];
    var song = state.uri && state.item && state.item.type === 'track' && !state.item.is_local ? state.item : null;
    showHeader();
    if (song) rows.push({ label: 'Radio from this song', note: song.name, icon: ICON_RADIO, radio: song });
    rows.push({ label: 'Your listening', cls: 'section', inert: true });
    rows.push({ label: 'Top songs', icon: ICON_SONGS, kind: 'tracks' });
    rows.push({ label: 'Top artists', icon: ICON_ARTISTS, kind: 'artists' });
    rows.push({ label: 'Recently played', icon: ICON_RECENT, kind: 'recent' });
    rows.push({ label: 'Your Spotify mixes', cls: 'section', inert: true });
    api.fillList(listEl, rows, function (row) {
      if (row.radio) startRadio(row.radio);
      else openMine(row.kind, row.label);
    });
    var mixes = ForYou.mixes();
    mixes.forEach(function (m) { listEl.appendChild(mixRow(m)); });
    if (!mixes.length) {
      listEl.appendChild(api.el('li', 'foot', 'Play a Daily Mix, Discover Weekly or another Spotify mix from your phone, and it’ll be kept here.'));
    }
    api.watchArt(listEl);
    listEl.scrollTop = 0;
  }

  function mixRow(m) {
    var li = api.el('li', 'track');
    var art = api.thumb(m.cover || m.songArt);
    // Covers of mixes can stop working; the song's art is a good stand-in.
    art.addEventListener('error', function () {
      if (art._src === m.songArt || !m.songArt) return;
      art._src = m.songArt;
      art.src = m.songArt;
    });
    li.appendChild(art);
    var text = api.el('div', 'track-text');
    text.appendChild(api.el('div', 'track-title', m.name));
    li.appendChild(text);
    li.appendChild(iconButton(ICON_RENAME, 'Rename', function () { openRename(m); }));
    li.appendChild(iconButton(ICON_FORGET, 'Forget this mix', function () {
      ForYou.forget(m.id);
      showForYou();
      api.toast('Forgot ' + m.name);
    }));
    li.addEventListener('click', function () {
      startPlayback({ context_uri: m.uri }, m.name, undefined, function (err) {
        if (err && (err.status === 403 || err.status === 404 || err.status === 400)) api.toast('Spotify wouldn’t start ' + m.name + ' from here');
        else api.actionError(err);
      });
    });
    return li;
  }

  // Spotify has no way to ask for a song's radio. But when a song played on its own ends, Autoplay
  // carries on with similar ones. If it's already playing, it carries on from the same spot.
  function startRadio(song) {
    var body = { uris: [song.uri] };
    if (song.uri === state.uri) body.position_ms = Math.round(api.progressMs());
    startPlayback(body, song.name + ' radio', undefined, null, function () {
      return Spotify.setRepeat('off').catch(function () {});  // repeat would keep Autoplay from starting
    });
  }

  function openMine(kind, title) {
    search.seq++;
    mine = { kind: kind, title: title, range: RANGES[0][0], items: null, error: null };
    $('browse-list').scrollTop = 0;
    loadMine();
  }

  function loadMine() {
    var m = mine, range = m.range;
    m.items = m.error = null;
    renderMine();
    function current() { return mine === m && m.range === range; }
    ForYou.load(m.kind, range).then(function (items) {
      if (!current()) return;
      m.items = items;
      if (!search.q) renderMine();
    }, function (err) {
      if (err && err.code === 'logged_out') return api.actionError(err);
      if (!current()) return;
      m.error = err || {};
      if (!search.q) renderMine();
    });
  }

  function renderMine() {
    var listEl = $('browse-list'), m = mine, items = m.items || [];
    showHeader();
    api.clearList(listEl);
    if (m.kind !== 'recent') listEl.appendChild(rangeRow());
    if (m.kind !== 'artists' && items.length) listEl.appendChild(mineHero(items));
    items.forEach(function (it, i) {
      listEl.appendChild(m.kind === 'artists' ? artistRow(it) : songRow(it, function () { playSongs(items, i, it.name); }));
    });
    var err = m.error;
    var foot = !err ? (!m.items ? 'Loading…' : items.length ? '' : 'Nothing here yet. Spotify fills this in as you listen.')
      : err.status === 403 ? 'This needs a permission your login doesn’t have. Log in on your Mac again and pair this iPad to see it.'
      : err.status === 429 ? api.busyText(err)
      : 'Couldn’t load this. Tap to try again.';
    if (foot) {
      var li = api.el('li', 'foot', foot);
      if (err && err.status !== 403) li.addEventListener('click', loadMine);
      listEl.appendChild(li);
    }
    api.watchArt(listEl);
  }

  function rangeRow() {
    var li = api.el('li', 'ranges'), seg = api.el('span', 'seg');
    RANGES.forEach(function (r) {
      var b = api.el('button', r[0] === mine.range ? 'on' : '', r[1]);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (mine.range === r[0]) return;
        mine.range = r[0];
        loadMine();
      });
      seg.appendChild(b);
    });
    li.appendChild(seg);
    return li;
  }

  function mineHero(items) {
    var imgs = (items[0].album && items[0].album.images) || [];
    return heroRow(imgs.length ? imgs[Math.min(1, imgs.length - 1)].url : '', mine.title, songs(items.length), function (shuffle) {
      playSongs(items, shuffle ? Math.floor(Math.random() * items.length) : 0, mine.title, shuffle);
    });
  }

  // Play a list of songs from one of them on.
  function playSongs(items, i, label, shuffle) {
    startPlayback({ uris: items.map(function (t) { return t.uri; }), offset: { position: i } }, label, shuffle);
  }

  function artistRow(a, note) {
    return contextRow(a, 'round', note, function () { startPlayback({ context_uri: a.uri }, a.name); });
  }

  // An album plays in order.
  function albumRow(a) {
    var kind = a.album_type === 'single' ? 'EP' : 'Album';
    return contextRow(a, '', [kind, artistsOf(a), (a.release_date || '').slice(0, 4)].filter(Boolean).join(' · '),
      function () { startPlayback({ context_uri: a.uri }, a.name, false); });
  }

  // An artist or album, with an optional line under its name.
  function contextRow(a, cls, note, onTap) {
    var li = api.el('li', 'track'), imgs = a.images || [];
    li.appendChild(api.thumb(imgs.length ? imgs[imgs.length - 1].url : '', cls));
    var text = api.el('div', 'track-text');
    text.appendChild(api.el('div', 'track-title', a.name || ''));
    if (note) text.appendChild(api.el('div', 'track-artist', note));
    li.appendChild(text);
    li.addEventListener('click', onTap);
    return li;
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
    var pl = page.pl;
    var note = page.denied || page.total === null ? noteFor(pl) : songs(page.total);
    return heroRow(coverOf(pl, 1), pl.name, note, page.total === 0 ? null : function (shuffle) { playPlaylist(pl, shuffle); });
  }

  // The top of a page: cover, name, and Play and Shuffle (unless there's nothing to play).
  function heroRow(art, name, note, onPlay) {
    var li = api.el('li', 'hero');
    li.appendChild(api.thumb(art, 'hero-art'));
    var info = api.el('div', 'hero-info');
    info.appendChild(api.el('div', 'hero-name', name));
    info.appendChild(api.el('div', 'hero-note', note));
    if (onPlay) {
      var buttons = api.el('div', 'hero-buttons');
      [['Play', false], ['Shuffle', true]].forEach(function (b) {
        var btn = api.el('button', 'hero-btn' + (b[1] ? '' : ' main'), b[0]);
        btn.type = 'button';
        btn.addEventListener('click', function () { onPlay(b[1]); });
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
  // Lower case, without accents or punctuation, so “beyonce” finds Beyoncé.
  function plain(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f'’]/g, '').replace(/[-.,:;!?&+\/()"“”]+/g, ' ');
  }

  // Does every word typed start a word of this?
  function matchesWords(q, text) {
    var words = plain(q).split(/\s+/).filter(Boolean), hay = ' ' + plain(text);
    return words.length > 0 && words.every(function (w) { return hay.indexOf(' ' + w) > -1; });
  }

  function artistsOf(x) { return (x.artists || []).map(function (a) { return a.name; }).join(', '); }

  // The artist and albums to show with the songs: [{ artist or album, close }]. close: it's what was
  // typed, rather than something Spotify thinks is related.
  function pickOthers(q, data) {
    function items(key) { return ((data && data[key] && data[key].items) || []).filter(function (x) { return x && x.uri; }); }
    function closeFirst(list) {
      return list.filter(function (x) { return x.close; }).concat(list.filter(function (x) { return !x.close; }));
    }
    var artists = items('artists').map(function (a) { return { artist: a, close: matchesWords(q, a.name || '') }; });
    var seen = {};
    var albums = items('albums').filter(function (a) {
      // A short single is just the song again, and albums often come in several editions.
      var key = plain((a.name || '') + ' ' + artistsOf(a));
      if (seen[key] || (a.album_type === 'single' && a.total_tracks < 4)) return false;
      return (seen[key] = true);
    }).map(function (a) { return { album: a, close: matchesWords(q, (a.name || '') + ' ' + artistsOf(a)) }; });
    return closeFirst(artists).slice(0, 1).concat(closeFirst(albums).slice(0, MAX_ALBUMS));
  }

  function otherRow(x) { return x.artist ? artistRow(x.artist, 'Artist') : albumRow(x.album); }

  function runSearch(offset) {
    var q = search.q, seq = ++search.seq, listEl = $('browse-list');
    var target = page && !page.denied ? page.pl : null;
    if (!offset) api.fillList(listEl, [{ label: 'Searching…' }]);
    // Only songs can be added to a playlist, and More results is for songs.
    Spotify.search(q, offset || target ? 'track' : 'track,artist,album', offset).then(function (data) {
      if (seq !== search.seq) return;  // a newer search replaced this one
      var found = (data && data.tracks) || {};
      var tracks = (found.items || []).filter(Boolean);
      var others = pickOthers(q, data);
      if (!offset && !tracks.length && !others.length) return api.fillList(listEl, [{ label: 'Nothing found for “' + q + '”.' }]);
      var below = others;
      if (!offset) {
        api.clearList(listEl);
        listEl.scrollTop = 0;
        if (target) listEl.appendChild(api.el('li', 'section', 'Tap + to add to ' + target.name));
        // The keyboard covers most of the list, so only what was asked for goes above the songs.
        var above = others.filter(function (x) { return x.close; });
        if (above.length || !tracks.length) {
          below = [];
          if (!above.length) above = others;
        }
        above.forEach(function (x) { listEl.appendChild(otherRow(x)); });
        if (above.length && tracks.length) listEl.appendChild(api.el('li', 'section', 'Songs'));
      }
      var more = listEl.querySelector('.more');
      if (more) listEl.removeChild(more);
      var end = listEl.querySelector('.others');  // songs go before the artists and albums at the bottom
      tracks.forEach(function (t) {
        listEl.insertBefore(songRow(t, function () {
          // Play it within its album so music keeps going after the song ends.
          startPlayback(t.album && t.album.uri ? { context_uri: t.album.uri, offset: { uri: t.uri } } : { uris: [t.uri] }, t.name);
        }, target), end);
      });
      if (below.length) {
        end = listEl.appendChild(api.el('li', 'section others', 'Artists and albums'));
        below.forEach(function (x) { listEl.appendChild(otherRow(x)); });
      }
      api.watchArt(listEl);
      // Spotify returns 10 at a time; stop at 50 to keep the list light on the iPad.
      if (found.next && offset + 10 < MAX_RESULTS) {
        more = api.el('li', 'more', 'More results');
        more.addEventListener('click', function () {
          if (more.textContent !== 'More results') return;
          more.textContent = 'Loading…';
          runSearch(offset + 10);
        });
        listEl.insertBefore(more, end);
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
    text.appendChild(api.el('div', 'track-artist', artistsOf(t) || (t.show && t.show.name) || ''));
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
  // shuffle: true or false to set it, or leave it out to keep it as it is. onFail handles errors other
  // than having no device; after runs once it's playing.
  function startPlayback(body, label, shuffle, onFail, after) {
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
        }).then(function () { return after && after(); });
      });
    }
    var fail = onFail || api.actionError;
    function done() {
      api.toast('Playing ' + label);
      api.afterAction();
    }
    go(state.deviceId).then(done, function (err) {
      if (!api.isNoDevice(err)) return fail(err);
      api.openDevices(function (device) {
        api.useDevice(device.id);
        go(device.id).then(done, fail);
      });
    });
  }

  // ---- setup ----------------------------------------------------------------
  function onClose() {
    $('search-input').blur();
    $('newpl-name').blur();
    clearTimeout(search.timer);
    search.seq++;  // drop any search still in flight
    picking = naming = null;
  }

  function init(a) {
    api = a;
    state = a.state;
    try { if (localStorage.getItem(TAB_KEY) === 'foryou') tab = 'foryou'; } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () {
        tab = b.getAttribute('data-tab');
        try { localStorage.setItem(TAB_KEY, tab); } catch (e) {}
        setQuery('');
      });
    });

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
      onNamed();
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
    onClose: onClose,
    _pickOthers: pickOthers  // for the tests
  };
})();
