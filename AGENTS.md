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
  filters; `lib/game-data.ts` builds the read routes' data.
- `components/` — `replay.tsx` (replayer, panel, control bar, board modes),
  `goban.tsx` (canvas board, Ogatak look; stones on one canvas, circles on a
  layer above that guess mode fades), `review-charts.tsx` (canvas ports of
  ogatak-clear's MOVE QUALITY and GAME STATUS), shadcn primitives in
  `components/ui/`. The review screen is specified in PRODUCT.md "Review
  screen"; its reference implementation is `~/proj/ogatak-clear/src/modules/`
  (`move_report.js`, `board_drawer.js`, `colour_gradients.js`, `utils.js`).
- `lib/db.ts` — SQLite schema, seeding, ingest, analysis queue.
  `lib/sgf.ts` — SGF parsing (server only; `@sabaki/sgf` needs `fs`).
  `lib/gtp.ts` — GTP coordinates, safe to import in the browser.
  `lib/review.ts` — candidate selection, Delta/Visits labels, gradient, and
  guess mode's rating of a played move (`rateMove`).
  `lib/use-stored.ts` — small settings kept in the browser's localStorage.
  `lib/types.ts` — shared types, tracked people.
- `lib/fetchers/{ogs,kgs,dgs}.ts` — game fetchers per server.
- `scripts/analyzer.mjs` — the analysis worker (runs on the PC);
  `scripts/katago-analysis.cfg` — its KataGo config.
  `scripts/pull-tvnik-library.mjs` — copies tvnik's games into this
  machine's database (keys `tvnik:<id>`).
  `scripts/publish-public.mjs` (`npm run publish:public`) — publishes the
  public copy to https://go-replayer.fuseki.net/ from this PC only: committed
  HEAD plus a snapshot of `data/go-replay.db`, uploaded with
  `~/.ssh/fuseki-go-replayer` (it can only publish this site; public half in
  `deploy/publish_from_pc.pub`, target in `deploy/target.json`). See
  PRODUCT.md "Public copy". `--build-only` stops at `.public-build/out`.
- `data/seed-sgf/`, `data/seed-accounts.json` — committed seed content.
  `data/go-replay.db` — the live database (gitignored).

## Remotes

- `origin` — github.com/ernop/go-replay-analysis (public). Never commit
  `.env.local` or `data/go-replay.db`.
- `cursor` — the original Cursor remote the project was started on.

## Machines

- **tvnik** (living-room NUC, Linux Mint, `/home/silver/proj`) hosts the web
  app and the database. LAN address at setup: `192.168.1.140`; the phone opens
  `http://192.168.1.140:4517`.
- **PC** (Ubuntu, hostname `PC`, repo at `/home/ef/proj/go-replay-analysis`)
  runs the analysis worker. As of 2026-09-25 afternoon the GPU is an
  RTX 3090 24 GB (compute capability 8.6, driver 595.91.07). The RTX 5060 Ti
  16 GB was in this same machine that morning; its August thread-sweep
  benchmark was ~1,570 visits/s. On the 3090 the same TensorRT binary and
  net, using `scripts/katago-analysis.cfg` (16 search threads), finished one
  2,000-visit empty-board query at about 1,410 visits/s. The engine cache for
  this card is `~/.katago/trtcache/trt-101601_gpu-1042a4e3_…` (built
  2026-09-25 14:20). KataGo TensorRT wrapper: `~/katago/trt/katago-trt`.
  Net: `~/katago/nets/b10c512h8nbt3tflrs-fson-silu-rsnh.bin.gz`.
  Full install story: mybrowser repo,
  `project-ideas/candidate-projects/katago-local-go-analysis.md`.
- tvnik also has KataGo 1.18.1 (CPU + OpenCL builds) and a b18 net in
  `~/katago/`, used once to prove the pipeline end to end. Its Intel OpenCL
  runtime is user-local: `. ~/katago/gpu-env.sh` before the OpenCL build.
  Too slow for real use (~30–37 visits/s).

## Running (tvnik)

- System Node is 18, too old for Next 16. Node 22 comes from nvm (no sudo on
  tvnik). Non-interactive shells must load it first:
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`
- `npm ci`, then `npm run dev` (port 4517, bound to 0.0.0.0). `npm run lint`
  and `npx tsc --noEmit` must pass before committing.
- Secrets: `.env.local` (gitignored) holds `DGS_USERID` / `DGS_PASSWD`; the
  template is `.env.example`. Only the server machine needs it. The dev server
  reads it at startup, so restart after editing.
- Do not kill the dev server with `pkill -f "next dev"` from a shell whose own
  command line contains that string; it kills the calling shell too.

## Analysis pipeline (how jobs move)

The server never pushes to the worker; the worker pulls.

1. UI "Begin analysis" marks games `queued` in the DB.
2. Worker polls `GET /api/analysis/next` every 5 s; the server hands out the
   oldest queued game (moves, setup stones, rules, komi) and marks it
   `running`. A job stuck in `running` for 15 min is handed out again.
3. Worker sends the whole game to KataGo's JSON analysis engine and posts
   results every 20 positions to `POST /api/analysis/<gameId>`, which merges
   them into `analysis_json`. Partial results are viewable immediately.

Worker on the PC:

    node scripts/analyzer.mjs --server http://192.168.1.140:4517 \
      --katago ~/katago/trt/katago-trt \
      --model ~/katago/nets/b10c512h8nbt3tflrs-fson-silu-rsnh.bin.gz --visits 1500

Verified 2026-09-24 on tvnik with the real engine (game 34, 62 moves, 40
visits, CPU build): all 63 positions posted and stored. `--mock` produces fake
data for UI work; `--once` exits when the queue is empty.

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
  best), never relative to the global board value. Circles carry Ogatak's
  "Delta + Visits" labels (the owner's Ogatak setting); which moves appear is
  Ogatak's count mode, the best plus the 5 lowest-cost moves with at least 1%
  of the position's visits. Details and reasons: PRODUCT.md "Review screen".
- One continuous best→worst gradient (ogatak-clear `green_red`); no special
  colour for the top move.
- Never show the future: no next-move marker, charts end at the current
  move, result hidden until revealed. Guess mode shows a move's own value
  only once that move is on the board (PRODUCT.md "Guess mode").
- "Was that move good" (per-move quality bars, fixed axis: up = White gained,
  down = Black gained) and "who is winning" (score-lead chart) are separate
  charts, never merged.
- Width = candidates within 0.30 pts of best; Width 1 = only one good move.

## Current state and next work (2026-09-26)

- The live library is on tvnik. Queue check 2026-09-25: 579 games with no
  analysis, 2 done, none queued. That database holds the 9 seed games, 177
  `kouchi` games (2004–2011), and 395 `adum` games (Adam = DGS `adum`,
  "adam miller"). `kochi` ("ernie (kochi)") is also the owner's account and
  is not yet registered.
- The PC checkout has `npm ci` done. On 2026-09-25 its database was filled
  from tvnik (`node scripts/pull-tvnik-library.mjs`: 572 DGS games plus the
  9 seeds). A dev server on the PC (`http://192.168.1.27:4517`, ethernet) is
  that copy, separate from tvnik's live database. DGS fetch credentials live
  in tvnik's `.env.local`, not in this clone.
- The worker stores every move KataGo reports, plus the played move's value
  from the following position when KataGo did not report it. It retries a
  failed results post 6 times over about 30 s, because the dev server returns
  500s for a few seconds while it recompiles; before that fix, one such blip
  lost game 398's run.
- The review screen was rebuilt on 2026-09-26 to follow ogatak-clear and to
  never show the future (PRODUCT.md "Review screen"). Guess mode was added
  the same evening (PRODUCT.md "Guess mode"): the board stays clean before
  each move, then briefly shows the move's rating and the mover's other
  options. "Think carefully" pauses, which would build on it, are still
  unbuilt. Open questions: pause-until-tap vs timed pause; whether "found the
  only good move" moments count.
- Analyzed on the PC as of 2026-09-26, at 1,000 visits (about 2 min per game
  on the 3090):
  - game 580 (tvnik game 11, kouchi vs nevizade);
  - Adam's 10 most recent games (ids 394–404; 398 and 395 were re-run
    after the worker restart).
  The phone opens `http://192.168.1.27:4517/game?id=<id>` (older
  `/game/<id>` links redirect). tvnik still runs the older code and has no
  analysis in the new format. This work was committed on 2026-09-26 together
  with the public copy.
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
