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

- `app/` — Next.js App Router pages (`page.tsx` library, `game/[id]` replayer,
  `accounts`) and API routes under `app/api/` (games, accounts + fetch,
  analysis queue / next job / result posting).
- `components/` — `replay.tsx` (replayer + controls), `goban.tsx` (canvas
  board), `winrate-graph.tsx`, shadcn primitives in `components/ui/`.
- `lib/db.ts` — SQLite schema, seeding, ingest, analysis queue.
  `lib/sgf.ts` — SGF parsing. `lib/types.ts` — shared types, tracked people.
- `lib/fetchers/{ogs,kgs,dgs}.ts` — game fetchers per server.
- `scripts/analyzer.mjs` — the analysis worker (runs on the PC);
  `scripts/katago-analysis.cfg` — its KataGo config.
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
- **PC** (Ubuntu, RTX 5060 Ti 16 GB) runs only the analysis worker. KataGo
  TensorRT wrapper at `~/katago/trt/katago-trt`, transformer net at
  `~/katago/nets/b10c512h8nbt3tflrs-fson-silu-rsnh.bin.gz` (~1,570 visits/s).
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
- Candidates are shown as cost vs the best move from this position (0 =
  best), never as visits, never relative to the global board value.
  Visibility depends only on cost, not visits.
- One continuous best→worst gradient; no special colour for the top move.
  The current blue/green scheme and the combined winrate+score graph are
  stock-Ogatak leftovers to be replaced.
- "Was that move good" (per-move quality bars, fixed axis: up = White gained,
  down = Black gained) and "who is winning" (score-lead chart) are separate
  charts, never merged.
- Width = candidates within 0.30 pts of best; Width 1 = only one good move.

## Current state and next work (2026-09-24)

- Library: 9 seed games, 177 `kouchi` games (2004–2011), 395 `adum` games
  (Adam = DGS `adum`, "adam miller"). `kochi` ("ernie (kochi)") is also the
  owner's account and is not yet registered.
- Next: review mode ("think carefully" moments), specified in PRODUCT.md.
  First step is extending the worker to store compact costs for all reported
  candidates (today it keeps the top 6), so Width and the reveal can be
  computed. Open questions for the owner: pause-until-tap vs timed pause at a
  key moment; whether "found the only good move" moments count.
