// Record player mode: a bookshelf of saved albums, a sleeve to pick a side, and a turntable
// where the tonearm is the only way to move through a side.
//
// Sound plays only while the platter turns (Start/Stop) and the needle is down on the grooves.
// A side is played as a list of track URIs, so Spotify runs out of music where the side ends,
// and the needle then rides the run-out groove until the arm is lifted (a manual arm).
//
// The turntable is drawn on a 1024×768 stage (the iPad mini in landscape) and scaled to fit,
// so the arm geometry below is in stage pixels.
var Records = (function () {
  var RECORD_KEY = 'deck.record';
  var SHELF_KEY = 'deck.shelf';
  var COLORS_KEY = 'deck.spineColors';
  var SORT_KEY = 'deck.shelfSort';
  var VIEW_KEY = 'deck.shelfView';
  var MAX_ALBUMS = 1000;
  var SIDE_MAX_MS = 25 * 60 * 1000;   // a longer disc is cut into more records, like a real LP
  var SHELF_TIMEOUT_MS = 2 * 60 * 1000;
  var GRACE_MS = 4000;                // after a command, polls may still show the old state

  var W = 1024, H = 768;
  var C = { x: 372, y: 384 };         // platter centre
  var P = { x: 712, y: 104 };         // tonearm pivot
  var L = 425;                        // pivot to stylus
  var REST = 90;                      // arm angle on its rest (degrees, clockwise from +x)
  var SIZES = { lp: { R: 320, label: 106 }, seven: { R: 187, label: 80 } };
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  var api = null;   // from deck.js: state, toast, actionError, afterAction, isNoDevice, openDevices, wake
  var root = null;  // the turntable while record mode is on
  var els = {};
  var rec = null;   // the record on the platter
  var arm = { on: false, down: false, ms: 0, at: 0 };  // ms: where the needle sits in the side
  var motor = false;
  var run = { expect: false, idx: -1, remaining: Infinity, cmdAt: 0 };  // expect: our side should be sounding
  var drag = null;
  var labelImg = null;

  function $(id) { return document.getElementById(id); }
  function toggle(el, cls, on) { el.classList[on ? 'add' : 'remove'](cls); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  function fmt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }
  function noop() {}
  function quiet(err) { if (err && err.code === 'logged_out') api.actionError(err); }

  // ---- sides ----------------------------------------------------------------
  // Each disc becomes one or more records of two sides, split at the track boundary that best
  // balances their lengths. Small singles and EPs become 7" records.
  function buildRecord(album, tracks) {
    var discs = [], byDisc = {};
    tracks.forEach(function (t) {
      var d = t.disc_number || 1;
      if (!byDisc[d]) { byDisc[d] = []; discs.push(d); }
      byDisc[d].push({ uri: t.uri, name: t.name || '', ms: t.duration_ms || 0 });
    });
    discs.sort(function (a, b) { return a - b; });
    var total = tracks.reduce(function (s, t) { return s + (t.duration_ms || 0); }, 0);
    var seven = album.type === 'single' && tracks.length <= 4 && total < 16 * 60 * 1000;
    var sides = [], records = 0;
    discs.forEach(function (d) {
      var list = byDisc[d];
      var ms = list.reduce(function (s, t) { return s + t.ms; }, 0);
      var n = Math.max(2, 2 * Math.ceil(ms / (2 * SIDE_MAX_MS)));
      split(list, n).forEach(function (group, j) {
        if (j % 2 === 0) records++;
        sides.push(makeSide(LETTERS[sides.length] || String(sides.length + 1), records, group));
      });
    });
    return { seven: seven, sides: sides };
  }

  function makeSide(label, record, tracks) {
    var start = [], t = 0;
    tracks.forEach(function (tr) { start.push(t); t += tr.ms; });
    return { label: label, record: record, tracks: tracks, start: start, ms: t };
  }

  // Contiguous split into n parts with the smallest longest part. Ties give side A more.
  function split(list, n) {
    var pre = [0];
    list.forEach(function (t) { pre.push(pre[pre.length - 1] + t.ms); });
    var m = list.length, best = [], cut = [], k, i, j;
    for (k = 1; k <= n; k++) {
      best[k] = []; cut[k] = [];
      for (i = 0; i <= m; i++) {
        if (k === 1) { best[1][i] = pre[i]; cut[1][i] = 0; continue; }
        best[k][i] = Infinity;
        for (j = 0; j <= i; j++) {
          var v = Math.max(best[k - 1][j], pre[i] - pre[j]);
          if (v <= best[k][i]) { best[k][i] = v; cut[k][i] = j; }
        }
      }
    }
    var parts = [], end = m;
    for (k = n; k >= 1; k--) {
      var from = cut[k][end];
      parts.unshift(list.slice(from, end));
      end = from;
    }
    return parts;
  }

  function side() { return rec && rec.sides[rec.side]; }

  function locate(s, ms) {
    for (var i = 0; i < s.tracks.length; i++) {
      if (ms < s.start[i] + s.tracks[i].ms) return { i: i, into: Math.max(0, ms - s.start[i]) };
    }
    return null;  // past the last track: the run-out groove
  }

  function indexIn(s, uri) {
    if (!s || !uri) return -1;
    if (run.idx >= 0 && s.tracks[run.idx] && s.tracks[run.idx].uri === uri) return run.idx;
    for (var i = 0; i < s.tracks.length; i++) if (s.tracks[i].uri === uri) return i;
    return -1;
  }

  // ---- arm geometry ---------------------------------------------------------
  function geom() {
    var g = SIZES[rec && rec.seven ? 'seven' : 'lp'];
    return { R: g.R, label: g.label, rOut: g.R - 7, rIn: g.label + 16, rRO: g.label + 7 };
  }

  var D = Math.sqrt((C.x - P.x) * (C.x - P.x) + (C.y - P.y) * (C.y - P.y));
  var BASE = Math.atan2(C.y - P.y, C.x - P.x) * 180 / Math.PI;

  // Arm angle that puts the stylus at radius r from the spindle (law of cosines).
  function thetaFor(r) {
    var c = (D * D + L * L - r * r) / (2 * D * L);
    return BASE - Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }
  function radiusFor(theta) {
    var a = theta * Math.PI / 180;
    var x = P.x + L * Math.cos(a) - C.x, y = P.y + L * Math.sin(a) - C.y;
    return Math.sqrt(x * x + y * y);
  }
  // Grooves run at a steady pitch, so time maps straight onto the radius.
  function msForRadius(r) {
    var g = geom(), s = side();
    if (r < g.rIn) return s.ms;
    return Math.max(0, Math.min(1, (g.rOut - r) / (g.rOut - g.rIn))) * s.ms;
  }
  function radiusForMs(ms) {
    var g = geom(), s = side();
    if (!s.ms || ms >= s.ms) return g.rRO;
    return g.rOut - ms / s.ms * (g.rOut - g.rIn);
  }

  function armMs() {
    if (!rec) return 0;
    if (run.expect && motor && arm.down) return Math.min(side().ms, arm.ms + Date.now() - arm.at);
    return arm.ms;
  }
  function setArmMs(ms) { arm.ms = ms; arm.at = Date.now(); }
  function armTheta() { return rec && arm.on ? thetaFor(radiusForMs(armMs())) : REST; }
  function inRunout() { return !!rec && arm.on && !run.expect && arm.ms >= side().ms; }

  // ---- playback -------------------------------------------------------------
  function send(body) {
    return Spotify.playItems(body, api.state.deviceId).catch(function (err) {
      if (!api.isNoDevice(err)) throw err;
      return new Promise(function (resolve, reject) {
        api.openDevices(function (device) {
          api.state.deviceId = device.id;
          Spotify.playItems(body, device.id).then(resolve, reject);
        });
      });
    });
  }

  // Start the side from a spot in it. Past the last track there's only the run-out groove.
  function playAt(ms) {
    var s = side(), t = locate(s, ms);
    setArmMs(t ? ms : s.ms);
    if (!t) { run.expect = false; return; }
    run.idx = t.i;
    run.remaining = Infinity;
    run.cmdAt = Date.now();
    run.expect = true;
    var body = {
      uris: s.tracks.map(function (tr) { return tr.uri; }),
      offset: { position: t.i },
      position_ms: Math.round(t.into)
    };
    send(body).then(function () {
      run.cmdAt = Date.now();
      // In order, and silence after the last track.
      Spotify.setShuffle(false).catch(quiet);
      Spotify.setRepeat('off').catch(quiet);
      api.afterAction();
    }, function (err) {
      run.expect = false;
      motor = false;
      paint();
      api.actionError(err);
    });
  }

  function stopSound() {
    if (!run.expect) return;
    setArmMs(armMs());
    run.expect = false;
    run.cmdAt = Date.now();
    Spotify.pause().then(api.afterAction, quiet);
  }

  function enterRunout() {
    setArmMs(side().ms);
    run.expect = false;
    arm.on = true;
    arm.down = true;
  }

  // Every poll: keep the turntable in step with what Spotify is actually doing.
  function onPlayer(p) {
    if (!rec || drag) return;
    if (Date.now() - run.cmdAt < GRACE_MS) return;
    var s = side(), item = p && p.item, playing = !!(p && p.is_playing);
    var idx = item ? indexIn(s, item.uri) : -1;

    if (idx >= 0 && playing) {
      // Our side is playing, maybe after a reload or a resume from the phone.
      run.idx = idx;
      run.remaining = (item.duration_ms || 0) - (p.progress_ms || 0);
      run.expect = true;
      arm.on = arm.down = motor = true;
      setArmMs(s.start[idx] + (p.progress_ms || 0));
      return;
    }
    if (!run.expect) return;

    if (run.idx === s.tracks.length - 1 && run.remaining < 12000) {
      // The side has ended. Spotify's Autoplay may have started something else: stop it.
      if (playing) Spotify.pause().then(api.afterAction, quiet);
      enterRunout();
      return;
    }
    if (playing) {
      // Music started from somewhere else: the needle comes up and the record waits.
      setArmMs(armMs());
      run.expect = false;
      arm.down = false;
      return;
    }
    // Paused or stopped from somewhere else.
    setArmMs(idx >= 0 ? s.start[idx] + (p.progress_ms || 0) : armMs());
    run.expect = false;
    motor = false;
  }

  function ourTrackPlaying() {
    return !!rec && api.state.playing && indexIn(side(), api.state.uri) >= 0;
  }

  // ---- controls -------------------------------------------------------------
  function toggleMotor() {
    var ms = armMs();
    motor = !motor;
    if (rec && motor && arm.on && arm.down && ms < side().ms) playAt(ms);
    if (!motor) {
      stopSound();
      setArmMs(ms);
    }
    paint();
  }

  function toggleCue() {
    if (!rec || !arm.on) return api.toast('Move the arm over the record first');
    var ms = armMs();
    if (arm.down) {
      stopSound();
      arm.down = false;
      setArmMs(ms);
    } else {
      arm.down = true;
      if (motor) playAt(ms);
    }
    paint();
  }

  function flip() {
    if (!rec) return;
    if (arm.on) return api.toast('Lift the arm off the record first');
    var s = side();
    var mates = [];
    rec.sides.forEach(function (x, i) { if (x.record === s.record) mates.push(i); });
    if (mates.length < 2) return;
    toggle(els.flipper, 'flipping', true);
    setTimeout(function () {
      rec.side = mates[(mates.indexOf(rec.side) + 1) % mates.length];
      setArmMs(0);
      save();
      drawVinyl();
      toggle(els.flipper, 'flipping', false);
      paint();
    }, 320);
  }

  function putOn(album, built, sideIndex) {
    stopSound();
    rec = {
      id: album.id, uri: album.uri, name: album.name, artist: album.artist, year: album.year,
      art: album.big || album.small, seven: built.seven, sides: built.sides, side: sideIndex,
      color: shelf.colors[album.id] || null
    };
    arm.on = arm.down = false;
    setArmMs(0);
    run.idx = -1;
    save();
    closeShelf();
    drawVinyl();
    paint();
  }

  function save() { write(RECORD_KEY, rec); }

  // ---- arm dragging ---------------------------------------------------------
  function stagePoint(e) {
    var t = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e);
    var rect = root.getBoundingClientRect(), s = rect.width / W;
    return { x: (t.clientX - rect.left) / s, y: (t.clientY - rect.top) / s };
  }
  function angleTo(pt) { return Math.atan2(pt.y - P.y, pt.x - P.x) * 180 / Math.PI; }

  function dragStart(e) {
    api.wake();
    if (!rec) return api.toast('Put a record on first');
    e.preventDefault();
    var pt = stagePoint(e);
    drag = { x: pt.x, y: pt.y, offset: angleTo(pt) - armTheta(), theta: armTheta(), moved: false };
  }
  function dragMove(e) {
    if (!drag) return;
    e.preventDefault();
    var pt = stagePoint(e);
    if (!drag.moved) {
      if (Math.abs(pt.x - drag.x) + Math.abs(pt.y - drag.y) < 8) return;
      // Picking up the arm lifts the needle.
      drag.moved = true;
      stopSound();
      arm.down = false;
      toggle(root, 'dragging', true);
      paint();
    }
    var max = thetaFor(geom().rRO);
    drag.theta = Math.max(REST, Math.min(max, angleTo(pt) - drag.offset));
    setArmTheta(drag.theta);
  }
  function dragEnd() {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (!d.moved) return;
    toggle(root, 'dragging', false);
    var r = radiusFor(d.theta), g = geom();
    if (r > g.R + 2) {
      // Let go off the record: back to the rest.
      arm.on = arm.down = false;
      setArmMs(0);
    } else {
      arm.on = arm.down = true;
      var ms = msForRadius(r);
      if (motor) playAt(ms);
      else setArmMs(ms);
    }
    paint();
  }

  function setArmTheta(theta) {
    var t = Math.round(theta * 100) / 100;
    if (els.arm._t === t) return;
    els.arm._t = t;
    els.arm.style.webkitTransform = els.arm.style.transform = 'rotate(' + t + 'deg)';
  }

  // ---- drawing --------------------------------------------------------------
  function drawVinyl() {
    if (!root) return;
    var has = !!rec;
    toggle(root, 'has-record', has);
    toggle(root, 'is-seven', has && rec.seven);
    // The sleeve stands in the panel, and the room takes on the cover's colour.
    if (has && rec.art) els.cover.src = rec.art;
    else els.cover.removeAttribute('src');
    els.glow.style.background = has && rec.color
      ? 'radial-gradient(ellipse at 50% 45%, ' + rec.color.bg + ' 0%, rgba(18, 13, 9, 0) 70%)' : '';
    if (!has) return;
    var g = geom(), s = side();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cv = els.vinyl, size = g.R * 2;
    cv.width = cv.height = Math.round(size * dpr);
    cv.style.width = cv.style.height = size + 'px';
    var f = els.flipper.style;
    f.left = (C.x - g.R) + 'px';
    f.top = (C.y - g.R) + 'px';
    f.width = f.height = size + 'px';
    els.sheen.style.left = f.left; els.sheen.style.top = f.top;
    els.sheen.style.width = els.sheen.style.height = f.width;

    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.translate(g.R, g.R);
    function ring(r, width, color) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, g.R, 0, Math.PI * 2);
    ctx.fillStyle = '#0c0c0d';
    ctx.fill();
    // Grooves, then the smooth bands between tracks.
    var odd = false;
    for (var r = g.rOut; r > g.rIn; r -= 1.6) {
      ring(r, 0.8, odd ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.065)');
      odd = !odd;
    }
    for (var i = 1; i < s.tracks.length; i++) {
      var rb = g.rOut - s.start[i] / s.ms * (g.rOut - g.rIn);
      ring(rb, 3.2, '#121213');
      ring(rb, 0.8, 'rgba(255,255,255,0.13)');
    }
    ring(g.R - 1, 1.5, 'rgba(255,255,255,0.14)');       // lead-in edge
    ring(g.rRO, 1, 'rgba(255,255,255,0.08)');           // run-out groove
    ring(g.rIn, 1, 'rgba(255,255,255,0.06)');
    if (!s.tracks.length) ring((g.rOut + g.rIn) / 2, 1, 'rgba(255,255,255,0.05)');

    drawLabel(ctx, g, s);
  }

  function drawLabel(ctx, g, s) {
    var url = rec.art;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, g.label, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#5a4632';
    ctx.fillRect(-g.label, -g.label, g.label * 2, g.label * 2);
    if (labelImg && labelImg._url === url && labelImg.complete && labelImg.naturalWidth) {
      ctx.drawImage(labelImg, -g.label, -g.label, g.label * 2, g.label * 2);
    } else if (url && (!labelImg || labelImg._url !== url)) {
      labelImg = new Image();
      labelImg._url = url;
      labelImg.crossOrigin = 'anonymous';
      labelImg.onload = function () { if (rec && rec.art === url) drawVinyl(); };
      labelImg.src = url;
    }
    // Side letter and speed along the bottom of the label.
    var grad = ctx.createLinearGradient(0, g.label * 0.25, 0, g.label);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = grad;
    ctx.fillRect(-g.label, 0, g.label * 2, g.label);
    ctx.fillStyle = '#f4ecdc';
    ctx.textAlign = 'center';
    ctx.font = '700 ' + Math.round(g.label * 0.17) + 'px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillText('SIDE ' + s.label, 0, g.label * 0.62);
    ctx.font = '500 ' + Math.round(g.label * 0.11) + 'px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillText(rec.seven ? '45 RPM' : '33⅓ RPM', 0, g.label * 0.8);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, rec.seven ? 19 : 4, 0, Math.PI * 2);  // 7" singles have the big centre hole
    ctx.fillStyle = '#1b1b1c';
    ctx.fill();
  }

  function setText(key, text) {
    var e = els.texts[key];
    if (e && e._v !== text) { e._v = text; e.textContent = text; }
  }

  function paint() {
    if (!root) return;
    var s = side(), ms = armMs();
    toggle(root, 'motor-on', motor);
    toggle(root, 'needle-down', !!rec && arm.on && arm.down);
    toggle(root, 'arm-rest', !rec || !arm.on);
    toggle(root, 'in-runout', inRunout());
    if (!drag) setArmTheta(armTheta());

    if (!rec) {
      setText('side', 'Turntable');
      setText('album', 'No record on the platter');
      setText('artist', 'Tap Records to pick one from your shelf');
      setText('track', '');
      setText('time', '');
    } else {
      var t = locate(s, ms);
      var where = !arm.on ? 'Drag the arm onto the record to play'
        : inRunout() ? 'Run-out groove'
        : t ? (t.i + 1) + '. ' + s.tracks[t.i].name : 'Run-out groove';
      if (arm.on && !arm.down && !inRunout()) where = 'Needle up · ' + where;
      setText('side', 'Side ' + s.label + ' · ' + (rec.seven ? '45' : '33⅓') + ' rpm');
      setText('album', rec.name);
      setText('artist', rec.artist + (rec.year ? ' · ' + rec.year : ''));
      setText('track', where);
      setText('time', s.tracks.length ? fmt(Math.min(ms, s.ms)) + ' / ' + fmt(s.ms) : 'No tracks on this side');
    }
    setText('cue', arm.down && arm.on ? 'Lift needle' : 'Lower needle');

    // Something else is playing on the account: say so, without putting it on the platter.
    var st = api.state, other = st.playing && st.item && !ourTrackPlaying();
    toggle(els.elsewhere, 'hidden', !other);
    if (other) {
      var artist = (st.item.artists || []).map(function (a) { return a.name; }).join(', ');
      setText('elsewhere', (st.device ? 'Playing on ' + st.device : 'Playing') + ': ' +
        st.item.name + (artist ? ' · ' + artist : ''));
    }
  }

  function scale() {
    if (!root) return;
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    root.style.webkitTransform = root.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  function mount(r) {
    root = r;
    els = {
      vinyl: r.querySelector('.tt-vinyl'),
      flipper: r.querySelector('.tt-flip'),
      sheen: r.querySelector('.tt-sheen'),
      arm: r.querySelector('.tt-arm'),
      elsewhere: r.querySelector('.tt-elsewhere'),
      cover: r.querySelector('.tt-cover'),
      glow: r.querySelector('.tt-glow'),
      texts: {}
    };
    Array.prototype.forEach.call(r.querySelectorAll('[data-rec-t]'), function (e) {
      els.texts[e.getAttribute('data-rec-t')] = e;
    });
    // Place the fixed parts from the same numbers the geometry uses.
    var mat = r.querySelector('.tt-mat'), mr = 334;
    mat.style.left = (C.x - mr) + 'px'; mat.style.top = (C.y - mr) + 'px';
    mat.style.width = mat.style.height = mr * 2 + 'px';
    var spindle = r.querySelector('.tt-spindle');
    spindle.style.left = C.x + 'px'; spindle.style.top = C.y + 'px';
    els.arm.style.left = P.x + 'px'; els.arm.style.top = P.y + 'px';
    var head = r.querySelector('.tt-head'), grab = r.querySelector('.tt-grab');
    head.style.left = (L - 44) + 'px';
    grab.style.left = (L - 75) + 'px';
    r.querySelector('.tt-tube').style.width = (L - 10) + 'px';
    var base = r.querySelector('.tt-armbase');
    base.style.left = P.x + 'px'; base.style.top = P.y + 'px';
    var rest = r.querySelector('.tt-armrest');
    rest.style.left = P.x + 'px'; rest.style.top = (P.y + L - 70) + 'px';

    r.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-rec]');
      var what = b && b.getAttribute('data-rec');
      if (what) api.wake();
      if (what === 'motor') toggleMotor();
      else if (what === 'cue') toggleCue();
      else if (what === 'flip') flip();
      else if (what === 'shelf' || (what === 'platter' && !rec)) openShelf();
    });
    grab.addEventListener('touchstart', dragStart, { passive: false });
    grab.addEventListener('touchmove', dragMove, { passive: false });
    grab.addEventListener('touchend', dragEnd);
    grab.addEventListener('touchcancel', dragEnd);
    grab.addEventListener('mousedown', dragStart);

    scale();
    drawVinyl();
    paint();
  }

  function unmount() { root = null; drag = null; }

  // ---- bookshelf ------------------------------------------------------------
  var shelf = {
    albums: null, sort: 'added', view: 'covers', filter: '', seq: 0, timer: null,
    observer: null, artObserver: null, colors: {}, queue: [], busy: 0
  };
  var sleeve = { album: null, spine: null };

  function slim(item) {
    var a = (item && item.album) || {};
    var imgs = a.images || [];
    return {
      id: a.id,
      uri: a.uri,
      name: a.name || '',
      artist: (a.artists || []).map(function (x) { return x.name; }).join(', '),
      year: (a.release_date || '').slice(0, 4),
      type: a.album_type || 'album',
      tracks: a.total_tracks || (a.tracks && a.tracks.total) || 0,
      small: imgs.length ? imgs[imgs.length - 1].url : '',
      big: imgs.length ? imgs[Math.min(1, imgs.length - 1)].url : ''  // about 300px
    };
  }

  function sameAlbums(a, b) {
    return a.length === b.length && a.every(function (x, i) { return x.id === b[i].id; });
  }

  function openShelf() {
    // Start without a filter: on a kiosk the last search could be hours old.
    $('shelf-filter').value = '';
    shelf.filter = '';
    toggle($('shelf'), 'hidden', false);
    bumpShelf();
    if (shelf.albums) renderShelf();
    else $('shelf-rack').innerHTML = '<div class="shelf-note">Taking your records down…</div>';
    refreshShelf();
  }

  function closeShelf() {
    closeSleeve();
    toggle($('shelf'), 'hidden', true);
    clearTimeout(shelf.timer);
    shelf.seq++;
  }

  // Nobody closes a forgotten shelf on a kiosk, so it closes itself.
  function bumpShelf() {
    api.wake();
    clearTimeout(shelf.timer);
    shelf.timer = setTimeout(closeShelf, SHELF_TIMEOUT_MS);
  }

  // Show the cached shelf at once; refetch only when the newest page or the count changed.
  function refreshShelf() {
    var seq = ++shelf.seq;
    Spotify.getSavedAlbums(0).then(function (first) {
      var items = ((first && first.items) || []).map(slim).filter(function (a) { return a.id; });
      var total = Math.min((first && first.total) || items.length, MAX_ALBUMS);
      var cached = shelf.albums;
      if (cached && cached.length === total && sameAlbums(cached.slice(0, items.length), items)) return null;
      function page(offset, acc, next) {
        if (!next || acc.length >= MAX_ALBUMS || seq !== shelf.seq) return acc;
        return Spotify.getSavedAlbums(offset).then(function (d) {
          var more = ((d && d.items) || []).map(slim).filter(function (a) { return a.id; });
          return page(offset + 50, acc.concat(more), d && d.next && more.length);
        });
      }
      return page(50, items, first && first.next);
    }).then(function (all) {
      if (!all || seq !== shelf.seq) return;
      shelf.albums = all.slice(0, MAX_ALBUMS);
      write(SHELF_KEY, shelf.albums);
      renderShelf();
    }, function (err) {
      if (seq !== shelf.seq) return;
      if (err && err.code === 'logged_out') return api.actionError(err);
      if (!shelf.albums) $('shelf-rack').innerHTML = '<div class="shelf-note">Couldn’t reach Spotify. Close the shelf and try again.</div>';
    });
  }

  function sortKey(a) {
    var s = shelf.sort === 'artist' ? a.artist.replace(/^the\s+/i, '') : a.name;
    return s.toLowerCase();
  }
  function letterOf(a) {
    var c = sortKey(a).charAt(0).toUpperCase();
    return LETTERS.indexOf(c) > -1 && c ? c : '#';
  }

  function sorted() {
    var list = shelf.albums.slice();
    if (shelf.sort === 'added') return list;
    return list.sort(function (a, b) {
      var ka = sortKey(a), kb = sortKey(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      if (shelf.sort === 'artist' && a.year !== b.year) return a.year < b.year ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  }

  function isSeven(a) { return a.type === 'single' && a.tracks <= 4; }

  function matches(a) {
    var q = shelf.filter;
    return !q || a.name.toLowerCase().indexOf(q) > -1 || a.artist.toLowerCase().indexOf(q) > -1;
  }

  // Two ways to browse: covers face-out on display shelves, or spines packed on a bookshelf.
  function renderShelf() {
    var rack = $('shelf-rack');
    var albums = sorted().filter(matches);
    if (shelf.observer) shelf.observer.disconnect();
    if (shelf.artObserver) shelf.artObserver.disconnect();
    shelf.queue = [];
    rack.innerHTML = '';
    rack.className = 'shelf-rack is-' + shelf.view;
    var total = shelf.albums.length;
    $('shelf-count').textContent = !total ? '' : shelf.filter ? albums.length + ' of ' + total
      : total + (total === 1 ? ' record' : ' records');
    Array.prototype.forEach.call(document.querySelectorAll('[data-shelf-sort]'), function (b) {
      toggle(b, 'on', b.getAttribute('data-shelf-sort') === shelf.sort);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-shelf-view]'), function (b) {
      toggle(b, 'on', b.getAttribute('data-shelf-view') === shelf.view);
    });
    rack._albums = albums;
    if (!albums.length) {
      rack.innerHTML = '<div class="shelf-note">' + (total
        ? 'No records match “' + escapeHtml(shelf.filter) + '”.'
        : 'No saved albums yet. Save albums in Spotify and they’ll show up here.') + '</div>';
      renderRail([]);
      return;
    }
    var frag = document.createDocumentFragment(), seen = {}, letters = [], uncolored = [], covers = [];
    albums.forEach(function (a, i) {
      var item = shelf.view === 'covers' ? makeCover(a) : makeSpine(a);
      item.setAttribute('data-i', i);
      if (shelf.view === 'covers') covers.push(item);
      else if (!shelf.colors[a.id]) uncolored.push(item);
      if (shelf.sort !== 'added') {
        var l = letterOf(a);
        if (!seen[l]) { seen[l] = true; letters.push(l); item.setAttribute('data-letter', l); }
      }
      frag.appendChild(item);
    });
    rack.appendChild(frag);
    renderRail(letters);
    if (shelf.observer) uncolored.forEach(function (s) { shelf.observer.observe(s); });
    if (shelf.artObserver) covers.forEach(function (c) { shelf.artObserver.observe(c); });
    else covers.forEach(function (c) { loadCover(c, true); });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function makeSpine(a) {
    var spine = el('div', 'spine' + (isSeven(a) ? ' seven' : ''));
    // Thicker for albums with more tracks, shorter for 7" singles.
    spine.style.width = Math.max(2.6, Math.min(6, 2.2 + a.tracks * 0.17)).toFixed(2) + 'vmin';
    var face = el('div', 'spine-face');
    var text = el('div', 'spine-text');
    text.appendChild(el('b', '', a.artist));
    text.appendChild(document.createTextNode('  ' + a.name));
    face.appendChild(text);
    spine.appendChild(face);
    if (shelf.colors[a.id]) paintSpine(spine, shelf.colors[a.id]);
    return spine;
  }

  // A cover standing face-out on a shelf, with a tag on the shelf edge.
  function makeCover(a) {
    var cell = el('div', 'cover' + (isSeven(a) ? ' seven' : ''));
    var art = el('div', 'cover-art');
    if (shelf.colors[a.id]) art.style.backgroundColor = shelf.colors[a.id].bg;
    var img = el('img');
    img.alt = '';
    img._src = a.big || a.small;
    img.onload = function () { toggle(img, 'loaded', true); };
    art.appendChild(img);
    cell.appendChild(art);
    cell.appendChild(el('i', 'cover-plank'));
    var tag = el('div', 'cover-tag');
    tag.appendChild(el('div', 'cover-name', a.name));
    tag.appendChild(el('div', 'cover-artist', a.artist));
    cell.appendChild(tag);
    return cell;
  }

  // Covers load as they come near the screen and let go of their image once far away, so a
  // big library doesn't fill the iPad's 1 GB.
  function loadCover(cell, on) {
    var img = cell.firstChild.firstChild;
    if (on && !img.getAttribute('src') && img._src) img.src = img._src;
    if (!on && img.getAttribute('src')) {
      img.removeAttribute('src');
      toggle(img, 'loaded', false);
    }
  }

  function renderRail(letters) {
    var rail = $('shelf-rail');
    rail.innerHTML = '';
    toggle($('shelf'), 'has-rail', letters.length > 0);
    if (!letters.length) return;
    ('#' + LETTERS).split('').forEach(function (l) {
      var b = el('button', letters.indexOf(l) > -1 ? '' : 'off', l);
      b.type = 'button';
      b.setAttribute('data-jump', l);
      rail.appendChild(b);
    });
  }

  function jump(letter) {
    var spine = $('shelf-rack').querySelector('[data-letter="' + letter + '"]');
    if (spine) $('shelf-body').scrollTop = spine.offsetTop;
  }

  // Spine colours come from the cover: shrink it to 8×8 and average.
  function paintSpine(spine, c) {
    spine.firstChild.style.backgroundColor = c.bg;
    spine.firstChild.style.color = c.fg;
  }

  function colorFor(a, done) {
    if (!a.small) return done(null);
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var cv = document.createElement('canvas');
        cv.width = cv.height = 8;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, 8, 8);
        var d = ctx.getImageData(0, 0, 8, 8).data, r = 0, g = 0, b = 0;
        for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        r = Math.round(r / 64 * 0.85); g = Math.round(g / 64 * 0.85); b = Math.round(b / 64 * 0.85);
        var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        done({ bg: 'rgb(' + r + ',' + g + ',' + b + ')', fg: lum > 0.55 ? '#1d1712' : '#f3ede2' });
      } catch (e) { done(null); }
    };
    img.onerror = function () { done(null); };
    img.src = a.small;
  }

  var colorSaveTimer = null;
  function pumpColors() {
    while (shelf.busy < 4 && shelf.queue.length) {
      var spine = shelf.queue.shift();
      var a = spine.parentNode && $('shelf-rack')._albums[Number(spine.getAttribute('data-i'))];
      if (!a) continue;
      if (shelf.colors[a.id]) { paintSpine(spine, shelf.colors[a.id]); continue; }
      shelf.busy++;
      (function (spine, a) {
        colorFor(a, function (c) {
          shelf.busy--;
          if (c) {
            shelf.colors[a.id] = c;
            paintSpine(spine, c);
            clearTimeout(colorSaveTimer);
            colorSaveTimer = setTimeout(function () { write(COLORS_KEY, shelf.colors); }, 2000);
          }
          pumpColors();
        });
      })(spine, a);
    }
  }

  // ---- sleeve ---------------------------------------------------------------
  function loadTracks(id) {
    function page(offset, acc) {
      return Spotify.getAlbumTracks(id, offset).then(function (d) {
        acc = acc.concat(((d && d.items) || []).filter(function (t) { return t && t.uri; }));
        return d && d.next && acc.length < 200 ? page(offset + 50, acc) : acc;
      });
    }
    return page(0, []);
  }

  function openSleeve(a, spine) {
    sleeve.album = a;
    sleeve.spine = spine;
    var img = $('sleeve-front');
    img.removeAttribute('src');
    if (a.big) img.src = a.big;
    // The record peeks out of the sleeve, its label printed with the cover.
    $('sleeve-label').style.backgroundImage = a.big ? 'url("' + a.big + '")' : '';
    toggle($('sleeve-disc'), 'seven', isSeven(a));
    toggle($('sleeve'), 'out', false);
    setTimeout(function () { if (sleeve.album === a) toggle($('sleeve'), 'out', true); }, 80);
    tintSleeve(shelf.colors[a.id]);
    if (!shelf.colors[a.id]) {
      colorFor(a, function (c) {
        if (!c) return;
        shelf.colors[a.id] = c;
        if (sleeve.album === a) tintSleeve(c);
      });
    }
    $('sleeve-title').textContent = a.name;
    $('sleeve-artist').textContent = a.artist + (a.year ? ' · ' + a.year : '');
    var box = $('sleeve-sides');
    box.innerHTML = '<div class="sleeve-note">Reading the back of the sleeve…</div>';
    box.scrollTop = 0;
    toggle($('sleeve'), 'hidden', false);
    loadTracks(a.id).then(function (tracks) {
      if (sleeve.album !== a) return;
      if (!tracks.length) { box.innerHTML = '<div class="sleeve-note">This album has no playable tracks.</div>'; return; }
      renderSides(a, buildRecord(a, tracks));
    }, function (err) {
      if (sleeve.album !== a) return;
      if (err && err.code === 'logged_out') return api.actionError(err);
      box.innerHTML = '<div class="sleeve-note">Couldn’t read the tracks. Close and try again.</div>';
    });
  }

  function renderSides(a, built) {
    var box = $('sleeve-sides');
    box.innerHTML = '';
    var busy = run.expect;
    var nRecords = built.sides[built.sides.length - 1].record;
    $('sleeve-format').textContent = (built.seven ? '7" single' : nRecords > 1 ? nRecords + ' × 12" LP' : '12" LP') +
      ' · ' + built.sides.length + ' sides';
    built.sides.forEach(function (s, i) {
      var block = el('div', 'sleeve-side');
      var head = el('div', 'sleeve-side-head');
      head.appendChild(el('span', '', 'Side ' + s.label));
      head.appendChild(el('span', 'sleeve-dim', s.tracks.length ? fmt(s.ms) : 'blank'));
      block.appendChild(head);
      var ol = el('ol', 'sleeve-tracks');
      s.tracks.forEach(function (t) {
        var li = el('li');
        li.appendChild(el('span', 'sleeve-tname', t.name));
        li.appendChild(el('span', 'sleeve-dim', fmt(t.ms)));
        ol.appendChild(li);
      });
      block.appendChild(ol);
      var b = el('button', 'sleeve-put', (busy ? 'Stop and put on Side ' : 'Put on Side ') + s.label);
      b.type = 'button';
      b.addEventListener('click', function () { putOn(a, built, i); });
      block.appendChild(b);
      box.appendChild(block);
    });
  }

  function tintSleeve(c) {
    $('sleeve').style.background = c
      ? 'radial-gradient(circle at 30% 40%, ' + c.bg + ' 0%, #0e0a07 75%)' : '';
  }

  function closeSleeve() {
    sleeve.album = null;
    if (sleeve.spine) toggle(sleeve.spine, 'pulled', false);
    sleeve.spine = null;
    toggle($('sleeve'), 'hidden', true);
  }

  function setupShelf() {
    shelf.albums = read(SHELF_KEY);
    shelf.colors = read(COLORS_KEY) || {};
    shelf.sort = read(SORT_KEY) || 'added';
    shelf.view = read(VIEW_KEY) === 'spines' ? 'spines' : 'covers';
    if (window.IntersectionObserver) {
      shelf.observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          shelf.observer.unobserve(en.target);
          shelf.queue.push(en.target);
        });
        pumpColors();
      }, { root: $('shelf-body'), rootMargin: '200px 0px' });
      shelf.artObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { loadCover(en.target, en.isIntersecting); });
      }, { root: $('shelf-body'), rootMargin: '700px 0px' });
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-shelf-view]'), function (b) {
      b.addEventListener('click', function () {
        shelf.view = b.getAttribute('data-shelf-view');
        write(VIEW_KEY, shelf.view);
        $('shelf-body').scrollTop = 0;
        if (shelf.albums) renderShelf();
      });
    });
    // Find a record: filters by title or artist as you type.
    var filter = $('shelf-filter'), filterTimer = null;
    filter.addEventListener('input', function () {
      bumpShelf();
      clearTimeout(filterTimer);
      filterTimer = setTimeout(function () {
        shelf.filter = filter.value.replace(/^\s+|\s+$/g, '').toLowerCase();
        $('shelf-body').scrollTop = 0;
        if (shelf.albums) renderShelf();
      }, 200);
    });
    $('shelf-filter-form').addEventListener('submit', function (e) { e.preventDefault(); filter.blur(); });
    // iOS 12 can leave the page pushed up after the keyboard closes.
    filter.addEventListener('blur', function () { window.scrollTo(0, 0); });

    $('shelf-close').addEventListener('click', closeShelf);
    $('sleeve-close').addEventListener('click', closeSleeve);
    $('shelf').addEventListener('touchstart', bumpShelf);
    $('shelf').addEventListener('mousedown', bumpShelf);
    $('shelf-body').addEventListener('scroll', bumpShelf);
    Array.prototype.forEach.call(document.querySelectorAll('[data-shelf-sort]'), function (b) {
      b.addEventListener('click', function () {
        shelf.sort = b.getAttribute('data-shelf-sort');
        write(SORT_KEY, shelf.sort);
        $('shelf-body').scrollTop = 0;
        if (shelf.albums) renderShelf();
      });
    });
    // Pull a record out: it slides up, then the sleeve opens.
    $('shelf-rack').addEventListener('click', function (e) {
      var spine = e.target.closest && e.target.closest('.spine, .cover');
      var a = spine && $('shelf-rack')._albums[Number(spine.getAttribute('data-i'))];
      if (!a) return;
      toggle(spine, 'pulled', true);
      setTimeout(function () { openSleeve(a, spine); }, 220);
    });
    // The A–Z rail: tap a letter or slide a finger along it.
    var rail = $('shelf-rail');
    function railAt(e) {
      var t = e.touches ? e.touches[0] : e;
      var b = e.type === 'click' ? e.target : document.elementFromPoint(t.clientX, t.clientY);
      if (b && b.getAttribute && b.getAttribute('data-jump')) jump(b.getAttribute('data-jump'));
    }
    rail.addEventListener('touchstart', function (e) { e.preventDefault(); railAt(e); }, { passive: false });
    rail.addEventListener('touchmove', function (e) { e.preventDefault(); railAt(e); }, { passive: false });
    rail.addEventListener('click', railAt);
  }

  // ---- setup ----------------------------------------------------------------
  function init(a) {
    api = a;
    rec = read(RECORD_KEY);
    if (rec && !(rec.sides && rec.sides[rec.side])) rec = null;
    setupShelf();
    if (rec && !rec.color) {
      var r = rec;
      colorFor({ small: r.art }, function (c) {
        if (!c || rec !== r) return;
        rec.color = c;
        save();
        drawVinyl();
      });
    }
    window.addEventListener('mousemove', dragMove);
    window.addEventListener('mouseup', dragEnd);
    window.addEventListener('resize', scale);
    window.addEventListener('orientationchange', function () { setTimeout(scale, 300); });
  }

  return {
    init: init,
    mount: mount,
    unmount: unmount,
    onPlayer: onPlayer,
    paint: paint,
    openShelf: openShelf,
    closeShelf: closeShelf
  };
})();
