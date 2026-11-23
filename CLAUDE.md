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
- Recover on its own from network drops, expired tokens and Spotify 5xx errors; back off on
  429s using `Retry-After`
- Avoid burn-in: drift the idle clock's position slowly

## Hardware and platform
- **Target device:** iPad mini 2 on **iOS 12.5.8**, the last iOS it can run, so this is
  permanent. Its browser is Mobile Safari 12.1. A7 chip, 1 GB RAM, 2048×1536 screen.
  - The current Spotify iOS app doesn't support iOS 12, so the web deck is the only option.
  - With 1 GB RAM, keep the DOM small, use 300px album art and blur a small image rather than a
    large one, and avoid animations that run all the time.
  - Home Screen web apps on iOS 12 have **their own `localStorage`, separate from Safari's**.
    Log in from inside the Home Screen app, not in Safari. Test early whether the OAuth redirect
    returns to the standalone app. If it doesn't, the fallback is a way to hand a refresh token
    to the iPad from another device.
- **Dev machine:** MacBook Air (Apple silicon)
- Lockdown plan: test with Guided Access, then supervise the iPad with Apple Configurator and
  use Single App Mode. See `docs/kiosk-lockdown.md`.

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
- **Polling:** `GET /v1/me/player` every ~3 s while playing and every ~10 s when idle or paused.
  Between polls, move the progress bar forward locally. Poll immediately after any control
  action.
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

Scopes to request (trim any the API no longer needs):
`user-read-playback-state user-modify-playback-state user-read-currently-playing
playlist-read-private playlist-read-collaborative playlist-modify-private
playlist-modify-public user-library-read user-library-modify`

## Layout
```
index.html          single page: deck, idle clock, playlist picker, hidden settings
css/deck.css        all styles
js/config.js        CLIENT_ID and redirect URI (edit this)
js/auth.js          PKCE login, callback handling, token storage and refresh
js/spotify.js       thin API wrapper: auth headers, 401 retry, 429 backoff
js/deck.js          UI: polling loop, rendering, controls, picker, long-press settings
docs/               setup and lockdown guides for Dylan
serve.sh            local static server on 127.0.0.1:8888
```

## Milestones
Milestones 1–4 are built and pass in Chrome against mocked API responses. They still need a
real Spotify login and a test on the iPad before being ticked.

1. [ ] Auth works locally: log in, then show the current track (art, title, artist)
2. [ ] Controls: prev / play-pause / next / like, with optimistic UI updates
3. [ ] Add-to-playlist picker (only playlists the user owns or collaborates on)
4. [ ] Polish: blurred album-art background, smooth track transitions, progress bar, idle clock
   (the "blur" is a 10×10 canvas scaled up, which is far cheaper than a CSS blur on the A7)
5. [ ] Deploy to GitHub Pages, add that redirect URI, and test on the real iPad
6. [ ] Kiosk hardening (see requirements above), then lock down with Single App Mode

## Working with Dylan
- He'll test on the real iPad. Big, obvious touch targets matter more than density.
- Keep `docs/` up to date when setup steps change.
