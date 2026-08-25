# Multiplayer Minesweeper (msbattle.net)

Real-time multiplayer Minesweeper racing: players clear their own board on a shared
no-guess layout, fastest wins. Casual rooms + a ranked ladder with accounts and Elo.

## Commands

Run from this directory (`msbattle/`):

- `npm run dev` — start locally with dev login enabled (`DEV_AUTH=1`), on port 1337.
  Auto-loads `.env`.
- `npm run stop` — stop the running server.
- `npm run restart` — stop + start (use this after server-side changes).
- `npm start` — plain start (no dev login); this is what the Docker/prod image runs.

**Always manage the server with these npm scripts** — never ad-hoc `node …` / `kill` / `lsof`
commands. They're the stable, approved lifecycle commands (safe to run without confirmation), so
using them consistently avoids per-command approval prompts. After any **server-side** change
(`src/server/**`), run `npm run restart`; client assets are served from disk, so a browser reload
picks those up with no restart.

Requires **Node ≥ 22** (uses the built-in `node:sqlite`).

There is no build step. `npm test` runs the integration tests (`node --test`,
`test/*.test.js`) — they boot the real server on an isolated port + throwaway DB and
check the `/api/*` surface; `test/helpers.js` is the spawn harness. To verify UI
changes, run the server and drive the app in a browser at http://localhost:1337.
Pure logic (board generation, the no-guess solver, bot behaviour, Elo) can be checked
with short `node -e` scripts.

## Layout

Source is split into three trees under `src/`:

**`src/server/`** — Node + socket.io backend. Organised into role subfolders; the entry
(`minesweeperServer.js`) and shared persistence (`db.js`) sit at the root, and everything
else is grouped:
- **`src/server/engine/`** — pure game logic / generators / solvers / benches, no http/socket/db
  coupling (`GameCreator`, `NoGuessGenerator`, `RoomCreator`, `BotPlayer`, `CSPSolver`,
  `PuzzleGenerator`, `InsideOutGenerator`, `RingSeedGenerator`, `StartPatterns`, `Patterns`,
  `TerritoryGame`, `TerritoryGenerator`, `BotBench`, `TerritoryBench`). The files `scripts/` import.
- **`src/server/runtime/`** — the http + socket runtime: shared state + the socket-handler modules
  (`appState`, `gameUtil`, `ranked`, `elo`, `bots`, `puzzlePlay`, `botDemo`, `standings`,
  `roomState`, `session`, `territory`, `staticServer`, `oauth`, `puzzleApi`, plus the Phase 0 split
  seams `results`, `lifecycle`, `matchToken`). **Phase 0 boundary prep** (see `PHASE0_TICKETS.md`,
  `ARCHITECTURE_PLAN.md`): `engine/`+`common/` are the pure game-core (barrel `engine/index.js`; never
  import runtime/db/socket — guarded by `test/boundary.test.js`); `runtime/results.js` is the single
  match-end persistence seam — `buildMatchConfig` (self-contained roster + rating-before captured at
  `startSeries`), `buildResultReport`, and an **idempotent** `persistResult` (keyed by a boot-stamped
  `matchId` via `db.markMatchPersisted` / the `processed_matches` table); `elo.computeRankedElo` is the
  pure pairwise-Elo math; `runtime/lifecycle.js` drains on SIGTERM (finish active matches, then exit;
  `formRankedMatch` refuses new matches while draining); `runtime/matchToken.js` is the HMAC join-token
  primitive (not yet wired — Phase 1). `appState` fields are tagged `[control]`/`[game]`/`[main-sp]`.

(File bullets below use bare names; resolve them under `engine/` or `runtime/` per the lists above.)
- `minesweeperServer.js` — HTTP + socket.io entry (at `src/server/` root): rooms, series, ranked
  matchmaking, bot orchestration. Its HTTP handler is a pure router — `/auth/*` → `oauth.js`,
  `/api/*` → `puzzleApi.js`, everything else → `staticServer.js`. **Error containment:** every
  socket event handler is wrapped in try/catch (the `socket.on` patch at the top of the
  connection handler, covering core + module handlers), and `uncaughtException`/`unhandledRejection`
  are caught at the process level — so a thrown handler/timer error is logged and the server keeps
  running instead of crashing and dropping every connected player.
- `staticServer.js` — serves client assets out of `src/client/` and `src/common/`,
  with the SPA fallback (extensionless unknown paths serve `index.html`).
- `appState.js` — the server's shared mutable state in one place: the live collections
  the socket handlers operate on (`rooms`, `games`, `sockets`, `names`, `accounts`,
  round/series timers, the bot registries, the ranked queues, territory/puzzle timers),
  plus `io`. A singleton — `minesweeperServer` aliases each locally (`var rooms =
  appState.rooms`, mutated in place, never reassigned), and the handler modules split
  out of the server share the same objects by requiring it. Primitive id counters
  (`nextRoomId`/`nextBotId`) are not in it.
- `ranked.js` — ranked matchmaking: the per-mode queues, the bot-trickle filler, and
  `formRankedMatch` (builds the room, seats humans + bots, hands off to the series start).
  Owns the `RANKED_MODES` catalogue + bot-join timings. When a match forms it emits `match_reveal`
  then, after a short `MATCH_REVEAL_MS` beat (no roster modal — the search waiting room already
  showed the field), starts the series; the client drops straight into the game layout with a
  covered board. Coupled to the core
  like territory, so its core services (`createPlayerGame`, `addBotToRoom`,
  `broadcastRoomState`, `startSeries`, `readUserRating`, a room-id source, `RANKED_RULES`,
  `MAX_BOTS_PER_ROOM`, `PROVISIONAL_GAMES`, `io`) are injected via `ranked.init(deps)`; queue
  state is `appState` and `botCount` comes from `gameUtil`. The server delegates
  `find_ranked`/`cancel_ranked`/disconnect to `ranked.isValidMode`/`enqueue`/`dequeue`.
- `elo.js` — the rating math: the pairwise-Elo formula (`applyRankedElo`), the per-style
  rating reader (`readUserRating`), and the tournament per-player variants
  (`applyEloForPlayer`/`tournamentEloParts`, so a cut player is rated the moment they're
  eliminated). Pure math over `db` + the `appState` accounts/botRating; the standings it
  consumes are built in the core. `RANKED_BOT_RATING`/`PROVISIONAL_GAMES` are injected via
  `elo.init(deps)` (`isBot` comes from `gameUtil`). Consumed by the core endgame, `ranked`, and `territory`.
  **Ladder & gains:** ratings run **0 → 3000+** with the tier bands at 200 each (Bronze I = 0;
  Master from 3000 — see `Ranking.js`); a new rating floors at 0 (Bronze I). `kFactor(played)`
  gives big placement swings that settle (K=150 game 1 → 40 from ~game 8), so first matches move
  you fast. `marginFactor` adds a **margin-of-victory bonus** (up to +60%) to a *positive* swing,
  scaled by how far your `progress` (avg fraction of board cleared across the series) beat the
  player you outranked — so a dominant clear pays more than a photo-finish. Progress is summed per
  round on the room (`progressSum`/`progressRounds`) and averaged in `buildSeriesStandings`; it's
  absent for territory (→ no margin bonus). **Standard is boosted** (`kFactor`/`marginFactor` take
  the style): its games take far longer than Sprint so a session yields fewer, and `styleKMultiplier`
  scales Standard's K by 1.5× in game 1 easing to a steady 1.3× (extra placement push), while its
  margin bonus rises to +110% (`STANDARD_MARGIN_BONUS`) — so a Standard blowout climbs ~2× a Sprint one. NB the bot pool is still calibrated on the old ~1000
  scale, so until it's re-benched the reachable human ceiling is roughly the pool's top rating.
- `bots.js` — racing/casual/ranked bot orchestration: add/remove bots, apply their per-move
  config to the game, and the per-move tick (`decideMove` → a delayed `handleLeftClick`, then
  reschedule). The bots play through the same game objects + move path as humans; `createPlayerGame`
  is injected via `bots.init(deps)`, and the game-loop helpers (`updateDraw`) + shared predicates
  (`isBot`/`botCount`/`getRoomBotNames`) come from `gameUtil`. Per-bot state is `appState`. (Territory
  has its own bot tick in `territory.js`.) NB the server requires it as `botMgr` to avoid colliding
  with the `bots` state map (`botId → true`) that `isBot` reads.
- `puzzlePlay.js` — single-player puzzle play (rated / streak / storm / daily): the run
  lifecycle, serving puzzles near the player's rating, building the game, the hint pointer,
  and finalising with the puzzle-Elo exchange. Self-contained on `db` + the generators/solver +
  `gameUtil` (`obfuscateBoard`) — no `init` needed; state
  (`puzzlePlay`/`puzzleRun`) is `appState`. The server delegates the `puzzle_*` socket events
  (`registerSocketHandlers`), the puzzle branch of `left_click`/`right_click`
  (`handleLeftClick`/`handleRightClick`), and disconnect (`cleanup`). Required as `puzzleMode`
  (the `puzzlePlay` name is the appState map). Solo free-play board gen (`request_solo_board`)
  stays in the server.
- `botDemo.js` — the admin "watch a bot play" demo: builds a standalone no-guess game with a
  pool bot's variables and streams its play (one frame per move) to the watching socket. The
  admin gate (`isSocketAdmin`) and `RANKED_RULES` are injected via `botDemo.init(deps)`; state
  (`botDemos`) is `appState`. Server delegates `bot_demo_start`/`bot_demo_stop`
  (`registerSocketHandlers`) and disconnect (`stopBotDemo`).
- `standings.js` — turns a room's game results into ranked arrays: per-round standings
  (finishers first, then by finish time / safe count), the series winner, the cumulative-score
  series standings, and the tournament final standings. Reads game/room state + the accounts
  cache; the rating constants are injected via `standings.init(deps)` (`isBot` comes from `gameUtil`).
- `roomState.js` — room serialization + broadcast: the lobby summary (`room_list`) and the
  full `room_state` payload the client renders, pushed over socket.io. Reads room/game/account
  state from appState; `io`/the bot+rating constants are injected via `roomState.init(deps)` (`isBot` from `gameUtil`).
- `session.js` — session/auth attach: `loginSocket` binds a real-or-guest user to a socket
  (accounts/names + the `authenticated` snapshot) and registers the auth socket events
  (`authenticate`/`guest_session`/`sign_out`/`set_name`). Reads appState + db + roomState + `gameUtil`
  (`updateDraw`); `PROVISIONAL_GAMES` injected via `session.init(deps)`. (OAuth redirect is `oauth.js`;
  clients then `authenticate` here.)
- `gameUtil.js` — small shared game helpers depending only on appState + crypto: the bot/player
  predicates (`isBot`/`humanCount`/`botCount`/`getRoomBotNames`), the board obfuscator
  (`obfuscateBoard`), the per-game broadcast payload (`gameForBroadcast`), and `updateDraw`
  (push each player their `draw_board` frame). Required across the server + modules.
- `puzzleApi.js` — the admin/puzzle HTTP API: everything behind `/api/*` (the All-Puzzles,
  Bots, Patterns, Starting-positions, Combined-puzzles pages), the background
  puzzle-generation job, and the startup pool top-up. Pure HTTP + db + generators, no
  room/game/socket state. Exposes `handleApiRoute(req,res,url)` and `ensurePoolTopUp()`.
  (Live puzzle *play* — `serveRunPuzzle` and its socket flow — stays in the server.)
- `oauth.js` — provider login (Google / Discord, GitHub server-side, and the
  `DEV_AUTH` dev shortcut): reads its config from the environment, manages the CSRF
  `state` nonces, exchanges codes, resolves/upserts the user via `db`, and redirects
  to `/#token=<session>`. Exposes `handleAuthRoute(req,res,url)` (the server's HTTP
  handler early-returns on it), `DEV_AUTH`, `OAUTH_BASE`, and `providerFlags()` (which
  providers the client shows buttons for).
- `GameCreator.js` — board/game state factory + mine placement.
- `NoGuessGenerator.js` — `createNoGuessTemplate` + `analyzeSolvability`, which verifies
  no-guess solvability by running the **capped CSP solver** (`GEN_MAX_COMPLEXITY`, kept
  below the case-split threshold so generation stays fast) and, from that same solve,
  bakes a per-cell **difficulty map** (`template.difficultyByCell`, CSP complexity per cell).
- `RoomCreator.js` — room and best-of-N series state.
- `BotPlayer.js` — bot AI. Each bot has six per-move variables (`speedMs`, `difficultyMs`,
  `distanceMult`, `maxDifficulty`, `mistakeRate`, `chordRate`); `computeMoveDelay` scales the
  pause by the move's actual numeric difficulty (from the board's difficulty map) and the bot
  guesses when the easiest available move exceeds `maxDifficulty`. It finds that easiest safe move
  with `CSPSolver.findNextSafeStep` (capped at `BOT_COMPLEXITY_CAP` = 7.999 so bots never use the
  case split — they top out below it and guess instead). Also the random-knob
  generator (`randomBotConfig`), pool loader/picker (`loadPool` / `pickBotFromPool`), and
  casual presets (`configForDifficulty`). `configForElo` survives only as the offline
  calibration anchor — nothing at runtime calls it.
- `BotBench.js` — headless bot benchmarking: replays a bot's real decision loop on a
  virtual clock to measure solve time, calibrates time→Elo against the `configForElo`
  curve, and rates a config. Reads each board's difficulty map off the template. Used by
  `scripts/generate-bot-pool.js`; no I/O of its own.
- `CSPSolver.js` — the **one and only solver** (the old pass-based `PuzzleSolver` was removed; CSP both
  rates a whole board and serves the next move). `analyzeBoard(board, state, {revealCell, maxComplexity})`
  returns per-move numeric `complexity` and `solved`; `findNextSafeStep(board, state, {maxComplexity, allow})`
  returns the single easiest forced move (`{kind, clueCells, safeCells, mineCells, componentSize}`) — used by
  the in-game hint pointer and by bots (with `allow = canTarget` to restrict to a bot's reachable frontier in
  territory). It absorbed `constraintAt` + `findEnumSteps` so it has no dependency on any other solver.
  The `maxComplexity` cap prunes the search —
  it's both the generation difficulty ceiling and the model for a bot's skill ceiling. Hard deductions
  (beyond trivial/subset) use, in order: a **sound 1-cell case split** (`findCaseSplitStep`, cost
  `CASE_BASE`=8 + branch) then **sound enumeration** (`findEnumSteps`: enumerate every consistent mine
  configuration of a frontier component ≤ `ENUM_CAP`=18, take only cells forced across ALL of them).
  **Soundness of the case split:** it hypothesises a frontier cell safe-vs-mine and propagates each branch
  over the VISIBLE clues only — a deduced-safe cell is marked `SAFE` (removed from its neighbours' mine
  candidates) but is **never revealed and its clue is never read**, so a hypothesis can't consult the
  hidden solution. It concludes a cell only when one branch contradicts (forcing the other) or both
  branches agree. The previous case split was UNSOUND: its "safe" branch revealed the hypothetical cell
  and cascaded using the TRUE board clues, so it could "prove" cells that public info doesn't force (e.g.
  resolve a genuine 50/50 just because it's safe on this board). The sound version was verified by a
  per-step audit (brute-force the visible state before each case step; 0 violations over 159 adversarial
  corner boards). None of this touches the real game: generation/bots cap below `CASE_BASE` so they use
  only trivial/subset/enum — every stored puzzle's `csp_method` is trivial/subset/intersect/union, never
  case/enum — so the change only affects the uncapped Analyze modal and ratings of non-no-guess boards.
- **Puzzle difficulty score** (`PuzzleGenerator.complexityScore`): sort the solve's per-move
  complexities high→low and sum `c / X^rank` with `X = 3.5`. The hardest move counts fully; each
  further hard move adds a geometrically-decaying share (bounded by `c_max · X/(X-1) ≈ 1.4×`), so
  stacking hard deductions is rewarded while a long tail of easy moves saturates — many *hard*
  moves matter, raw *length* doesn't. `rating = max(0, round(240·(score − 0.5)))`; the difficulty
  *tier* (t1–t6) is bands on `maxComplexity` alone. Bump `db.CURRENT_SCORING_VERSION` when the
  formula changes — a startup backfill re-rates every stored puzzle below it.
- `db.js` — SQLite (`node:sqlite`) for accounts, sessions, and ratings.
- **Guests & auth.** There's no login wall: a visitor with no stored session auto-starts a **guest**
  (client emits `guest_session` on connect → `db.createGuest()` makes a real `users` row flagged
  `is_guest`, provider `"guest"`, name `"GuestNNNNN"`, default ratings; the server mints a session and
  returns its token in the `authenticated` payload so the guest persists across reloads). Guests are
  normal users — they play ranked and accumulate Elo — just hidden from the leaderboard (`topPlayers`
  filters `is_guest = 0`). **Upgrading:** when a guest hits Sign in, the client threads its session token
  as `?upgrade=<token>` into the OAuth login; the callback (`resolveOAuthUser` → `db.upgradeGuest`)
  attaches the provider identity to the SAME row (keeping id/rating/stats) — unless that provider account
  already exists, in which case it logs into the existing account and discards the guest (`switched`).
  Sign-out drops back to a fresh guest, never a login wall. Client: `Auth.js` (`applyConnected` →
  `guest_session` when tokenless; `applyAuthenticated` stores `data.token` + calls `applyUserIdentity`);
  `#name_view` is the sign-in card — **provider buttons only** (`.btn-oauth-google`/`.btn-oauth-discord`,
  brand-styled with their logos); the old "set your name" form was removed (renaming is the dashboard pen). **Topbar identity** (`applyUserIdentity`):
  a real account shows its **auth-provider logo** (`providerLogoSVG`, Google/Discord marks; dev/github get
  none) + name + a "Sign out" button — **no rank badge** (rank lives on the home dashboard chips); a guest
  shows **only the "Sign in" button** (no name/logo). The `authenticated` payload carries `provider` for this.
  **Renaming** is done **inline on the home dashboard**: a pen icon next to the name (`#dash_edit_name`) swaps
  it for `#dash_name_input` in place — Enter/blur commit via `set_name` → `db.setUserName`, Escape cancels;
  no page change (wired in Auth.js). `#name_view` is now just the **guest sign-in** card (`showNameView`).
  **Cleanup:** drive-by guests are reaped by `db.pruneStaleGuests(maxAgeMs)` (deletes `is_guest=1` rows
  with `played=0` AND `puzzles_attempted=0` older than the TTL, plus their sessions/attempts; a guest who
  played anything is kept). The server runs it on startup and daily (`reapGuests`, TTL = `GUEST_TTL_DAYS`
  env, default 7).
- **Multi-provider accounts (email linking).** A single account can be reached through several logins
  (Google + Discord, …). Each provider login is a row in the **`user_identities`** table
  (`(provider, provider_id)` PK → `user_id`); `users.provider/provider_id` is just the original/primary
  login. `db.upsertUser` / `db.upgradeGuest` resolve via `findAccountForLogin`: an **existing linked
  identity** first, then (account-linking) **a real account with the same verified email** — in which case
  the new provider is linked to that account (`linkIdentity`) instead of making a duplicate; otherwise a
  new account is created. `users.last_provider` is bumped to the provider used on every login (while
  `users.provider` stays the original), so the topbar logo reflects the **most recently used** login.
- **Names.** `users.display_name` is the shown, editable name (read via `db.displayNameOf` = `display_name
  || name`); `set_name` writes only `display_name`. On first real login it's seeded from the provider's
  name **only if unset** — a guest's auto-name lives in `name` (not display_name) so it doesn't count, and
  a later provider login never clobbers a chosen name. Each provider's raw id+name are also kept verbatim
  in dedicated columns (`google_auth_id`/`google_auth_name`, `discord_*`, `github_*`) via
  `setProviderAuthFields`, in case they're wanted later. The `authenticated` payload's `name` is the
  display name; `topPlayers` shows `COALESCE(display_name, name)`. So signing in with Google and later Discord under the same email lands on the
  same player, and either login works thereafter. Only **verified** emails link (Discord gates on
  `verified`, GitHub on primary+verified, Google on `email_verified`). Caveat: this links a *new* provider
  to an existing account — it does **not** merge two accounts both created separately before the identity
  existed (no auto-merge of pre-existing duplicates). Existing rows are backfilled into `user_identities`
  on startup. NB the `create_room` socket still creates a Territory room for `{mode:"territory"}` (ranked +
  the territory test use it), even though the custom UI is race-only.
- `StartPatterns.js` — size-parametric enumeration of starting-cascade positions (any H×W
  block) and the unique first-deduction patterns they yield, reusing `Patterns.js`'s
  canonicalisation. Driven by `scripts/generate-patterns.js`, which catalogues into
  `deduction-patterns.json` tagged by source size. Served by `GET /api/start-patterns` and
  shown on the **Start patterns** admin page (`#/admin/start-patterns`, `StartPatternsView.js`,
  reusing `PatternsView.js`'s board renderers). `geometry(H,W,walls)` also enumerates blocks flush
  against board edges — open / wall / corner placements (walls remove ring cells and add `wallCells`
  to the pattern, drawn as dark tiles). The script has **two passes**: (1) exhaustive enumeration of
  every ring arrangement for **3×3 + 3×4** (open/wall/corner), and (2) a **curiosity sweep** of two
  named clue rings — all-1s, and 4s-in-corners/2s-along-edges — for every block size **3×3 up to 9×9**.
  Exhaustive enumeration is only viable up to ~4×4 (ring grows with block size; 4×4-open alone ≈ 6 min,
  see the ring≤24 / `BRUTE_LIMIT` guards), so the sweep builds just those two tuples and runs the same
  extractor; rings past the brute-force limit fall back to the analyzer-deduced forced set.
  Findings: starting cascades yield very few unique patterns (40 total) and the complexity
  **ceilings at ~8** (case-split rings + one 3×4-open subset at 8.44) regardless of block size;
  bigger blocks add only larger versions of the same case rings, and wall/corner add 3 *easier*
  (cx ≤ 2.7) edge patterns. Hard patterns (chain/enum) live mid-solve, not at a fresh opening —
  starting positions aren't a source of hard building blocks. **mod-3 parity law:** the all-1s and
  corners-4/edges-2 rings force a deduction (always a cx-8 case-split) **iff neither H nor W ≡ 2
  (mod 3)**; otherwise the ring is fully ambiguous and forces nothing. This holds out to 9×9 — the
  difficulty never rises above 8, so larger blocks never mean harder building blocks.
- **Corner-mine starting positions** (`scripts/generate-corner-positions.js` → `starting_positions`
  table, admin "Starting positions" page `#/admin/starting-positions`, `StartingPositionsView.js`).
  A separate family from the plain 3×3 cascades: a **4×4 opening with one corner a covered mine the
  solver must deduce** (not pre-flagged) — the far interior still has a 0-cell, so it floods like a
  real cascade. The script enumerates every surrounding ring layout (2²⁰), dedups by revealed-clue tuple
  (76 352 distinct openings), and rates each **realistically**: it takes the lexicographically-smallest
  consistent ring layout (the same concrete board the Analyze modal rebuilds), constructs the real board,
  and solves it **with cascades** — recording **max** (hardest single deduction) and **total** (sum) from
  the analyzer's own `maxComplexity`/`totalComplexity`. NB this metric evolved: an early version analyzed
  the frozen opening with no layout and no cascades (inflating ratings), and it relied on the old UNSOUND
  case-split; with cascades + a concrete layout + the sound solver, the hardest openings now top out around
  **cx 11** (a sound case split). **Only ~58% (44 091/76 352) are fully solvable** — the surrounding ring
  is underconstrained, so these are families of boards, not single puzzles; the family is a curiosity, not
  a real source of hard puzzles. Forced safe/mine ring cells come from the exact brute-force closure
  (layout-independent). It
  stores a **~200 sample**: always the single hardest opening, plus an even random sample across the
  `floor(max)` bands. Stored as `size=4`, `variant="corner4"`, with `total_complexity`/`max_complexity`
  columns — so the admin **Family** filter (`3×3 cascade` vs `4×4 corner-mine`) keeps them apart from the
  plain cascades (default `size=3` view); `StartingPositionsView.js` renders them on a 6×6 board
  (`paintCornerPosCanvas`, corner drawn as a flag) with an **Analyze** button (`GET
  /api/starting-positions/:id/analyze` → `cornerStartingPuzzle` rebuilds the concrete board, reusing the
  All-Puzzles solver-trace modal). Re-run the script to regenerate the sample.
- **Puzzle scouts** (`scripts/scout-corner-positions.js`, `scripts/template-scout.js`) — report-only search
  tools for finding genuinely-hard *solvable* openings (the kind that require case analysis, not just a long
  subset chain). `scout-corner-positions.js` sweeps the H×W corner-mine family (env H/W, MAX_MINES);
  `template-scout.js` is the **general** version: you write a board template (text grid; tokens `0-8`
  revealed-fixed, `?` revealed-any, `#` covered-any/free, `*` covered-mine, `s` covered-safe-any, `A-I`
  covered-safe-fixed-0..8; aliases `.`=`#`, `M`=`*`) and it enumerates every consistent mine layout (sparse,
  `MAX_MINES`), buckets by the opening, **skips openings with no forced-safe cell** (unsolvable — no first
  move — found for free from the per-cell mine-frequency closure, never invoking the solver), solves the
  rest WITH cascades (capped at `ANALYSIS_CAP` to skip non-human brute-enum), and prints the hardest
  fully-solvable board. Findings so far: corner-mine families are nearly barren (3 case gems in 4×4, 0 in
  4×5/5×5); two coupled mines hit far more; constructive generation (`InsideOutGenerator`) makes hard
  *subset*-solvable puzzles (cap ~2600 rating) but structurally **cannot** produce case-analysis ones,
  because it follows the analyzer's cheapest forced move so a cheap solving path always exists by construction.
- `scripts/combine-patterns.js` — composes two start patterns into one board to test whether
  *combining* building blocks beats the single-opening ~cx-8 ceiling. It lays two blocks side by
  side so their unknown rings either share a seam column or sit a gap apart, solves for a concrete
  mine layout (backtracking) so each is a real `{rows,cols,mines,revealed}` board, and scores it
  with `PuzzleGenerator.analyzeWithTracking`. Writes `combined-puzzles.json`; served by
  `GET /api/combined-puzzles` (+ `/:id/analyze`) and shown on the **Combined puzzles** admin page
  (`#/admin/combined-puzzles`, `CombinedPuzzlesView.js`), which reuses the All-Puzzles
  `renderPuzzleListCard` / `openAnalyzeModal` (both now take an analyze-endpoint base arg) so each
  card is playable and Analyze shows the solver trace. Findings: composing genuinely helps — a
  `#15⊕#16` 1-column-gap board is fully solvable at cx 5.9 (vs 2.69 alone), and two heavy
  `corners4-edges2` rings sharing a seam reach cx 9.7 (past 8, though it stalls before a full
  solve). Some pairs (`#15⊕#16`, `#16⊕#16` at a shared seam) have **no consistent mine layout** —
  the clue rings conflict at the seam — surfaced as a note on the page since they can't be a board.
- `TerritoryGenerator.js` / `TerritoryGame.js` — the **Territory (versus)** mode: players grow from
  the corners of ONE shared board, claiming cells (vs the racing modes where each player has a private
  state matrix over a shared layout). Supported with **2 players** (opposite corners, 18×30) or **4**
  (one per corner — `generate({corners: 4})`, on a bigger 24×40 board; `territoryDims(players)` picks
  the size). The generator is generate-and-test: a random
  board with the top-left corner block mirrored onto every other corner (180° for 2; the full
  horizontal/vertical/180° set for 4) and every cascade capped, so all start openings are **identical**,
  plus a mine-free **start zone** (Chebyshev radius 3) at each corner, kept only if it's **no-guess
  solvable from EVERY corner** (verified per-corner with `NoGuessGenerator.analyzeSolvability`) — the
  interior is independent, not symmetric. `TerritoryGame` is N-player throughout (per-player owner /
  scores / capture); it holds the single `state` + an `owner` matrix,
  enforces contiguous growth (you may only reveal a covered cell adjacent to your own territory). Hitting
  a mine now simply **freezes** you for `FREEZE_MS` (3 s) via `g.hitMine` — the old self-explosion (which
  re-covered a patch of your own territory) was removed; the cell stays a covered mine. The ONLY thing
  that re-covers territory now is an opponent's **energy bomb** (see below). A re-cover that leaves a cell
  next to a revealed 0 is auto-revealed (`fillUncascaded`) but claimed by the OWNER OF THAT 0-cell, so a
  blast only ever feeds the player whose own open ground forced the reveal.
  **Energy bombs** (`g.requestBomb` / `g.detonateBomb`): spend `BOMB_COST` (1000) energy to launch a missile
  from a random generator (structure) you own at a target cell. After a distance-scaled flight the blast
  re-covers a Euclidean `BOMB_RADIUS` (≈2.6) circle as **neutral** ground, wiping flags + infrastructure
  (structures/lines) there. The mines under it are re-rolled at board density to a **no-guess-solvable**
  layout (`regenPatch` — border-constrained backtracking + `solvableFromBorder`, ≤`BOMB_REGEN_TRIES` tries;
  falls back to the existing layout if none found) and the changed clues are patched to clients. **Claim
  lock:** for `BOMB_CLAIM_LOCK_MS` (5 s) after impact only the launcher may take the crater — each crater
  cell gets `g.bombClaim["r,c"] = {pid, until}`, and `g.claimLocked(pid,r,c)` blocks everyone else in
  `canReveal`, the reveal cascade, and `fillUncascaded` (so neither a click nor a cascade nor an auto-fill
  can grab it); after 5 s it opens to anyone. `g.claimList(now)` (broadcast as `claims`, also prunes
  expired) drives the client overlay. Wiring: `territory_bomb` socket event → `requestBomb` (validate energy
  / pick silo / stage `_missile`) + broadcast, then a `setTimeout(flightMs)` → `detonateBomb(tr,tc,pid,now)`
  + broadcast. The blast reuses the `_explosion` payload (`{origin, recovered, clues, bomb:true}`);
  `bomb:true` makes the client clear EVERYONE's flags in the area. Client: HUD `tv-bomb-btn`
  (cost + affordability, `territoryToggleAim`) or the **S** hotkey → aiming mode (crosshair, Esc cancels) →
  next board click emits the bomb (`territoryLaunchBomb`, intercepted in `performAction`); the missile
  animates via `territoryMissiles`/`drawTerritoryMissiles`, and the claim lock pulses in the launcher's
  colour via `territoryClaims`/`drawTerritoryClaims`.
  Server wiring lives in `territory.js` (extracted from `minesweeperServer`): it owns the
  territory socket handlers + helpers (start/end/broadcast/bot-tick/world-tick) and the
  territory board sizes/density. Because it's both called from the core (start/leave/click)
  and calls back into it (`clearRoundTimer`, `applyRankedElo`, `broadcastRoomState`/`List`), those
  few callbacks + `io`/`COUNT_DOWN_TIME` are injected once via `territory.init(deps)` to avoid a
  circular require; `obfuscateBoard`/`isBot` come from `gameUtil` and everything else is `appState`. The server
  delegates: `room.gameMode === "territory"` →
  `territory.startGame` builds one shared game; `left_click` routes to `territory.handleReveal` → `tg.reveal(pid,r,c,now)`
  and broadcasts `territory_board` (`state`+`owner`+`scores`+`frozenUntil`); **there is no round clock**
  (`roundSeconds: 0` — and ranked formation now honors an explicit `0` via
  `typeof modeDef.roundSeconds === "number"`, so territory no longer silently inherits the
  300s default). **The game ends only on elimination** — when just one player still holds any ground
  (`maybeEndTerritory` → `tg.alive() <= 1`, "eliminated") — or a player leaves, or a genuine deadlock
  (`tg.deadlocked()`: nobody can expand AND no fort stands to re-open the board, "deadlock"). Clearing
  every safe cell is NOT an end — that's when the invasion war begins. Winner = most cells. **Entry points:** "Create
  Territory (1v1)" and "Create Territory (4-player)" buttons in the custom lobby (`create_room` with
  `players: 2|4`; `startTerritoryGame` accepts 2 or 4 and seeds one player per corner from
  `TERRITORY_COLORS = [cyan, amber, violet, rose]`), and **ranked** `territory_duo` (2-player) /
  `territory_quad` (4-player) modes chosen from the territory ranked picker (`RANKED_PICKER_META`,
  style `"territory"`, filled with bots like the other ranked modes) — both share the one
  `rating_territory` Elo ladder; `endTerritoryGame` applies rank-based Elo across all players (so it
  works for 4 as well as 2) and reports the delta in `territory_result`. **Client:
  `Territory.js` renders on the SHARED game board** (`#game0` / `renderPlayerBoard` / `drawCell`),
  not a bespoke canvas — it sets `myState` from the shared state, feeds an owner-colour grid that
  `drawCell` tints (via `view.getOwner`, null in other modes) — and applies **fog-of-clues**: clue numbers
  show only on cells you own PLUS opponent cells that border one of yours (the contested frontier);
  opponent cells deeper in their territory show their owner tint but no number (`view.hideClue`), so you
  can't read your opponent's board — and routes clicks through
  `Input.performAction`'s `"territory"` mode. Like the other modes it **predicts locally** — the
  client decodes the board, so `territoryLocalReveal` reveals+cascades+claims a safe move instantly
  and then emits; the server still owns mine hits (explosions), enclosure capture and validation. The
  next `territory_board` **merge-reconciles** rather than overwrites: a cell you've already revealed is
  never un-revealed by a server board unless that board's `explosion.recovered` list actually re-covered
  it — so a broadcast that races ahead of your reveal's echo (an opponent moving) can't flicker your
  cells back to covered, and the reverse-cascade animation is driven off that same `recovered` list
  (never a diff), so it only ever plays on the exploder's cells. Reusing the real board means keyboard focus, right-click `preventDefault`, hit-testing
  and animations all work for free. Racing chrome is hidden via a `.territory` class on `#game_view`
  plus a small territory score-bar HUD (chip · bar · chip for 2; a chips row over a segmented bar for
  4, built from `territoryInfo.players`). **Bots** use the same `BotPlayer.decideMove` AI as the
  racing modes, fed a game view with two extra knobs (no-ops for racing): `canTarget(r,c)` limits
  reveals to the bot's own frontier (`tg.canReveal` + excluding mines it has detonated) and
  `revealsOnly` drops flags/chords. `scheduleTerritoryBot` ticks it on a speed/difficulty-scaled
  cadence; `tg.mineKnown` keeps it from re-hitting a mine. Bots are picked for territory by a
  **separate measured rating** (`b.ratings.territory`): `TerritoryBench` replays a bot's decision loop
  clearing a no-guess territory board against a non-moving opponent on a virtual clock (mirroring
  `BotBench`, but mine hits cost a re-cover + freeze instead of a flat penalty), and
  `scripts/calibrate-territory.js` (fanned across `territory-bench-worker.js`) maps clear time to an Elo
  and writes `ratings.territory` onto every pool bot; matchmaking calls `pickBotFromPool(elo, w,
  "territory")` and targets the lobby's territory Elo. So the bot doesn't needlessly guess into mines,
  `CSPSolver.findNextSafeStep` takes the bot's `canTarget` predicate via its `allow` option (territory only)
  and only counts a
  safe deduction as a result when it has a cell on the bot's own frontier — a safe move the bot can't
  reach no longer short-circuits it into a guess; it keeps searching for a frontier-safe move. This
  both cuts territory mine-hits and gives the calibration real resolution across the Elo range.
  **Enclosure capture**
  (`tg.captureEnclosed`, run after every reveal): a region you've sealed off so that **only you can
  reach it** — two reachability floods (each spreads **8-connected** from a player's land through covered
  cells only, matching `canReveal`'s 8-adjacency expansion — using 4-connectivity under-counted reach and
  let the capture STEAL cells the opponent could still grab diagonally, ending games early; the
  opponent's land AND neutral dead ground are walls), capture = cells your flood reaches but the
  opponent's doesn't — is claimed. This captures regions pinned against a **board edge** too, not just
  interior pockets (the edge isn't an escape). Captured covered non-mines are revealed and claimed,
  mines stay a covered dead pocket. **Enemy pockets flip too** (second pass, connectivity-based):
  "freedom" = reaching the board border through any NON-your cell (your cells are the only walls). A
  player starts on the border, so they stay free until you wall their land off from every edge; anything
  you seal into the interior — opponent cells AND the neutral/covered ground trapped with them (e.g. bomb
  craters) — can no longer reach the border and is captured (enemy land revealed + claimed, sealed mines
  become your covered structures). A covered/neutral boundary cell no longer saves an island; only a real
  escape route to the open edge does. Both passes skip cells under a bomb claim lock (`g.claimLocked`).
  Fully surrounding an opponent away from the edges captures their territory and can eliminate them.
  **Structures + offensive beams (PvP invasion).** A connected blob of covered mines whose entire outer
  boundary you own becomes your **structures** (`g.updateStructures`, run after every board change — it
  flood-fills each 8-connected mine group and claims the whole group if one player rings it, so clusters
  of mines count, not just lone ones): owned by you (counts toward
  score, NOT toward `claimedSafe`), auto-flagged, rendered as a coloured flag with a charge gauge. Each
  has a **cooldown** that recharges faster the more territory you hold (`cooldownFor` ∝ your cell count).
  Left-clicking your charged structure fires `g.fireStructure` → a **directional beam** at the nearest
  enemy cell: it travels over your land/neutral, then re-covers a 3-wide channel of the enemy's territory
  (`BEAM_LEN` deep) — those cells go neutral and you re-claim them by expanding in. An enemy **structure
  in the path ABSORBS** the beam: it's destroyed (reverts to a neutral mine) and the beam stops there, so
  forts are sacrificial defence. Re-cover stays consistent via the shared `fillUncascaded` (reused from
  explosions). Wiring: `territory_fire` socket event; `broadcastTerritory` sends `structures`
  (`{r,c,owner,readyInMs,cooldownMs}`, client interpolates the gauge) and a one-shot `fire`
  (`{pid,from,to,recovered,destroyed}`) for the breach + beam-streak animation (`territoryBeams` /
  `drawTerritoryBeams`, a fading glowing line from fort to impact in the firer's colour). NB: beams
  re-open cleared cells to NEUTRAL (claimable by either side), so they don't permanently capture — a
  defended core a bot keeps re-revealing can stalemate, since elimination is now the only win. A beam
  that captures the channel for the firer (or a domination tiebreak) is the open follow-up.

  **Energy infrastructure (`TerritoryGame.js`).** A structure (claimed mine) is also an energy
  **extractor**: it spends `EXTRACTOR_BUILD_MS` (15s) under construction, then produces `EXTRACTOR_RATE`
  (1/s) energy for its owner. `g.extractorStartedAt["r,c"]` is stamped when the cell is first claimed (in
  `updateStructures`) and cleared when its enclosure breaks. Running extractors auto-wire **energy lines**
  to their nearest same-owner running extractors (`g.recomputeLines`, ≤ `LINE_MAX_LINKS`=3 each within
  `LINE_RADIUS`=6 Chebyshev), stored in `g.energyLines["r,c|r,c"] = {owner,startedAt}`; a line spends
  `LINE_BUILD_MS` (10s) building then adds `LINE_RATE` (0.6/s). Energy banks per player in `g.energy`
  (`g.accrueEnergy` integrates rate×Δt lazily; `g.energyRate` sums running extractors + completed lines).
  A server `setInterval` (`startTerritoryWorldTick`, ~1/s, cleared in `endTerritoryGame`) calls
  `g.tickWorld` (accrue + re-wire) and re-broadcasts so the economy advances even when nobody clicks.
  `broadcastTerritory` adds `energyLines` (`energyLineList`: endpoints + `buildInMs`/`buildMs`), per-
  structure `buildInMs`/`buildMs`, and `energy`/`energyRate` per player. **Client:** `territoryStructures`
  entries carry `builtAt`/`buildMs`; `drawCell` shows a construction ring (`drawExtractorBuild`) until
  built, then a glowing core (`drawExtractorCore`) + the beam gauge; `drawTerritoryEnergyLines` renders the
  grid as **faint orthogonal (Manhattan) traces** along the grid axes (`territoryGridPoint` routes
  horizontal-then-vertical; dashed while building, very low alpha when done) with occasional **energy
  packets** (`territoryPackets`) blipping along them — spawned on a randomised cadence by
  `territorySpawnPackets` from the 250ms tick (`territoryEnergyTickFn`), which kicks the rAF loop while a
  packet is in flight. The HUD chip shows banked energy (`territoryEnergy` +
  `territoryEnergyNow` interpolation, ticked every 250ms by `territoryEnergyTick`). Banked energy is the
  resource for the planned **energy explosions** (area wipe → re-covered cells, up for grabs) — not yet
  built; board re-randomisation of the wiped area is a later idea.
- `RingSeedGenerator.js` — turns a "4s and 2s" ring start (corners4-edges2) into a real solvable
  puzzle. That ring has exactly **2 symmetric solutions** and no single clue change breaks it (every
  change either over-constrains to 0 or loosens to 7–9 solutions), so it searches clue-change sets of
  increasing size (fewest first), keeps the ones that force a reveal, ranks by deduction complexity,
  and from the hardest down hands the seed to the inside-out generator to finish — keeping the first
  that comes out faithful (block clues still the ring values) and fully solvable. Two top-corner
  4→2 changes break the symmetry and grow into a solvable ~cx-7.9 board (rating ~2350). Driven by
  `combine-patterns.js` (group "Ring → solvable").
- `InsideOutGenerator.js` — deduction-driven generator: from a seed it asks the analyzer for the next
  forced move, commits each revealed cell's clue to the value that maximises full-solve complexity,
  and keeps only fully-classified (solvable-by-construction) boards. `constructFromSeed` is the shared
  loop, used by its own random-cascade `tryConstruct` and by `RingSeedGenerator`. NB: `analyzeBoard`
  returns *bundled* moves with `revealed`/`flagged` arrays and a `method` (no `action`); `applyMove`
  reads those — switching on `action` made it a silent no-op that produced zero puzzles.

**`src/common/`** — modules required by both runtimes (loaded via plain
`<script>` tag in the browser and `require()` on the server):
- `BoardLogic.js` — cascade, chord, neighbour iteration, the MINE/FLAGGED/
  UNKNOWN/KNOWN state sentinels.

**`src/client/`** — browser frontend, each file a single feature. `index.html`, `style.css`,
`favicon.svg`, `logo.svg` sit at the root; the JS modules are grouped into subfolders (served
transparently — the `<script src>` paths carry the subfolder, e.g. `/core/Main.js`):
- **`core/`** — the live-game runtime (`Main`, `Input`, `BoardRender`, `Animations`, `BoardDecoder`).
- **`ui/`** — cross-cutting UI infra (`Router`, `Auth`, `Overlay`, `Sound`, `Music`, `MobileLayout`,
  `Fullscreen`, `RoundTimer`, `DangerWarning`, `Keybindings`).
- **`views/`** — page/feature views (`Lobby`, `GameRoom`, `Profile`, `Leaderboard`, `Learn`, `Solo`,
  `Territory`, `PuzzlePlay`, `Ranking`, `MatchPanels`).
- **`admin/`** — admin views (`AdminList`, `BotsAdmin`, `PatternsView`, `StartPatternsView`,
  `StartingPositionsView`, `CombinedPuzzlesView`, `PuzzleLab`, `Puzzles`, `DesignView`). `DesignView`
  (`/admin/design`) is a living design reference — renders the full rank ladder (every tier + sub-tier)
  with the live `buildRankBadge` so the insignia can be reviewed without grinding. It also has an
  admin "Set your rank" tool: pick a rating + mode and it emits `admin_set_rating` → the server
  (`isSocketAdmin`-gated) writes the rating via `db.setRating` (no played change) and echoes
  `admin_rating_set`, so you can preview ranks / test the ranked UI at any tier.

(File bullets below use bare names; resolve them under `core/`, `ui/`, `views/`, or `admin/`.)
- `index.html` — entry page: markup only. Every client module is a plain `<script>`
  tag (each becomes a global); they load in dependency order, with `Main.js` last.
- `Main.js` — the client entry / live-game core: the socket connection and all its
  `socket.on(...)` handlers (puzzle / solo / ranked / territory / game / tournament),
  the shared live-game state (`rows`, `cols`, `myState`, `playerCanvas`, the cell-state
  sentinels) the feature modules read as globals, and the top-level DOM/state wiring.
  Loaded last so those globals exist before anything uses them.
  **1v1 duel layout** (neon "arena" battle, redesigned from a set of Figma-style mockups): a 2-player
  racing match (`isDuoRacing()`) gets a side-by-side battle layout while playing — two equal boards
  facing off across a center VS column. The opponent board (`game1`) is sized to match the player
  board (`sizeOpponentCanvases()`) instead of the small sidebar thumbnail; the scoreboard/series
  side-cards are hidden. Each board card is a glowing framed "arena" (`box-shadow` + `border` in that
  side's own colour — cyan-blue `--duel-you`, pink-red `--duel-opp`) with an **identity panel**
  (avatar + name + a pill-bordered rank badge, `buildDuelIdentity`/`fillDuelId`, reusing
  `buildRankBadge`/`tierFor`) and a **progress row** (bar + "N cells left", `setDuelBar` — cell counts
  come straight off `totalSafe`/`safeCount` on each side's live game object). **In-game still shows
  only the rank tier, never the exact rating — including your own** (`fillDuelId` renders
  `tierFor(...).name` with no number; the mockups this redesign is based on originally showed a raw
  number too, but that was explicitly dropped in favor of the badge, keeping the existing "hidden
  info" rule intact). The center `#duel_center` holds a **VS badge** (a rotated square — `::before`
  supplies the "VS" text unrotated, since the element itself is `transform: rotate(45deg)`), a
  **tug-of-war meter** (`.duel-meter-track`, a diamond marker slid via `left: %` toward whoever's
  ahead, plus a "You're ahead"/"X is ahead"/"Tied up" callout) and a "First to 100% wins" pill — all
  driven by `updateDuelMeter(myP, opP)`, called from `updateDuelHud()` in `draw_board` alongside the
  two bars. This meter is a deliberately calmer, different way to show "who's ahead" than the
  **leader-glow border** removed earlier (task history) — both are intentional, not a contradiction to
  reconcile. The center round timer (`#duel_timer`) sits in a bordered badge with a cyan-to-red
  gradient border (`.duel-timer-badge`, gradient via the padding-box/border-box double-background
  trick) and a "RANKED · SPRINT"-style mode line (`.duel-timer-mode`, computed once per match from
  `currentRankedMode` and left alone after — the empty-string check in `updateDuelHud` guards that);
  `#ranked_tag`/`#game_progress_text` are hidden for duo specifically since their info moved into that
  badge. Both `#duel_timer` (`min-width: 5ch`) and `.duel-timer-mode` (`min-width: 140px`, sized for
  the longest real label, "RANKED · TERRITORY") reserve their width even while empty — the mode line
  in particular starts empty and is far wider than the timer digits once populated, so without its own
  reserve the badge (sized to fit its widest child) visibly widens and shifts the whole header the
  instant the first live frame arrives and fills it in. Driven by a `duo` class on `#game_view` (CSS
  `.game-view.duo`, `--duel-you`/`--duel-opp`).
  Active during play, plus the ranked planning/reveal window so you see the opponent the moment you
  join (custom rooms stay normal in planning so their config shows); the opponent's board is painted
  covered (`paintOpponentCovered`) until their first real frame, so both boards show through the join +
  countdown. Both boards are pushed toward the center column so the VS sits exactly between them.
  **Landscape phones** (wide enough — `min-width: 701px` — to clear the portrait breakpoint below, but
  short: `@media (orientation: landscape) and (max-height: 500px) and (min-width: 701px)`, mirrored into
  `body.duel-landscape-mode` by `applyDuelLandscapeClass`, Main.js — see the force-rotate bullet further
  down for why a class instead of the media query directly) get an entirely different **centered-board**
  layout instead of inheriting the desktop one. Went through two versions: the first kept the desktop
  idea of two boards side by side, just resized (own board dominant, opponent's smaller) — playable, but
  felt unnatural to actually play on, since the thing you're interacting with sat off to one side instead
  of dead center. This version centers the board and turns *both* sides into pure info panels instead —
  yours on the left, the opponent's on the right, with a small view-only board preview at the bottom of
  theirs (not a second board to actively track) — Flag/Reveal in their own panel directly under the
  board, and a back button (`#duel_back_btn`, top-left of the left panel) since the header carrying
  `#leave_button` is hidden outright here same as before. Built to match a second provided sketch closely
  (`layout-mobile2.png`, repo root — distinct from `layout-mobile.png`/`layout-desktop.png`, the first
  round's references).
  **The grid**: `.game-grid` becomes `minmax(0,210px) minmax(0,1fr) minmax(0,210px)` columns ×
  `minmax(0,1fr) auto` rows, with `grid-template-areas: "left board right" "left toggle right"` — left
  and right panels span the full height, the board and the Flag/Reveal panel stack in the center column.
  `#duel_center` (the old VS/tug-of-war meter this layout doesn't use at all) is hidden outright rather
  than finding it a spot. Getting three unrelated elements — the info panel, the board, and the toggle
  buttons, previously three levels deep inside one `#player_div` card — to each land in their own grid
  area **without moving anything in the DOM** uses `display: contents` cascaded through `.game-left` AND
  `#player_div` (both flatten to nothing box-wise, promoting their children — `.duel-header-row`,
  `.board-wrap`, `.duel-mode-toggle` — up to be direct grid items); `grid-area` assigned to each
  individually. `display: contents` only removes an element from the box tree, not the DOM tree, so
  descendant selectors through it still match fine if ever needed. The opponent's side doesn't need the
  same depth — `.opponent_div` itself becomes the right panel directly (its board preview stays nested
  normally inside it, since it doesn't need to escape anywhere), so only `.game-side`/`#all_opponents_div`
  flatten, one level less than the player's side.
  **Both info panels** (`.duel-header-row` for "you", `.opponent_div` for the opponent — different
  elements, identical styling rules applied to both) carry the neon "arena" card look the two boards used
  to wear themselves (border/glow in the side's own colour) — there's only one board left to wear it now
  (`.board-wrap`, styled directly since `.player-board`, which used to carry it, is flattened away).
  Identity is a **vertical, centered stack** — avatar on top (50px, circular, ringed in the side's own
  colour — up from the horizontal avatar-beside-text row every earlier version of this layout, and every
  other context this component appears in, used), name, then the tier pill below. **No more "un-mirror
  the opponent" question** from the previous version — both sides just center, so there's no left/right
  asymmetry to reconcile between them any more. Progress (`.duel-bar-corner`, pct + bar + "N cells left")
  sits below identity — more width to work with in a dedicated side panel than the old compact top-right
  corner readout it used to be. Started as a bordered/backgrounded card like the timer box below it, but
  the border/background were dropped on request (`border`/`background` removed from the
  `body.duel-landscape-mode .game-view.duo .duel-bar-corner` rule) — the surrounding panel already reads
  as a card of its own (its own border/glow), so a second nested box just for the stats felt redundant;
  it reads fine sitting directly on the panel background instead, `padding` alone still keeps it clear
  of the avatar above and the timer box below. The round timer relocates into the left panel too
  (`#duel_timer_landscape_box`, physically moved in `index.html` from inside `#duel_center` to inside
  `.duel-header-row` — still mirrored by `updateRoundTimer`/`updateDuelHud` exactly as before, just a new
  home; both `.duel-timer-landscape-box` and `.duel-timer-landscape` need their own `display` override
  here since their base rules default to `display: none` — missing the second one was a real bug caught
  by checking the *element's* computed style, not just eyeballing the screenshot, since the icon next to
  it still rendered fine on its own and made the empty box easy to miss at a glance).
  **Gotcha, cost real debugging time**: `#duel_id_opp`'s own base rule (`.game-view.duo #duel_id_opp {
  flex-direction: row-reverse; text-align: right; }` — desktop's mirror treatment) carries an ID
  selector, which beats a plain-class override on specificity regardless of source order. Three separate
  properties needed their own `#duel_id_opp`-qualified override here (`.duel-id`'s `flex-direction`,
  `.duel-id-tier-pill`'s `flex-direction`, `.duel-id-info`'s `align-items`) for the opponent to actually
  end up vertical/centered instead of silently keeping its old horizontal desktop layout underneath the
  new panel styling.
  **A second real bug, caught only by explicitly re-checking desktop after implementing**: two brand new
  elements this version introduces — `.duel-back-btn` and `.duel-opp-board-label` — had no base
  `display: none` rule anywhere (every other landscape-only element in this whole layout has one), so
  they rendered on desktop (and everywhere else) by default the instant they existed in the DOM, not just
  in landscape. Fixed by adding the missing base-hidden rules alongside the rest.
  **A third, same-shaped bug**: `.duel-header-row` also matches the OPPONENT's own `.duel-header-row` —
  a different element, same class, nested inside `.opponent_div` wrapping `#duel_id_opp` + its progress
  corner — so the "give this the neon arena card look" rule (border/background/glow, meant for the left
  panel) styled it too, as a second, redundant blue (`--duel-you`, its default) card nested inside the
  already-bordered (red/`--duel-opp`) right panel. Fixed with a follow-up rule scoped to
  `.opponent_div .duel-header-row` specifically, resetting it back to a plain invisible wrapper —
  `.opponent_div` itself is already the card there.
  **Reveal/Flag** (`.duel-mode-toggle`) is nested inside `.board-wrap` now (moved there in `index.html`,
  a real DOM move, not just a CSS reposition) — part of the board's own card instead of a separate panel
  below it (tried in the version right before this one) or pinned over its corner (the version before
  that). `flex: 0 0 auto` keeps it from participating in `.board-scroll`'s `flex: 1` growth as a sibling
  flex child of `.board-wrap`; no border/background of its own any more either, since it's already inside
  the same bordered card as the board — a second nested border there would be the same "two boxes"
  mistake as the previous bullet, just for buttons instead of an info panel. DOM order is still Reveal
  then Flag (matches the sketch — was Flag then Reveal in the very first version); both still just flip
  the same shared `flagMode` state everything else does (`updateFlagModeButton`, Main.js).
  **`fitDesktopCellPx`** (`MobileLayout.js`) floors at 56px here now (was 40, before that 30, before that
  the shared `DESKTOP_CELL_MIN` 22px) — still gated on `isDuoRacing()` + `body.duel-landscape-mode` (via
  the `isDuelLandscapeMobile()` helper) — bumped repeatedly after "very hard to click correctly" feedback;
  pinch-zoom is there for zooming back OUT to an overview, tapping cells accurately at the default size
  matters more than fitting the whole board in
  untouched. `.board-scroll` still gets the `flex:1; min-height:0; overflow:auto` chain (only the board
  pans internally, not the page — `.game-view.duo` stays pinned to `height:100dvh; overflow:hidden`),
  scrollbar hidden, and `#game0`'s `touch-action: manipulation` (pan + native pinch-zoom, minus
  double-tap-zoom, which would fight tap-to-reveal) — all unchanged from before, still needed for the
  same reasons. The opponent canvas fix also carries over unchanged: `width`/`height: auto !important`
  (inline styles otherwise always beat a stylesheet) so `max-width`/`max-height` can't independently
  stretch cells off-square, same aspect-ratio-preserving resolution as an `<img>`.
  **The Gold board skin's vignette** (`body[data-board-skin="gold"] .board-scroll::after`, a
  `position: absolute; inset: 0` radial-gradient) still doesn't scroll *with* the board's content, same
  bug/fix as before — disabled specifically where `.board-scroll` is actually scrollable (here and
  portrait mobile), left alone on desktop.
  **Opponent stats box was width-starved, fixed**: `.duel-bar-corner-track`'s `flex: 1` should fill the
  stats card, but the opponent's copy stayed pinned near its label's own width. Cause: the *shared*
  `.duel-header-row, .opponent_div { display: flex; flex-direction: column; align-items: center; }` rule
  matches the opponent's nested `.duel-header-row` (see the "second real bug" above) too, and `align-items:
  center` on its parent (`.opponent_div`) shrink-wraps a child with no explicit width to its own content's
  width instead of stretching it — so `.duel-bar-corner { width: 100% }` computed against that narrow
  shrink-wrapped wrapper, not the full 210px panel. Fixed by adding `width: 100%` to the
  `.opponent_div .duel-header-row` neutralizing override alongside its border/background reset. Once that
  wrapper actually spans the panel, the old `max-width: 130px` cap on `.duel-bar-corner-track` (a leftover
  from a narrower previous layout) was also removed — both sides' tracks now size purely off `flex: 1`
  and match exactly.
  **Opponent avatar sat higher than the player's, fixed**: `#duel_id_you` carries `margin-top: 1.6rem` to
  clear the back button; `#duel_id_opp` had `margin-top: 0`, so despite both panels having identical
  padding, the opponent's avatar rendered ~26px closer to the panel's top edge — asymmetric even though
  only the left panel actually has a back button reserving that space. Fixed by giving `#duel_id_opp` the
  same `margin-top: 1.6rem`, so both avatars now start at an identical distance from their panel's top
  regardless of which side has the button.
  **Cells were still hard to tap despite the 40px floor, actual fix**: `fitDesktopCellPx`'s landscape-duel
  floor (see below) only controls the *backing* cell size the JS computes — `sizePlayerCanvas`'s non-mobile
  branch (taken whenever `mobileLayout`, the `max-width: 700px` boolean, is false — true for this layout,
  since it's specifically gated to `min-width: 701px` in `applyDuelLandscapeClass`) sets `canvas.style.
  maxWidth = "100%"`, which silently scales the rendered canvas straight back down to fit `.board-scroll`'s
  container width regardless of what cell size the JS floor asked for. So the floor bump to 40 never
  actually changed anything on screen — the effective on-screen cell size was still just container-width /
  cols (~17px at 844×390), the exact thing the "hard to click" feedback was about. Fixed with a new
  `isDuelLandscapeMobile()` helper (`isDuoRacing()` + `body.duel-landscape-mode`) that now also routes
  `sizePlayerCanvas` through the *mobile* branch (fixed pixel `width`/`height`, `maxWidth: none`, the
  whole-cell-centered `.board-scroll` width calc) even though `mobileLayout` itself stays false here — this
  is exactly the fixed-size-plus-native-pan treatment `.board-scroll`'s `overflow: auto` was already
  written for, just never actually reachable before. With real headroom to scroll now available, also
  bumped the floor itself again, 40 -> 56px. `snapBoardScroll`/`mobileNavigate`/the find-next-frontier arrow
  stay gated on the real `mobileLayout` flag (unchanged) — panning here is native browser touch-scroll, no
  whole-cell snap-back or frontier-hunting aid, since only the sizing branch was in scope this round.
  **Side panels shrunk to maximize board space**: `.game-grid`'s side columns went 210px -> 158px (avatar
  64px -> 50px, name/pct/rank-badge font sizes and card paddings/gaps trimmed to match, `.duel-id-name`
  gained `overflow: hidden; text-overflow: ellipsis` since a slimmer panel clips long names sooner) — more
  of the fixed-width 844×390-ish viewport goes to `minmax(0, 1fr)`'s board column instead of the two info
  panels, letting more of the (now bigger, see below) cells fit on screen without panning as far. Purely a
  width/sizing pass — no structural changes, so none of the gotchas above needed touching again.
  **Countdown didn't work while the board was panned, fixed (mobile only)**: `countdownDigitCycle`
  (`Overlay.js`) spells its number out of covered CELLS spread across the whole board grid (`Animations.js`)
  — fine when the whole board is always in view (desktop), broken here once the board legitimately zooms in
  and pans (the cell-floor fix above), since the glyph can land anywhere on the (now larger-than-viewport)
  canvas, including entirely scrolled off-screen. Fixed with a mobile-only counterpart,
  `mobileCountdownDigitCycle`, gated on the same `isDuelLandscapeMobile()` helper `MobileLayout.js` already
  exports: instead of painting into board cells, it just drives `#board_overlay`'s existing count/go text
  styles (`.board-overlay-count`/`.board-overlay-go` in style.css — previously dead CSS, written for an even
  earlier countdown implementation and never wired back up until now). `#board_overlay` is a sibling of
  `#board_scroll` inside `.board-wrap` (`position: relative`), absolutely `inset: 0` over the whole card —
  NOT inside the scrollable canvas — so it's pinned to the same spot on screen no matter how far the board
  is panned, works at any zoom/scroll position by construction. `countDown` branches on `mobileDuel` once,
  up front, calling `mobileCountdownDigitCycle` instead of `countdownDigitCycle` and showing `"GO"` in the
  same overlay (auto-hides after 550ms) instead of relying on the (still-unchanged, still-running for its
  sound/decorative sweep) `startBoardGoAnimation`. Elsewhere (desktop, solo, territory, the 6-player
  layout) `mobileDuel` is always false, so this is strictly additive — the canvas glyph path is completely
  untouched or reachable.
  **Opponent panel clipped by a notch/curved corner on real devices, fixed**: reported as "the opponent's
  panel goes a bit off-screen to the right" — didn't reproduce as an actual layout overflow in a plain
  browser at any realistic landscape width (`window.innerWidth`/`document.body.scrollWidth` always matched
  exactly, checked 701px through 1024px), which pointed at a real-device-only cause instead: a landscape
  PHONE (this layout is JS-gated to one) commonly has a notch/Dynamic Island or curved display corners on
  its left/right edges in this orientation, and the grid's flat `1.5rem` side padding
  (`body.ranked-game .game-grid`) reserves no extra room for that — so on a device that reports a real
  inset, content can render partly behind the curved bezel/notch, invisible despite being completely
  "on-screen" by every DOM measurement. Fixed by adding `env(safe-area-inset-left/right, 0px)` on top of
  the existing `1.5rem` baseline directly on `body.duel-landscape-mode .game-view.duo .game-grid`
  (specificity already beats the ranked-game shorthand, so this is the actual left/right padding used
  here regardless of that class). No-op (`env()` falls back to `0px`) on any device/browser that doesn't
  report an inset, so desktop and non-notched phones render pixel-identical to before — same reasoning as
  the existing `env(safe-area-inset-bottom)` use for the portrait mobile action bar, just extended to the
  two side edges here since a notch can land on either one depending on which way the phone was rotated.
  **Panning only worked from a drag that started exactly on the canvas, fixed (mobile only)**:
  `#board_scroll`'s native `overflow: auto` pan (the cell-zoom fix above) only ever engages for a touch
  that starts inside the scrollable element itself — easy to miss with a thumb on a short, cramped
  landscape screen where the canvas shares the viewport with two side panels, and a swipe starting just
  off it did nothing. `MobileLayout.js` now also wires `touchstart`/`touchmove`/`touchend` on `#game_view`
  itself, gated on `isDuelLandscapeMobile()`, that manually drives `boardScroll.scrollLeft`/`scrollTop`
  by the drag delta for any touch that starts OUTSIDE `#board_scroll` (`duelPan` state, `DUEL_PAN_TOLERANCE`
  10px). Touches starting ON the canvas are left completely alone — `boardScroll.contains(e.target)` bails
  out at `touchstart`, so the existing native scroll and Main.js's own tap/long-press-to-flag handling for
  the canvas are untouched, no double-handling of the same gesture. Below the 10px tolerance nothing is
  intercepted (no `preventDefault`), so a plain tap on Reveal/Flag/back/find-next still fires its normal
  click — the same "don't commit until real movement" idea `TOUCH_MOVE_TOLERANCE` already uses for the
  canvas's own tap-vs-pan distinction, just at the game-view level instead. No whole-cell snap here (that's
  still gated on the real `mobileLayout` flag, which stays false in this layout, same as before) — this is
  plain 1:1 drag panning, nothing more.
  **Manual fullscreen entry point, next to the back button**: `enterDuelMobileFullscreen` (Fullscreen.js)
  already auto-attempts fullscreen the instant a duel match starts, but that can silently fail (blocked,
  unsupported, or the gesture just didn't count on that browser) — and the header's own `#fullscreen_btn`
  toggle is no help here since `.game-header` itself is hidden outright in this layout. `#duel_fullscreen_btn`
  (`index.html`, right next to `#duel_back_btn`, same 28px square styling one slot over) gives mobile
  players a manual way back in. Unlike the header button it only ever calls `enterGameFullscreen(true)` —
  never toggles/exits — and hides itself outright once `body.game-fullscreen` is set (style.css) rather
  than swapping to a compress icon, since the back button already covers "get me out of here". Also
  respects `body.no-fullscreen-support` (same class the header button already sets itself when the API
  isn't there to call at all, e.g. iOS Safari) — hidden by default everywhere else like every other
  landscape-only element in this layout (`.duel-fullscreen-btn { display: none; }`, base rules).
  **Post-game result modal needed a scroll to reach its own buttons, fixed**: `.board-overlay-panel`
  (the fixed, screen-centered ranked-result modal — MatchPanels.js's `showRankedResult`) already had an
  `overflow-y: auto`/`max-height: 90vh` scroll fallback for short viewports, but at this layout's actual
  ~390px height the full 1v1 content (hero + rating card + opponent line + times chips + Play
  another/Leave) didn't fit under that even with the fallback — the buttons themselves sat below the
  fold, unreachable without scrolling. Rather than lean on the scroll, a `body.duel-landscape-mode`
  block right after the duel's own CSS (not nested under `.game-view.duo` like the rest of that
  section — the modal is a fixed-position overlay outside the grid, `body.duel-landscape-mode` alone is
  the right gate, and it's already only ever true while `.duo` is active) shrinks every padding/gap/font
  size in the hero, rating card, and opponent/times context, plus `.result-actions .btn`'s own padding —
  nothing removed, just proportionally smaller, verified against actual `scrollHeight` vs `clientHeight`
  (295px of content in a 390px-tall viewport, comfortably no scroll needed) rather than eyeballing it.
  Only the 1v1 (`.ranked-result`) shape needed handling — the 6-player standings-list variant never
  shows here, this layout is duo-only. Desktop and portrait mobile (which have real vertical headroom)
  are untouched, same reasoning as every other `body.duel-landscape-mode`-gated rule in this file.
  **Whole-board overview during the countdown, zooming into the opening cascade at GO**: the 56px-floor
  zoom (above) is great for tapping accurately mid-round, but useless for getting your bearings before
  the round even starts — nothing's clickable yet, so `fitDesktopCellPx` (`MobileLayout.js`) now only
  applies that floor once `roundStartTime > 0` (stamped the instant GO fires, `countDown`'s onDone,
  Overlay.js). Before that it floors at `1` instead — effectively no floor, just whatever cell size
  fits the WHOLE board on screen — so the player can size up what they're about to solve during the
  countdown. `localRoundStartReveal` (Main.js — the shared onDone for every racing mode, fires the
  guaranteed opening cascade from the board's exact center, `Math.floor(rows/2), Math.floor(cols/2)`,
  the same cell every player's board shares) now also calls `sizePlayerCanvas()` right before its own
  `renderPlayerBoard()`, gated on `isDuelLandscapeMobile()` — draws the reveal at the FINAL (zoomed)
  backing resolution once, so nothing needs to be redrawn again as the zoom below plays out.
  **Animated, not instant** — a first version just snapped straight to the new size/scroll position, but
  that read as an abrupt cut, not "zooming in on where you're starting." `animateDuelZoomIn(centerR,
  centerC, fromCellPx)` (`MobileLayout.js`, called right after `sizePlayerCanvas()`) is a plain
  `requestAnimationFrame` loop, ~450ms, ease-out cubic: each frame recomputes an interpolated `cellPx`
  between the overview size and the final one, writes it straight to `playerCanvas.style.width/height`
  (CSS display size only — the backing resolution/raster was already fixed by the one `sizePlayerCanvas`
  call above, so this never re-renders, just rescales the existing frame each tick, cheap), and
  re-centers `#board_scroll`'s `scrollLeft`/`scrollTop` on `(centerR, centerC)` at that frame's cell
  size (same math as `scrollToCell`, just re-run every tick against the moving cell size instead of
  once) — clamps harmlessly to the scroll range's own bounds early on, when the board's still too small
  to overflow at all. `fromCellPx` has to be captured BEFORE `sizePlayerCanvas()` runs (it overwrites
  `playerCanvas.style.width` with the final value) — the animation's own first frame immediately
  overrides it back down to the start size before the browser's next paint, so there's no flash of the
  final huge size first. `queueRevealAnimations`/`cellAnims` only ever store `(r,c)` + a start timestamp
  (not pixel coordinates), and every repaint recomputes cell position from the CURRENT cell size —
  confirmed safe to resize (and, now, animate the size of) mid-reveal-animation.
  **The zoom-in target isn't always the true center, either**: the opening cascade always originates
  from the board's exact center (a game rule — every player's board shares the same opening, computed
  from `Math.floor(rows/2), Math.floor(cols/2)`) but by the time a big cascade finishes flooding
  outward, that center cell is usually deep inside the newly-revealed blob — all-clear, nothing left to
  click, a boring first thing to see. `pickZoomTarget(state, centerR, centerC, viewCols, viewRows)`
  (`MobileLayout.js`, called from `localRoundStartReveal` right after `sizePlayerCanvas()` — needs the
  FINAL zoomed cell size to convert `#board_scroll`'s pixel dimensions into a cell-count viewport
  footprint first) scans the reveal's own boundary (a `KNOWN` cell touching at least one still-`UNKNOWN`
  neighbor — interior cells are skipped outright, their neighborhood is nearly always all-revealed
  regardless of window size) for whichever boundary cell's own immediate viewport-sized neighborhood
  comes closest to an even 50/50 split of revealed vs covered — some clues already up to read, some
  cells right there to act on. Falls back to the true center only in the degenerate case where nothing
  qualifies as a boundary at all (the cascade cleared the entire board); a small distance-to-center term
  in the score breaks near-ties toward the more central candidate, purely for predictability when
  several spots score about the same. Verified against a deliberately large all-clear blob (the "boring
  center" case reproduced on purpose): the true center scored a 100%-revealed window, `pickZoomTarget`
  landed on a boundary cell scoring 62.5% instead — and against a realistically-sized small opening,
  landed right at its own edge, same as expected. `centerR`/`centerC` themselves are untouched — they
  still drive the actual cascade origin (`BoardLogic.cascadeReveal`) and every opponent's identical
  reveal (`startOpponentRevealAnim`'s `targets`); only the local camera's landing spot (`zoomR`/`zoomC`
  in `localRoundStartReveal`) is redirected.
  **Slowed down on request**: `animateDuelZoomTo`'s (renamed from `animateDuelZoomIn` — see the manual
  zoom toggle below, it's no longer only ever zooming IN) `DURATION_MS` went 450 → 900. This is the one
  moment (GO, or the manual zoom toggle) meant to be watched rather than reacted to instantly, unlike
  every other animation in this layout — worth the extra time specifically here.
  **Manual pinch-style zoom toggle, double-tap/double-click**: `duelZoomedOut` (`MobileLayout.js`) is a
  standalone boolean `fitDesktopCellPx` now also checks (alongside `roundLive`) when deciding whether to
  apply the 56px floor — lets a player zoom back OUT to the whole-board overview mid-round to get their
  bearings, then back IN, reusing the exact same two cell sizes and the exact same `animateDuelZoomTo`
  the GO transition uses, just triggered on demand instead of automatically. `zoomDuelOut()` anchors the
  zoom-out on whatever's currently centered in the viewport (read back from `#board_scroll`'s own
  scroll position) so it feels anchored on "here" rather than jumping to recenter on something else;
  `zoomDuelIn(targetR, targetC)` takes an explicit target — wherever the player just tapped/clicked.
  Both call `sizePlayerCanvas()` (which re-reads `duelZoomedOut` through `fitDesktopCellPx`) before
  `animateDuelZoomTo`, same "final state first, then animate the display size backwards from where it
  was" pattern the GO transition established. Reset to `false` at the start of every round
  (`localRoundStartReveal`, Main.js) so a round never inherits the previous one's zoom state.
  **Gesture wiring, Main.js**: while zoomed IN, a double-tap/double-click (`duelIsDoubleTap` — tracks the
  last tap's time+position, no artificial delay-before-acting on the FIRST tap of a pair, so ordinary
  single-tap reveals stay exactly as responsive as before; the SECOND tap of a genuine pair triggers the
  zoom out ADDITIONALLY, entirely after its own normal reveal/flag action has already fired) zooms out.
  While zoomed OUT, cells are too small to tap precisely enough for a real reveal/flag attempt at all —
  so ANY tap/click there is read as "zoom in HERE" instead (`cellFromClient` under the tap → `zoomDuelIn`),
  and the long-press-to-flag timer isn't even started in that state (`touchstart`, Main.js) so it can't
  race the zoom. Mouse gets the equivalent via `playerCanvas.ondblclick` (native, reliable for a real
  mouse unlike touch, where a synthetic `dblclick` isn't guaranteed and `touch-action: manipulation`
  deliberately suppresses the BROWSER's own native double-tap-zoom already — see the board-scroll
  gotcha bullet — so this is a from-scratch custom gesture, not built on top of that) and a `duelZoomedOut`
  check inside the existing `onclick`.
  **The "jump to another unsolved area" button's pan (below) is smooth too, with no extra code needed**:
  `scrollToCell(r, c, true)` (`MobileLayout.js`, already existed) passes `behavior: "smooth"` to the
  native `Element.scrollTo` — the browser already animates that on its own, verified by sampling
  `scrollLeft`/`scrollTop` across several `requestAnimationFrame` ticks after a click and seeing it ease
  toward the target over ~250ms rather than jump.
  **Bug found along the way, not introduced by this feature but only ever visible once the overview
  needed a real number instead of a floor to hide behind**: `fitDesktopCellPx`'s generic width/height
  measurement doesn't fit this layout at all — `.game-left` is `display: contents` here (grid-area
  flattening, above), so its `clientWidth` is always exactly 0, silently falling back to the
  `cols * PLAYER_CELL` guess every single time; the height formula (`window.innerHeight - canvas top -
  24`) has no idea the Reveal/Flag/find-next row shares `.board-wrap`'s column below the canvas, so it
  overshoots by that row's real height. Both errors happened to not matter before — the 56px floor
  always won regardless of what the (wrong) natural-fit number came out to — but surfaced as a
  doesn't-quite-fit overview the moment that floor stopped applying. Fixed with a duel-landscape-only
  measurement branch: `.board-wrap` itself is a real, un-flattened box (`grid-area: board`), and
  `#board_scroll`'s `clientHeight` already reflects everything else in its flex column correctly
  (ordinary flex layout, button row included) — read the width off `.board-wrap` and the height off
  `#board_scroll` directly instead. Width can't come from `#board_scroll` itself the same way: its
  pannable-board branch (above) explicitly narrows `#board_scroll`'s own `style.width` to fit the LAST
  computed cell size, so reading it back here would be circular, always chasing the previous value.
  **"Jump to prev/next unsolved area" buttons**: `#duel_find_prev_btn`/`#duel_find_next_btn`
  (index.html, flanking Reveal/Flag on either side — prev first, then Reveal, Flag, next, in DOM order,
  which is also visual order since `.duel-mode-toggle` is a plain flex row with no `order` overrides —
  icon-only/`flex: 0 0 auto` so they don't steal Reveal/Flag's width) revive `mobileNavigate`
  (`MobileLayout.js`) — written for a `‹ / ›` nav button pair that never actually got built, so this was
  dead code with no callers until now. Its guard (`!mobileLayout` → now `!boardIsPannable()`, a shared
  `mobileLayout || isDuelLandscapeMobile()` helper also used by `sizePlayerCanvas`'s own branch
  condition) is what made it reachable from here at all. **Originally shipped as a single button**
  trailing after Flag (always `dir=1`, no "previous" to pair it with) — split into this `‹`/`›` pair on
  request, each just calling `mobileNavigate(-1)`/`mobileNavigate(1)` (no change needed in
  `mobileNavigate` itself, it already took a direction), **then moved to flank Reveal/Flag** rather than
  both trailing after them, again on request — purely a DOM reorder in index.html, `getElementById`
  wiring in Main.js doesn't care about position. The existing auto-appearing hint arrow
  (`#find_next_arrow`/`updateMobileFindNextHint`) stays `mobileLayout`-only, untouched — a deliberately
  separate feature from these on-demand buttons.
  **Cell-by-cell stepping wasn't good enough, reworked into area-cycling**: the original revived version
  stepped through `getSortedFrontierCells`'s flat, circularly-sorted list of individual UNKNOWN cells one
  at a time — which mostly just nudged the view to the cell right next door, barely reading as "somewhere
  else," especially via the fallback path (cursor not currently on a frontier cell finds the NEAREST cell
  and steps to its immediate neighbour in the sorted list). Replaced with `frontierCells()` +
  `getFrontierClusters()`: the former is the same frontier scan; the latter flood-fills those cells into
  8-adjacency connected components ("areas") and picks each one's landing cell as the member closest to
  the cluster's own centroid. `mobileNavigate` cycles between these AREAS (same circular-sweep-by-angle-
  from-the-board's-centroid sort as before, just one entry per cluster instead of per cell) instead of
  individual cells — "somewhere else, not the cell next to you" falls out because two distinct clusters
  are never adjacent to each other by construction (there's always at least one revealed cell separating
  them) — stepping to the next cluster in sweep order is a guaranteed jump to a materially different part
  of the board, not a neighbor. Verified with a synthetic board: two well-separated frontier rings
  alternate cleanly on successive presses instead of drifting locally.
  **A mine-aware version of this shipped first, then had to be reverted — real cheat vector, not just an
  unnecessary convenience**: `frontierCells()` briefly excluded any cell `boardCell(r,c) === MINE`
  (BoardDecoder.js) reports as a mine, on the reasoning that landing on/highlighting an obviously-a-mine
  cell wasn't useful — the button's job is finding somewhere to dig, not surfacing a mine. But the client
  fully decodes the WHOLE board's true mine layout locally the whole time (needed for its own optimistic-
  reveal prediction, Input.js) — filtering by it here leaked that ground truth straight through the UI: a
  cell the button always skipped, or the specific cell it highlighted (`redrawOwnBoardWithFocus`'s focus
  ring) within an otherwise uniform-looking frontier, was directly readable as "the client knows this one
  isn't a mine." Fixed by making `frontierCells()`/`getFrontierClusters()` reason ONLY about what the
  PLAYER themselves already knows (`myState` — their own revealed/flagged state; flagged cells are
  already excluded for free, `isFrontierCell` only considers `UNKNOWN` ones) and never consult
  `boardCell`/the decoder at all. Verified by re-running the same "all-mine frontier ring around a
  revealed cell" case that the mine-aware version deliberately hid (produced zero clusters there): the
  fixed version now happily forms a cluster and lands on a mine cell directly (`boardCell(...) === MINE`
  true at the landing spot) — and, across 50 trials with a single mine placed at a different random
  position inside the same ring each time, the chosen representative cell never changed, confirming the
  choice is purely geometric (centroid-nearest) and carries no information about where the mine actually
  is.
  **Experiment: your own progress, front and center above the board**: `#duel_top_progress` (index.html,
  first child of `.board-wrap`, before `#board_scroll`) puts a second copy of the "you" progress bar
  right above the board you're actually looking at while playing, instead of only in the side panel's
  `.duel-bar-corner` off to the left — the goal being to make progress feel more immediately satisfying
  to watch land, not just a number to glance at. Mirrored by `setDuelBar`'s existing `"duel_bar_you"`
  branch (Main.js) — one extra `if (barId === "duel_bar_you") updateDuelTopProgress(pct, cellsLeft);`
  line, no new data plumbing. `flex: 0 0 auto` inside `.board-wrap`'s flex column, same as
  `.duel-mode-toggle` below the board — `#board_scroll`'s own `clientHeight` (the duel-landscape
  `fitDesktopCellPx` measurement fix, above) automatically accounts for the extra row's height when
  fitting the board, no manual adjustment needed anywhere.
  **The actual "reward" part**: `updateDuelTopProgress`/`bumpDuelTopProgress` (Main.js) fire a pulse +
  pop combo every time `cellsLeft` actually drops (`lastDuelTopProgressLeft`, reset at the start of every
  round in `setCoveredBoard` so a new round's first frame can't read as a bogus gain against the last
  one's leftover number) — a slower springier fill transition than the corner bar's plain `0.3s ease`
  (`cubic-bezier(0.22, 1, 0.36, 1)`, `0.5s`), a brief glow (`.duel-top-progress-pulse`, restarted from
  scratch via a forced reflow — `void fill.offsetWidth` — so a fast chord streak doesn't have to wait
  out a still-running pulse before showing the next one), and a one-shot `+N` callout spawned at the
  fill's current leading edge that floats up and fades (`.duel-top-progress-pop`, removed on its own
  `animationend`). A chord that clears several cells in one server frame reads as one `+N`, not N silent
  ticks — `draw_board` frames are already coalesced to whatever the server just broadcast, so batching
  falls out for free rather than needing its own logic. Verified a simulated +12 gain: pop text `"+12"`,
  the pulse class present on the fill, then both gone again after the animation's own duration with no
  manual cleanup needed. Desktop is untouched (`.duel-top-progress`'s base rule is `display: none`, same
  pattern as every other landscape-only element here).
  **Known gap, not fixed by this version**: `body.duel-force-rotate` (see its own bullet below) only ever
  applies on a phone-sized viewport that's still portrait-*width* — the CSS rotation trick changes how
  the content renders, not the actual width a media query measures — which means the portrait
  `@media (max-width: 700px)` block's own rules (the `#mobile_duel_progress` strip, `.mobile-action-bar`,
  hiding `.game-side` outright) still match at the same time as this layout's, and fight it. Explicit
  higher-specificity overrides for the worst of these (hide the portrait strip/action-bar, force
  `.game-side` back to `display: contents`) live right after the `body.duel-force-rotate #game_view`
  rotation rule. **Not fixed**: the board's own cell-sizing algorithm (`fitDesktopCellPx` vs
  `fitMobileCellPx`, chosen by the `mobileLayout` boolean off that same width media query) doesn't know
  about force-rotate either, so a force-rotated board still sizes/paginates using the portrait touch-pan
  logic instead of this layout's own approach — a JS-side fix, not just more CSS, left for later.
  **6-player battle layout** (`isMultiRacing()`, 3-6 racing players): the same TetrisFriends idea
  scaled up — one big own board on the left with your identity panel (`#duel_id_you`) above it, the
  round timer centered up top (shared `#duel_timer`), and **every** opponent's live board tiled in a
  two-column grid on the right (the existing `game1`-`game5` slots), each card showing the player's
  name + live `%` (`playerLabel`) and a finished/done treatment once they clear (`updateMultiHud`).
  Driven by a `multi` class on `#game_view` (CSS `.game-view.multi`); toggled alongside `duo` in `applyDuoClass`.
  Unlike the duel, opponent canvases keep their small `OPP_CELL` render resolution and are scaled to
  the grid cell by CSS (`width:100%`), so `sizeOpponentCanvases` needs no special case. The fullscreen
  re-center rule excludes `.multi` (like `.duo`) so it keeps its own two-column grid. Tournaments
  (larger lobbies) stay on the scoreboard layout with top-2 opponent thumbnails.
  **Gotcha**: `applyDuoClass` re-measures/resizes opponent canvases a frame later via `requestAnimationFrame`
  (the `.duo`/`.multi` class needs a frame to actually affect layout before `clientWidth` reads correctly —
  see its comment). Reassigning a canvas's `width`/`height` attribute always clears it (`sizeBoardCanvas`),
  so if that deferred pass computes a different cell size than the first, synchronous one, it silently blanks
  the canvas — any repaint gap there shows as an opponent board flashing black during matchmaking/countdown.
  That rAF callback repaints via `paintOpponentCovered()` when `pendingLocalRoundReveal` is still true (i.e.
  still in the pre-reveal window) specifically to close this gap — don't drop that call when touching this code.
  The site footer is hidden whenever a game is on screen via a `body.in-game` class (added by the
  game entry points, removed in `hideAllViews`).
- **Mobile in-game (portrait phones)**: `.opponents` and the desktop `.duel-bar`/`#duel_id_you` panel
  are all hidden below the `max-width: 700px` breakpoint (no room) — past that width, phones wide
  enough to be in landscape get their own dedicated layout instead (see the 1v1 duel layout bullet
  above), not just the desktop layout inherited as-is. Two things fill the portrait gap: a
  **rotate-to-landscape nudge** (`#rotate_prompt`, CSS-only
  `@media (max-width: 900px) and (orientation: portrait)`, shown only while `body.in-game` — not a true
  OS orientation lock, which is unreliable outside fullscreen across browsers, so a "Continue anyway"
  button (`#rotate_prompt_dismiss`) adds a `.dismissed` class rather than trapping anyone whose device
  won't rotate; `resetGameUI` clears that class so the nudge reappears for the next game/search) for
  solo/puzzle/6-player, and a **compact 1v1 progress strip** (`#mobile_duel_progress`, duo only —
  `updateDuelHud` mirrors the same you/opponent progress numbers into it via `setMobileDuelBar`, with
  the opponent's name read straight from `#player_name1`) so a portrait player isn't racing with zero
  indication of whether they're winning until the round ends. **The 1v1 duel specifically doesn't use
  the rotate nudge at all** — see "Forcing landscape for the 1v1 duel" below; it renders the real
  landscape layout regardless of physical orientation instead of asking the player to turn the phone.
- `AdminList.js` — shared helpers for the paginated admin views: `renderPager` and the
  `applyQueryString` URL-filter-state write (All Puzzles / Bots / Patterns / Starting positions).
- `style.css` — all styles.
- **Routing** — clean History-API paths, no `#`. `Router.js`'s `navigate(path)` does `pushState` +
  `applyRouteFromHash()` (name kept for history; it now reads `location.pathname`); `popstate` handles
  back/forward; and a delegated document click handler turns same-origin `<a href="/…">` clicks into
  client-side navigations (so links just need a path href — `/auth/…`, external, hash, download, and
  new-tab links are left alone). Programmatic nav uses `navigate("/…")`. Filter views read state from
  `location.search` and `replaceState` it back. **Server SPA fallback:** any path with no on-disk
  **file** AND no file extension serves `index.html` (so `/learn`, `/privacy`, `/admin/bots` deep-link
  directly); paths with an extension still 404. NB `resolveStatic` only matches regular files, so a
  route that collides with a client subfolder (`/admin`, `/core`, `/ui`, `/views`) falls through to
  the SPA fallback instead of trying to serve the directory (which 500'd). The OAuth callback still returns the session token in a `#token=`
  fragment (orthogonal to routing — `Auth.js` strips it on load).
- **Legal pages** — Privacy Policy / Terms of Service render as ordinary in-app SPA views
  (`#privacy_view` / `#terms_view` in `index.html`, the `.legal` block from `style.css`), so the
  navbar stays like every other page. Routes `/privacy` and `/terms` (`showPrivacyView` /
  `showTermsView` in `Router.js`) are handled at the TOP of `applyRouteFromHash`, before the
  name-entry gate, so they're public (a signed-out OAuth reviewer can read them), and deep-link directly
  via the SPA fallback. Linked from the home page's `.site-footer`. `logo.svg` is the square brand tile
  (same design as `favicon.svg`); `logo-512.png` (repo root) is its rasterised 512×512
  PNG for upload as the OAuth consent-screen app logo.
- `BoardRender.js` — canvas paint + palette + animation timings + DPR.
- **Board skins** (the foundation for texture packs) — **per-player**: each board renders in its owner's
  skin (yours in yours, opponents in theirs, bots in the default). `BOARD_SKINS`/`BOARD_SKIN_LIST` live in
  `src/common/Cosmetics.js` (shared with the server — see Shop below) and are re-exported as globals at
  the top of `BoardRender.js` (`var BOARD_SKINS = Cosmetics.BOARD_SKINS`, etc.) so every other client file
  keeps reading the same names. Each skin holds its colours (mine, per-number, known/unknown cell, flag,
  font, `glow`). The palette is **per `BoardView`**: `BoardView.skinId` (set via `liveBoardView(canvas,
  state, skinId)` / `drawBoardStatic(state, canvas, skinId)`), and `BoardView.draw()` loads that skin's
  palette (`setPaletteVars`) for the synchronous paint then restores `localBoardSkin` — so the draw helpers
  stay unchanged. `localBoardSkin` is the local user's pick (their own board + UI previews + the
  `body[data-board-skin]` CSS frame); opponent draws pass `game.skin || "classic"` (bots/unknown →
  classic, never the local skin). `drawNumber` glows each digit when `NUMBER_GLOW` is on. Three skins ship:
  **classic** (blue, free), **tactical** (phosphor-CRT: dark screen, teal cells, neon glowing monospace
  digits; a **paid shop item**, see Shop below), and **gold** (black-and-gold prestige: metallic gold
  unrevealed cells, warm jewel-tone numbers, serif font; also **paid**). Each paid skin's **frame** is CSS
  under `body[data-board-skin="<id>"]` (`.player-board` bezel + `.board-scroll` inset glow +
  a skin-specific `::after` overlay — scanlines for tactical, a soft vignette for gold) so it only frames
  YOUR board.
  **Sync:** `setBoardSkin(id)` persists to `localStorage["ms_board_skin"]`, applies, and emits `set_skin`.
  The client's *initial* emit happens from `applyAuthenticated` (Auth.js), not the earlier `applyConnected`
  — `set_skin` is ownership-gated server-side (see Shop below) and `accounts[playerID]` doesn't exist yet
  at raw connect time, so emitting before auth would always be rejected for a legitimate owner; the
  authenticated payload's `ownedItems` decides locally whether the stored pick is even worth sending, else
  it falls back to `classic`. Server mirrors the `names`/`set_name` pattern: `appState.skins[pid]`, the
  `set_skin` handler (session.js) shape-validates + (for a purchasable id) checks `db.ownsItem` before
  storing it (falling back to `"classic"` + emitting `skin_rejected` otherwise) and updates the live
  `game.skin` + rebroadcasts, `createPlayerGame` seeds `game.skin = skins[pid] || null`, `gameForBroadcast`
  ships `skin`, and disconnect clears it. The picker lives in the avatar-editor modal
  (`renderAvatarModalSkins` → `#avatar_modal_skins`, `openAvatarEditor`/Profile.js — there's no longer a
  separate Settings-page copy) — no admin gate; every signed-in player sees every skin, purchasable-and-
  unowned ones rendered locked (dimmed, priced, clicking routes to `/shop`) via `shopItemUnlocked("skin", id)`.
  New **free** skins = just a `BOARD_SKINS` entry (+ optional CSS frame); a new **paid** skin also needs a
  `ShopCatalog.ITEMS` entry (see Shop below). Image texture packs extend the same hook.
- **Avatars + country** — account-level cosmetic identity, mirroring the skin pattern. The **avatar** is
  the in-game flag on a pole — a **triangular pennant**. With a country set, the player's country flag fills
  the pennant: the (circular) `/flags` SVG is scaled to a square big enough that its disc covers the whole
  triangle, then clipped to the triangle (so corners/edges crop the flag — intentional), loaded async with a
  placeholder. Without a country it's a coloured pennant in `avatar_color` (`#rrggbb`; null → default red).
  So the country flag *is* the avatar — there's no separate flag badge. The **country** is an ISO-3166 alpha-2 code; its flag is an SVG under `/flags/<code>.svg`
  (copied from the trevelur project). Country **names are not hardcoded** — `Intl.DisplayNames` resolves
  them at runtime in `core/Countries.js` (which also lists the flag codes + `countryFlagSrc`); this both
  avoids a maintenance burden and sidesteps content-filter false-positives on long disputed-territory name
  lists. `buildAvatarChip(color, country, px)` (BoardRender) is the reusable element used on the **profile**
  (header + an Appearance picker), the **leaderboard** rows, the **home** dashboard
  identity, the **in-game** HUD (duel identity panels + the `player_name0..5` board tags — `setHudName`
  caches the chip so it isn't rebuilt every `draw_board` frame), and **replays** (format **v3** stores
  per-player avatar+country). **Data flow:** `users.avatar_color`/`country` columns; `db.setAvatarColor`/
  `setCountry`; `appState.avatars`/`countries` maps populated in `loginSocket`; `set_avatar`/`set_country`
  handlers (session.js, validated) persist + update the live game + rebroadcast; `gameForBroadcast` and the
  room-state players list carry `avatar`/`country`; `topPlayers` selects them; the `authenticated` payload
  carries `avatarColor`/`country`; disconnect clears the maps. Besides `#rrggbb` and `img:<id>`, two procedural
  avatar values are drawn on the canvas in `buildAvatarCanvas`: `"anon"` (a head-and-shoulders **anonymous
  silhouette**) and `"mine"` (the game's iconic spiky **sea-mine** — shaded body + rim light + shine). The
  flag-pennant colour palette (`AVATAR_COLORS`) is the free/default classic **red** flag plus any purchasable
  colours (currently the black **pirate flag**, see Shop below). **Guests** with no chosen
  avatar default to `"anon"` (`loginSocket` substitutes it when `is_guest` and `avatar_color` is null —
  display-only, not persisted). The home identity avatar is **click-to-edit**: clicking it opens
  `openAvatarEditor` (a `.cr-modal` reusing `renderAppearance` + a live preview); `setAvatarColor`/
  `setCountry` call `refreshAvatarDisplays` to repaint the profile header, home identity, and modal preview.
  (Derived from a Figma "futuristic board" export, translated into this canvas palette + CSS frame.)
  **Flag picker** (`src/client/ui/FlagPicker.js`, replaces the old `<select>`): `buildFlagPickerTrigger`
  returns a 52×52 square trigger button showing just the current flag; clicking it opens
  `openFlagPicker` — a searchable, alphabetized grid of square flag+name cards (`/flags-square/<code>.svg`,
  a second unmasked asset set alongside the round `/flags/`), positioned as a desktop popover anchored to
  the trigger (flips above if there's more room there) or a centered mobile sheet under 900px, with a "No
  flag" cell to clear. Closes on Escape, backdrop click, window resize, or scrolling the page *outside* the
  panel (scrolling the grid itself is exempted). Ported from Mathias's `FlagPicker.tsx` in the
  `achtung-royale` codebase (a React component — the UX/positioning logic was translated to plain DOM,
  not the JSX itself); `Countries.js`'s `Intl.DisplayNames`-based data layer already matched that approach
  independently, so it needed no changes beyond adding `countryFlagSrcSquare`.
  **Locked items open a purchase modal, not `/shop`:** clicking an unowned avatar/skin inside the
  appearance modal calls `openItemPurchaseModal(item)` (Profile.js) instead of navigating away — a small
  `.cr-modal` stacked on top (`#item_purchase_modal`) showing the item + `buyShopItem` (Shop.js, shared
  with the real Shop page) as its Buy button, so a real purchase still redirects to Stripe when confirmed,
  but just browsing locked items no longer closes the appearance modal. `markOwnedLocally` (Shop.js)
  refreshes `renderAvatarModalAvatars`/`renderAvatarModalSkins` and closes the purchase modal once an item
  is actually owned (the admin fake-grant path completes synchronously; a real Stripe purchase redirects
  away before this ever runs).
  **Home-page previews render live, in the player's own skin:** `buildLearnPuzzle` takes a `spec.skin`
  (→ `learnBoardView` → `BoardView.skin`); the dashboard mode previews (`renderModeBoardPreviews`) and the
  daily-puzzle hero (`renderLobbyDailyBoard`) pass `localBoardSkin`, and `setBoardSkin` (BoardRender.js)
  calls both again on every skin change so neither goes stale. (An earlier version pre-rendered these 4
  mode-preview boards to static PNGs at build time, fixed to "classic", and embedded them as plain `<img>`
  tags for a JS-free first paint; that traded skin-consistency for a marginal paint-time win, so it was
  dropped once skins became a purchasable, player-visible choice — `buildLearnPuzzle`/`BoardView.draw()`
  only ever paint synchronously with no `requestAnimationFrame` loop of their own, so these "just a still
  frame" previews were never actually expensive to render live.) Other `buildLearnPuzzle` boards (Learn,
  Help, admin) also just follow `localBoardSkin` directly.
- `Animations.js` — the cellAnims queue + RAF loop + per-frame board paint.
- `Input.js` — pointer/touch/keyboard handlers, local reveal/chord mirrors. Keyboard
  actions are resolved through `keybindings.actionFor()`. A chord that **detonates** clears every
  incorrect flag around that number (flagged but not actually a mine) in all modes — locally, and via
  a `right_click` per cleared flag in server-tracked modes (and via `territoryToggleFlag` in territory).
- `Keybindings.js` — rebindable in-game keyboard controls (persisted to `ms_keybinds`)
  and the Controls section rendered on the Profile page.
- `BotsAdmin.js` — admin bot browser (`#/admin/bots`): paginated/sortable/Elo-filterable
  view of the pool via `GET /api/bots`, plus the server-driven "watch a bot play" modal
  (`bot_demo_start`/`stop` → `bot_demo_board`/`move` sockets; renders frames with `drawCell`).
- `Fullscreen.js` — `enterGameFullscreen()` / `exitGameFullscreen()`: requests browser
  fullscreen when a game starts (any mode) and releases it on leave. Because the
  Fullscreen API needs a transient user gesture, `enterGameFullscreen()` is called straight
  from the committing click handlers (`readyButton` for casual, `findRanked` for ranked,
  `startSolo`, `renderPuzzlePlay`, territory create), never from a later socket/board
  callback; it's idempotent and fails silently if the browser blocks/doesn't support it.
  Exit is wired into every leave path (`leave_button`, `cancelRanked`, `exitSolo`,
  `exitPuzzle`, territory teardown, and the Router's navigate-away teardown). The **game header has a
  fullscreen toggle** (`#fullscreen_btn`, icon-only, next to the progress text) so a player who pressed
  Esc can re-enter — `toggleGameFullscreen` enters/exits off the live state (the click is the needed
  gesture); its expand/compress icon swaps off `body.game-fullscreen`, and the button is hidden
  (`body.no-fullscreen-support`) where the Fullscreen API is unavailable (iOS Safari).
  Fullscreen chrome (driven by `body.game-fullscreen`) hides the navbar + footer and, for the
  non-territory/non-puzzle modes, re-centers the play area (the windowed grid left-aligns the
  board in a `1fr` column + 320px sidebar, which jams it against the edge once `main`'s
  max-width is dropped in fullscreen).
  NB the "leaving counts as a loss" prompt (in `leave_button` and the Router navigate-away path)
  uses the app's own `showConfirm` modal, **not** `window.confirm()` — browsers suppress native
  dialogs while fullscreen (they return false silently, so the button looked dead in-game).
  Leaving goes through `leaveRoom(toHome)` (Main.js), which emits `leave_room` and then **tears the game
  UI down immediately client-side** (`teardownRoomUI(toHome)`: clear room state + route, which hides
  `#game_view`) rather than waiting for the server's `left_room` echo — so the game never lingers
  if that echo is slow/dropped. The echo still arrives and applies any ranked Elo delta. **The "Exit
  game" button (and search-cancel) pass `toHome=true` → always returns to the home screen** (`navigate("/")`);
  the **navigate-away path** (clicking a nav link mid-game, via the Router) calls `leaveRoom()` with no
  flag so `teardownRoomUI` re-applies the already-changed target URL instead of forcing home.
  **Forcing landscape for the 1v1 duel** (mobile only): the fullscreen opt-in above is off by default
  everywhere (`enterGameFullscreen()` skips mobile viewports outright unless called with `force=true`),
  but the duel's landscape layout is built specifically around reclaiming the space the browser's own
  chrome (address bar, home indicator) would otherwise eat, so `findRanked` (Lobby.js) calls
  `enterDuelMobileFullscreen()` (Fullscreen.js) for 1v1 racing modes specifically, bypassing that
  opt-in — gated on touch + a phone-sized `screen.width/height` (not viewport width, which can't tell
  a phone already turned sideways from a small desktop window) rather than `isMobileViewport()`.
  Once fullscreen resolves, `tryLockLandscape()` attempts `screen.orientation.lock("landscape")` — the
  real, correct fix where it's supported: it genuinely reorients the device's own rendering, so
  `@media (orientation: landscape)` just picks it up with no extra code. **It's unsupported on iOS
  Safari specifically** (no `ScreenOrientation.lock()` at all, and — separately — no arbitrary-element
  Fullscreen API on iPhone either, only iPad; both silently no-op there per the existing try/catch
  pattern). For exactly that gap, `body.duel-force-rotate` (style.css, driven by `applyDuelLandscapeClass`
  in Main.js) is a CSS-only fallback: rotates `#game_view` 90° via `transform: rotate(90deg) translateY(-100%)`
  off a `width:100vh;height:100vw` box, so a portrait phone that can't be orientation-locked still
  renders the real landscape layout instead of the rotate-prompt nudge. This is why the landscape duel
  layout is driven by a plain class (`body.duel-landscape-mode`) rather than a `@media (orientation:
  landscape)` query directly (see the big comment above that class in style.css) — a CSS transform
  doesn't change what a media query itself observes, only how the transformed element renders, so the
  query alone could never see the force-rotated case. Rendering (local coords → screen) falls straight
  out of the transform cascade with no extra work; the one thing that doesn't is hit-testing a tap
  (screen coords → local), which `cellFromCanvas` (Input.js) special-cases with the matching
  inverse-rotation math when `body.duel-force-rotate` is set (verified self-consistent — center taps
  hit the center cell, all four on-screen corners map to the four expected board corners with
  monotonic progression between them — but **the actual physical rotation direction (which way a real
  phone needs to be turned for the content to read upright) hasn't been validated against a real
  device**, only Chromium's touch/geometry emulation; if it renders upside-down in practice, flip the
  rotation sign here and in `cellFromCanvas`'s formula together). `clearBattleLayoutClasses()` clears
  both classes alongside `.duo`/`.multi` — folded into `teardownRoomUI` specifically (not left to
  whichever next game type happens to call it, e.g. `applyPuzzleBoard`) since `#game_view` is shared
  across every mode and a leftover `duel-force-rotate` would otherwise rotate whatever opens next.
- `MobileLayout.js`, `Sound.js`, `Overlay.js`, `RoundTimer.js`,
  `DangerWarning.js`, `BoardDecoder.js`, `Router.js`, `Auth.js`,
  `Ranking.js`, `Leaderboard.js`, `Profile.js`, `Lobby.js`,
  `MatchPanels.js`, `GameRoom.js`, `Solo.js`, `Learn.js`,
  `StartPatternsView.js`, `CombinedPuzzlesView.js` — one feature each.
  (`Overlay.js` also holds `showConfirm(message, opts)` — the app's promise-based confirm
  modal, used app-wide instead of `window.confirm()`.)
- **Solo** (`/solo`, `showSoloView`) — single-player **free play**, no config page: `showSoloView`
  **drops you straight into a board** (`startSolo` → `request_solo_board` → the `solo_board` handler shows
  `#game_view`). There is no `#solo_view` markup. Size + density are changed from the **in-game sidebar**
  (`#solo_card`: `.solo-size-btn`/`.solo-density-btn` quick-re-roll a new board immediately; "New board" =
  `#solo_restart`); `soloSelectedSize`/`soloSelectedDensity` persist the choice and `Solo.js`
  `syncSoloControls()` (called from `startSolo`) lights up the sidebar's active buttons + best-time line
  (`updateSoloBest` → `#solo_best`). No nav item — reached through Play → the home **Solo** card, so
  `showSoloView` keeps **Play** highlighted. `exitSolo` returns **home** (`/`), not `/solo` (navigating
  back to `/solo` re-launches a board). The old `/practice` path **redirects** to `/solo`. `/solo` is the
  lone `inGameRoutes` entry (the board shows over it, URL stays `/solo`).
  **Pre-game Start gate:** a solo board loads **locked** with a centered **Start** button over the board
  (`#solo_start_overlay`, a scrim + button inside `.board-wrap`; `soloSession.started` starts `false`).
  Input is blocked while not started — `performAction` early-returns for solo when `!soloSession.started`,
  and the overlay scrim also eats mouse clicks. Clicking Start (`#solo_start_btn` → `beginSolo`) hides the
  overlay and runs the shared `countDown(3, onDone)` (the 3-2-1-GO board overlay reused from ranked round
  starts; `onDone` fires at "GO" and sets `started = true`, capturing the session so a mid-countdown "New
  board" can't unlock the new one). `hideAllViews` clears the overlay defensively; the `solo_board` handler
  re-shows it for every fresh board.
  **Timer:** starts on the **first real move**, not on cursor moves or no-op clicks. `soloStartTimerOnce`
  (Solo.js, idempotent) is called from `soloOnAfterReveal` only when the reveal/chord actually changed the
  board (`result.anyChange || result.hitMine`) and from Input.js's flag branch when a flag is placed — NOT
  from the top of `performAction` (which fired for any click, including clicking an already-revealed cell
  to position the cursor — the bug this fixed).
- **Puzzles picker** (`#puzzles_mode_modal`, `openPuzzlesModal`/`closePuzzlesModal` in Router.js) — same
  in-place modal pattern as `ranked_mode_modal` (Sprint/Standard): opened from the home dashboard's
  **Puzzles** row instead of navigating to a page. Just two cards now — **Puzzle Ladder** (with its
  tier/level progress inline, `#puzzles_modal_ladder_progress`, via `puzzleLadderHTML`) and **Time Trial**
  (the renamed Storm mode; `mode === "storm"` on the wire/DB is unchanged, only the displayed name
  changed) — Streak and Daily were dropped from this picker (Daily has its own home-page hero card
  already; Streak's route/feature still exists, just isn't linked from here). `/puzzles` is a back-compat
  redirect that lands on the lobby and opens the modal, same as `/ranked/sprint`|`standard`. The home
  card itself shows the **Puzzle Ladder tier** (`#puzzle_ladder_tier`, `puzzleLadderLabel`) instead of the
  hidden puzzle rating or a solved count — same "tier only" treatment Sprint/Standard use.
- **Puzzle Ladder** (the renamed "Rated" mode) — a chess.com-style **monotonic points progression** layered
  on the rated trainer. `users.puzzle_points` only ever goes **up** (awarded server-side in `finalizePuzzle`
  on a rated *solve*, scaled by difficulty: `puzzlePointsFor(puzzleRating − playerRating)` → 15 regular /
  20 hard / 25 extra-hard, halved for a hinted solve, 0 on a miss; `db.addPuzzlePoints`). Points drive a
  **tier + level** via `core/PuzzleLadder.js` (`puzzleLadder(points)` / `puzzleLadderLabel`): 8 tiers
  (Wood→Stone→Bronze→Silver→Crystal→Elite→Champion→Legend) × 20 levels × 50 pts/level — **all tunable in that
  file**. The two-way **`puzzle_rating` is unchanged** and now *only* sets which puzzles you're served —
  it's **hidden from the UI** (picker header, in-game panel, profile); the Ladder is the rank and never
  drops. **New players start at puzzle_rating 0** (seeded in user creation; pool has plenty of sub-400
  puzzles so the climb is gentle). Shown on the picker
  card, the in-game rated panel (`renderPuzzlePlay`/`renderPuzzleRank` — tier + level bar + points-earned
  flash), and the profile Puzzles section; a tier-up reuses the achievement-toast UI. `puzzlePoints` rides
  the `authenticated` payload + each `puzzle_result`. **Admin reset:** the Admin landing has a "Reset puzzle
  progress" button → `admin_reset_puzzles` (session.js, re-checks `is_admin` from the DB) →
  `db.resetPuzzleProgress` (rating→0, points→0, peak cleared) → echoes `puzzles_reset` so the client
  updates without a reload.
- **In-game button groups** (keyboard): any container tagged `.kbd-btn-group` (the puzzle fail actions
  `#puzzle_fail_actions`, the `.result-actions` rows in the series/tournament/result panels) is
  keyboard-driven — `focusButtonGroup` (Main.js) focuses its primary button when shown (e.g. "Try again"
  on a puzzle miss; `presentPanel` does it for overlay panels), the **arrow keys move focus between** the
  group's buttons, and Enter/Space activates the focused one. The board key handler (Input.js) and the
  MatchPanels Enter-to-primary fallback both bail when focus is inside a `.kbd-btn-group`, so they don't
  double-fire or move the board.
- **Home dashboard aside** (`Lobby.js`/`Profile.js`). The mode rows are just Sprint · Standard ·
  **Puzzles** (→ `/puzzles`) — the old Practice/Solo row was dropped from the home card entirely (the
  `/solo` free-play page itself still exists, just isn't linked from here). Each row uses a generated
  **board preview** (`DASH_MODE_BOARDS` in `Profile.js`) — all three share Standard's 6×9 board
  dimensions (`renderModeBoardPreviews`) so the rendered previews come out the same size; don't reintroduce
  mismatched `rows`/`cols` per mode there. The right aside holds only the daily-puzzle hero now — the
  "Active lobbies" card (`.dash-rooms`, `#home_room_list`, `renderHomeRooms`) was removed as clutter;
  `/custom` is reached via the nav instead. (`#leaderboard_list` is gone; `renderLeaderboard` already
  `.filter(Boolean)`s its now-null home target and only fills the full list.)
- **Daily puzzle retry**: a miss no longer locks the day out — `puzzle_daily_start` (`puzzlePlay.js`)
  only rejects with `daily_already_done` when the existing `daily_attempts` row for today has
  `solved=1`; a missed attempt can be retried (same puzzle, `db.recordDailyAttempt`'s `INSERT OR REPLACE`
  just overwrites the row each time) until it's solved or the UTC day rolls over. The miss outcome panel
  (`showDailyOutcome` in `PuzzlePlay.js`) shows a **Try again** button next to Back to lobby; the home
  card's daily hero button does the same (`renderLobbyDailyState` in `Profile.js` — "Try again", not
  disabled, on a miss).
- **Leaderboard page** (`/leaderboard`) has **mode filter tabs** (`#leaderboard_tabs`: Sprint · Standard
  only — Overall/Tournament/Territory tabs were dropped from the UI, though `get_leaderboard`/
  `db.topPlayers` still support those modes server-side). `Leaderboard.js` tracks `currentLeaderboardMode`
  (defaults `"sprint"`) and `selectLeaderboardMode(mode)` (highlights the tab, shows a loading row, emits
  `get_leaderboard {mode}`); the `leaderboard` handler ignores replies whose `mode` no longer matches
  (tab-switch races). Server: `get_leaderboard` passes `mode` to `db.topPlayers(limit, mode)`, which ranks
  by that style's column via a **whitelist** map (`LEADERBOARD_COLUMNS`) and returns it as `rating`
  (plus `id` now, for profile links), so `renderLeaderboard` stays mode-agnostic (tier via `tierFor` on
  that rating). Puzzles is excluded (separate rating scale).
  **Rows link to a read-only public profile** (`/profile?id=<userId>`, `.lb-row-linked`) — a feature
  that didn't exist before (there was previously no way to view anyone's profile but your own).
  `showProfileView` (Router.js) branches on `?id=`: with one, it calls `renderPublicProfile(userId)`
  (Profile.js) instead of the normal `renderProfile()`; that emits `get_public_profile {userId}` and
  renders `renderPublicProfileData` from the `public_profile` reply — a trimmed Overview-only build
  (identity, lifetime stats, ranked ladders, puzzles; no tabs, no achievements/match history/rating
  graph, no edit-name pencil) reusing the same `profileStat`/`profileLadderCard`/`profilePuzzleLadderCard`
  helpers `renderProfile` uses, just fed from the fetched `profile` object instead of the global
  `account`. Server-side, `buildPublicProfilePayload`
  (session.js, beside `buildAccountPayload`) is a curated subset — no token/provider/ownedItems/email;
  puzzle rating stays hidden same as everywhere else, only ladder points are exposed. Returns `null` for
  a missing or guest user. `publicProfilePending` (Profile.js) guards against a stale reply landing after
  the player has already navigated to a different profile or away — the `public_profile` handler
  (Main.js) drops any reply whose `userId` doesn't match.
- **Profile page** (`Profile.js`, `renderProfile`) is a full stats dashboard, split into three **tabs**
  (`#profile_tabs`, `PROFILE_TABS`/`selectProfileTab` — an **underlined** style, deliberately different
  from the `.lb-tab` filled-pill look used for leaderboard/rating-chart mode filters, since these are page
  sections rather than a data filter; the active tab is remembered in `profileTab` across re-renders,
  defaulting to Overview; the tab bar is hidden when signed out): **Overview** (`#profile_tab_overview`) —
  identity (name + "Member since" from `account.createdAt`; no single "overall" rank badge any more —
  redundant now that Sprint and Standard each get their own ladder card, and inconsistent with the
  leaderboard dropping its Overall tab too), lifetime stats (played/wins/win rate/**best** daily streak,
  not the current one), **per-mode ranked ladder cards** (`profileLadderCard`, **Standard shown before
  Sprint** — Tournament/Territory are not surfaced), and a **Puzzle Ladder card** in the same
  `profileLadderCard` visual treatment ("puzzles shown like ranked" — `profilePuzzleLadderCard`, a
  tier-coloured dot standing in for the hexagon rank badge since the Puzzle Ladder's Wood..Legend tiers
  are a different system from `buildRankBadge`'s Bronze..Master) plus Solved/Best streak/Best Time Trial
  stats beneath it. The free-play best-times matrix was dropped entirely (`profileBestsGrid` and friends,
  removed). **Matches** (`#profile_tab_matches`) — the rating graph + recent-games list (see Match history
  below); **Achievements** (`#profile_tab_achievements`). The **rating graph** (`buildRatingChartSVG`)
  draws its horizontal reference lines at **tier boundaries** (every `SUB_TIER_WIDTH`, capped so a wide
  rating range doesn't cram in too many) instead of generic evenly-spaced values, each labelled/coloured
  with that tier — doubles as "how close to the next tier" at a glance. `renderRatingGraphCard` forces
  strictly increasing point timestamps before charting: the synthetic "before" seed point used to share
  the first real match's exact timestamp (and two real matches recorded in the same tick still could),
  which draws a perfectly vertical line segment at that x — a real bug, not a style choice; don't
  reintroduce a same-timestamp point without nudging it forward. The **Achievements** card
  (`#achievements_card`, `renderAchievements`): a **data-driven** `ACHIEVEMENTS` catalogue (~25 + a meta
  **Collector**) evaluated against a flat **metrics bag** = `account` fields merged with the server's
  `db.achievementStats(userId)` aggregates. Two entry shapes — TIERED counter (`value(m)` + `tiers`, e.g.
  Victories 1/10/50/250/1000, Ascendant by tier, Deductionist, On Fire win-streak, Duelist, Daily Devotee,
  …; most now carry one extra top tier beyond their original ceiling) or BOOLEAN (`bool(m)` + `progress(m)`,
  e.g. Two-Sport, Well-rounded, Sharpshooter, Sub-minute). A tile's progress bar (`.ach-prog-bar`) is muted
  grey while the achievement is still fully locked (`.ach-locked .ach-prog-bar`) even though it shows real
  progress toward the first tier — left at the default accent blue, that read as "you've unlocked
  something here" on a tile that's otherwise dimmed/grey, which wasn't true yet. **Adding an achievement is
  one catalogue entry** (plus, if it needs a number we don't track, one metric in `achievementStats`).
  Rank/streak/peak achievements read **peak/best** metrics (`stats.peak.*`, `winStreakBest`,
  `dailyStreakBest`, `peakPuzzleRating`) so they **never un-earn** when the current value drops.
  `achievementStats` reads a **pre-aggregated `player_stats` row** (one per user — a PK lookup, no scans):
  per-mode wins, peak-per-style, win streak, best day wins/gain, big swing, 1v1/6-player wins, peak puzzle
  rating, dailies solved, best daily streak, distinct active days. That row is maintained **incrementally**
  at the event seams — `recordMatch`→`bumpMatchStats` (read-modify-write: per-mode win + peak, streak
  cur/best, day counters + bests, swing, 1v1/6p, active day), `updateUserPuzzleRating`→`bumpPuzzleStats`,
  `recordDailyAttempt`→`bumpDailyStats`; the `*_current`/`stat_day`/`day_*` columns are the working state
  the `*_best` columns need. A **one-time lazy backfill** (`computeStatsFromHistory`→`backfillPlayerStats`,
  gated by `player_stats.backfilled`) seeds the row from existing
  `match_history`/`puzzle_attempts`/`daily_attempts` the first time it's read — so existing players keep
  their numbers and the expensive aggregation runs **once per user, never per profile-open**.
  All bumps swallow their own errors. `achievementStats` ships in the `get_match_history` payload as
  `stats` (shape unchanged → client untouched; rank achievements client-fallback to current ratings when
  a player has no match history yet). The client renders achievements from
  `account` immediately, then re-renders when `renderMatchHistory` fills the aggregates. `computeTiered`
  derives reached-tier/roman-numeral/progress and exposes `reached`/`tierCount`/`complete`; tiles are
  **three-state** — `.ach-complete` (all tiers → green) / `.ach-partial` (some tiers → blue) / `.ach-locked`
  (dimmed, greyscale). The header count is **tier-aware**: total tiers reached / total tiers (so multi-tier
  achievements count fully), while the meta **Collector** still counts distinct achievements unlocked.
  **Unlock toasts** (`checkAchievementUnlocks` + `showAchievementToast` → bottom-right `#toast_stack`): it
  diffs each achievement's reached-tier count against the last snapshot (`achReached`); the first check
  after (re)connect baselines silently, later checks toast any newly-crossed tier (blue=unlocked /
  green=complete). A check runs whenever fresh stats land (`renderMatchHistory`); `refreshAchievementProgress`
  (Main.js) re-requests `get_match_history` after every result (`series_ended`, `puzzle_result`,
  `puzzle_run_end`, `puzzle_daily_result`, `solo_record`), and `applyAuthenticated` requests it once to
  baseline before the first game.
  **Style-challenge achievements** ("No Flags" / "Chord Master") are event-driven, not cumulative-stat
  derived: Input.js tracks per-board `clearNoFlag`/`clearNoReveal` (a flag placement / a direct reveal of
  a covered cell flips them — chords don't), **only in solo + racing, never puzzles/territory**; reset at
  each board start (`resetClearChallenge` in `setCoveredBoard` + `solo_board`); on a clear (`reportClear`
  from solo win / racing `me.finished`) the client emits `record_clear {noFlag,noReveal}` →
  `db.recordClear` bumps `player_stats.noflag_clears`/`noreveal_clears` (these have no history source, so
  backfill leaves them untouched — they only accrue going forward) → exposed as `noFlagClears`/
  `noRevealClears` in the stats bag.
- **Match history** (rating graph + recent games on the profile). A `match_history` table
  (`db.js`: `user_id, style, rating_before, rating_after, placement, players, won, opponent, created_at`)
  gets one row per human per completed ranked match, written wherever Elo persists: `elo.js`
  `applyRankedElo` (racing + territory) and `applyEloForPlayer` (tournament), right after
  `db.updateRating`. `db.recordMatch` (swallows its own errors so it can't break match-end),
  `getMatchHistory(userId,limit)` (recent, desc — the games list), `getRatingHistory(userId,limit)`
  (asc — bucketed per style for the graph). The `get_match_history` socket handler (session.js) returns
  `{matches, ratings}` for the signed-in user; the client requests it from `renderProfile`, the
  `match_history` handler calls `renderMatchHistory` → a responsive **SVG line chart**
  (`#rating_history_card`, per-style toggle, seeded from each series' first `rating_before`) and a
  **recent-games list** (`#recent_games_card`: style chip, Won/Lost or "Nth of M", Δrating, opponent/
  player-count, relative time). Both cards hide when empty (and a `#matches_empty` placeholder shows when
  both are). NB history accrues **going forward** —
  pre-existing accounts have no rows until they play. Each row also carries a **`replay_id`** (nullable
  FK to `match_replays`); when set, the row renders as a link to `/replay?id=N` with a "▶ Watch"
  affordance — there is no separate replays list, the recent-games list IS the replays list.
- **Match replays** (ranked matches, server-side capture — `runtime/replay.js`). The format is an
  **input log**, not a state log: store the mine layout once per round (a `rows*cols`-bit bitmask) plus
  each player's ordered **applied** clicks, and re-simulate cascades at playback. An event is
  `varint(dt_ms) + varint(cell<<1 | button)` (~2-3 B; button is 1 bit, 0=left/1=right — reveal-vs-chord
  is decided by board state on replay). Each round stores **two** bitmasks — `mines` (bomb layout) and
  `known` (the no-guess opening `init` reveals before any click; needed so playback's board doesn't start
  fully covered). The per-player header carries name / userId / **board-skin id** (so playback
  renders each board in the skin its player had at match time) plus a reserved byte where a **bot flag**
  used to live — **whether an opponent was a bot is hidden information**, so it's no longer recorded
  (the byte is written `0`), not shipped in the replay metadata (stripped in `get_replay`, including for
  legacy rows), and never surfaced by `Replay.js`. Format is versioned (`REPLAY_VERSION`,
  currently **3**; v2 added the skin, v3 the avatar+country — readers version-gate so older replays still
  decode, defaulting to classic). A whole 1v1 sprint is ~300-350 B raw, gzipped to a BLOB. Capture rides three seams in
  `minesweeperServer.js`: `startSeries`→`replay.startMatch` (arms `room.replay` for ranked non-territory
  rooms), `startGame`→`replay.startRound` (snapshots the two bitmasks) + `replay.attach` (wires
  `game.onMove` per player), and `endSeries`→`replay.finishMatch` (serialize + gzip + persist, then clear).
  Moves are captured via a **`game.onMove(button,r,c)`** hook in `engine/GameCreator.js`, fired *after* the
  `playing && !frozen` guard in `handleLeftClick`/`handleRightClick` — so only real in-play moves are
  logged (bots included, since they call the same handlers). Storage (`db.js`): `match_replays` (summary
  columns + gzipped `data` BLOB) and `match_replay_players` (side table mapping replay→real user ids, so a
  user's replays list without touching the blob). `saveReplay(meta,blob,participants)`, `listReplaysForUser`,
  `getReplay`. `winner_id` is null when a bot won the match (bots have no user id). After `saveReplay`,
  `finishMatch` calls `db.linkReplayToMatches(id, participants, rp.createdAt)` to stamp the new id onto
  this match's `match_history` rows (scoped by `user_id` + `created_at >= matchStart` + `replay_id IS
  NULL`, so it touches only this match). Replays accrue **going forward**.
- **Replay playback** (`/replay?id=N`, `#replay_view`, `views/Replay.js`). One socket handler in
  `session.js`: `get_replay` (→ `replay_data`; participant-gated via `listReplaysForUser`; the server
  **gunzips** and ships the raw binary so the client needs only the decoder, not a gzip dep — arrives as an
  ArrayBuffer). `Replay.js` decodes the input log, then for each round builds a mine+clue model and
  **re-simulates** each player's board by applying their events up to the playhead time `T` — `dfs`/`chord`
  mirror GameCreator exactly (templated board, so no first-click relocation; `autoChordOnFlag` is unused so
  it's ignored). Layout is a **focused stage** (one big board) above a **filmstrip** of small thumbnails —
  all players, click any to focus it (`setFocus`, which rebuilds at the current playhead so position +
  play state are preserved). Focus defaults to the viewer's own board (matched by `account.userId`),
  falling back to player 0. Each player has one shared state array fed to all its `BoardView`s (the
  thumbnail, plus the stage board when focused), so `renderFrame` re-sims each player once per frame and
  draws all its views. Boards render **in that player's stored board skin** (unknown/missing ids fall back
  to `classic`). Controls: timeline slider, play/pause (rAF loop), speed buttons (0.5/1/2/4×), and per-game
  tabs when `gameCount>1`. Steady-state redraws are skipped unless a player's applied-event count changed.
  `teardownReplay` (called from `hideAllViews`) cancels the rAF on navigation. Entry point: the **recent-
  games rows** on the profile that have a `replay_id` link to `/replay?id=N` (see Match history above).
- **Settings page** (`/settings`, `#settings_view`, `showSettingsView`) — local, on-device preferences:
  Gameplay (`#gameplay_card`), Audio (`#audio_card`), and **Controls** / keybindings (`#controls_card`).
  `showSettingsView` calls `renderGameplaySettings`/`renderAudioSettings`/`renderKeybindings`. Board skin
  used to have its own card here too; it was dropped once the avatar-editor modal covered the same
  picker, so skin-picking now lives only on the Profile page. Settings has its own nav link
  (`data-route="settings"`). Consecutive `.setting-row`s (Music/Effects, say) get spacing via
  `.setting-row + .setting-row` — `.section-card` itself is a plain block container with no gap, so
  without it they sat flush against each other. A keybind that `set()` freed up (its key got reassigned
  to a different action — see the comment there) renders "—" with a dashed red border
  (`.keybind-key-unbound`) instead of the normal neutral style, so a silently-broken control doesn't
  look identical to a working one.
- **Shop** (`/shop`, `#shop_view`, `showShopView` → `renderShop` in `Shop.js`) — real-money cosmetic
  purchases via **Stripe Checkout** (hosted page; the client never loads Stripe.js, it only calls our own
  `/api/shop/*`). **Catalog**: `src/common/ShopCatalog.js` (common, `require`'d server-side + loaded as a
  `<script>` client-side) hand-authors `ITEMS` — currently every `AVATAR_IMAGES` preset at $1.99 (`id`s are
  literally the `"img:<id>"` wire value `set_avatar` already uses), every `AVATAR_COLORS` entry past the
  free/default one at $1.99 too (currently just the black pirate flag — label is hand-authored since it
  can't be derived from a hex value), the `tactical` skin at $4.99, and the
  `gold` skin at $5.99 (skin `id`s are literally `set_skin`'s wire value) — plus a boot-time check that
  every catalog id round-trips against
  `Cosmetics.js`. Free/default values (`anon`, `mine`, the red flag colour, `classic`) are simply absent
  from `ITEMS`; `ShopCatalog.isPurchasable(kind, id)` is how every gate (client picker + server handler)
  decides whether ownership even needs checking. **Ownership**: `db.js`'s `shop_purchases` table
  (`user_id, kind, item_id, …, PRIMARY KEY(user_id, kind, item_id)`, matching the `match_replay_players`
  multi-row-per-user shape) + `listOwnedItemIds`/`ownsItem`/`grantItem` (idempotent — `INSERT OR IGNORE`,
  returns whether newly granted); `session.js`'s `buildAccountPayload` ships `ownedItems` on both the live
  `authenticated` event and SSR hydration, and a `refresh_owned_items` → `owned_items` socket round-trip
  re-syncs it after a purchase (the client can't hear about one live — Stripe redirects the browser, no
  socket involved). **HTTP** (`src/server/runtime/shopApi.js`, mounted in `minesweeperServer.js` like
  `oauth`/`puzzleApi`): `POST /api/shop/checkout` (resolves the caller via `X-Session-Token`, rejects
  guests, looks up the item + **builds the Stripe price server-side from the catalog** — never trusts a
  client-submitted price — creates a Checkout Session, returns `{url}` for a full-page redirect);
  `GET /api/shop/session-status` (UX fast-path on the redirect back — grants immediately if already paid,
  since the webhook can lag); `POST /api/shop/webhook` (the **authoritative** grant path — verifies
  `stripe-signature` via `stripe.webhooks.constructEvent` against a **raw Buffer body** — signature
  verification needs the exact bytes, so this route has its own reader and can't reuse the string-based
  JSON reader the checkout endpoint uses — then grants from the session's `metadata.{userId,kind,itemId}`,
  deduped through `processed_stripe_events`/`markStripeEventProcessed` against Stripe's at-least-once
  redelivery); `POST /api/shop/fake-grant` (**admin-only, works in prod too** — re-checks `is_admin` from
  the DB like `session.js`'s `admin_reset_puzzles`, then `grantItem`s with `priceCents: 0` and
  `stripeSessionId: "fake-shop:admin"` so these rows are identifiable later — no Stripe interaction at
  all, so it works even with Stripe unconfigured). Env: `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`
  (`.env.example`; a restricted key is recommended over a full secret key). **No refund/chargeback
  revocation** and **no grandfathering** of pre-shop `tactical` usage — deliberate launch scope, not an
  oversight. **Client UI**: `Shop.js` renders tiles grouped by kind (Owned / $X.XX / Sign in to buy — no
  "Buy" prefix on the price, it's already the only thing that button could mean; clicking it just disables
  the button rather than swapping in a "Starting checkout…" label, so the price text's own width never
  shifts anything) and handles the `?purchase=success|cancel` return trip; an admin sees a
  **"Fake shop" checkbox** at the
  top of the page (`account.isAdmin`, in-memory `fakeShopMode` — never persisted) that, while on, routes
  every Buy click to `/api/shop/fake-grant` instead of Checkout, activating instantly with no payment (the
  button relabels to "Activate (fake)" so it's never ambiguous which mode is live; the server independently
  re-checks admin on every call, so the checkbox is a UX switch, not a trust boundary). `Profile.js`'s
  `renderAppearance`/`renderAvatarModalSkins` share `shopItemUnlocked(kind, id)`
  + `goToShop()` + `buildSkinPreview(id)` (also reused by the Shop tile) to render unowned purchasable items
  locked (dimmed, priced, clicking navigates to `/shop`) instead of hidden or freely selectable.
- **Help modal** (`#help_modal`, `wireHelpModal` in Main.js). The navbar **Help** item is a `<button>`
  (not an `<a>`, so the router's link interceptor ignores it) that opens a concise modal — rules +
  controls, reusing the `.cr-modal`/`.cr-dialog` chrome. The "The rules"/"Game modes" section headings
  were dropped (the modal's own "How to play" title already says what the first section is; the Game
  modes section — Practice/Ranked/Puzzles/Territory — was redundant with just navigating the site and
  stale on Territory, which isn't a surfaced player-facing mode) and a **Learn** link was added next to
  the rules for a guided walkthrough. On open it fills the control-key chips
  (`#help_key_reveal`/`flag`/`next`) from the live rebindable bindings via
  `keybindings.label(keybindings.get(action))`, so they track the player's actual keys, and renders two
  small **example boards** (`buildLearnPuzzle`, rendered once into `#help_board_numbers`/`#help_board_flags`)
  showing the same layout first with bare number clues, then with the mines flagged. The footer's
  "rebind your keys" link points at **Settings** (`/settings`, where `#controls_card` actually lives —
  it used to say Profile, which hasn't hosted keybindings since Controls moved off it). Closes on the ×,
  Esc, backdrop, or either footer link (all carry `data-help-close`; the links also navigate).
- **Ranked search.** The racing modes (1v1 + 6-player Sprint/Standard) drop you **straight into the
  battle UI** and slot opponents into the opponent boards as they're found — search and play share one
  screen, so there's no separate waiting room and "Play another" never leaves the page. `findRanked`
  (Lobby.js) routes `isRaceRankedMode(mode)` to `startBattleSearch(mode)` (Main.js): it sets a
  `rankedSearch` state (`{mode,size,race,members}`), shows `#game_view` in the duo/multi layout, paints
  your board + opponent slots covered (medium 15×20 placeholder), and shows a "Finding match · N/size"
  pill (`#battle_search_status`) in the game header. The battle-layout helpers read EITHER a live room
  OR the search: `battleSize()`/`battleRoster()` fall back to `rankedSearch`, and `paintOpponentCovered`
  fills the next opponent board per `members` (the rest show a dimmed pulsing `Searching…` slot,
  `.opponent-searching`). `ranked_searching` broadcasts feed `updateBattleSearch`; `joined_room` calls
  `endBattleSearch` so the live `room_state` takes over seamlessly. The "Exit game" button cancels the
  queue (`cancelBattleSearch`) while still searching, and `left_room` skips its teardown while
  `rankedSearch` is set (so "Play another"'s `leave_room`+re-queue doesn't bounce you to the lobby).
  NB the picker (`Router.js`) must NOT `navigate("/")` for race modes — that would hide the battle UI;
  it only routes home for the overlay modes.
- **Custom rooms.** The Custom page (`#custom_view`) is casual race-only — Territory is **not** creatable
  here (it lives in Ranked). A "+ Create room" button opens the create-room modal (`#create_room_modal`,
  wired in `wireCreateRoomModal` in Main.js): segmented `.cr-seg` controls (one `.active` per group) pick
  players (2–6), board size, round time, mine penalty, series length, and a **gameplay Modifier** up front,
  plus a **10%–30% mine-density slider** (`#cr_density`). "Create room" emits `create_room` with those options; the server
  (`minesweeperServer.js`) applies each through the room's validated setters (`setBoardSize`/`setMineDensity`/
  `setRoundSeconds`/`setDeathPenalty`/`setGameCount`, player count via `createRoom`'s `customMaxPlayers`), so a
  bad payload just falls back to defaults. `setMineDensity` range-validates whole-percent steps in 10%–30%
  (`MINE_DENSITY_*_PCT` in RoomCreator) — density is a slider, not discrete options, in both the modal and the
  lobby (`#mine_density_slider`, which debounces `set_mine_density` while dragging and isn't re-set from
  `room_state` while focused).
  **Gameplay modifiers** (custom only, mutually exclusive — `room.modifier` ∈ `null | "noFlags" | "onlyFlags"`,
  `setModifier` in RoomCreator): **No flags** disables flagging (engine `handleRightClick` early-returns when
  `game.noFlags`); **Only flags** disables left-click reveal (`handleLeftClick` early-returns when
  `game.onlyFlags`) and turns on `autoChordOnFlag` so placing a flag chords its satisfied numbered
  neighbours. The auto-chord **cascades** (`autoChordCascade` in GameCreator): after a flag is placed **or
  removed**, it sweeps the board chording every satisfied number and repeats until a pass opens nothing new —
  because a chord can reveal a further number that's itself already satisfied, so one correct flag chains
  across the board (each productive pass lowers `squaresLeft`, so it terminates). Removing a flag re-runs it
  too (an over-flagged number dropping back to its exact count becomes chordable). Reveals are server-driven
  (the client doesn't predict only-flags reveals) and arrive via `draw_board`. Win is still a standard clear.
  `startGame` sets the per-game flags from `room.modifier`; it rides
  `start_game` + `room_state` (so `currentRoom.modifier`), and `Input.performAction` mirrors the rules
  client-side: `noFlags` drops right-clicks; in `onlyFlags` a **left-click can't reveal** — on a covered or
  flagged cell it's a no-op, on a revealed number it routes through the flag tool as a chord (the server
  ignores `left_click` in this mode), while right-click places/removes flags. Bots play
  it as-is (they still flag), so they cope but aren't optimised for these modes. The room
  list (`roomRow` in Lobby.js) shows each room's full ruleset as `.room-chip`s (players X/Y — red when full,
  board dims, % mines, round time, series); `roomSummary` (roomState.js) now includes `boardSize`+`mineDensity`.
  Once you're in a casual room, the **planning phase uses a clean waiting-room lobby** (`.game-view.lobby`,
  toggled in `renderRoomState` when `!playing && !battleActive && !ranked && gameMode==="race" && !territory`):
  a two-column layout — a **slot-based roster** (`renderLobbySlots`, one seat per `maxPlayers`) fills the
  left, the **Series** ruleset card sits on the right (equal height), and a **full-width Ready bar** spans
  both below. Empty seats carry an **"+ Add bot"** button (owner, until `maxBots`); bot seats get an inline
  difficulty `<select>` + remove ×; there is **no separate bots card** in the lobby. (`display:contents` on
  `.game-side` lets the scoreboard + series cards become direct grid items; the Ready button in `.game-left`
  spans `grid-column: 1 / -1`.) No empty board, no "Scoreboard". `buildRoomState` exposes `maxPlayers` for
  the seat count. The ranked race battle layout (duo/multi) is `battleActive`, so it
  is unaffected; starting the game removes the `lobby` class and the duel/multi layout takes over.
- **Territory & Tournament** still use the legacy **waiting-room overlay** (`#ranked_searching`, a centred
  full-viewport card): `renderMatchRoster(info)` turns the `members` roster into a filling slot list
  (name + tier chip, "YOU" tag, "Waiting for player…" placeholders) above a mode label + tagline
  (`MODE_TAGLINES`), progress bar, count, and a Leave button. Only newly-arrived rows animate in
  (`matchRosterShown` gate), so existing rows don't re-flash as bots trickle in.

The Learn page is an interactive deduction trainer (`LEARN_COURSES` data
array, ~16 puzzles + ~10 demos). No mine-count deductions — the game
hides the total.

## Configuration (`.env`, auto-loaded; gitignored)

- `PORT` — 1337 local, 8080 in prod.
- `DEV_AUTH=1` — enables the `/auth/dev` login button. **Never set in production.**
- `OAUTH_REDIRECT_BASE` — base URL for OAuth callbacks (`http://localhost:1337` local,
  `https://msbattle.net` prod).
- `google_auth_client_id` / `google_auth_client_secret` (and `discord_*` equivalents; GitHub is still
  wired server-side but no longer shown in the UI) — OAuth credentials. The server reads these plus
  `GOOGLE_CLIENT_ID` / `DISCORD_CLIENT_ID`-style UPPER_CASE names. Sign-in offers **Google + Discord**
  (Facebook is a planned addition); each provider's button only appears when its client ID is configured.
- `stripe_secret_key` / `stripe_webhook_secret` (also read as `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`)
  — the shop's Stripe credentials (see Shop above). Absent locally → every `/api/shop/*` route degrades to
  a clean `503 {error:"shop_unconfigured"}` rather than throwing, so the rest of the server/tests run fine
  without them. Test the webhook locally with the Stripe CLI: `stripe listen --forward-to
  localhost:1337/api/shop/webhook`.

Ranked data persists in SQLite at `ranked.db` (gitignored), or `RANKED_DB` if set.

## Deployment

fly.io app `erik-minesweeper` at msbattle.net. `fly deploy`. The Dockerfile uses
`node:24-alpine`; a fly volume `minesweeper_data` is mounted at `/data` and
`RANKED_DB=/data/ranked.db` keeps ratings across restarts.

The current single-process monolith is deliberate (built to move fast). The **long-term target**
(splitting a stateless control plane from a fleet of authoritative per-match game servers, SQLite →
Postgres, etc.) and the phased migration onto it live in **`ARCHITECTURE_PLAN.md`** — read that before
any re-platforming or service-split work.

**Phase 1 split (built, opt-in via `ROLE`).** The same binary runs as `both` (default — today's
monolith, unchanged), `main` (control plane: lobby/auth/matchmaking/puzzles, owns SQLite, allocates
matches), or `game` (runs live matches handed to it; clients connect directly with a join token). Key
modules: `runtime/role.js` (ROLE + secrets + `GAME_SERVERS`/`MAIN_URL`), `runtime/internalApi.js`
(secret-guarded `/internal/health|report|allocate`), `runtime/gameService.js` (`buildMatchFromConfig` +
allocate/report boundary), `runtime/matchToken.js` (HMAC join token carrying `matchId`+`playerKey`),
`runtime/identity.js` (`playerKeyFor`). Flow: main forms a match → `allocateMatchToGameServer` POSTs the
spec to a game server (falling through draining/down ones) → emits `match_handoff {gameUrl, token}` →
client opens a 2nd socket to the game server (`activeGameSocket()` in Main.js, events bridged via
`onAny`) → game runs it → posts a `ResultReport` to main's `/internal/report` → `persistResult` applies
Elo from the report by `userId` (`elo.applyRankedEloFromReport`), idempotently. Deploy configs +
runbook: `fly.main.toml` / `fly.game.toml` / `DEPLOY_SPLIT.md`. Proven by `test/{split,humanattach,
endtoend,failover,internalapi,elo}.test.js` (real two-process integration) and verified live in a
browser. **Not yet wired:** full live-match reconnection, per-machine addressing for an autoscaled
multi-game-machine fleet, and Postgres/Redis (Phases 2–4). Tickets: `PHASE0_TICKETS.md` / `PHASE1_TICKETS.md`.

## Conventions

- **Hover state is border/opacity only — never a lift, pop, or scale.** No `transform: translateY(...)`,
  `scale(...)`, or added box-shadow "pop" on `:hover` for interactive cards/tiles/buttons/rows
  (avatar swatches, skin options, learn steps/course cards, lobby mode rows, footer icons, etc.) —
  just a `border-color`/`opacity`/`background` change, matching the site's otherwise-clean, static
  visual language. Decorative micro-interactions unrelated to a card/tile hovering (e.g. the logo's
  tiny hover scale) are the only exception. When adding a new interactive element, default to this
  and don't reach for a lift effect even if it "feels natural" — it was deliberately removed
  site-wide.
- Boards are always no-guess solvable; one shared layout per round with the centre
  pre-revealed.
- Board size is a per-room preset (small 10×13 / medium 15×20 / large 16×30) and mines
  are a density fraction of the cells, so difficulty stays consistent across sizes.
  Dimensions are passed into `createGame`/`createTemplate`; the solver and bot derive
  them from the board array; the client receives `rows`/`cols` in room state.
- Ranked uses a fixed ruleset (Best of 5, 5 min rounds by default (`RANKED_RULES.roundSeconds`) —
  Standard's denser 20% board gets 6 min via `roundSeconds: 360`; territory has no clock, 5s mine penalty, medium board,
  10% mines for Sprint / 20% Standard / 15% Tournament), pairwise Elo, tiers, and a leaderboard. Filler bots are tuned to the
  lobby's average rating and trickle into the queue like real players. The tier ladder runs
  0 → 3000 (Bronze I = 0, 200 per sub-tier, Master from 3000); everyone starts/floors at 0 and
  climbs. Gains are bigger for placement games and scale up with margin of victory (see `elo.js`).
  Ratings are **per-style only** (`rating_sprint`/`rating_standard`/`rating_tournament`/
  `rating_territory`) — there is no single legacy `rating` column. Anything needing one "overall"
  number uses the **max across modes**: `overallRating(account)` on the client (topbar chip, profile
  summary), `readUserRating(u)` with no style / `MAX(...)` in `topPlayers` on the server. Per-match
  payloads (scoreboard, search roster, result card) carry the relevant per-style rating via
  `gameUtil.accountRating(acc, style)`.
- Ranked filler bots come from a **pre-benchmarked pool** (`bots-pool.json`, committed),
  not synthesized on the fly. Each pool bot is a random point in the six-variable space
  (speed, per-difficulty thinking, distance multiplier, max-difficulty ceiling, mistake
  rate, chord rate) whose Elo was *measured* by simulating it solving boards at the three
  ranked densities (10/15/20%) and mapping its solve times onto the `configForElo`
  calibration curve. Distinct play styles can land at the same Elo (a fast guesser vs a
  slow, thorough solver). Matchmaking calls `botPlayer.pickBotFromPool(targetElo)`.
  Regenerate with `node scripts/generate-bot-pool.js` (a few minutes; tune with
  `POOL_SIZE` / `BOARDS` / `CAL_SAMPLES` env vars). **Re-run it whenever bot AI, the CSP
  solver/complexity costs, `GEN_MAX_COMPLEXITY`, or the boards change** — the measured solve
  times depend on them. Each pool entry persists its measured per-density `times`, so a pure
  **ladder relabel** (changing only the Elo scale, not the AI) does NOT need a re-bench: run
  `node scripts/rerank-bot-pool.js`, which relabels the stored calibration curve and re-derives
  every bot's rating from its stored times. The pool currently spans the 0–3000 ladder (fastest
  reference config = Master 3000); `BotBench.configForElo` anchors are `ELO_MIN/ELO_MAX = 1000/3000`.
