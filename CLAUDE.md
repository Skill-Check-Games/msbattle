# Multiplayer Minesweeper (msbattle.net)

Real-time multiplayer Minesweeper racing: players clear their own board on a shared no-guess
layout, fastest wins. Casual rooms + a ranked ladder with accounts and Elo, plus single-player
puzzles. Plain Node + socket.io backend, plain-JS browser client, no build step, SQLite via
`node:sqlite` (Node >= 22).

**Keep this file short.** It is loaded into every Claude request. Do not append fix histories,
bug post-mortems, or feature changelogs here; that lives in git history and, for the older
material, `docs/PROJECT_NOTES.md` (the previous 170 KB version of this file, kept as an
archive; grep it for a subsystem when you need the backstory).

## Commands

- `npm run dev` — start locally with dev login (`DEV_AUTH=1`) on port 1337. Auto-loads `.env`.
- `npm run stop` / `npm run restart` — stop, or stop + start. **Always use these npm scripts**
  for the server lifecycle, never ad-hoc `node`/`kill`/`lsof`.
- `npm start` — plain start (what the Docker/prod image runs).
- `npm test` — integration tests (`node --test test/*.test.js`) that boot the real server on an
  isolated port + throwaway DB and check `/api/*`; `apps/server/test/helpers.js` is the harness.

After any change under `apps/server/src/**`, `npm run restart`. Client assets are served from disk,
so a browser reload picks up `apps/legacy-client/**` and `packages/core/src/common/**` with no restart. Verify UI in a
browser at http://localhost:1337 (dev login: `/auth/dev?name=Dev`). Pure logic (board gen,
solver, bots, Elo) can be checked with short `node -e` scripts.

## Layout

npm workspaces (same shape as achtung-royale): `packages/core` is the game core shared by server and
client, `apps/server` the Node backend, `apps/client` the React client (Vite), `apps/legacy-client` the
old plain-JS client (served until the React one covers everything, then deleted). Root scripts run the
server from the repo root so `.env`, `ranked.db` and the data JSONs stay there. `core` is imported by deep
path: `require("core/src/engine/GameCreator")`, `require("core/src/common/BoardLogic")`.


- `apps/server/src/minesweeperServer.js` — HTTP + socket.io entry. Pure router: `/auth/*` → `runtime/oauth.js`,
  `/api/*` → `runtime/puzzleApi.js` + `runtime/shopApi.js`, everything else → `runtime/staticServer.js`
  (SPA fallback for extensionless paths). Every socket handler is wrapped in try/catch and
  `uncaughtException`/`unhandledRejection` are caught, so a thrown handler logs instead of crashing.
- `packages/core/src/engine/` — pure game logic, no http/socket/db imports (guarded by `apps/server/test/boundary.test.js`):
  `GameCreator`, `NoGuessGenerator`, `RoomCreator`, `BotPlayer`, `CSPSolver` (the one solver: rates
  boards and serves next moves), `PuzzleGenerator`, `InsideOutGenerator`, `RingSeedGenerator`,
  `StartPatterns`, `Patterns`, `BotBench`. Barrel: `engine/index.js`.
- `apps/server/src/runtime/` — shared state + socket-handler modules: `appState` (all live mutable state,
  a singleton), `ranked` (queues + `formRankedMatch`), `elo`, `bots`, `puzzlePlay`, `botDemo`,
  `standings`, `roomState`, `session` (auth attach + account payloads + most `set_*` handlers),
  `gameUtil`, `replay`, `results`/`lifecycle`/`matchToken`/`role`/`internalApi`/`gameService`
  (the Phase 1 main/game split, opt-in via `ROLE`). Modules get core services injected via
  `x.init(deps)`.
- `apps/server/src/db.js` — SQLite: users, sessions, ratings, match history, replays, puzzles, shop purchases.
- `packages/core/src/common/` — loaded by both runtimes (`<script>` tag + `require`): `BoardLogic` (cascade/chord,
  cell-state sentinels), `Cosmetics` (board skins, avatars, reveal effects), `ShopCatalog`.
- `apps/legacy-client/` — `index.html` (all markup; every module is a plain `<script>` global, loaded in
  dependency order, `core/Main.js` last), `style.css` (all styles, large), and:
  - `core/` — live-game runtime: `Main` (socket handlers + shared game globals), `Input`,
    `BoardRender` (canvas paint, palettes, avatars), `Animations`, `BoardDecoder`, `Countries`, `PuzzleLadder`.
  - `ui/` — `Router` (History API, `navigate(path)`), `Auth`, `Overlay` (`showConfirm`, never
    `window.confirm`), `Sound`, `Music`, `MobileLayout`, `Fullscreen`, `RoundTimer`, `Keybindings`, `FlagPicker`.
  - `views/` — one page/feature each: `Lobby`, `GameRoom`, `Profile` (dashboard identity + customize
    lab), `Leaderboard`, `Learn`, `Solo`, `PuzzlePlay`, `Ranking` (tier badges), `MatchPanels`, `Replay`, `Shop`.
  - `admin/` — admin pages (`AdminList`, `BotsAdmin`, `PatternsView`, `StartPatternsView`,
    `StartingPositionsView`, `CombinedPuzzlesView`, `PuzzleLab`, `Puzzles`, `DesignView`).
- `apps/server/scripts/` — offline generators (bot pool, patterns, corner positions, scouts).
- `design-refs/` — the mockup screenshots layouts were built against.

Other docs: `ARCHITECTURE_PLAN.md` (target architecture; read before any service-split work),
`PHASE0_TICKETS.md` / `PHASE1_TICKETS.md`, `DEPLOY_SPLIT.md`, `DESIGN.md`, `AVATARS.md`, `TODO.md`.

## Game rules and data

- Boards are always no-guess solvable; one shared layout per round with the centre pre-revealed.
  Board size is a per-room preset (small 10×13 / medium 15×20 / large 16×30); mines are a density
  fraction of cells. Dimensions flow in via `createGame`/`createTemplate`; the client gets `rows`/`cols`.
- Ranked: fixed ruleset (best of 5, 5 min rounds, Standard 6 min, 5 s mine penalty, medium board,
  10% mines Sprint / 20% Standard), pairwise Elo. Ratings are **per style** (`rating_sprint`,
  `rating_standard`), 0 → 3000+, 200 per sub-tier, everyone starts at 0. "Overall" = max across
  modes. Placement swings are large (`kFactor`) and margin of victory adds a bonus (`elo.js`).
- Puzzles: two-way `puzzle_rating` only picks which puzzles you get and is hidden from the UI; the
  visible rank is the monotonic Puzzle Ladder (`puzzle_points`, `core/PuzzleLadder.js`).
- Filler bots come from the pre-benchmarked `bots-pool.json`. Re-run `node apps/server/scripts/generate-bot-pool.js`
  whenever bot AI, the CSP solver/complexity costs, or the boards change; a pure ladder relabel only
  needs `node apps/server/scripts/rerank-bot-pool.js`.
- Hidden information: in-game shows only rank tiers, never exact ratings; whether an opponent is a bot
  is never exposed (not even in replays). Client-side helpers must not leak the decoded mine layout
  (the client decodes the full board for optimistic reveals).
- Guests are real `users` rows (`is_guest`), play ranked, hidden from the leaderboard, and upgrade in
  place on sign-in. Accounts can have several provider identities (`user_identities`).
- Cosmetics (skins, avatars, reveal effects) are per player and shipped on every game broadcast;
  paid ones are gated server-side by `db.ownsItem` and sold via Stripe Checkout (`shopApi.js`).
  Free/default values are simply absent from `ShopCatalog.ITEMS`.

## Conventions

- Hover state is border/opacity/background only. Never a lift, scale, or added shadow on hover.
- Concentric corners: an outer frame's radius = inner radius + padding. Matte badges, no glow/shine.
- Home page uses exactly two gap sizes (`--gap-tight`, `--gap-group`).
- No em dashes in UI copy. No taglines.
- `.cr-modal` dialogs toggle the `hidden` attribute; `Router.js` derives `body.modal-open` from it.
- Bump `db.CURRENT_SCORING_VERSION` when the puzzle difficulty formula changes (startup backfill re-rates).
- Reassigning a canvas's `width`/`height` clears it: every resize must be followed by a repaint.
- Any element that only exists for one layout (landscape duel, portrait, etc.) needs a base
  `display: none` rule, otherwise it renders everywhere.

## Configuration (`.env`, gitignored)

`PORT` (1337 local, 8080 prod), `DEV_AUTH=1` (never in prod), `OAUTH_REDIRECT_BASE`,
Google/Discord OAuth ids + secrets, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (absent → shop
routes return `503 shop_unconfigured`), `RANKED_DB` (SQLite path; default `ranked.db`),
`GUEST_TTL_DAYS`, `ROLE` (`both` | `main` | `game`).

## Deployment

fly.io app `erik-minesweeper` at msbattle.net: `fly deploy`. Volume `minesweeper_data` at `/data`,
`RANKED_DB=/data/ranked.db`. The single-process monolith is deliberate; the split is opt-in (`ROLE`).
