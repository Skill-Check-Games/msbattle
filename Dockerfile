FROM node:24-alpine

# esbuild (used by `npm run build` below to bundle the client) ships a glibc-linked native binary;
# Alpine's musl libc can't run it without this compatibility shim — without it the build step fails
# with "exit code 126" (found the binary, couldn't execute it).
RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY . .
# Workspaces: one install at the root links packages/core into node_modules for apps/server. Dev
# dependencies are needed here because the client build (vite) is one.
RUN npm ci

# Concatenates + minifies the client scripts into bundle.js (see scripts/build-client.js /
# staticServer.js). esbuild is a real (non-dev) dependency specifically so this works with the
# plain --omit=dev install above — playwright (devDependencies-only, used for manual/local UI
# verification) never needs to be installed here.
RUN npm run build

ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/server/src/minesweeperServer.js"]
