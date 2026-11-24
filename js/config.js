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
    'user-library-modify',
    'user-top-read',                   // For you: top songs and artists
    'user-read-recently-played'        // For you: recently played
  ],

  POLL_PLAYING_MS: 3000,
  POLL_IDLE_MS: 10000,
  POLL_QUIET_MS: 20000,                // after nothing has played, and nobody's touched it, for:
  QUIET_AFTER_MS: 10 * 60 * 1000,
  POLL_STUCK_MS: 60000,                // a poll that takes this long is given up on
  SETTINGS_LONG_PRESS_MS: 2000,
  IDLE_AFTER_PAUSE_MS: 5 * 60 * 1000,  // paused this long → idle clock
  SHEET_TIMEOUT_MS: 45000              // close an untouched picker or settings sheet
};
