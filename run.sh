#!/usr/bin/env bash
# Start the local explorer. Downloads the published catalogue the first time (55 MB), then reuses it.
#   ./run.sh                 build if needed, serve on http://127.0.0.1:8765 and open your browser
#   ./run.sh --refresh       download the latest weekly catalogue again
#   ROMGI_OPEN=0 ./run.sh    do not open a browser window
set -euo pipefail
cd "$(dirname "$0")"
RAW=https://raw.githubusercontent.com/caprado/romgi/main/db
mkdir -p data
if [ "${1:-}" = "--refresh" ]; then rm -f data/romdb.db data/version.json; shift; fi
if [ ! -f data/romdb.db ]; then
  echo "Downloading the romgi catalogue (about 55 MB)..."
  curl -L --fail --progress-bar -o data/romdb.db.gz "$RAW/romdb.db.gz"
  gunzip -f data/romdb.db.gz
  curl -sL --fail -o data/version.json "$RAW/version.json" || true
fi
OPEN=--open
[ "${ROMGI_OPEN:-1}" = "0" ] && OPEN=""
exec python3 serve.py --db data/romdb.db --version-json data/version.json $OPEN "$@"
