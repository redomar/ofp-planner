# Deploy and refresh the snapshot

Live: **https://plans.massorbit.co.uk** · Dokploy Cloud project "OFP Planner", app "web", on server koronto-neu (138.68.119.18).

## How it's deployed

- Dokploy builds the repo's `Dockerfile` (default stage `web`: `pnpm build` → nginx serving `out/`) from GitHub `redomar/ofp-planner`, branch `main`. **A push to `main` deploys to production** (autoDeploy, trigger "push").
- Deploys are zero-downtime: the Swarm update order is start-first (new container up before the old stops), rolling back if the new one fails.
- Domain `plans.massorbit.co.uk` → port 80, HTTPS via Let's Encrypt. DNS (Hover) already points `*.massorbit.co.uk` at the server.
- The image contains the schedule snapshot committed in `public/data/` at build time.
- Bind mount: host `/srv/ofp-planner/live` → container `/usr/share/nginx/html/live` (read-only). nginx serves `/data/` from `live/data` first, then the baked copy (see `nginx.conf`). The folder is never served directly.

## Refreshing the schedule data (the maintenance latch)

The data pipeline is a CLI only; nothing on the site or the server can start it. It runs **on your machine** (it needs ~0.6 GB of cache and a few minutes per new day), never on the server.

```sh
pnpm data:snapshot --days 15 --end 2026-10-04   # rebuild public/data/ locally (see docs/data-pipeline.md)
pnpm build && pnpm verify                        # check it
```

Then either:

- **Send it over SSH (no rebuild):** `pnpm data:push` uploads `public/data/` to `koronto:/srv/ofp-planner/live/data` and swaps it in atomically. `pnpm data:push --status` compares local and live; `pnpm data:push --clear` removes the live copy so the baked one is served again. Override the target with `OFP_DATA_HOST` / `OFP_DATA_DIR`.
- **Or commit it:** `git add public/data && git commit` and push to `main`; Dokploy rebuilds with the new data baked in. (If a live copy was pushed earlier it still wins; clear it, or push again.)

Browsers pick up a new snapshot on their next visit: the manifest is revalidated every time, the other files are requested with `?v=<generatedAt>`.

## Local / other hosts

`pnpm build` writes a static `out/` that any host can serve (route `/x` → `x.html`). `docker compose up -d web` runs the same image on :8080; `docker-compose.yml` also has a `snapshot` service for hosts where running the pipeline in a container is preferred.
