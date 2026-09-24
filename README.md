# Go Game Replay

A late-night Go game replayer with **pre-computed KataGo analysis**. Collect games
into a library (from OGS/KGS accounts, SGF uploads, or the seeded classics), approve
the next one, and watch it play out with autoplay, a winrate graph, and engine move
suggestions — all analyzed ahead of time on your own GPU so any device can just watch.

See [PRODUCT.md](./PRODUCT.md) for the full product spec and settled decisions.

## Run it

```bash
npm install
npm run dev          # serves on http://0.0.0.0:4517
```

Open http://localhost:4517. The library is pre-seeded with nine classic games
(AlphaGo–Lee Sedol, Shusaku, Go Seigen). On a phone on the same network, use
`http://<your-LAN-IP>:4517`.

## Analyze games (on the GPU machine)

1. In the library, click **Begin analysis** (or queue a single game from its replay
   page). This only marks games as queued.
2. Run the worker on the machine with the GPU (can be the same machine that runs the
   web server):

```bash
npm run analyze -- --katago /path/to/katago --model /path/to/model.bin.gz --visits 400
# add --server http://<server>:4517 if the web app runs elsewhere
```

The worker drains the queue, posting per-move winrate / score lead / top moves back
to the server as it goes — you can already watch partial results while it runs.
It uses `scripts/katago-analysis.cfg` (winrates reported from Black's perspective).

No KataGo handy? Demo the UI with fake data:

```bash
npm run analyze:mock
```

## Add your games

- **Accounts tab** — register usernames per server (OGS, KGS, DGS, …) and who they
  belong to (Me / Carl / Adam / Gary / other). **Fetch games** pulls recent games
  from OGS, KGS, and DGS; all registered names are used to label library games with
  their person for filtering.
- **DGS credentials** — Dragon Go Server only allows logged-in users to list games,
  so DGS fetching needs your own DGS login in `.env.local`:

```bash
DGS_USERID=your-dgs-handle
DGS_PASSWD=your-dgs-password
```
- **Upload SGF** — drop any `.sgf` files into the library.

## Project layout

- `app/` — Next.js pages (library, accounts, `/game/[id]` replayer) and API routes
- `components/` — goban canvas, replay view, winrate graph, speed slider, …
- `lib/` — SQLite store, SGF parsing, OGS/KGS fetchers
- `scripts/analyzer.mjs` — the KataGo analysis worker
- `data/seed-sgf/` — committed seed games; `data/go-replay.db` — runtime library (gitignored)
