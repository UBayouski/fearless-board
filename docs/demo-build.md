# Demo build: what the hosted site may contain

## Why

The data licence forbids redistributing the data or any derived dataset that "still contains or allows
reconstruction" of it. Section 4(b) allows showing results and statistics to judges, and including "only the
small excerpts of the Data reasonably necessary to demonstrate the Project".

Today `pnpm data` writes every pick and ban of 1,737 games, plus `picks.json` with one row per player pick,
and the app computes every game plan in the browser from `picks.json`. Served from a public site, that is a
copy of the data, not an excerpt. It is fine on a local machine and must never be deployed.

So there are two builds:

- **Full (local):** unchanged. Everything, computed in the browser from `picks.json`. For development and
  for judges who run the project against their own copy of the data.
- **Demo (hosted):** a small set of featured series. Their game plans are computed in advance and stored as
  statistics (names, counts, percentages). No `picks.json`, no model file, no other series. This is the only
  build that is ever deployed.

The board must look and behave the same in both builds for a featured series: pools, likelihoods, ban panel,
live draft mode, series outlook, pick cost, written note, reveal.

Two runs. Do one section, report every numbered item as "done" or "not done" with the file changed, and
stop. Do not weaken or delete existing tests.

## 1. Pipeline: the demo data

1. **Featured rule.** Add `packages/pipeline/src/featured.ts` with a pure function that selects the
   featured series from the series index and the pick rows. No hand-picked ids. Rule: series with at least four games played
   (`gameCount >= 4`; the index records games played, not the format, and four or more can only be a
   best-of-five) where all ten players of game 1 have appeared in at least 20 earlier series; newest first;
   take the first 20 (the count is a parameter, default 20). The newest qualifying series must come first, because the app opens on it.
   Add a unit test with a small fixture.
2. **Plan encoding.** In `packages/shared/src/` add `planCodec.ts` with `encodePlan(plan)` and
   `decodePlan(json)`: a `GamePlan` as plain JSON and back (Maps and Sets as arrays). To keep files small:
   - likelihood entries keep `championId`, `probability` (rounded to 5 decimals) and `roleShare` (rounded
     to 4 decimals); `features` is dropped (no component reads it; `decodePlan` fills it with zeros);
   - champions are written as indexes into one champion-id list per file, not as repeated ids;
   - `startLikelihoods` is the same for every game of a series, so it is stored once per player per series.
   Add a unit test: for a fixture, `decodePlan(encodePlan(plan))` gives the same pools, burned sets,
   lineup and leverage exactly, and the same likelihood order with probabilities within 0.00001.
3. **`pnpm data:demo`** (new file `packages/pipeline/src/demo.ts`). It reads the finished full output in
   `packages/app/public/data/` (it does not read the raw match files, and stops with a clear message if
   the full output is missing) and writes `packages/app/public/data-demo/`:
   - `manifest.json`: `mode: "demo"`; all champions (the lists refer to them); only the teams and players
     of the featured series; the counts of the full dataset (series, games, events, first and last date) as
     plain numbers; `notes` as in the full manifest but with the count of notes copied.
   - `series-index.json`: the featured series only, newest first.
   - `<seriesId>.json` for each featured series: the draft as in the full output, plus `plans`: one encoded
     plan per game number, computed with the shared `gamePlan` function, exactly as the app computes it.
   - `notes/<seriesId>.json`: copied from the full output where it exists.
   - `backtest.json`: copied from the full output.
   - Nothing else: no `picks.json`, no `model.json`, no series outside the featured list.
   It clears the folder first, then prints the featured list (date, event, teams), the file count and the
   total size. Expected: under 6 MB in total and under 400 KB for any one series file. Report both numbers.
4. **Guards.** Add `packages/app/public/data-demo/` and `dist-demo` to `.gitignore`, and `public/data-demo/`
   to the pattern in `scripts/check-no-data.mjs`. Neither folder is ever committed.

Checks for this run: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm data:demo`, `pnpm check:data`.
Do not run `pnpm data` or `pnpm data:notes`.

## 2. App: two sources for the plan

1. **Data folder.** The app reads the data folder name from `import.meta.env.VITE_DATA_DIR` (default
   `data`) in one helper; every `fetch` in the app goes through it. No other file contains the string
   `data/`.
2. **Plan source.** `SeriesBoard` no longer calls `gamePlan` itself. It receives a function
   `planFor(gameNumber): GamePlan | null`. In full mode `App` builds it from `picks.json` and `model.json`
   as now; in demo mode `App` builds it from the `plans` in the series file with `decodePlan`. No component
   below `App` knows which mode is in use, and in demo mode the app requests neither `picks.json` nor
   `model.json`.
3. **Opening series.** In demo mode the app opens on the first entry of `series-index.json`, game 3. In
   full mode the present rule stays.
4. **Demo line.** In demo mode the series selector shows, above the list: "Demo: N featured series out of
   M. Run the project locally with the hackathon data for all of them." N and M come from the manifest.
   Muted text, no new colours.
5. **`pnpm build:demo`**: builds the app with `VITE_DATA_DIR=data-demo` into `packages/app/dist-demo/`,
   then a script `scripts/check-demo.mjs` fails the build unless all of these hold for `dist-demo`:
   no folder `data`; no `picks.json` or `model.json` anywhere; the number of series files equals the
   length of `series-index.json`; that length is at most 20. Vite copies the whole public folder, so `build:demo`
   removes `dist-demo/data` before the check runs and prints that it did. The README states that only
   `dist-demo` is ever deployed.
6. **Tests.** Add render cases: (a) the board renders from a decoded plan with the same tile names and
   percentages as from the computed plan for the fixture; (b) in demo mode with a draft action entered, the
   ban panel and the matrix still update (live draft works from a decoded plan). Existing cases stay green.
7. **README.** A section "Two builds": what each contains, why, and the commands (`pnpm data`,
   `pnpm data:demo`, `pnpm build`, `pnpm build:demo`). A few lines, no marketing.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm lint` (no warnings), `pnpm build`, `pnpm data:demo`, `pnpm build:demo`,
`pnpm check:data` pass. Report the featured list, the demo output size and the largest file. Do not deploy
anything. Do not run `pnpm data` or `pnpm data:notes`.
