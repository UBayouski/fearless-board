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
