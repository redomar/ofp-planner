# Deploy and refresh the snapshot

The site is static: `pnpm build` writes `out/`, which any static host can serve. The Docker image serves it with nginx.

## Site

```sh
docker compose up -d web          # http://localhost:8080
```

The image includes the snapshot that was committed in `public/data/` when it was built.

## Refreshing the snapshot (the maintenance latch)

The snapshot job is a CLI command, not a web route. Nothing on the site can start it.

**Locally**, then commit and redeploy:

```sh
pnpm data:snapshot      # rebuilds public/data/ (see docs/data-pipeline.md for flags)
pnpm build && pnpm verify
git add public/data && git commit -m "Schedule snapshot <date>"
```

**On the server**, without a rebuild:

```sh
docker compose --profile maintenance run --rm snapshot
```

This writes into the `live` volume. nginx serves `/data/` from that volume first and falls back to the copy baked into the image. Raw downloads are cached in the `cache` volume, so later runs fetch less. Run it by hand, or from the host's cron or a Dokploy scheduled job:

```cron
# 04:30 on the 1st of each month
30 4 1 * * cd /srv/ofp-planner && docker compose --profile maintenance run --rm snapshot >> /var/log/ofp-snapshot.log 2>&1
```

To return to the baked snapshot, empty the volume: `docker compose run --rm --entrypoint sh snapshot -c 'rm -rf /live/data'`.

Browsers pick up a new snapshot on their next visit. The manifest is revalidated every time, and the other files are requested with `?v=<generatedAt>`.
