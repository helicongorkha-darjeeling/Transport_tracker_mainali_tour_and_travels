#!/bin/bash
# Double-click this file on a Mac to start the tracker and open it in your browser.
cd "$(dirname "$0")"

# Find Node: the system one if installed, otherwise a Node folder downloaded from nodejs.org
# (for example ~/Downloads/node-v26.13.1-darwin-arm64), newest first.
NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  for candidate in $(ls -dt "$HOME"/Downloads/node-v*-darwin-*/bin/node "$HOME"/node-v*-darwin-*/bin/node \
                            "$HOME"/Desktop/node-v*-darwin-*/bin/node ./node/bin/node 2>/dev/null); do
    if [ -x "$candidate" ]; then NODE="$candidate"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "Couldn't find Node.js."
  echo "Download the macOS .tar.gz from https://nodejs.org/en/download, unzip it into Downloads, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

PORT=${PORT:-3000}
echo "Using Node at $NODE ($("$NODE" --version))"
( sleep 1.5; open "http://localhost:$PORT" ) &
echo "Transport tracker is running at http://localhost:$PORT"
echo "Keep this window open while you use it. Close it (or press Ctrl+C) to stop."
exec "$NODE" server.js
