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
but a second or two may play.
