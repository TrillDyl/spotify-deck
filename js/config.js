// Spotify Deck configuration.
// The Client ID is safe to commit: PKCE apps have no secret. Never put a Client Secret here.
var DECK_CONFIG = {
  CLIENT_ID: '74005bc56ff548a69a056b5e9897a2ee',

  // Must exactly match a Redirect URI in the Spotify dashboard.
  // Uses the page's own URL so it works for both 127.0.0.1 and GitHub Pages.
  REDIRECT_URI: window.location.origin + window.location.pathname,

  SCOPES: [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-private',
    'playlist-modify-public',
    'user-library-read',
    'user-library-modify'
  ],

  POLL_PLAYING_MS: 3000,
  POLL_IDLE_MS: 10000,
  SETTINGS_LONG_PRESS_MS: 2000,
  IDLE_AFTER_PAUSE_MS: 5 * 60 * 1000,  // paused this long → idle clock
  SHEET_TIMEOUT_MS: 45000,             // close an untouched picker or settings sheet

  // Layout used until one is picked in settings: classic, cassette, hifi, turntable, terminal,
  // handheld, dashboard, bigclock or poster.
  DEFAULT_THEME: 'classic',

  // Weather for the layouts that show it. Set your coordinates (e.g. lat: 40.71, lon: -74.01);
  // leave them null to hide weather. units: 'fahrenheit' or 'celsius'.
  WEATHER: { lat: null, lon: null, units: 'fahrenheit' }
};
