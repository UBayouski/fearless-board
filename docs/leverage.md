# Ban leverage and denial picks

## Why

The board now says what each player is likely to pick. A coach's next question is what to do about it. In
Fearless Draft there are two ways to take a champion away from the opponent:

- **Ban it:** gone for this game only.
- **Pick it yourself:** gone for both teams for the rest of the series.

This task ranks both, using the pick likelihoods that already exist. No new model.

Hard rule and definitions as in `docs/pick-model.md`.

## 1. Calculations (`packages/shared`, pure functions with tests)

Inputs for one game: the likelihood list of each of the ten players (from `buildPickLikelihoods`).

**Threat** of champion `c` from a team: the probability that at least one of its five players picks it,
`1 - product over the five players of (1 - P(player picks c))`. Keep the per-player parts for display.

**Ban leverage** for team A against team B: for every available champion, `threat from B`, with
`threat from A` beside it as the cost (banning it also takes it from your own players). Sort by
`threat from B - threat from A`. Return the top 8, each with the B players it hits (likelihood 5% or more).

**Denial picks** for team A: champions where an A player has played the champion before and has it among
their ten most likely, sorted by `threat from B`. Return the top 5, each with the A player who can take it
(likelihood, games played) and the B players it hits.

Tests on fixtures: a champion only one opposing player wants gets that player's likelihood as threat; a
champion both teams want equally has leverage zero; burned champions never appear; a champion no own player
has played is never a denial pick.

## 2. Backtest (pipeline)

On the test period (series from 2026-01-01, model trained on earlier series, as for the pick model), for
every ban in a game where all ten players have a role:

- Share of actual bans that were in the banning team's top 5 and top 8 by ban leverage.
- The same for two plain lists, as comparison: the opponent's threat alone, and the champions most picked in
  the last 45 days over all roles.
- Report all games, and games 2 and later.

Write the numbers to `backtest.json` under `leverage` and print them. An earlier check on raw pool share
found it barely better than the plain list, so a small gain is a possible result. Report what comes out; do
not tune, and do not hide the comparison.

## 2b. Corrections after review of sections 1 and 2

- **The backtest ran on empty likelihoods, so its numbers are noise.** `backtestLeverage` reads
  `draft.roleCounts`, but the pipeline attaches `roleCounts` and `championsSeen` only to the object it
  re-reads from disk when writing the series file, not to the series in memory. Every player's list is
  therefore empty, every threat is zero, and the ranking is the order of the champion set. That is why
  leverage and threat are identical (2.8% and 5.9%) and far below the plain list (13.9% and 21.1%).
  - Attach `roleCounts` and `championsSeen` to the series in memory when they are computed, and write each
    series file once.
  - `backtestLeverage` must throw if a player with a role gets an empty likelihood list. A silent empty
    result must not be possible. Add a test for that, and a test on a fixture where leverage and threat
    rank differently.
- **Speed.** Likelihoods are rebuilt for every ban, ten times per game, and the set of champions seen and
  the 45-day counts are rebuilt by scanning all picks each time. Compute them once per series, and the
  likelihoods once per game.
- **Sanity check to report:** the opponent-threat list should not be far below the plain 45-day list. If it
  is, look for a second fault before reporting.
- **Design section 7 leftovers** (seen on series 2950569): the cell of a player with no earlier games still
  shows "limited history (0 games)" in ember; remove it there, the muted note is enough. The reliability
  line should start "On games 2 and later of 2026, ...".

Stop after these corrections and report the backtest table and the run time of `pnpm data`.

## 3. Board

A panel directly under the pool matrix, two columns in the same team order as the matrix. Per team:

- **Bans to consider:** up to 8 rows. Champion, a bar for the threat from the opponent, the number as a
  percentage, and in muted text who it hits: "Jojopyun 26% · Elyoya 4%". If the own team's threat is 5% or
  more, add "costs you: Caps 13%".
- **Picks that also deny:** up to 5 rows. Champion, "you: Caps 13% · 9 g", "them: Jojopyun 26%".
- A one-line explanation under the panel title: "A ban removes a champion for this game. A pick removes it
  for both teams for the rest of the series."
- In planning mode this uses nothing from game N or later. After "Reveal game N", mark the champions that
  were actually banned by each team (a small "banned" label) and the picks that were made.

The panel must not push the matrix down: it comes after it. No change to the cells.

## 4. README

Add both definitions and the backtest result to the "Method" section.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm data`, `pnpm build`, `pnpm check:data` pass. Stop after section 2 and
report the backtest table; then continue with sections 3 and 4.
