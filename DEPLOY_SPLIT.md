# Deploying the split (main + game) — P1-8

The app runs as a single binary in one of three roles via the `ROLE` env var (see `runtime/role.js`):

- **`both`** (default) — the monolith. This is what `fly.toml` deploys today; nothing about it changes.
- **`main`** — control plane: lobby/auth/matchmaking/puzzles/profile, owns SQLite, allocates matches.
- **`game`** — runs live matches handed to it by main; clients connect directly with a join token.

The split is **opt-in**: deploy `fly.main.toml` + `fly.game.toml` to run split, or keep `fly.toml` for the monolith. The same code, same tests; only the env differs.

## Why this gives no-downtime deploys
- A match runs entirely on a **game** server, not on main. **Deploying `main` never touches a live game** (lobby/matchmaking blips for a few seconds; the match keeps running on its game server, and clients' match sockets stay connected to it).
- **Deploying the game tier drains**: the workflow drains one game app at a time (`/internal/drain` → it refuses new matches, main routes to the other app), waits for its live matches to end, then deploys it. No in-game player is cut (below).

## App layout
- **main = the existing `erik-minesweeper` app**, redeployed in the `main` role (`fly.main.toml`). It keeps
  its volume / ratings DB / `msbattle.net` domain / OAuth — nothing to migrate.
- **game = a new `msbattle-game` app** (`fly.game.toml`), stateless.

## One-time setup
```sh
fly apps create msbattle-game

# Shared secrets — INTERNAL_SECRET guards the main↔game API; MATCH_TOKEN_SECRET signs join tokens.
# Both MUST be identical across the two apps. (erik-minesweeper already has the OAuth secrets.)
SEC=$(openssl rand -hex 32); TOK=$(openssl rand -hex 32)
fly secrets set -a erik-minesweeper INTERNAL_SECRET=$SEC MATCH_TOKEN_SECRET=$TOK
fly secrets set -a msbattle-game     INTERNAL_SECRET=$SEC MATCH_TOKEN_SECRET=$TOK

# Push-to-deploy: create a deploy token and add it to GitHub as the FLY_API_TOKEN repo secret
# (repo → Settings → Secrets and variables → Actions → New repository secret).
fly tokens create deploy
```
Then **disconnect fly.io's built-in GitHub auto-deploy** in the fly dashboard (it deploys the monolith
`fly.toml` to erik-minesweeper and would fight the workflow below). `GAME_SERVERS` in `fly.main.toml` is
the game fleet's **public** URL (handed to the browser in `match_handoff`, so it must be client-reachable);
`MAIN_URL` in `fly.game.toml` uses fly's **private** network (`erik-minesweeper.internal`) for reports.

## Deploy
Push to `master` → `.github/workflows/fly-deploy.yml` deploys the game fleet, then the control plane.
Or manually, in the same order:
```sh
fly deploy -c fly.game.toml    # game fleet first, so main has somewhere to allocate
fly deploy -c fly.main.toml    # then the control plane (erik-minesweeper)
```

## Routing model (read this before scaling the game fleet)
- The browser loads the client from **main**, matchmakes there, then opens a **second socket directly to
  the game server** at the URL from `match_handoff`. Game servers enable CORS in code so this cross-origin
  socket is allowed; the signed join token is the real gate.
- **Single game machine (start here):** `https://msbattle-game.fly.dev` resolves to the one machine —
  everything just works. **This is enforced**: the deploy workflow runs `fly scale count 1` after deploying
  the game app, because fly creates 2 machines by default and there's no count field in `fly.toml` for
  Machines apps. With >1 machine the public hostname load-balances and a client's match socket can hit a
  different machine than the one main allocated to → the attach fails and matchmaking hangs at N/size.
  **Do not `fly scale count` the game app past 1** until per-machine routing (below) is wired.
- **Multiple game machines (scaling — NOT yet wired):** `msbattle-game.fly.dev` load-balances across
  machines, but a given match lives on **one specific** machine, so the client must reach *that* machine.
  That needs per-machine public addressing (fly-replay / a machine-pinned hostname) and main allocating to
  a specific machine + handing the client that machine's URL. The allocation already iterates
  `GAME_SERVERS` and falls through unhealthy ones, so the simplest multi-server setup is to list each game
  machine's own public URL in `GAME_SERVERS`. True per-match placement/affinity across an autoscaled fleet
  is the Phase 2 ("per-match allocation + multi-region") work.

## Deploying the game tier without cutting matches (two apps, drain-then-deploy)
A game server's match state lives only in its memory, and one fly app = one hostname = one machine (see
the routing model above), so a plain `fly deploy` of a game app restarts its machine and kills every match
on it. The fix is **two game apps** (`msbattle-game`, `msbattle-game-b` — same `fly.game.toml`, deployed
with `-a`; both listed in main's `GAME_SERVERS`) and a workflow that deploys them **one at a time**:
1. `POST /internal/drain` on app A → it refuses new matches (503), main allocates to B instead.
2. Poll `/internal/health` until `activeMatches` is 0 (up to `DRAIN_MAX_WAIT_S`, then deploy anyway).
3. `fly deploy -a A`, then the same for B (A, freshly deployed, is un-drained and takes matches meanwhile).
4. Deploy main last. A game server retries its result report while main restarts, so a match that ends
   during main's ~20s blip still persists.

The workflow needs the `INTERNAL_SECRET` repo secret (same value as the fly apps') to call `/internal/*`;
without it, it deploys without draining and prints a warning. An app that doesn't exist yet is skipped.

**One-time setup for the second app** (the first is the existing `msbattle-game`):
```sh
fly apps create msbattle-game-b
# same shared secrets as msbattle-game / erik-minesweeper — read the current values from the running machine:
fly ssh console -a msbattle-game -C "printenv INTERNAL_SECRET"
fly ssh console -a msbattle-game -C "printenv MATCH_TOKEN_SECRET"
fly secrets set -a msbattle-game-b INTERNAL_SECRET=<value> MATCH_TOKEN_SECRET=<value>
# and add INTERNAL_SECRET (same value) as a GitHub Actions repo secret so the workflow can drain.
```
The next push deploys it (and pins it to one machine); after that main routes to whichever app is up
and not draining.

**Mid-match reconnects** are a separate, client-facing part of the same story: a match socket that drops
(wifi/cellular handoff, locked phone, proxy hiccup) reconnects with its join token — valid for hours, not
the 60s it once was — and the game server rebinds it to the very same seat, held for a 45s grace window
(`GAME_RECONNECT_GRACE_MS`). Only a player who never comes back is evicted (with the early-leave penalty).

**Backstop:** on SIGINT/SIGTERM (`runtime/lifecycle.js`) a game server still drains on its own and fly
waits `kill_timeout` (300s — a top-level key in `fly.game.toml`; under a section it is silently ignored)
before force-killing. That only helps matches shorter than the timeout, which is why the workflow drains
first.

## Verifying
- Health: `curl -H "x-internal-secret: $SEC" https://msbattle-game.fly.dev/internal/health` →
  `{ok, role:"game", draining, activeMatches}`.
- Locally (what was used to verify P1-6 end-to-end), two processes on one box:
  ```sh
  RANKED_DB=/tmp/game.db ROLE=game PORT=1402 INTERNAL_SECRET=s MATCH_TOKEN_SECRET=t MAIN_URL=http://localhost:1401 node src/server/minesweeperServer.js &
  RANKED_DB=/tmp/main.db ROLE=main PORT=1401 DEV_AUTH=1 INTERNAL_SECRET=s MATCH_TOKEN_SECRET=t GAME_SERVERS=http://localhost:1402 node src/server/minesweeperServer.js &
  # open http://localhost:1401, queue ranked → the match runs on :1402
  ```

## Rollback
Deploy `fly.toml` (the monolith) to the main app — `ROLE` defaults to `both` and the whole app runs in one
process again. Nothing in the split changes the monolith's behaviour, so this is always safe.
