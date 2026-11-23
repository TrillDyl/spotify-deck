#!/bin/bash
# Serve the deck at http://127.0.0.1:8888/ (Spotify needs the loopback IP, not "localhost").
cd "$(dirname "$0")"
echo "Spotify Deck → http://127.0.0.1:8888/"
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server 8888 --bind 127.0.0.1
else
  npx --yes http-server -a 127.0.0.1 -p 8888 -c-1
fi
