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
  - **KGS** (scrape of the monthly `gameArchives.jsp` pages, current + previous month).
  - Other servers (DGS, IGS/PandaNet, Fox, Tygem) can be registered for name-matching
    but have no fetcher yet.
- Fetches are capped (~30 games) and throttled to be polite; games are deduped by a
  per-source key (`ogs:<id>`, `kgs:<path>`, `upload:<sha1>`, `seed:<file>`).

## Analysis pipeline

Decision: analysis runs on the **owner's local GPU**, not in the cloud — renting a
production GPU was judged not worth the hassle. The web server is the store; any
browser can view results afterward.

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

## Technical decisions

- Stack: Next.js (App Router, TypeScript), Tailwind, shadcn/ui primitives,
  `better-sqlite3` for storage, `@sabaki/sgf` for parsing, `@sabaki/go-board` for
  capture logic. Board is a custom `<canvas>` renderer.
- Storage: single SQLite file `data/go-replay.db` (gitignored). SGF text is stored
  in the DB row. Seed games live in `data/seed-sgf/` (committed) and are ingested on
  first run.
- Server binds `0.0.0.0:4517` so a phone on the same LAN can reach it.
- Seed content: AlphaGo–Lee Sedol games 1–5 (2016), Shusaku's ear-reddening game
  (1846) and an 1855 Shusaku–Gennan game, Go Seigen–Shusai "Game of the Century"
  (1933), Go Seigen–Kitani first Kamakura jubango game (1939). From Andries
  Brouwer's collection (homepages.cwi.nl/~aeb/go).

## Open items

- Owner to supply usernames for Me/Carl/Adam/Gary on their servers, and the
  preferred game source to bulk-download from.
- Possible later: fetchers for DGS/IGS/Fox/Tygem, ownership heatmaps, comment
  display from SGF, multi-device sync beyond LAN (tunnel/hosting).
