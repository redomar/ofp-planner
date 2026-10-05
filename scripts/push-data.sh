#!/usr/bin/env bash
# Send the local schedule snapshot (public/data/) to the server over SSH, without rebuilding the site.
#   pnpm data:push            upload and swap in atomically
#   pnpm data:push --status   show what the server is serving
#   pnpm data:push --clear    remove the live copy (the site falls back to the snapshot baked into the image)
# The server's nginx serves /data/ from $REMOTE/data first, then the baked copy (nginx.conf; Dokploy bind mount
# $REMOTE → /usr/share/nginx/html/live). Nothing runs on the server except mv/rm.
set -euo pipefail
HOST="${OFP_DATA_HOST:-koronto}"
REMOTE="${OFP_DATA_DIR:-/srv/ofp-planner/live}"
cd "$(dirname "$0")/.."

gen() { node -e "const m=require('$1');console.log(m.generatedAt, m.coverage?m.coverage.from+'→'+m.coverage.to:'', m.counts.flights+' flights')"; }

case "${1:-}" in
  --status)
    echo "local : $(gen ./public/data/manifest.json)"
    ssh "$HOST" "cat '$REMOTE/data/manifest.json' 2>/dev/null" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(!s)return console.log('server: no live copy (serving the baked snapshot)');const m=JSON.parse(s);console.log('server:',m.generatedAt,m.coverage?m.coverage.from+'→'+m.coverage.to:'',m.counts.flights+' flights')})"
    exit 0 ;;
  --clear)
    ssh "$HOST" "rm -rf '$REMOTE/data' '$REMOTE/.incoming'"
    echo "Cleared $HOST:$REMOTE/data; the site now serves the snapshot baked into the image."
    exit 0 ;;
esac

test -f public/data/manifest.json || { echo "No public/data/manifest.json; run pnpm data:snapshot first." >&2; exit 1; }
echo "Uploading $(gen ./public/data/manifest.json) to $HOST:$REMOTE/data"
ssh "$HOST" "mkdir -p '$REMOTE/.incoming'"
rsync -az --delete --stats public/data/ "$HOST:$REMOTE/.incoming/"
# swap: the new copy replaces the old in one rename
ssh "$HOST" "cd '$REMOTE' && rm -rf data.old && { [ -d data ] && mv data data.old || true; } && mv .incoming data && rm -rf data.old && chmod -R a+rX data"
echo "Done. Browsers pick it up on their next visit (the manifest is revalidated each time)."
