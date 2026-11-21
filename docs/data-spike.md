# Data spike: draft extraction

Goal: `pnpm data` reads the local hackathon data and writes the draft JSON the app loads.
Done when the app shows real series and game counts instead of "No draft data found".

## Hard rule

Match data never enters this repo. Read it from `STL_DATA_DIR` (default `../stl-hackathon-2026-grid-starter`).
Write output only to `packages/app/public/data/` (git-ignored). Tests use hand-written fixtures, never copied
records. Run `pnpm check:data` before every commit.

## What is already known (checked 2026-11-20)

- 745 League of Legends series, 1,739 games, 20 events from 2025-01-15 to 2026-10-12 (LCK, LEC, LTA, LCS).
- `meta/games.csv` has, per game: game number, patch, winner, both teams with side.
- `meta/rosters.csv` has, per game: each player and the champion they played. This gives picks without
  opening any match file.
- Match files (`lol/events_<series_id>_grid.jsonl.zst`) are needed for bans and pick order: the game's
  `draftActions` inside `seriesState`. Node's built-in zstd stream reads them; `packages/pipeline/src/zst.ts`
  already does this.
- The last line of a match file is a `grid-ended-feed` event with no `seriesState`. Take the last event that
  has one.
- Fearless rule: in all 569 multi-game series no champion is played twice by either team. The assumption
  in `burnedChampions` (a pick by either team burns the champion for both) matches the data.

## Tasks

1. **Read the index files.** Parse `meta/games.csv`, `meta/rosters.csv`, `meta/teams.csv`,
   `meta/characters.csv` and `lol/series.csv` (rows with `title` = `lol`). Use a real CSV parser: fields are
   quoted and can contain commas.
2. **Build picks.** Produce one `SeriesDraft` per series (types in `packages/shared/src/index.ts`) with each
   game's patch, sides, winner and `picks`.
3. **Add bans and order.** For each match file, read `draftActions` for every game and fill `actions`.
   Print one game's raw `draftActions` first and confirm its shape before writing the mapping.
4. **Reconcile.** Check that the picks in `draftActions` equal the champions in `rosters.csv` for every game.
   Report mismatches; do not hide them.
5. **Explain the exceptions.**
   - 5 series have a team repeating a champion (2 in LCK Split 3 2025, 1 in LTA North Split 3 2025, 2 in LCS
     Split 2 2026). Find out whether these are remakes, data errors or a rule exception.
   - 17 games have 11 roster rows instead of 10. Find out why (substitution, duplicate row) and decide how to
     handle them.
6. **Write output.** `manifest.json` (`Manifest` type) plus the series drafts, split so the app does not load
   one large file. Print the run time for all 745 files and the total output size.

## Report back

- Counts: series, games, games with complete draft actions, mismatches.
- The cause of each exception in task 5.
- Any change needed to the shared types, and why.
