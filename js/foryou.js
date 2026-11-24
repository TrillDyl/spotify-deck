// What the For you tab shows: your top songs and artists, what you played lately, and the mixes
// Spotify makes for you. js/browse.js draws it.
//
// Spotify doesn't let apps like this one list its mixes or ask for recommendations (since Nov 2024).
// So a mix is remembered when the deck sees it playing, started from a phone or computer, and can
// then be played again from here. Its songs can't be listed.
var ForYou = (function () {
  var MIXES_KEY = 'deck.mixes';
  var MAX_MIXES = 24;
  var SEEN_EVERY_MS = 10 * 60 * 1000;
  var FRESH_MS = 30 * 60 * 1000;
  var NAME_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
  var OEMBED = 'https://open.spotify.com/oembed?url=';
  // Every playlist Spotify makes has an ID that starts like this.
  var SPOTIFY_MADE = /^spotify:(?:user:spotify:)?playlist:(37i9dQZ[A-Za-z0-9]+)$/;

  // [{ uri, id, name, named, cover, songArt, at, asked }], last played first. named: by you.
  var list = null;
  var last = { id: '', at: 0 };  // so that a poll every 3 s isn't a write every 3 s
  var cache = {};                // 'tracks:short_term' → { at, items }

  // ---- mixes ----------------------------------------------------------------
  function mixes() {
    if (list) return list;
    try { list = JSON.parse(localStorage.getItem(MIXES_KEY)); } catch (e) {}
    if (!Array.isArray(list)) list = [];
    return list;
  }
  function save() {
    try { localStorage.setItem(MIXES_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function find(id) {
    return mixes().filter(function (m) { return m.id === id; })[0];
  }

  // Every poll: remember a mix that's playing.
  function see(p) {
    if (p && p.is_playing && p.item) remember(p.context, p.item, Date.now());
  }

  function remember(context, track, at) {
    var made = SPOTIFY_MADE.exec((context && context.uri) || '');
    if (!made) return;
    var id = made[1];
    if (last.id === id && at - last.at < SEEN_EVERY_MS) return;
    var m = find(id);
    if (m && m.at >= at) return;  // an older play, from the recently played list
    last = { id: id, at: at };
    if (!m) {
      var artist = track && track.artists && track.artists[0];
      m = { uri: 'spotify:playlist:' + id, id: id, name: artist ? 'Mix with ' + artist.name : 'Spotify mix', named: false, cover: '', songArt: smallArt(track), at: at, asked: 0 };
      list.push(m);
    }
    m.at = at;
    list.sort(function (a, b) { return b.at - a.at; });
    if (list.length > MAX_MIXES) list.length = MAX_MIXES;
    save();
    if (!m.cover && at - m.asked > NAME_RETRY_MS) lookUp(m);
  }

  function smallArt(track) {
    var imgs = (track && track.album && track.album.images) || [];
    return imgs.length ? imgs[imgs.length - 1].url : '';
  }

  // Spotify's public link preview knows the name and cover of many mixes, though not all. This isn't
  // the Web API, so it needs no login and doesn't count towards its limits.
  function lookUp(m) {
    fetch(OEMBED + encodeURIComponent(m.uri)).then(function (res) {
      m.asked = Date.now();  // an answer, even if it's no
      return res.ok ? res.json() : null;
    }).then(function (d) {
      if (d && d.title && !m.named) m.name = d.title;
      if (d && d.thumbnail_url) m.cover = d.thumbnail_url;
      save();
    }).catch(function () {});  // no network: ask again next time it plays
  }

  function rename(id, name) {
    var m = find(id);
    if (!m) return;
    m.name = name;
    m.named = true;
    save();
  }

  function forget(id) {
    list = mixes().filter(function (m) { return m.id !== id; });
    save();
  }

  // ---- your listening -------------------------------------------------------
  // kind: 'tracks' | 'artists' | 'recent'. range: 'short_term' (4 weeks) | 'medium_term' (6 months) |
  // 'long_term' (1 year). Kept for half an hour; recent plays are always fetched.
  function load(kind, range) {
    if (kind === 'recent') return Spotify.getRecent().then(recent);
    var key = kind + ':' + range, had = cache[key];
    if (had && Date.now() - had.at < FRESH_MS) return Promise.resolve(had.items);
    return Spotify.getTop(kind, range).then(function (d) {
      var items = ((d && d.items) || []).filter(function (x) { return x && x.uri; });
      cache[key] = { at: Date.now(), items: items };
      return items;
    });
  }

  // Each song once, latest first. Any mixes they came from are remembered too.
  function recent(d) {
    var seen = {}, songs = [];
    ((d && d.items) || []).forEach(function (r) {
      var t = r && r.track;
      if (!t || !t.uri) return;
      remember(r.context, t, Date.parse(r.played_at) || 0);
      if (seen[t.uri]) return;
      seen[t.uri] = true;
      songs.push(t);
    });
    return songs;
  }

  return { see: see, mixes: mixes, rename: rename, forget: forget, load: load };
})();
