# Static export built with pnpm, served by nginx. Nothing runs server-side.
#
# Targets:
#   web       (default) the site, with the committed schedule snapshot baked in
#   snapshot  one-off maintenance job: rebuilds the schedule snapshot into /live/data
#             (a volume nginx serves at /data/, taking precedence over the baked copy).
#             Not reachable from the web; run it by hand or on a schedule. See docs/deploy.md.
FROM node:22-slim AS deps
WORKDIR /app
# git: the footer's build info (commit, branch, dirty flag) is read from .git at build time
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global --add safe.directory /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM deps AS snapshot
COPY . .
ENV SNAPSHOT_OUT=/live/data SNAPSHOT_CACHE=/cache
VOLUME ["/live", "/cache"]
CMD ["pnpm", "data:snapshot"]

FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html
RUN mkdir -p /usr/share/nginx/html/live
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
