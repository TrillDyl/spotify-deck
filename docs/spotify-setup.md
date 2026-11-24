# Spotify developer setup

The deck needs a Spotify "app" so it can read and control your playback. It's free, but under
Spotify's 2026 rules **your account must have Premium**.

1. Go to https://developer.spotify.com/dashboard and log in with your Spotify account.
2. Click **Create app**.
   - **App name:** Spotify Deck
   - **App description:** Personal now-playing display for my iPad
   - **Redirect URIs:** add `http://127.0.0.1:8888/`
     (Use the IP address, not `localhost`. Spotify rejects `localhost`.)
   - **Which API/SDKs:** tick **Web API**
   - Accept the terms and click **Save**.
3. Open the app's **Settings** and copy the **Client ID**. You don't need the Client Secret, so
   don't put it anywhere in this project.
4. Paste the Client ID into `js/config.js`.
5. If logging in later shows an error about the user not being registered, go to the app's
   **User Management** and add your own Spotify email.

## GitHub Pages (for the iPad)
The deck is live at **https://trilldyl.github.io/spotify-deck/**. Add that exact URL as a second
Redirect URI in the same app settings. The trailing slash has to match exactly.

Every push to `main` redeploys it within a minute or two.

## Record player mode
Turn off **Autoplay** in the Spotify app (Settings → Playback) on the device that plays the music,
so a side ends in silence. If it's left on, the deck pauses the extra song as soon as it notices,
but a second or two may play. (**Radio from this song** needs Autoplay on, so if you use both, leave
it on.)

## For you
Browse → **For you** has your top songs and artists, what you played lately, song radio, and the
mixes Spotify makes for you.

- **Log in again once** after this was added (November 2026): it needs two new permissions. Log in
  on the Mac, then pair the iPad again (`kiosk-lockdown.md`, phase 1). Until then those pages say so,
  and everything else works.
- **Mixes:** Spotify doesn't let apps list its mixes (Daily Mix, Discover Weekly and so on). Play one
  from your phone once while the deck is on, and it's kept under For you to play again. The pencil
  renames it and the ✕ forgets it. Deleting the Deck icon to pair again also clears this list.
- **Radio from this song:** plays the song, then Spotify's Autoplay carries on with similar ones.
  Autoplay has to be on in the Spotify app on the device that plays the music.
