FROM node:24-alpine

# esbuild (Vite's bundler, used by `npm run build` below) ships a glibc-linked native binary;
# Alpine's musl libc can't run it without this compatibility shim (the build fails with "exit code 126").
RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY . .
# Workspaces: one install at the root links packages/core into node_modules for apps/server. Dev
# dependencies are needed here because the client build (vite) is one.
RUN npm ci

# Builds the React client into apps/client/dist (vite), which the server serves.
RUN npm run build

ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/server/src/minesweeperServer.js"]
