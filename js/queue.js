// The Up next list. Spotify's API can't remove a song from the queue, so Remove hides the song and
// the deck skips it when it comes up. skip: URI → how many upcoming plays to skip.
var DeckQueue = (function () {
  // The queue as Spotify returns it, slimmed down for the list.
  function parse(d) {
    return ((d && d.queue) || []).map(function (q, i) {
      var imgs = (q.album && q.album.images) || q.images || [];
      return {
        index: i,  // position in Spotify's queue
        uri: q.uri,
        title: q.name || '',
        artist: (q.artists || []).map(function (a) { return a.name; }).join(', ') || (q.show && q.show.name) || '',
        art: imgs.length ? imgs[imgs.length - 1].url : ''
      };
    });
  }

  // Forget removals for songs that have left the queue some other way.
  function prune(skip, all, playingUri) {
    Object.keys(skip).forEach(function (uri) {
      var left = all.filter(function (q) { return q.uri === uri; }).length + (uri === playingUri ? 1 : 0);
      skip[uri] = Math.min(skip[uri], left);
      if (!skip[uri]) delete skip[uri];
    });
  }

  // Hide removed songs. A removal hides (and later skips) that song's next appearance.
  function visible(skip, all) {
    var hide = {};
    Object.keys(skip).forEach(function (uri) { hide[uri] = skip[uri]; });
    return all.filter(function (q) {
      if (!hide[q.uri]) return true;
      hide[q.uri]--;
      return false;
    });
  }

  // Use up one removal. True if this play of the song should be skipped.
  function take(skip, uri) {
    if (!skip[uri]) return false;
    if (!--skip[uri]) delete skip[uri];
    return true;
  }

  return { parse: parse, prune: prune, visible: visible, take: take };
})();
