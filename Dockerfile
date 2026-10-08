# AI Job Hunter — container image
# Developed by Lulamile Mkhungela.
#
# Two stages: the UI is built with dev dependencies, then only production
# dependencies and the built assets are carried into the runtime image.
#
# The optional `better-sqlite3` native dependency is deliberately omitted: the app
# prefers Node's built-in `node:sqlite` (Node >= 22.5), so no compiler is needed and
# the image stays small.

FROM node:22-slim AS build
WORKDIR /app

# Workspace manifests first, so dependency layers cache independently of source changes.
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
# NODE_ENV is intentionally unset here — the UI build needs devDependencies (vite).
# Optional dependencies are required at this stage: rollup (used by vite) ships its
# platform binary as an optionalDependency, and omitting it makes `vite build` fail.
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
# Operator tools. set-password.js is the only way back in if the account's password is
# lost, because the app deliberately has no in-app password reset:
#   fly ssh console -C "node tools/set-password.js you@example.com 'a new password'"
COPY --from=build /app/tools ./tools

# The SQLite database, uploads and generated documents live here. On Fly this is a
# mounted volume; anywhere else, point DATA_DIR at a persistent disk.
RUN mkdir -p /data
ENV DATA_DIR=/data

EXPOSE 8787

# The app handles SIGTERM: it stops the scheduler cleanly and lets in-flight work finish.
CMD ["node", "server/src/index.js"]
