# Spotify Deck

A full-screen Spotify "now playing" deck for an old iPad. It shows and controls whatever's
playing on your laptop or phone, with no Bluetooth needed.

## Quick start
1. Create the Spotify developer app: follow `docs/spotify-setup.md` (about 2 minutes).
2. Paste your Client ID into `js/config.js`.
3. Run `./serve.sh` and open http://127.0.0.1:8888/ on the Mac.
4. Once it works, deploy it to GitHub Pages and open it on the iPad.
5. Lock the iPad to the deck: `docs/kiosk-lockdown.md`.

## Working on it
- Tests: `node --test tests/*.test.js` (no install needed). GitHub runs them on every push.
- Try it without Spotify: `./serve.sh`, then http://127.0.0.1:8888/tests/mock.html
- Before committing a change to the deck, run `node tools/stamp.js`. The iPad keeps an offline copy
  and only fetches a new one when that stamp changes.

To build it with Claude Code, open this folder and start with milestone 1 in `CLAUDE.md`.
