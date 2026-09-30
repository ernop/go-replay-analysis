# Go Game Replay — Product Spec

A Go game replayer with pre-computed KataGo analysis, built for relaxed late-night
watching without the pain of PandaNet live. You collect games into a library, approve
one, and watch it play out move by move with engine commentary that was computed ahead
of time on your own GPU.

The UI copies the owner's Ogatak fork,
[ernop/ogatak-clear](https://github.com/ernop/ogatak-clear), and the settings in
the owner's own Ogatak `config.json`: near-black background (`#080808`), a
`#111111` panel, white text, and a wood board. Decided 2026-09-26 after the
first review screen drifted from Ogatak's meanings, labels, and style: where
this app differs from ogatak-clear, the reason is written below. Since
2026-09-29 the replayer uses one standard sans-serif font instead of Ogatak's
monospace, and white rather than amber labels (see "The replayer's
direction").

## Core workflow

1. Games arrive in the **Library** (seeded classics, uploaded SGFs, or fetched from
   go servers via the **Accounts** tab).
2. The library shows an **Up next** card: the first game with status `new`. Its result
   is hidden behind a "reveal result" toggle so nothing gets spoiled. **Approve &
   watch** opens the replayer; **Skip** marks it `skipped` and offers the next one.
3. The replayer plays through the game with two big one-move buttons, a
   play/pause button above them, and small first / last move buttons (see
   "Review screen"). Keyboard: `←`/`→` one move, `↓`/`↑` ten moves,
   `Home`/`End`, `Space` = play/pause, `Enter` = show or hide guess mode's
   analysis.
   Autoplay (decided 2026-09-26, widened 2026-09-29): the default is 10 s per
   move, chosen from a small "every [10 s]" dropdown, because a big slider
   gave too much room to a minor setting. It offers 0.5–60 s in 21 steps
   (0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50,
   60; the owner asked for "more gradations"), plus the players' own times
   (see "Real-time pacing"). While playing, a gold bar under the board fills
   toward the next move, so a move never lands without warning. Each move gets
   its own timer, so the bar and the move stay in step. The speed, the board
   mode (see "Guess mode"), how long guess mode shows its analysis, and each
   chart's scale, window and open/closed state are remembered in the browser.
4. **Begin analysis** (library toolbar) queues every unanalyzed game. A separate
   worker process on the GPU machine drains the queue and posts results back to the
   server, so analysis is *pre-computed* and viewable later from any device (e.g.
   phone in bed, over LAN or a tunnel).

## Library tracking

- Statuses: `new` → (`skipped` |) `played` → `done`. Set by hand with the buttons in
  the replayer and Up next's Skip (the per-row status dropdown was removed on
  2026-09-29).
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
  - **White first, then Black** (decided 2026-09-29), each in its own column:
    the player's name and rank in fixed-width slots (name 12 characters, rank
    3, and after Black the handicap, "H3", 3), so names, ranks and handicaps
    line up down the table whatever the filters show. Then result and date.
    Tapping anywhere on a row opens the game.
  - **Names are the handle only**: DGS's "Real Name (handle)" shows as
    "handle"; a name without one (the seed games' "Lee Sedol") shows whole.
    Longer names end in "…", and hovering shows the full name and rank.
  - **A tracked person shows by their person name** ("Me", "Adam") in a chip
    of their stone's colour: white with black text when they play White,
    black with a white border when they play Black. This replaced the People
    column; the person filter stays.
  - No status or analysis columns (removed 2026-09-29): status is set in the
    replayer or with Skip, and "analysis done" is a filter. Board size,
    source, move count, and tags have no columns either; size and source are
    still filters.
  - The date is the start date, because that is what "date played" sorts by.
    DGS stores "start,end" and SGF allows "start..end" (a 1933 seed game
    spans three months).
  - Columns appear as the screen widens: White and Black on a phone; result
    and date from 640 px; a small Watch button from 1024 px. A last, empty
    column takes the leftover width, so the others keep their fixed widths.
  - The Up next card is one line too: "UP NEXT", the two players as in the
    table, the date, "reveal result", and small buttons at the right (icons
    only below 1280 px). Phones drop the date and the reveal link.
- **Small, quiet chrome** (the owner, 2026-09-29: "make topbar etc much
  smaller and more subtle"). The top bar is 28 px tall with 14 px text; the
  current page is marked in gold, not with a filled tab. Toolbar controls are
  28 px tall with 12 px text; "analysis done" shows as a gold outline when on;
  on a phone the toolbar is one row that scrolls sideways, so the first game
  starts about 170 px down instead of 450. Up next and notices use 14 px
  text, and the table's column labels are 14 px gold.

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
**tvnik** (the living-room NUC). Benchmarked on tvnik (ASUS NUC15, Core Ultra 5 225H,
Arc iGPU, KataGo 1.18.1, b18c384nbt net): ~30 visits/s on CPU and ~35–37 visits/s on
the iGPU via OpenCL — roughly 45–55 min per 250-move game at 400 visits, too slow.
The PC also holds the library and serves the LAN app. tvnik was only a test host
(the owner, 2026-09-26: "its fine they only be here. tvnik was just for testing"),
so its older library is not kept in step and the analysis lives only on the PC and
the public copy.

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
  position after it was played (`source: "continuation"`). 10,000 visits per
  position by default (`--visits` to change; see "Analysis depth").
- `--mock` mode generates plausible fake data (engine label "MockEngine (demo
  data)") so the UI works without a GPU; used for demos/tests only.

## Analysis depth (decided 2026-09-29)

The owner: "we shall do all analysis (new ones and also redo all old ones on
the actual site) til we have at least 10k nodes covered for every step, every
move. the current analysis is a bit too short — many of the options literally
only have 40 nodes as backing them up!"

- Every position of every analysed game gets at least **10,000 visits**. At
  1,000, the alternatives on the board often rested on 10–70 visits. At 10,000
  a middle-game position's top six moves get a few hundred to a few thousand
  each (game 580, move 31: 4,720, 2,745, 614, 282, 244 and 203), and the board's
  visit minimum (1% of the position) becomes 100.
- The worker's default is `--visits 10000`. When nothing is queued, it takes
  the newest analysed game whose analysis has fewer visits and analyses it
  again. The `analysis_visits` column holds the visits of each game's last
  complete run.
  - The game stays `done` throughout, so it never leaves the library's
    "analysis done" filter, here or on the public copy.
  - New positions replace old ones as they arrive, and the game counts as
    deeper only once the run completes.
  - A failed run leaves the game `done` with its old analysis, and it is tried
    again after 15 minutes.
  - `--no-deepen` turns this off, and `--mock` never deepens, so fake data
    cannot replace real analysis.
- Cost on the PC (RTX 3090, b10c512 net): `scripts/katago-analysis.cfg`
  searches 4 positions at once, 16 threads each, in batches of 64. That
  measured ~1,890 visits/s, against ~1,390 one position at a time, with the
  GPU then ~95% busy, so more parallelism would not help. In the first real
  run a position took ~4.5 s: about 15 min for a 200-move game, and about
  2.4 h to redo the 11 games analysed at 1,000 visits (started 2026-09-29).
- The public copy picks the deeper analysis up with its usual data publish, at
  most every 30 minutes.

## The replayer's direction (the owner's requests of 2026-09-29)

The owner, about the replay page: "never use name, always use username only.
Don't repeat the word white/black rather use either textcolor or large stone
with background having distinguishable color to indicate such. the main top
right shall be a border indicating whose turn, the background should indicate
their color, just the username and rank. move komi, date to the side, and make
it subtle. move caps subtle. remove the result data entirely — only show that
once the game is fully done or user hit the arrow to zoom to end of game. use
standard font everywhere varying in size / prominence only. make control
buttons full width and each have a clear border. one row shall say play/pause
next row shall say left/right only. then smaller and out of the way, do the
full zoom to first move, or full zoom to end of game. the point mainly is that
it should be super easy to use left/right one move."

And about guess mode: more "every" steps, plus the players' own time per move
("if the player took n seconds we shall also take n, or 2x n"); "reveal"
renamed "show analysis"; circles that "only say the differential on that
move"; a gradient of "green to subtle red, no browns"; at least 10,000 visits
per position (see "Analysis depth"); openers for the two charts that remember
their state; "when i hit 'back 1' ... act as if this was a newly shown move";
a mode that keeps the analysis "until i tap to go on to the guess stage"
("hold til accepted"); and a smaller disc on the played stone "so it's more
obvious which move was just played!"

Later the same day, the small discs that followed were "just way too small",
and the owner asked instead to "mark the move with a lower-right corner number
and color combo, big enough to be super clear, not ruining the aesthetic, and
also letting me clearly also see which move was the last played actual one".
A first version put a dot on each point and its number in a badge beside it,
moving to whichever side had room; the owner: "no it still has to be
localized near the area the stone is played, and we don't need TWO splotches
of the relevant color" (see "Guess mode"). Then, of the single badges that
hung from each point: "for the played move, use the one you did, and for the
nonplayed ones, use this rounded rectangle but put it directly centered over
the played spot (the line intersection)", with "a slider for how big the
played move's indicator is, and another slider for all the other
indicators", and a setting to "ALSO show 'total visits' for each shown one,
or not".

What these say about what the owner wants, and so how to decide future
questions:

- **The board and one-move stepping are the product.** The page is mostly
  used on a phone in bed, and the action repeated hundreds of times a game is
  one move forward or back. Those two buttons are the biggest controls, with
  play/pause just above them; jumps and settings are small and out of the way.
- **Colour says who; words only say names and values.** Sides are shown as the
  board shows them, in black and white, never with the words "Black" and
  "White". A player is their server handle, not their real name.
- **Quiet until it matters.** Komi, date and captures are seldom needed, so
  they are small and to the side. The result matters once, at the end, and is
  otherwise absent; even a reveal button invites the spoiler.
- **One plain font; hierarchy from size and weight.** No monospace, no
  colour-coded labels.
- **Guess first, then judge, at the viewer's pace and in both directions.**
  The owner studies by predicting each move, and the analysis is the answer
  key. It comes back when a move is revisited, and it can wait for the viewer
  instead of timing out, so autoplay never outruns thinking.
- **Numbers must be trustworthy, and few.** An option backed by 40 visits is
  noise. On the board, guess mode says only how much worse each option was.
- **A calm colour language.** Good is green, bad a soft red, and nothing in
  between looks muddy. The move just played stays a plain stone with its red
  last-move dot.
- **One mark per move, on the move.** Each rated move shows its colour once,
  in the badge that holds its number. An option's badge is centred on its own
  point, so its place alone says which point it marks; the played move's
  sits at a corner of its stone, which cannot be mistaken. A mark that
  wanders to wherever there is room, or a second patch of the same colour,
  reads as clutter.
- **Readable at a glance on a phone, before tidy.** A number on the board
  that needs squinting might as well be absent. Marks shrunk to look neat on
  19 px phone squares were rejected the same day; guess mode's badges keep
  12 px bold text however small the board is, and on a phone reach a little
  past their square to do it.
- **The viewer tunes what he reads.** How big the marks are, and whether
  visits show, are his settings, changed with the board in view.
- **The game's own rhythm, when the record has it.** Pacing can follow how
  long the players really took.

The "think carefully" moments below should follow the same rules.

## Review screen (decided 2026-09-26, follows ogatak-clear; revised 2026-09-29)

**Never show the future.** A replay is watched without spoilers: nothing on
screen may depend on moves not yet reached. There is no marker on the move
that will be played next. The charts end at the current move. The worker's
stored value for a played move KataGo did not report (`source:
"continuation"`) is never drawn as a candidate before the move; guess mode
shows the played move's value only once it is on the board. The result is not
shown at all until the last move is on the board, whether reached by stepping
or with the last-move button; there is no reveal button.

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
- Analysis mode's circles are stone-sized, as in Ogatak; guess mode uses
  badges instead (see "Guess mode"). All are filled from one
  best-to-worst gradient: green `#1fc46a`, `#8fd957`, yellow `#ecea6a`, light
  orange `#fbb870`, and a soft red `#f47c7c`. It replaced ogatak-clear's `green_red`
  on 2026-09-29, whose orange and dark red read as brown (the owner: "green
  to subtle red, no browns"). Every stop is light enough to stand off the
  wood and to carry black text. Colours are interpolated in linear sRGB, with
  the scale ending at the worst shown move (minimum 0.5 points).
- In analysis mode each circle holds two lines of black text in the page's
  font: "Delta" (for example "0" or "-0.42", this move's score minus the best
  move's, for the side to move) and "Visits". This matches the owner's Ogatak
  setting `numbers: "Delta + Visits"`. The text is sized as in Ogatak's
  `board_font_chooser`, so "999" fills 59% of a square. Guess mode's badges
  hold the points lost, and the visits only when the viewer asks for them
  (see "Guess mode").
- A "mode" dropdown chooses what the board shows: `analysis` (these
  circles, for the side to move), `guess` (see "Guess mode"), or `off`
  (stones only; it replaced the "candidates on/off" toggle).

**Panel** (everything right of the board on desktop; below it on phones),
top to bottom:

- **Players:** White's box, then Black's, as in the library. Each box is its
  stone's colour, white with black text or black with white text and a thin
  white border, and holds only the handle and rank: "adum 3d", never "adam
  miller (adum)", and no "WHITE", "BLACK" or "TO PLAY". A gold ring (3 px,
  2 px out from the box) marks the side to move. At the last move the ring
  goes, and the winner's box adds "won +R" (+R, +T, +F or the points; "draw"
  in both boxes for a jigo), with the words ("won by resignation") on hover.
  On phones the boxes sit above the board and their text is a size smaller,
  so a result still fits beside a short handle.
- **Game facts:** the handicap ("H3"), komi, start date, and captures (a small
  white and black stone, each with the stones that side has taken), all in
  caption size. They sit beside the players, stacked, when the panel is at
  least 720 px wide, and in one line underneath otherwise; on phones, below
  the charts.
- **Controls** (the owner: "the point mainly is that it should be super easy
  to use left/right one move"):
  - a full-width play/pause button with a clear 2 px border, gold while
    playing;
  - under it, previous and next move as two half-width 64 px buttons holding
    only an arrow;
  - a small row: first move at the left, last move at the right, and between
    them the move counter and, in guess mode, the "lost" badge;
  - the settings, small: "every", "mode", and in guess mode "show analysis",
    then the badge size sliders and "show visits too". Each slider has a
    notch at every step, numbers at both ends and at 100 and 150, and its
    value in bold beside its label; on a wide panel the two sit side by
    side.
  The buttons turn off double-tap zoom, so fast taps on a phone all count.
- **Move quality:** a port of ogatak `draw_quality`. One bar per move fills
  its whole slot. Up means White gained, measured as the drop in Black's
  score lead during the move. Black's moves are grey and White's are white.
  "white gains" / "black gains" name the two halves.
- **Game status:** a port of ogatak `draw_status`. It shows the score line,
  with White's lead filled white above zero and Black's grey below. A yellow
  marker, a dot, and "#move" show where you are.
- Each chart's heading opens and closes it; each remembers its own state in
  the browser (`replay.quality.open`, `replay.status.open`).
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

**Removed on the owner's request (2026-09-29):** the "•••" result reveal;
the words WHITE, BLACK and TO PLAY; real names; the captures inside the player
boxes; and the game info between the boxes.

**Type and colour:**

- One standard sans-serif family everywhere, the board's labels included: the
  system UI font (`system-ui`, then Segoe UI, Roboto, Ubuntu, Noto Sans,
  Arial). Decided 2026-09-29 (the owner: "use standard font everywhere varying
  in size / prominence only"); it replaced Ogatak's "DejaVu Sans Mono".
- Hierarchy comes only from size and weight. Labels ("move", "lost", "every")
  are white at caption size; values are bold and larger. Gold is kept for
  things that are not text: the turn ring, the countdown bar, and the play
  button's border while playing. The charts' axis labels are white too.
- Six sizes from ogatak `type_scale.js` at the owner's `info_font_size` 28 and
  zoom 0.62: hero 28, emph 22, body 17, ui 16, caption 14, fine 12 px, as
  `fs-*` utilities. Dropdowns use 16 px, below which iPhones zoom in on
  focus.
- Ogatak's grey secondary text is white here (standing rule: no grey text).
- Board and stone images are drawn, not copied, because Ogatak's are AGPL.

**Layout:**

- On desktop the board takes the viewport height, but never more than
  leaves about 430 px for the panel (`min(100vh − 45px, 100vw − 31rem)`; the
  45 px is the top bar and the page's vertical padding, 88 px before the top
  bar shrank on 2026-09-29).
  At a 1024 px window that is a 513 px board and a panel wide enough for the
  charts.
- On phones (below 1024 px) the page is one scrolling column: players,
  board, controls (so taps land in the same place), Move quality, Game status,
  game facts, and library actions.
- The Next.js dev badge is off (`devIndicators: false`) because it covered
  text on phones.
- Checked by Playwright screenshots at 1920×1080, 1024×728, and 390×844.

## Guess mode (decided 2026-09-26, revised 2026-09-29)

The owner's words: "the main mode showing analysis is fine but i want another
'i guess' mode where AFTER the move, it shows the value (loss) it had, and
interesting alternatives, momentarily (controllable). I want to be able to
watch/review in this mode, too."

Guess mode is analysis mode's candidates shown after the move instead of
before it, plus a rating of the move that was played. The viewer guesses each move on
a clean board, then sees how the real move compared.

- **Before a move:** stones and the last-move dot only. Nothing on the board
  depends on the next move.
- **When a move lands**, the stone appears first and about 0.2 s later the
  rating fades in. Since 2026-09-29 this happens whichever way the viewer got
  there: stepping forward or back, autoplay, or any jump or chart click (the
  owner: "when i hit 'back 1' i.e. left arrow, we shall act as if this was a
  newly shown move"). Before, going back showed a clean board. Opening a game
  at its saved move shows nothing. The rating is:
  - The mover's other options: the moves analysis mode showed for that
    position (the engine's first move plus the 5 lowest-cost moves, with the
    same visit minimum), minus the point that was played. Each is one
    rounded badge in its gradient colour, centred on the point's line
    crossing, holding the points it loses against the best move: bold black
    text, one decimal, whole points from 10 up ("12"), "0" for the best.
    There is no other mark on the point. The number is unsigned, like the
    "lost" readout, because every option is at or below the best; the colour
    already says good or bad.
  - Visits are off by default ("the analysis circles shall only say the
    differential on that move"). "show visits too" adds them to every badge,
    the played move's included, as a second line under the points, not bold,
    at 0.8 of their size: an option's own visits, and for the played move
    the visits of the search its value came from (see "Values").
  - The played stone keeps its red last-move dot, never covered, and gets
    a badge at its lower right, 1.15 times larger with a heavier edge, so it
    is the first number the eye finds. A move worse than every alternative
    sets the far end of the colour scale, so it never shares their colour
    (ogatak-clear rule 6).
  - Badge size: by default the text is 0.4 of a square tall, never under
    12 px. That is 22 px on a 1920 px screen's 54 px squares, and 12 px on
    a phone's 19 px squares, where an option's badge reaches a little past
    its square. Two sliders under the settings, "played move size" and
    "other moves size", scale the played move's badge and the options'
    separately, from 50% to 200% in steps of 10 (default 100%). They, and
    "show visits too", show only in guess mode and are kept in the browser
    like the other settings. Changing any of them shows the current move's
    rating, and keeps it up while the setting changes, so the effect is in
    view.
  - Placement: an option's badge is centred on its crossing, with odd pixel
    sizes so it centres exactly on the 1 px lines. Where two options'
    badges would overlap, or one would cover the played stone's red dot,
    they are pushed apart along the line between their points, by at most
    30% of the badge's width or height, so each still covers its own
    crossing; the board's edge holds them in. Any overlap left (at large
    sizes on a phone) is drawn with the option that loses least on top. The
    played stone cannot be mistaken, so its badge alone may take another
    corner of the stone, when the lower right would hide options' badges or
    points; it is drawn above them all.
  - How it got here: until 2026-09-29 these were stone-sized circles like
    analysis mode's. That morning the played stone got a smaller disc ("so
    it's more obvious which move was just played!"), then every option did,
    with a red ring round the played stone for its highlight. On phones the
    discs' text was about 6 px, and the owner found them "just way too
    small". That evening each option became a dot plus a badge that moved
    to whichever side had room, which was neither on the point nor a single
    mark ("it still has to be localized near the area the stone is played,
    and we don't need TWO splotches of the relevant color"). Next came one
    badge hanging from each point to the lower right. The owner kept that
    for the played move and asked for the options' badges to be "directly
    centered over the played spot (the line intersection)", with the two
    size sliders and the visits setting.
  - Next to the move counter: "lost 2.30", with the value as a black-on-colour
    badge in the move's gradient colour ("pass lost …" for a pass). A pass
    has no stone to carry a badge, so there it is the only copy. Its space
    is kept while empty, so nothing shifts when it appears.
- **How long:** "show analysis [3 s]" (named "reveal" until 2026-09-29):
  0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15 or 20 s, "until next move", or
  "hold till accepted". The default 3 s is the owner's "momentarily". A timed
  rating counts from when it has fully faded in, then fades out over 0.5 s.
- **Hold till accepted** (the owner: "keep showing analysis until i tap to go
  on to the guess stage; if this is active and i tap to hide the analysis of
  the move just played, then we move forward to the (either autoplaying or
  manual advancing) next move as usual"). The rating stays until the viewer
  taps the board or presses Enter. While it shows, autoplay waits, with no
  countdown bar, and the play button reads "pause · tap the board to go on".
  The tap hides it and starts a full interval of guessing time before the
  next move; without autoplay the viewer steps on as usual. Tapping while it
  is hidden brings it back, and autoplay waits again.
- **Tapping the board** (or Enter) shows the last move's rating again, or
  hides it early, in every setting.
- **Autoplay:** "every N s" stays the time between moves. With a timed rating,
  the rating takes the start of each interval and the rest is guessing time:
  at the default 10 s and 3 s, about 6 s of clean board. With "until next
  move", or a rating longer than the interval, the next move replaces it.
- Changing mode clears any rating; after switching to guess mode, nothing shows
  until the next move lands. The charts are unchanged: they end at the current
  move, so the move's quality bar appears as it lands.

**Values.** The played move and its alternatives are measured the same way:
points below the engine's first move in the position the mover faced, as on
analysis mode's circles. The played move's own score from that search is
used when it had the board's visit minimum (1% of the position's visits).
Below that its score is unsettled, and the position after the move, which had
a full search of its own, supplies it. Measured 2026-09-26 on the 11 analysed
games (1,919 moves): 10% of played moves were under the minimum, and a quarter
of those were a point or more from the following position's score, against 4%
of better-visited moves. Another 11% were never reported by KataGo; the
worker's `continuation` value for those is the following position's score too.
The visits "show visits too" gives the played move are those of whichever
search supplied its score: its own, or the following position's.

So "lost" can differ from the MOVE QUALITY bar for the same move, which is the
change in the root score across the move (ogatak-clear's definition): by more
than 0.5 points on 18% of those moves, and by more than 1 point on 6%. The
rating uses the candidates' measure so that the played move can be compared
directly with the options drawn around it.

Guess mode is the base for the "think carefully" moments below: they would add
a subtitle and a longer pause before selected moves, and after the move they
show this same rating.

## Real-time pacing (decided 2026-09-29)

The owner: "can't we make it take something like the original games time
intervals? don't we have those in the sgf? i.e. if the player took n seconds we
shall also take n, or 2x n, etc as options in the every list."

- "every" also offers **real ×0.5, ×1, ×1.5, ×2 and ×3**: each move waits as
  long as its player took, times the factor, but at least 1 s so a quick reply
  still shows. A move the record did not time uses the game's median.
- The times come from the SGF: BL/WL, the time left after each move, with
  OB/OW (periods or stones left in overtime), TM and OT, as KGS and CGoban
  write them. Main time, Japanese byo-yomi, Canadian overtime and Fischer are
  understood; the move that starts a new Canadian period cannot be timed.
  `lib/sgf.ts` puts the result in each move's `seconds`. Real-time pacing
  needs times for at least half of the moves.
- **No game in the library has them yet (2026-09-29).** The 572 DGS games are
  correspondence games whose SGFs carry no clock, and their moves take hours
  or days anyway; the 9 seed games have none either. So the real choices show
  disabled, under "as the players took (no clock in this record)".
  - OGS keeps per-move times in its game API (`gamedata.moves[i][2]`, in
    milliseconds) but not in its SGFs, and the OGS fetcher does not read
    them yet.
  - KGS SGFs have BL/WL, but KGS archive pages now ask for a login, so the
    KGS fetcher needs one before it can bring any in.

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
counted from. Stable costs need deep searches; since 2026-09-29 every position
gets at least 10,000 visits (see "Analysis depth"), about 15 min for a
200-move game on the PC's RTX 3090. The RTX 5060 Ti that was in the PC on the
morning of 2026-09-25 benchmarked at ~1,570 visits/s for one position.

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
- **A release may be up to 512 MiB** (decided 2026-09-29; the owner: "let's
  raise it dramatically to like 500MiB and in general we have to be careful
  about these arbitrary limits"). Fuseki's receiver had capped releases at
  64 MiB only because it held each upload in memory; it now streams files to
  disk. The site's policy (`fuseki4_ai/setup/apps/receivers/go-replayer.json`)
  admits 512 MiB, 16,384 files and 64 MiB per file, room for roughly 300 games
  analysed at 10,000 visits.
- **Every push to GitHub's `main` publishes** (decided 2026-09-26; the owner:
  "i want that to autoupdate every time i push to github"). GitHub cannot
  build the site itself, because the games and analysis live only in the PC's
  database and the upload key only on the PC. A systemd user timer on the PC
  (`deploy/systemd/`) therefore runs `scripts/publish-on-change.mjs` a minute
  after each check ends. When `origin/main` has moved, it publishes exactly
  that commit, so a push from any machine counts and the working tree is left
  alone. With the PC on, the site follows a push within about two minutes;
  a push made while the PC is off is published once it is back on. A failed
  publish is retried every 15 minutes, and the log is
  `~/.local/state/go-replayer/publish.log`.
  A self-hosted GitHub Actions runner was rejected: on a public repository,
  anyone's pull request could run code on the PC.
- **New analysis publishes too, at most every 30 minutes** (decided
  2026-09-26, the owner's "yes please" to that offer). The same check notices
  when the database has changed in a way the site shows: new or finished
  analysis, games added or removed, tags, accounts. It then republishes once
  30 minutes have passed since the last publish, so a long analysis run
  reaches the site in half-hourly steps rather than after every batch the
  worker posts. It compares a fingerprint of the published columns (for
  analysis, the time of the last write and the progress, not the analysis
  itself), so watching a game, which saves viewing progress every few seconds
  but is not published, never triggers a build. The fingerprint only decides
  when to build: the release's content hash still decides whether anything is
  uploaded.
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

- Public copy size: at 10,000 visits a game's analysis is almost 3 times its
  size at 1,000, because KataGo reports ~83 moves per position instead of ~30
  (game 580: 0.99 MB against 0.36 MB). An average 180-move game will be about
  1.5 MB. Every publish uploads the whole site, and the PC uploads to Fuseki
  at about 1.8 MiB/s, so a 512 MiB site would take about five minutes each
  half-hourly data publish. If the site grows that large, the publisher
  should send only changed files (the receiver linking the rest from the live
  release) or precompress the data files (nginx `gzip_static`).

- Owner to supply usernames for Me/Carl/Adam/Gary on their servers, and the
  preferred game source to bulk-download from.
- Possible later: fetchers for DGS/IGS/Fox/Tygem, ownership heatmaps, comment
  display from SGF, multi-device sync beyond LAN (tunnel/hosting).
