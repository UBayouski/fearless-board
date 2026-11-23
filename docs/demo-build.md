# Demo build: what the hosted site may contain

## Why

The data licence forbids redistributing the data or any derived dataset that "still contains or allows
reconstruction" of it. Section 4(b) allows showing results and statistics to judges, and including "only the
small excerpts of the Data reasonably necessary to demonstrate the Project"; otherwise a project should
load the data from the data repository. The organizers confirmed that a hosted demo with aggregated
statistics is fine, for a project that published no per-round or per-event records.

Today `pnpm data` writes every pick and ban of 1,737 games, plus `picks.json` with one row per player pick.
Served from a public site, that is a copy of the roster and game indexes, not an excerpt. It is fine on a
local machine and must not be deployed.

So there are two builds:

- **Full (local):** unchanged. Everything, read from a local clone of the data. For development and for
  judges who run the project against their own copy.
- **Demo (hosted):** a small set of featured series, with pools precomputed as statistics. This is the only
  build that is ever deployed.

## Tasks

### 1. Featured series

Add `packages/pipeline/featured.ts`: a rule that selects 20 series, no hand-picked ids.

- Best-of-five series only, where all ten players have at least 20 earlier games.
- Spread over leagues and seasons: take the most recent qualifying series per event first, then fill up to
  20 by date, newest first.
- Print the selected list (event, date, teams).

### 2. Demo output

`pnpm data:demo` writes to `packages/app/public/data-demo/` (add it to `.gitignore` and to the pattern in
`scripts/check-no-data.mjs`):

- `manifest.json`: only the teams, players and champions that occur in the featured series, plus
  `mode: "demo"` and the counts of the full dataset (series, games, events, date range) as plain numbers.
- `series-index.json`: the 20 featured series only.
- One file per featured series, containing the draft (as now) and, for each game number N from 2 up, each
  player's pool as of that series: champion, games, wins, last played. These are the statistics the board
  shows; the app must not need `picks.json` in demo mode.
- `backtest.json`: the summary numbers, computed over the full dataset.
- No `picks.json`. No series outside the featured list.

Report the number of files and the total size. Expected: about 23 files, well under 1 MB.

### 3. App

- The app reads `VITE_DATA_DIR` (default `data`; the demo build sets `data-demo`).
- Put pool computation behind one interface with two sources: computed from `picks.json` in full mode, read
  from the series file in demo mode. The components must not know which one is in use. Add a test that both
  sources give the same pools for a fixture series.
- In demo mode the series selector shows a line: "Demo: 20 featured series out of 744. Run the project
  locally with the hackathon data for all of them." with a link to the README section.
- `pnpm build:demo` builds the app in demo mode into `packages/app/dist-demo/` and must fail if that folder
  contains `picks.json` or more than 20 series files.

### 4. README

Add a section "Two builds" explaining the above in a few lines, and the commands for each.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm build:demo`, `pnpm check:data` pass. Report the featured
list and the demo output size.
