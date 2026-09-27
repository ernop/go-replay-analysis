# Go Game Replay — Product Spec

A Go game replayer with pre-computed KataGo analysis, built for relaxed late-night
watching without the pain of PandaNet live. You collect games into a library, approve
one, and watch it play out move by move with engine commentary that was computed ahead
of time on your own GPU.

The UI copies the owner's Ogatak fork,
[ernop/ogatak-clear](https://github.com/ernop/ogatak-clear), and the settings in
the owner's own Ogatak `config.json`: near-black background (`#080808`), a
`#111111` panel, white text, amber (`#e0b872`) labels, one monospace font, and a
wood board. Decided 2026-09-26 after the first review screen drifted from
Ogatak's meanings, labels, and style: where this app differs from ogatak-clear,
the reason is written below.

## Core workflow

1. Games arrive in the **Library** (seeded classics, uploaded SGFs, or fetched from
   go servers via the **Accounts** tab).
2. The library shows an **Up next** card: the first game with status `new`. Its result
   is hidden behind a "reveal result" toggle so nothing gets spoiled. **Approve &
   watch** opens the replayer; **Skip** marks it `skipped` and offers the next one.
3. The replayer plays through the game with standard controls: first / previous /
   next / last move, plus **play** (autoplay). Keyboard: `←`/`→` one move,
   `↓`/`↑` ten moves, `Home`/`End`, `Space` = play/pause.
   Autoplay (decided 2026-09-26): the default is 10 s per move, chosen from a
   small "every [10 s]" dropdown (1–30 s) in the control bar, because a big
   slider gave too much room to a minor setting. While playing, a gold bar
   under the board fills toward the next move, so a move never lands without
   warning. Each move gets its own timer, so the bar and the move stay in step.
   The speed, the candidates on/off toggle, and each chart's scale and window
   are remembered in the browser.
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
- Free-form **tags** per game, editable in the replayer (search still matches
  them).
- **Filters**: **analysis done**, status, person (tracked people), win/loss
  (B or W wins), source, board size, even vs handicap, and free-text search
  (players / event / tags). Sorts: newest added, date played, longest.
  **"analysis done" is on by default** (decided 2026-09-26): on the phone the
  owner almost always wants a game whose review is ready. It is a toggle at the
  front of the toolbar. **Up next** follows the filters, so by default it offers
  the next unwatched analyzed game.
- **Game table: one line per game** (the owner's general rule, 2026-09-26: no
  second "sub-row" of other information inside a row).
  - The players' names are the row, with the handicap after them ("H3") when
    there is one. Names end in "…" when too long, the full names show on
    hover, and tapping them opens the game. The event / file code is not shown.
  - Board size, source, move count, and tags have no columns. Size and source
    are still filters.
  - The date is the start date, because that is what "date played" sorts by.
    DGS stores "start,end".
  - Columns appear as the screen widens: players only on a phone; date from
    640 px; people, result, and status from 1024 px; analysis and the Watch
    button from 1280 px.
  - The Up next card is one line too: "UP NEXT", the players, the date, and
    "reveal result". Its buttons are icons below 1280 px, and phones drop the
    date and the reveal link.

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
- Per position (turn 0..N): winrate, score lead, visits, and **every move KataGo
  reported** (coordinate, winrate, score lead, visits, short PV). There is no
  stored cap. A move KataGo never visited is still valued from the root of the
  position after it was played (`source: "continuation"`). Default 400 visits
  per position (`--visits` to change).
- `--mock` mode generates plausible fake data (engine label "MockEngine (demo
  data)") so the UI works without a GPU; used for demos/tests only.

## Review screen (decided 2026-09-26, follows ogatak-clear)

**Never show the future.** A replay is watched without spoilers: nothing on
screen may depend on moves not yet reached. There is no marker on the move
that will be played next. The charts end at the current move. The worker's
stored value for a played move KataGo did not report (`source:
"continuation"`) is never drawn as a candidate. The result stays behind "•••"
until revealed or until the last move.

**Board** (ogatak `board_drawer.js` with the owner's config):

- No coordinates. Wood `#d0ad75`, 1 px black grid, 3 px star points. The last
  move gets a red dot (`#ff6666`).
- Candidates use Ogatak's count mode: the engine's first move plus the 5
  lowest-cost other moves. Ties keep engine order and passes are skipped.
  The owner asked for "the top move plus say 5" on 2026-09-25; Ogatak's
  own count is 10.
- Ogatak's visit minimum for those places is a fixed 50, sized for live
  searches of tens of thousands of visits. At this app's roughly 1,000
  stored visits, 50 hid most real alternatives: all 6 circles showed in only
  27% of positions. The minimum here is therefore 1% of the position's
  visits, which is 10 at 1,000 visits and 50 at 5,000.
- Each circle is stone-sized and filled from ogatak-clear's `green_red`
  palette. Colours are interpolated in linear sRGB, with the scale ending at
  the worst shown move (minimum 0.5 points).
- Each circle holds two lines of black Arial text: "Delta" (for example
  "0" or "-0.42", this move's score minus the best move's, for the side to
  move) and "Visits". This matches the owner's Ogatak setting
  `numbers: "Delta + Visits"`. The text is sized as in Ogatak's
  `board_font_chooser`, so "999" fills 59% of a square.
- A "candidates on/off" toggle hides the circles.

**Panel** (everything right of the board on desktop; below it on phones),
top to bottom:

- **Players strip:** Black box, then game info, then White box. The side to
  move is highlighted with a gold border and marked "TO PLAY". In a panel
  narrower than 560 px the two boxes sit side by side and the info goes
  underneath.
- **Control bar:** navigation, the move counter, the speed dropdown, and the
  candidates toggle.
- **MOVE QUALITY:** a port of ogatak `draw_quality`. One bar per move fills
  its whole slot. Up means White gained, measured as the drop in Black's
  score lead during the move. Black's moves are grey and White's are white.
  Axis labels are gold, and "white gains" / "black gains" name the two
  halves.
- **GAME STATUS:** a port of ogatak `draw_status`. It shows the score line,
  with White's lead filled white above zero and Black's grey below. A yellow
  marker, a dot, and "#move" show where you are.
- Both charts use ogatak-clear's current-line rules:
  - Only moves already reached are plotted, across at least 20 slots.
  - The y scale starts at log₂, matching the owner's config, and a header
    toggle switches to linear.
  - A "full" / "window" toggle with a "last N" box (default 40) switches to
    a sliding window.
  - Clicking a chart jumps to that move, and hovering gives exact values.
  - When the chart is short, an axis label that would overlap its neighbour
    is skipped.
  - "W ahead" / "B ahead" sit on the left, not the right as in Ogatak,
    because at the right edge they collide with the "#move" label.
- **Library actions:** status, tags, and the engine and visits used.

**Removed on the owner's request (2026-09-26):**

- The text block with whose turn, verdict, points lost, best move, and score
  change: "not needed at all".
- The "From here" move table.
- The ring marking the next move, which showed the future.
- The big speed slider.

**Type and colour:**

- One monospace family everywhere, "DejaVu Sans Mono" first, which is what
  Ogatak renders with on the PC.
- Six sizes from ogatak `type_scale.js` at the owner's `info_font_size` 28 and
  zoom 0.62: hero 28, emph 22, body 17, ui 16, caption 14, fine 12 px, as
  `fs-*` utilities.
- Ogatak's grey secondary text is white here (standing rule: no grey text).
- Board and stone images are drawn, not copied, because Ogatak's are AGPL.

**Layout:**

- On desktop the board takes the viewport height, but never more than
  leaves about 430 px for the panel (`min(100vh − 5.5rem, 100vw − 31rem)`).
  At a 1024 px window that is a 513 px board and a panel wide enough for the
  charts.
- On phones (below 1024 px) the page is one scrolling column: board, control
  bar (so taps land in the same place), MOVE QUALITY, GAME STATUS, players,
  and library actions.
- The Next.js dev badge is off (`devIndicators: false`) because it covered
  text on phones.
- Checked by Playwright screenshots at 1920×1080, 1024×728, and 390×844.

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
- **Candidates are shown relative to the best available move** (0 = best),
  never relative to the global board value — a lost game still has a "best
  move from here". The board labels each circle with that difference and its
  visits, as the owner's Ogatak does (see "Review screen").
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

The worker stores every candidate KataGo reports, which is the set Width is
counted from. Visits high enough for stable costs — on the PC (RTX 3090 as of
2026-09-25, TensorRT, b10c512 transformer net, ~1,410 visits/s) ~1,000–2,000
visits per position is about 3–7 min per game. The RTX 5060 Ti that was in the
PC that morning benchmarked at ~1,570 visits/s.

The whole flow must work on a phone in portrait orientation.

## Public copy: go-replayer.fuseki.net (decided 2026-09-26)

The owner's words: "make it so that anyone visiting sees all the games that are
there. From my PC ... that needs a special way to upload stuff to it, like when
I want to get new updates ... everyone who's viewing it will just have their
own local storage in their browser. It just tells them what they've seen, what
they haven't". The owner named the host `go-replayer.fuseki.net`.

- Every game in the library is published, analyzed or not, with the same
  library filters and review screen as the LAN app.
- Each visitor's status (new, skipped, played, done), last viewed move and
  watched-to-end live only in their browser (localStorage key
  `go-replayer.progress`); reaching the last move marks a new or skipped game
  played, as in the LAN app. The owner's own progress is not published.
- Nothing on the public copy writes: no uploads, game fetching, analysis
  queueing or accounts page; tags show read-only.
- Only the owner's PC publishes: `npm run publish:public` builds the committed
  code with a snapshot of `data/go-replay.db` and uploads it with
  `~/.ssh/fuseki-go-replayer`, a key that can only hand a release for this site
  to Fuseki's receiver. New analysis appears publicly after the next publish.
  A release is named by a hash of its files, so data-only updates publish.
- Game pages are `/game?id=<id>` in both builds (one static page for the public
  copy); LAN links to `/game/<id>` redirect.
- The site's CSP allows only same-origin scripts; the publisher moves Next.js's
  inline page-data scripts into `/_scripts/` files, and the page connects only
  to its own origin.

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

- Public copy size: analysis averages about 0.6 MB per game (largest 1.2 MB),
  and Fuseki's receiver takes at most 64 MiB per release, so roughly 100
  analyzed games fit; beyond that the publisher must precompress the data files
  (nginx `gzip_static`) or the receiver's limit must change.

- Owner to supply usernames for Me/Carl/Adam/Gary on their servers, and the
  preferred game source to bulk-download from.
- Possible later: fetchers for DGS/IGS/Fox/Tygem, ownership heatmaps, comment
  display from SGF, multi-device sync beyond LAN (tunnel/hosting).
