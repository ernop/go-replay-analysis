<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# go-replay-analysis - Agent Index

A Go game replayer for relaxed watching (often on a phone, in bed): games are
collected into a library, analysed ahead of time by KataGo on the desktop PC's
GPU, and replayed move by move with engine commentary. Parent doc tree:
mybrowser repo `AGENTS.md` (sibling projects table). Durable facts belong in
this repo's docs, not in an agent's private memory.

## Start here

- [`PRODUCT.md`](./PRODUCT.md) — requirements and settled decisions (workflow,
  library tracking, people/accounts, analysis pipeline, review mode). Read it
  before product-affecting changes; record new decisions there.
- [`README.md`](./README.md) — user-facing setup and usage.
- Display rules come from the owner's Ogatak fork,
  [ernop/ogatak-clear](https://github.com/ernop/ogatak-clear) (its `PRODUCT.md`
  and `agents.md`). This app's review mode follows those rules; see
  "Display rules" below and PRODUCT.md "Review mode".

## Code map

- `app/` — Next.js App Router pages (`page.tsx` library, `game/page.tsx`
  replayer at `/game?id=<id>`, `accounts`), read routes under `app/data/`
  (`library.json`, `games/<id>.json`; static in the public copy, live in the
  LAN app, used by both), and write routes under `app/api/` (games, accounts +
  fetch, analysis queue / next job / result posting; LAN only).
- `lib/site-mode.ts` — `SITE_MODE`, "lan" or "public". Keep its one line
 exactly as written: `scripts/publish-public.mjs` rewrites that line to build
 the public copy. `lib/progress.ts` saves viewing progress (LAN: database,
 public: the visitor's localStorage); `lib/library.ts` holds the library
 filters and how players and dates are shown (`handleOf`, `playedOn`,
 `finishedOn`, shared by the library and the replayer); `lib/game-data.ts` builds the read routes'
 data.
- `components/` — `replay.tsx` (replayer: player boxes, big one-move
  controls, board modes, guess mode's timing, its "show analysis" override
  button and its badge settings row, the "info" card with komi, captures
  and dates),
  `goban.tsx` (canvas board, Ogatak look; stones on one canvas, candidate
  marks on a layer above that guess mode fades: analysis mode's circles, or
  guess mode's badges, the options' circles rimmed in the mover's colour
  and centred on their points, and the played move's a rectangle at a
  corner of its stone, edged in the same colour),
  `review-charts.tsx` (canvas ports of
  ogatak-clear's MOVE QUALITY and GAME STATUS, each opening and closing),
  shadcn primitives in `components/ui/`. The review screen is specified in PRODUCT.md "Review
  screen"; its reference implementation is `~/proj/ogatak-clear/src/modules/`
  (`move_report.js`, `board_drawer.js`, `colour_gradients.js`, `utils.js`).
- `lib/db.ts` — SQLite schema (with a small `migrate` for added columns),
  seeding, ingest, analysis queue.
  `lib/sgf.ts` — SGF parsing, including each move's clock time from BL/WL,
  or from `TIMEUSED` (this app's own property, written by the OGS fetcher)
  (server only; `@sabaki/sgf` needs `fs`).
  `lib/gtp.ts` — GTP coordinates, safe to import in the browser.
  `lib/review.ts` — candidate selection, Delta/Visits labels, gradient, and
  guess mode's rating of a played move (`rateMove`).
  `lib/use-stored.ts` — small settings kept in the browser's localStorage.
  `lib/types.ts` — shared types, tracked people.
- `lib/fetchers/{ogs,kgs,dgs}.ts` — game fetchers per server. OGS's also
  reads each game's API record and writes its end date and move times into
  the stored SGF (`ogsRecord`; PRODUCT.md "What the servers record").
- `scripts/analyzer.mjs` — the analysis worker (runs on the PC; 10,000 visits
  by default, and it re-analyses shallower games when the queue is empty);
  `scripts/katago-analysis.cfg` — its KataGo config (4 positions at once).
  `scripts/pull-tvnik-library.mjs` — copies tvnik's games into this
  machine's database (keys `tvnik:<id>`).
  `scripts/publish-public.mjs` (`npm run publish:public`) — publishes the
  public copy to https://go-replayer.fuseki.net/ from this PC only: committed
  HEAD plus a snapshot of `data/go-replay.db`, uploaded with
  `~/.ssh/fuseki-go-replayer` (it can only publish this site; public half in
  `deploy/publish_from_pc.pub`, target in `deploy/target.json`). See
  PRODUCT.md "Public copy". `--build-only` stops at `.public-build/out`;
  `--ref <commit>` builds that commit instead of HEAD.
  `scripts/publish-on-change.mjs` — run every minute by the
  `go-replayer-publish` systemd user timer on the PC (units in
  `deploy/systemd/`, installed in `~/.config/systemd/user/`); publishes
  `origin/main` as soon as it moves, and new analysis at most every 30
  minutes. So pushing `main` is publishing: don't also run `publish:public`
  after a push. `--dry-run` says what it would do next. Log:
  `~/.local/state/go-replayer/publish.log`; last publish (commit, data
  fingerprint, time): `.git/public-published.json`.
- `data/seed-sgf/`, `data/seed-accounts.json` — committed seed content.
  `data/go-replay.db` — the live database (gitignored).

## Remotes

- `origin` — github.com/ernop/go-replay-analysis (public). Never commit
  `.env.local` or `data/go-replay.db`.
- `cursor` — the original Cursor remote the project was started on
  (origin.cursor.com/yolo-so-be-careful/go-replay-analysis). Only tvnik's
  checkout has it and its credentials. It was brought level with GitHub on
  2026-09-26 (on tvnik: `git pull --ff-only origin main && git push cursor
  main`); keeping it current is optional, and `origin` is the one to push.

## Machines

- **PC** (Ubuntu, hostname `PC`, repo at `/home/ef/proj/go-replay-analysis`)
  is the project's home: the library database, the LAN app the phone opens
  (`http://192.168.1.27:4517`, ethernet), the analysis worker, and the
  public copy's publisher. As of 2026-09-25 afternoon the GPU is an
  RTX 3090 24 GB (compute capability 8.6, driver 595.91.07). The RTX 5060 Ti
  16 GB was in this same machine that morning; its August thread-sweep
  benchmark was ~1,570 visits/s. On the 3090 the same TensorRT binary and
  net, with 16 search threads on one position, finished one 2,000-visit
  empty-board query at about 1,410 visits/s. The GPU is the limit: searching
  4 positions at once (the config since 2026-09-29, batch 64) measured ~1,890
  visits/s with the GPU ~95% busy, and 8 × 8 threads was no faster. The
  engine caches for this card are
  `~/.katago/trtcache/trt-101601_gpu-1042a4e3_…_b32` and `…_b64` (built
  2026-09-25). KataGo TensorRT wrapper: `~/katago/trt/katago-trt`.
  Net: `~/katago/nets/b10c512h8nbt3tflrs-fson-silu-rsnh.bin.gz`.
  Full install story: mybrowser repo,
  `project-ideas/candidate-projects/katago-local-go-analysis.md`.
- **tvnik** (living-room NUC, Linux Mint, `/home/silver/proj`, LAN
  `192.168.1.140`) was only a test host: the owner, 2026-09-26, "tvnik was
  just for testing". Its dev server and its own older library still run at
  `http://192.168.1.140:4517`; nothing there needs keeping in step. It also
  has KataGo 1.18.1 (CPU + OpenCL builds) and a b18 net in `~/katago/`, used
  once to prove the pipeline end to end; too slow for real use (~30–37
  visits/s). Its Intel OpenCL runtime is user-local:
  `. ~/katago/gpu-env.sh` before the OpenCL build.

## Running

- On the PC, system Node is 22: `npm ci`, then `npm run dev` (port 4517,
  bound to 0.0.0.0). `npm run lint` and `npx tsc --noEmit` must pass before
  committing. (tvnik's system Node is 18, so there Node 22 comes from nvm:
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`.)
- Secrets: `.env.local` (gitignored) holds `DGS_USERID` / `DGS_PASSWD`; the
  template is `.env.example`. Only the server machine needs it: the PC's
  was copied from tvnik's on 2026-09-26, and its DGS login was checked from
  the PC. The dev server reads it at startup, so restart after editing.
- Do not kill the dev server with `pkill -f "next dev"` from a shell whose own
  command line contains that string; it kills the calling shell too.

## Analysis pipeline (how jobs move)

The server never pushes to the worker; the worker pulls.

1. UI "Begin analysis" marks games `queued` in the DB.
2. Worker polls `GET /api/analysis/next?deepenBelow=<its visits>` every 5 s;
   the server hands out the oldest queued game (moves, setup stones, rules,
   komi) and marks it `running`. A job stuck in `running` for 15 min is
   handed out again. With nothing queued, it hands out the newest `done` game
   whose `analysis_visits` is below the worker's visits, leaving it `done`
   (PRODUCT.md "Analysis depth").
3. Worker sends the whole game to KataGo's JSON analysis engine and posts
   results every 20 positions to `POST /api/analysis/<gameId>`, which merges
   them into `analysis_json`. Partial results are viewable immediately.

Worker on the PC (10,000 visits per position is the default and the rule):

    node scripts/analyzer.mjs --server http://127.0.0.1:4517 \
      --katago ~/katago/trt/katago-trt \
      --model ~/katago/nets/b10c512h8nbt3tflrs-fson-silu-rsnh.bin.gz

Verified 2026-09-24 on tvnik with the real engine (game 34, 62 moves, 40
visits, CPU build): all 63 positions posted and stored. `--mock` produces fake
data for UI work and never re-analyses; `--once` exits when there is nothing
left to do; `--no-deepen` leaves shallower analyses alone.

API routes have no authentication. Acceptable on the home LAN only; add auth
before exposing the app through a tunnel.

## Display rules (from ogatak-clear)

All KataGo values are stored Black-POV (`reportAnalysisWinratesAs = BLACK`).
Convert only at the display layer, and follow these rules:

- No bare signed numbers: "B+2.30", "W 61%".
- Move quality = points the mover threw away vs the best available move,
  always >= 0 (parent root scoreLead − child root scoreLead, flipped for
  White, clamped at 0). Verdicts: <0.5 excellent, <1.5 good, <3 inaccuracy,
  <6 mistake, >=6 blunder.
- Candidates are shown relative to the best move from this position (0 =
  best), never relative to the global board value. In analysis mode circles
  carry Ogatak's "Delta + Visits" labels (the owner's Ogatak setting); guess
  mode's badges carry the points lost, one decimal without a leading zero
  (".3"), the same label as the "lost" readout beside the move counter
  (visits only if the viewer turns them on), one per move: an option's a
  circle centred on its point, with a solid rim in the colour of the stone
  that would have gone there (under every badge, so it never covers a
  number), and kept off the last-move triangle; the played move's at a
  corner of its stone, edged in the mover's colour, as the readout is.
  Default
  text is at
  least 12 px; two − / + steppers at the bottom of the panel scale the
  played and other badges in five steps, 50–200% (100% in the middle).
  Which moves appear is Ogatak's count mode, the
  best plus the 5 lowest-cost moves with at least 1% of the position's
  visits. Details and reasons: PRODUCT.md "Review screen".
- One continuous best→worst gradient, green to a soft red with no browns
  (`lib/review.ts`); no special colour for the top move.
- The last move is a light blue triangle in the lower-right corner of its
  square, its short sides 0.6 of the square (`LAST_MOVE_SIZE`), over the
  stone, in every mode. Not Ogatak's red dot: the owner dislikes red there
  (2026-09-30), and red means a bad move.
- Never show the future: no next-move marker, charts end at the current
  move, and the result appears only once the last move is on the board.
  Guess mode shows a move's own value only once that move is on the board
  (PRODUCT.md "Guess mode").
- Players are marked by colour (a black or white box, a small stone), never
  labelled with the words "Black" / "White", and named by their handle,
  never their real name.
- "Was that move good" (per-move quality bars, fixed axis: up = White gained,
  down = Black gained) and "who is winning" (score-lead chart) are separate
  charts, never merged.
- Width = candidates within 0.30 pts of best; Width 1 = only one good move.

## Current state and next work (2026-09-29)

- The library is the PC's `data/go-replay.db`, filled on 2026-09-25 from
  tvnik's test library (`node scripts/pull-tvnik-library.mjs`: 572 DGS games
  plus the 9 seeds, 581 in all): 177 `kouchi` games (2004–2011) and 395
  `adum` games (Adam = DGS `adum`, "adam miller"). `kochi` ("ernie (kochi)")
  is also the owner's account and is not yet registered.
- The worker stores every move KataGo reports, plus the played move's value
  from the following position when KataGo did not report it. It retries a
  failed results post 6 times over about 30 s, because the dev server returns
  500s for a few seconds while it recompiles; before that fix, one such blip
  lost game 398's run.
- The review screen was rebuilt on 2026-09-26 to follow ogatak-clear and to
  never show the future (PRODUCT.md "Review screen"). Guess mode was added
  the same evening (PRODUCT.md "Guess mode"): the board stays clean before
  each move, then shows the move's rating and the mover's other options.
- On 2026-09-29 the owner reshaped the replay page, and PRODUCT.md "The
  replayer's direction" records his words and what they imply: handles only,
  colour instead of the words Black/White, a gold ring for the side to move,
  small side facts, the result only at the last move, one sans-serif font,
  full-width play/pause and one-move buttons, charts that open and close,
  guess mode's analysis on every move shown (back steps too) with a "hold
  till accepted" setting, finer "every" and "show analysis" steps,
  real-time pacing from SGF clocks, and a green-to-soft-red gradient.
  "Think carefully" pauses, which would build on guess mode, are still
  unbuilt; "hold till accepted" answers the old pause-until-tap question for
  guess mode. Still open: whether "found the only good move" moments count.
- Analysed on the PC: game 580 (tvnik game 11, kouchi vs nevizade) and
  Adam's 10 most recent games (ids 394–404), first at 1,000 visits on
  2026-09-26. From 2026-09-29 14:29 the worker re-analyses them at 10,000
  visits, newest first, about 2.4 h in all; game 580 was done by 14:39. A
  game's `analysis_visits` column reads 10000 once it is redone. The public
  copy follows within 30 minutes of each game.
  The phone opens `http://192.168.1.27:4517/game?id=<id>` (older
  `/game/<id>` links redirect), or the public copy.
- KGS archive pages now ask for a login (found 2026-09-29), so
  `lib/fetchers/kgs.ts` finds no games until it logs in. The game files
  themselves are still public and carry the players' clocks; which servers
  record what (dates, thinking time, sources) is in PRODUCT.md "What the
  servers record".
- Visual checks: `node scripts/review-screenshots.mjs <url> <move> [outDir]
  [mode]` saves 1920×1080, 1024×728, and 390×844 screenshots, paused and
  autoplaying, in the given board mode; guess mode adds a `-rating` shot
  while the move's rating shows. It uses Playwright from
  `~/proj/voice-wei/node_modules`, because Playwright is not a dependency
  here. Prefer it to the in-IDE browser pane: while that pane is hidden it
  cannot take screenshots, and ResizeObserver never fires in it.
- Resetting a test game's progress: `last_viewed_move` and `watched_to_end`
  are set by just opening a game. The screenshot script puts
  `last_viewed_move` back itself; `watched_to_end` cannot be unset through
  the API, so avoid visual checks at a game's last move unless it is already
  watched.
