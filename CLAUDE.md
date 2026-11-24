# Spotify Deck

A full-screen "now playing" deck for an old iPad. It shows whatever Spotify is playing on
Dylan's laptop or phone and lets him control it from the iPad. No Bluetooth and no Spotify
app on the iPad: it's a web page that talks to the Spotify Web API, saved to the iPad's
Home Screen and later hard-locked as a kiosk.

## What it must do
- Show what's playing on **any** of the account's devices (Mac, iPhone, speakers): large album
  art, track title, artist, album, and a progress bar
- Large touch controls: previous, play/pause, next, like (save to library)
- **Add to playlist**: a picker listing the user's playlists, tap one to add the current track
- **Layout extras**: a draggable progress bar (the song jumps when the finger lifts;
  hidden handle when Spotify disallows seeking), elapsed and total time, a volume slider (hidden when the device can't change volume) and an
  Up next button. Up next is a scrolling list of the whole queue: tap a song to skip to it, swipe
  left to reveal **Remove**. The queue is only fetched while it's open, and the open/closed choice
  is saved per device
- Shuffle and repeat buttons, and tapping "Playing on…" opens the device picker. For episodes,
  previous and next become −15 s and +30 s
- **Browse**: a sheet (button on the now-playing screen, or tap the idle clock) listing all the user's
  playlists with covers (their own and public ones they've saved, refetched each time it opens), with
  a search box on top for songs. Tap a playlist to open it: Play, Shuffle, and (if the user owns it or
  collaborates on it) its songs with art and artists. Tap a song to play from there. Every song has
  queue and add-to-playlist buttons. Searching from inside an own playlist adds straight to it. If no
  device is active, play targets the last device seen (kept across reloads), then falls back to asking
  which device to play on
- **For you** (a tab in Browse): top songs and artists (4 weeks, 6 months, 1 year), recently played,
  **Radio from this song** (plays the song alone with repeat off, so Autoplay carries on), and
  Spotify's mixes. Spotify won't list its mixes, so the deck remembers any it sees playing (playlist
  IDs starting `37i9dQZ`, in `deck.mixes`), names them from Spotify's public oEmbed lookup, and plays
  them by `context_uri`
- **New playlist**: from Browse (opens it, empty) or from the picker (adds the song). Private
- **Record player mode** (Settings → Mode): a shelf of saved albums (`GET /me/albums`), shown
  as covers face-out (the default) or as spines, with a search box, sorting and an A–Z rail.
  Cover images load only near the screen and unload when far away, to fit the iPad's 1 GB RAM.
  Then a sleeve with the record sliding out and each side listed, and a turntable whose panel
  shows the cover. Albums split into sides by disc and length (7" for
  short singles). A side plays as a `uris` list with shuffle and repeat off. Sound only plays
  with the platter on (Start/Stop) and the needle down; the tonearm is the only way to change
  songs. The shelf is built 60 albums at a time and emptied on close. A side ends in the run-out
  groove (manual arm), and Flip needs the arm at rest. If
  Autoplay starts a song after the side, the deck pauses it. Code: `js/records.js`,
  `css/records.css`
- Update on its own when the track changes, with no user action
- Idle state when nothing is playing: a dimmed clock, never a blank page or an error

## Kiosk requirements (this runs unattended on a locked iPad)
- Log in once, then refresh tokens silently. It must **never** fall back to a login
  screen in normal use. Exception: Spotify refresh tokens last **6 months from login**, and
  refreshing doesn't extend that, so a re-login roughly twice a year can't be avoided. Settings
  shows the expected date.
- No links or navigation that leave the page; no pinch-zoom, double-tap zoom, text selection
  or rubber-band scrolling
- Settings (log out, choose device, brightness and dim options) are hidden behind a **2-second
  long-press in the top-left corner**
- Recover on its own from network drops, expired tokens, requests that never answer and Spotify 5xx
  errors; back off on 429s. Polling must never stay stopped (there's a watchdog in `tick()`)
- Start and reload without a network (`deck.appcache`). Never call `location.reload()` directly: use
  `safeReload()`, because a failed reload leaves an error page nobody can close
- Never open Spotify's login page on iOS: it can't run there and there's no way back
- Avoid burn-in: drift the idle clock's position slowly

## Hardware and platform
- **Target device:** iPad mini 2 on **iOS 12.5.8**, the last iOS it can run, so this is
  permanent. Its browser is Mobile Safari 12.1. A7 chip, 1 GB RAM, 2048×1536 screen.
  - The current Spotify iOS app doesn't support iOS 12, so the web deck is the only option.
  - With 1 GB RAM, keep the DOM small, load covers in lists only near the screen, and blur a small
    image rather than a large one. The now-playing art fills 983px, so it uses Spotify's 640px image.
  - Animations that run all the time (the progress bar) may only change `transform` or `opacity`.
  - Home Screen web apps on iOS 12 have **their own `localStorage`, separate from Safari's**.
  - **Spotify's login page doesn't run on iOS 12**: its scripts use optional chaining, which
    Safari 12 can't parse (checked Nov 2026). So the iPad never logs in itself. A computer logs
    in and uses Settings → **Send login to iPad**, which shows a QR code for
    `<deck URL>#pair=<refresh token>&since=<login time>` and logs the computer out (so two
    devices never rotate the same refresh token). On iOS Safari the deck leaves the link in place
    and asks for Add to Home Screen. The Home Screen app keeps the link as its start URL, imports
    the token once (`deck.pairUsed`), and ignores it after that. The QR library loads from cdnjs
    only on the computer.
- **Dev machine:** MacBook Air (Apple silicon)
- Lockdown: Guided Access (Dylan's choice, Nov 2026). Single App Mode doesn't work reliably with Home
  Screen web apps. See `docs/kiosk-lockdown.md`.

## Tech decisions
- **Plain HTML, CSS and JS. No build step and no framework.** It has to run on old Mobile Safari
  and be easy to deploy as static files.
- **Target Safari 12.1 (iOS 12.5.8).** Use classic `<script>` tags (no ES modules, no build
  step).
  - **Not available in Safari 12.1:** optional chaining `?.`, `??`, class fields, top-level await,
    `Promise.allSettled`, `String.prototype.replaceAll`, Pointer Events (use touch events),
    `ResizeObserver`, the Screen Wake Lock API, and `prefers-color-scheme`.
  - **CSS not available in Safari 12.1:** flexbox `gap` (use margins; grid `gap` is fine),
    `aspect-ratio`, `inset`.
  - **Fine to use:** `fetch`, `Promise`, `async/await`, `AbortController`, `URLSearchParams`,
    `TextEncoder`, `IntersectionObserver`, `Object.fromEntries`, `Array.prototype.flat`, CSS
    variables, CSS grid, `-webkit-backdrop-filter`, `env(safe-area-inset-*)`.
  - Keep the screen awake with Settings → Display & Brightness → Auto-Lock → Never, not with JS.
- **Auth:** Authorization Code with PKCE, entirely in the browser with no backend. Implicit
  grant is deprecated, so don't use it.
  - `crypto.subtle.digest` needs a secure context (HTTPS or 127.0.0.1). Safari 12 has it there,
    but keep a small pure-JS SHA-256 fallback for testing the iPad over plain-HTTP LAN.
  - Store the access token, refresh token and expiry in `localStorage`. Spotify may return a
    **new refresh token** on refresh: always save it if present.
  - Refresh proactively about 5 minutes before expiry, and on any 401.
  - PKCE refresh tokens work once. A refresh is given 30 s but never aborted, and a late answer is
    still saved, because it holds the only token that works from then on.
  - `invalid_grant` isn't retried (Spotify's rule). The access token is used until it runs out.
- **Polling:** `GET /v1/me/player` every ~3 s while playing, ~10 s when idle or paused, and ~20 s
  after 10 minutes of neither music nor touches. Between polls, move the progress bar forward
  locally. Poll immediately after any control action. Call `command()` when sending a player command:
  polls sent before or during one are dropped, since they can still show the old state.
- **429s:** Spotify doesn't expose `Retry-After` to browsers (checked Nov 2026), so `js/spotify.js`
  doubles its wait each time. A rate limit blocks every call. A `QUOTA_EXCEEDED` (Development Mode's
  separate quota, since July 2026, limits unpublished and grouped by endpoint) blocks only its group.
- **Offline copy:** AppCache, because the iPad is frozen at iOS 12.5.8, it updates all files together
  and it needs no running process. Service workers had cache and update bugs in iOS 12 Home Screen
  apps and would handle every poll. **Run `node tools/stamp.js` before committing a change to the
  deck**, or the iPad keeps the old version (a test checks this). Not yet checked on the iPad; if it
  doesn't work there, use a network-first service worker.
- **CSP** in `index.html`: scripts from this site and cdnjs, connections to this site and Spotify
  (the API, accounts, and open.spotify.com for oEmbed).
- **Hosting:**
  - Local dev: `./serve.sh` → `http://127.0.0.1:8888/`. Spotify requires the loopback **IP**,
    not `localhost`.
  - iPad: GitHub Pages (free HTTPS). Register both redirect URIs in the Spotify dashboard.
  - The Client ID is public in PKCE flows, so committing `js/config.js` is fine. Never commit a
    client secret, and the app shouldn't need one.

## Spotify Web API notes (verify against current docs; Spotify changed a lot in 2026)
Spotify's February 2026 changes apply to Development Mode apps (this is one):
- The app owner needs an **active Premium** subscription, or the app stops working
- Up to **5 users** per app (fine for this project)
- Adding to a playlist is **`POST /v1/playlists/{id}/items`**. The old `/tracks` endpoint was
  removed.
- Saving to the library is **`PUT /v1/me/library?uris=…`**, with Spotify **URIs**
  (`spotify:track:…`) comma-separated in the **query string**, not the body (max 40). Unlike is
  `DELETE /v1/me/library?uris=…`, and checking is `GET /v1/me/library/contains?uris=…`, which
  returns `[true]`. These replaced `/me/tracks`. Scopes: `user-library-modify` / `user-library-read`.
- `GET /v1/me` still works (Premium status was removed from it, as were `email` and `country`).
- Use `GET /v1/me/playlists` (not `/users/{id}/playlists`). Playlist `tracks` fields were renamed
  to `items`.
- Migration guide: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide

Player endpoints used (playback control needs Premium):
- `GET /v1/me/player`: state, device, item, progress, is_playing
- `PUT /v1/me/player/play`, `PUT /v1/me/player/pause`
- `POST /v1/me/player/next`, `POST /v1/me/player/previous`
- `GET /v1/me/player/devices` and `PUT /v1/me/player` (transfer): nice-to-have device picker
- `PUT /v1/me/player/play?device_id=…` with `{context_uri, offset: {uri}}` or `{uris}`: Browse.
  Any playlist in the library can be played this way, even ones the user doesn't own
- `POST /v1/me/player/queue?uri=…`: track or episode URIs only
- `PUT /v1/me/player/seek?position_ms=…`: the progress bar. `actions.disallows.seeking` in
  `GET /me/player` says when it isn't allowed (ads, some speakers)
- **The queue can't be edited or jumped into** (no remove, clear or skip-to-item endpoint, checked
  Nov 2026). So tapping a queued song calls `next` once per song before it, and Remove hides the
  song and skips it with `next` when it starts playing (about a second may be heard). Removals
  live in memory, and are dropped when a different playlist or album starts
- `GET /v1/search?type=track`: **max `limit` is 10** since Feb 2026 (default 5); page with
  `offset`. The deck stops at 50 results to keep the DOM small
- `GET /v1/playlists/{id}/items` (max 50 a page) only works for playlists the user owns or
  collaborates on (403 otherwise), so followed playlists open with just Play and Shuffle. Each row
  holds the song as `item` (was `track`)
- `POST /v1/me/playlists` makes a playlist. Some Development Mode apps report 403s. Not yet checked
  with this app
- **Blocked for Development Mode since Nov 2024** (don't try to add them): recommendations, related
  artists, featured and category playlists, and reading any playlist Spotify makes (404, and they're
  left out of `/me/playlists`). New releases, categories and artists' top tracks went in Feb 2026.
  Still available: `GET /me/top/{artists,tracks}` and `GET /me/player/recently-played`
- Not yet checked on a real account: that a mix's `context.uri` shows up in `GET /me/player`, that
  playing it by `context_uri` works, and that song radio starts Autoplay
- Cover image URLs for playlists expire within a day, so they aren't stored
- The Developer Policy rules out content from other services (so no LRCLIB lyrics) and voice control
- The order of player commands isn't guaranteed: send them one at a time

Scopes to request (trim any the API no longer needs):
`user-read-playback-state user-modify-playback-state user-read-currently-playing
playlist-read-private playlist-read-collaborative playlist-modify-private
playlist-modify-public user-library-read user-library-modify user-top-read user-read-recently-played`
(the last two are for For you; logins from before Nov 24, 2026 lack them, and For you says so)

## Layout
```
index.html          single page: idle clock, sheets, hidden settings, and the layout <template>
css/deck.css        all styles
js/version.js       written by tools/stamp.js
js/config.js        CLIENT_ID, polling and timeout settings (edit this)
js/log.js           the last 30 errors, for Settings → Diagnostics
js/auth.js          PKCE login, callback handling, token storage and refresh, QR pairing
js/spotify.js       thin API wrapper: auth headers, 401 retry, 429 backoff
js/queue.js         Up next: parsing it and hiding removed songs
js/foryou.js        For you's data: remembered mixes, top songs and artists, recent plays
js/browse.js        Browse, For you, a playlist's songs, search, the picker, new playlists
js/deck.js          polling loop, layout, controls, sheets, long-press settings, diagnostics
js/records.js       record player mode: shelf, sleeve, sides, turntable and tonearm
css/records.css     record player styles (turntable drawn at 1024×768 and scaled)
deck.appcache       files the iPad keeps for offline use; written by tools/stamp.js
tools/stamp.js      run before committing a change to the deck
tests/              node --test tests/*.test.js; mock.html is the deck with a fake Spotify
docs/               setup and lockdown guides for Dylan
serve.sh            local static server on 127.0.0.1:8888
```

## Layout
- One layout (Classic): album art on the left, a blurred album-art background, details and
  controls on the right. The other eight layouts were removed in Nov 2026.
- It's a `<template id="tpl-classic">` plus CSS. Its markup declares what it shows (`data-t`,
  `data-p`, `data-v`, `data-show`, `data-art`, `data-action`, `data-vol-control`,
  `data-seek-control`, `data-queue-list`), and `js/deck.js` fills it in. The full list is in the
  comment at the top of `deck.js`.
- The queue (`GET /me/player/queue`) is fetched only while Up next is open, and refreshes on track
  change and every 2 minutes.

## Milestones
Milestones 1–4 are built and pass in Chrome against `tests/mock.html`. A real login reached
the iPad through QR pairing on Nov 23, 2026. Controls, like, the picker and polish still need
checking on the iPad with real playback.

1. [x] Auth works: log in (on a computer, then QR pairing to the iPad)
2. [ ] Controls: prev / play-pause / next / like, with optimistic UI updates
3. [ ] Add-to-playlist picker (only playlists the user owns or collaborates on)
   - Browse (open and play playlists, search, queue, add, new playlist) is built and passes against mocks
4. [ ] Polish: blurred album-art background, smooth track transitions, progress bar, idle clock
   (the "blur" is a 10×10 canvas scaled up, which is far cheaper than a CSS blur on the A7)
5. [ ] Deploy to GitHub Pages, add that redirect URI, and test on the real iPad
6. [ ] Kiosk hardening (see requirements above), then lock down with Guided Access

## Working with Dylan
- He'll test on the real iPad. Big, obvious touch targets matter more than density.
- Keep `docs/` up to date when setup steps change.
