# Go Game Replay — Product Spec

A Go game replayer with pre-computed KataGo analysis, built for relaxed late-night
watching without the pain of PandaNet live. You collect games into a library, approve
one, and watch it play out move by move with engine commentary that was computed ahead
of time on your own GPU.

The UI design language follows [ogatak](https://github.com/rooklift/ogatak) (the
owner's KataGo GUI): near-black background (`#080808`), white text, amber accent
(`#e0b872`) for labels, blue (`#77dddd`) for the engine's top move, green (`#99dd55`)
for other candidates, wood-colored board.

## Core workflow

1. Games arrive in the **Library** (seeded classics, uploaded SGFs, or fetched from
   go servers via the **Accounts** tab).
2. The library shows an **Up next** card: the first game with status `new`. Its result
   is hidden behind a "reveal result" toggle so nothing gets spoiled. **Approve &
   watch** opens the replayer; **Skip** marks it `skipped` and offers the next one.
3. The replayer plays through the game with standard controls: first / previous /
   next / last move, plus **Play** (autoplay) with a speed slider (0.5–5 s/move).
   Keyboard: `←`/`→` one move, `↓`/`↑` ten moves, `Home`/`End`, `Space` = play/pause.
4. **Begin analysis** (library toolbar) queues every unanalyzed game. A separate
   worker process on the GPU machine drains the queue and posts results back to the
   server, so analysis is *pre-computed* and viewable later from any device (e.g.
   phone in bed, over LAN or a tunnel).

## Library tracking

- Statuses: `new` → (`skipped` |) `played` → `done`. Manual via a status dropdown per
  row and buttons in the replayer.
- **Auto-tracking**: reaching the final move of a game automatically marks it
  `played` (if it was `new`/`skipped`) and records `watched to end ✓`. The last
  viewed move is saved continuously, so a game resumes where you left off.
- Free-form **tags** per game, editable inline in the table and the replayer.
- **Filters**: status, person (tracked people), win/loss (B or W wins), source,
  board size, even vs handicap, free-text search (players / event / tags). Sorts:
  newest added, date played, longest.

## People & accounts

- Tracked people: **Me, Carl, Adam, Gary** (constants in `lib/types.ts`), plus
  arbitrary "Other" names. Their actual server usernames get registered on the
  Accounts tab (usernames still to be provided by the owner).
- An account = (server, username, person). Games are labeled with people by
  case-insensitive username match against black/white player names (across all
  servers — usernames are assumed distinctive enough; revisit if collisions appear).
- **Automatic game fetching** is implemented for:
  - **OGS** (online-go.com REST API: player search → recent finished games → SGF),
  - **KGS** (scrape of the monthly `gameArchives.jsp` pages, current + previous month),
  - **DGS** (Dragon Go Server "quick suite": `quick_do.php` JSON API for user lookup
    and finished-game lists, public `sgf.php` for downloads). DGS removed all
    anonymous list access, so fetching requires the owner's own DGS login in
    `.env.local` (`DGS_USERID` / `DGS_PASSWD`); credentials are used once per fetch
    and never stored in the DB. The fetcher pages through the user's complete
    finished-games archive (100 per page, capped at 400 games) because tracked
    players have 10+ year archives and old games matter (e.g. the owner's old simul
    games against Adam, ~2015).
    Verified 2026-09: the owner's Adam is DGS handle **`adum`** ("adam miller",
    active, 428+ finished games, played `kouchi` at 2d–3d in 2004–2009). The
    handles `Adam` (an unrelated one-login 2005 account) and `rbadam` (nonexistent)
    are NOT him. The owner's old accounts are `kouchi` (games 2004–2011) and `kochi`
    (player name "ernie (kochi)"; found 2026-09-24 in an adum game — not yet
    registered). The ~2015 simul games are not in kouchi's archive. Both `adum` and `kouchi` are seeded in
    `data/seed-accounts.json` (loaded when the accounts table is empty). The DGS
    list API returns games newest first, so the 400 cap keeps the most recent. Password
    recovery for old DGS accounts: https://www.dragongoserver.net/forgot.php
  - Other servers (IGS/PandaNet, Fox, Tygem) can be registered for name-matching
    but have no fetcher yet.
- DGS names players as "Real Name (handle)", so person-matching also matches a
  registered username appearing as `(handle)` inside the player name.
- Fetches are capped (~30 games) and throttled to be polite; games are deduped by a
  per-source key (`ogs:<id>`, `kgs:<path>`, `upload:<sha1>`, `seed:<file>`).

## Analysis pipeline

Decision: analysis runs on the **owner's local GPU**, not in the cloud — renting a
production GPU was judged not worth the hassle. The web server is the store; any
browser can view results afterward.
Decided 2026-09: the worker runs on the owner's **desktop PC** (discrete GPU), not
**tvnik** (the living-room NUC) that hosts the web app. Benchmarked on tvnik (ASUS NUC15, Core Ultra 5 225H,
Arc iGPU, KataGo 1.18.1, b18c384nbt net): ~30 visits/s on CPU and ~35–37 visits/s on
the iGPU via OpenCL — roughly 45–55 min per 250-move game at 400 visits, too slow.

- Data flow: UI queues games → `GET /api/analysis/next` hands the worker one job
  (moves in GTP coordinates, initial stones, rules, komi) and marks it `running` →
  worker posts batches to `POST /api/analysis/<gameId>` → server merges into
  `analysis_json` on the game row. Stuck `running` jobs are re-handed out after
  15 minutes. Queue order is FIFO.
- Worker: `scripts/analyzer.mjs`, speaking KataGo's JSON analysis-engine protocol.
  Ships with `scripts/katago-analysis.cfg` which sets
  `reportAnalysisWinratesAs = BLACK` — **all stored winrates/score leads are from
  Black's perspective**; the UI converts to side-to-move where needed.
- Per position (turn 0..N): winrate, score lead, visits, and top ≤6 candidate moves
  with PV. Default 400 visits per position (`--visits` to change).
- `--mock` mode generates plausible fake data (engine label "MockEngine (demo
  data)") so the UI works without a GPU; used for demos/tests only.
- Replay analysis display: black/white winrate bar, score lead, last-move winrate
  delta (green/yellow/red at −2%/−6%), clickable winrate+score graph across the whole
  game, and on-board candidate overlays (blue = best, green = others, showing
  winrate% and visits; red ring = the move actually played next).

## Review mode: "think carefully" moments (requested 2026-09-24, not yet built)

The target experience: press **Play** and the game plays itself at a relaxed
~10–15 s per move. Most moves pass quietly. At the **10–20 most significant
moments per game** (split between both players) a subtitle appears *before*
the move: **"Think carefully about Black's next move."** The viewer gets time to
think; then the actual move is played and the board **explains it**: the move
played, the best move, and the other real options, shown with clear colours and
plain text ("Black played D4 — lost 4.20 pts. Best was Q10.").

Rules inherited from the owner's Ogatak fork (github.com/ernop/ogatak-clear,
its PRODUCT.md is the reference; these supersede the stock-Ogatak display
described under *Analysis pipeline*):

- **No bare signed numbers.** Values name the colour they favour: "B+2.30",
  "W 61%". Reason: POV-dependent signs force mental translation on every move.
- **Move quality = points thrown away by the mover, ≥ 0**, vs the best move
  available *from that position* (parent root scoreLead − child root
  scoreLead, sign-flipped for White, clamped at 0). Verdicts: <0.5 excellent,
  <1.5 good, <3 inaccuracy, <6 mistake, ≥6 blunder.
- **Candidates are shown as cost vs the best available move** (0 = best),
  never as visits, and never relative to the global board value — a lost game
  still has a "best move from here".
- **One continuous best→worst gradient** (green → red), no special colour for
  the top move. This replaces the stock blue/green scheme.
- **"Was that move good" and "who is winning" are different questions** and
  get separate charts: a per-move quality bar chart on a fixed axis (up =
  White gained, down = Black gained) and a score-lead chart (W above, B below).
- **Width** = number of candidates within 0.30 pts of the best. Width 1 means
  only one good move exists — a strong "think carefully" signal even when the
  player found it.

Choosing moments: rank each position by the mover's points lost (relative to
that game's typical loss) and by narrowness (low Width with a large gap to the
2nd-best move); take the top 10–20, roughly balanced between Black and White.
Computed from stored analysis in the app, so the thresholds can be tuned
without re-analysing.

Data this needs from the worker (beyond today's top-6): a compact cost list
for all reported candidates (Ogatak stores the top 50), enough candidates with
PVs to explain the choice, and visits high enough for stable costs — on the
PC (RTX 5060 Ti, TensorRT, b10c512 transformer net, ~1,570 visits/s) ~1,000–2,000
visits per position is ~3–6 min per game.

The whole flow must work on a phone in portrait orientation.

## Technical decisions

- Stack: Next.js (App Router, TypeScript), Tailwind, shadcn/ui primitives,
  `better-sqlite3` for storage, `@sabaki/sgf` for parsing, `@sabaki/go-board` for
  capture logic. Board is a custom `<canvas>` renderer.
- Storage: single SQLite file `data/go-replay.db` (gitignored). SGF text is stored
  in the DB row. Seed games live in `data/seed-sgf/` (committed) and are ingested on
  first run.
- Server binds `0.0.0.0:4517` so a phone on the same LAN can reach it. Next.js dev
  mode blocks cross-origin dev-asset requests from anything but `localhost`, which
  froze the app when opened via `127.0.0.1` or a LAN IP — `allowedDevOrigins` in
  `next.config.ts` therefore allows loopback and private-network (192.168/10/172)
  hostnames. Production (`npm start`) has no such restriction.
- Seed content: AlphaGo–Lee Sedol games 1–5 (2016), Shusaku's ear-reddening game
  (1846) and an 1855 Shusaku–Gennan game, Go Seigen–Shusai "Game of the Century"
  (1933), Go Seigen–Kitani first Kamakura jubango game (1939). From Andries
  Brouwer's collection (homepages.cwi.nl/~aeb/go).

## Open items

- Owner to supply usernames for Me/Carl/Adam/Gary on their servers, and the
  preferred game source to bulk-download from.
- Possible later: fetchers for DGS/IGS/Fox/Tygem, ownership heatmaps, comment
  display from SGF, multi-device sync beyond LAN (tunnel/hosting).
