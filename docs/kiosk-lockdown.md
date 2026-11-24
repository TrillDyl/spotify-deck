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

## Phase 1: lock it with Guided Access
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
   - About every 6 months Spotify ends the login. The clock says so from two weeks before. Delete
     the Deck icon and repeat these steps.
   - Check it can start offline: wait a minute, turn on Airplane Mode, close Deck (double-click Home
     and swipe it away) and open it again. The clock should appear. Turn Airplane Mode off again.
2. Go to **Settings → Display & Brightness → Auto-Lock → Never**, and keep the iPad on its
   charger. With Auto-Lock on Never, a plugged-in iPad never sleeps.
3. Go to **Settings → General → Accessibility → Guided Access** (on iOS 12 it's under General).
   Turn it on, then:
   - **Passcode Settings → Set Guided Access Passcode**. Don't use the iPad's own passcode.
   - **Display Auto-Lock → Never**, if your iPad shows this option. Guided Access has its own
     sleep timer, separate from the one in step 2.
4. Open **Deck** from the Home Screen and triple-click the Home button. Tap **Options**:
   - **Sleep/Wake Button: off**, so a bump can't turn the screen off.
   - **Volume Buttons: off**.
   - **Motion: off**, with the iPad already in landscape. This locks the rotation.
   - **Keyboards: on**. Song search and naming a playlist need it.
   - **Touch: on**.

   Then tap **Start**.
5. To exit, triple-click and enter the passcode.

Guided Access turns off whenever the iPad restarts: see *After a power cut or restart* below.

## Why not Single App Mode
Guided Access is the lock for this iPad. Single App Mode (with Apple Configurator) locks an iPad to
an app, and a Home Screen web app isn't one: people who have tried it get a blank white screen after
a restart, and Jamf's support says it isn't compatible. Locking to Safari instead would show the
address bar, and Safari can't see the deck's login because iOS 12 keeps its storage separate. It also
means erasing the iPad.

If you ever want a hard lock, the thing to try is a kiosk browser app such as **Kiosk Pro Lite**
(free, and listed for iOS 12.5 and later), because Single App Mode can lock to that. It hasn't been
tested with the deck.

## After a power cut or restart
Guided Access turns off when the iPad restarts, so:
1. Unlock the iPad and open **Deck**. It starts even if the Wi-Fi isn't back yet, and catches up on
   its own.
2. Triple-click Home and tap **Start**.

Keep the iPad's own passcode off, or short, so anyone at home can do this.

## If something goes wrong
Hold the top-left corner for 2 seconds → **Diagnostics**. It shows the version, when Spotify last
answered, whether the offline copy is in place, when the login ends and the last 30 errors.

- **Orange dot, top right:** the deck can't reach Spotify, or Spotify asked it to slow down. It
  retries by itself. "Waiting on limits" in Diagnostics shows how long.
- **"Spotify login ends in … days" on the clock:** pair again when it suits you (phase 1, step 1).
  It shows up two weeks ahead.

## New versions
The deck checks for a new version every hour and switches to it while the clock is showing. To
switch now, use Settings → **Reload** twice: the first fetches the new version, and the second
(after about 30 seconds) starts it. GitHub Pages can take 10 minutes to serve it.

## Battery care for an always-plugged-in iPad
Old batteries can swell when they're held at 100% for months. Put the charger on a smart plug
that turns it off for a few hours a day, and check now and then that the screen isn't lifting
away from the body.
