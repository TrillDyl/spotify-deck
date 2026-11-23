# Locking the iPad to the deck

## Phase 0: start fresh (optional)
1. Back up anything on the iPad you want to keep.
2. On the iPad: **Settings → General → Reset → Erase All Content and Settings**. If Find My
   iPad is on, it asks for your Apple ID password to turn it off. That avoids Activation Lock.
3. Set it up again, then **Settings → General → Software Update** to get to iOS 12.5.8.
4. Skip anything you don't need during setup (Siri, Screen Time, App Analytics).

## Strip the iPad down
The iPad has 1 GB of RAM, and anything running in the background slows the deck. On iOS 12.5.8:

- **Notifications:** Settings → Notifications → turn off **Allow Notifications** for every app.
  Also turn Show Previews to Never.
- **Do Not Disturb:** Settings → Do Not Disturb → on, **Silence: Always**. Nothing pops up.
- **Background App Refresh:** Settings → General → Background App Refresh → **Off**.
- **Automatic downloads:** Settings → iTunes & App Store → turn off Apps, Updates and Offload
  Unused Apps' automatic downloads.
- **Siri and suggestions:** Settings → Siri & Search → turn off Listen for "Hey Siri", Press Home
  for Siri, and all Siri Suggestions (also in Lock Screen and Look Up).
- **Handoff and AirDrop:** Settings → General → Handoff → off. Control Center → AirDrop →
  Receiving Off.
- **Control Center:** Settings → Control Center → **Access Within Apps → off**.
- **Screen Time:** Settings → Screen Time → Turn Off Screen Time.
- **iCloud:** if you signed in, turn off Photos, iCloud Drive and everything else you don't
  need, or skip signing in altogether. The deck needs no Apple ID.
- **Speed and looks:** Settings → General → Accessibility → **Reduce Motion: on**, and
  Increase Contrast → **Reduce Transparency: on**. Both make old iPads noticeably faster.
- **Screen:** Settings → Display & Brightness → **Auto-Lock: Never**. Auto-Brightness is under
  General → Accessibility → Display Accommodations. Turn it on so the deck dims with the room.
- **Apps:** delete every app you can (press and hold an icon → ✕). Leave Safari and Settings.
- **Keyboard:** Settings → General → Keyboard → turn off Auto-Correction, Predictive and
  Enable Dictation, so the keyboard loads faster when you search for songs in Browse.
- Restart the iPad once at the end to clear memory.

## Phase 1: soft lock while testing (Guided Access)
1. Get the deck onto the iPad, already logged in. Spotify's login page doesn't run in iOS 12
   Safari, so the login comes from your Mac:
   1. On the Mac, open https://trilldyl.github.io/spotify-deck/ and **Connect Spotify**.
   2. Hold the top-left corner for 2 seconds → **Send login to iPad** → tap again. A QR code
      appears and the Mac logs itself out.
   3. On the iPad, open **Camera**, point it at the code and tap the Safari banner. The deck
      opens and says "Almost there".
   4. Tap **Share → Add to Home Screen → Add**, then open **Deck** from the Home Screen. It
      logs in by itself.
   - Don't open the pairing link and keep using the deck in Safari: on iOS 12, Safari and Home
     Screen apps keep separate storage, and the login has to land in the Home Screen app.
   - About every 6 months Spotify ends the login. Delete the Deck icon and repeat these steps.
2. Go to **Settings → Display & Brightness → Auto-Lock → Never**.
3. Go to **Settings → Accessibility → Guided Access**, turn it on, and set a passcode.
4. Open the deck and triple-click the Home button (or the top button). Turn off the Sleep/Wake
   and Volume buttons in Options, but leave **Keyboards** on (song search needs it), then tap
   **Start**.
5. To exit, triple-click and enter the passcode.

Guided Access turns off whenever the iPad restarts. That's fine for testing.

## Phase 2: hard lock (Single App Mode, using your Mac)
⚠️ Supervising the iPad **erases it**. Back it up first if anything on it matters.

Before erasing, turn off **Find My iPad** (Settings → your name → iCloud → Find My iPad) and sign
out of iCloud. Otherwise Activation Lock asks for your Apple ID password when the iPad restarts.

1. Install **Apple Configurator** from the Mac App Store.
2. Connect the iPad by cable and unlock it.
3. In Configurator, select the iPad, then **Prepare** → Manual configuration → tick
   **Supervise devices** and continue. This erases and supervises the iPad.
4. After it restarts, set it up again: sign in, set Auto-Lock to Never, and open the deck and
   log in to Spotify once.
5. In Configurator, select the iPad → **Actions → Advanced → Start Single App Mode** and pick
   the browser that runs the deck. (Single App Mode locks to an app, not a web page.)
6. To make changes later, plug it into the Mac and use **Stop Single App Mode**.

The exact menu names vary between Configurator versions. If something isn't where these steps
say, search the menus for "Supervise" and "Single App Mode".

## Battery care for an always-plugged-in iPad
Old batteries can swell when they're held at 100% for months. Put the charger on a smart plug
that turns it off for a few hours a day, and check now and then that the screen isn't lifting
away from the body.
