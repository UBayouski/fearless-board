# Game view: plan the next game

Goal: the board answers one question at a glance: "going into game N, what can each player still pick?"
Today that answer sits below a full screen of history, and the history includes the games that had not been
played yet. This task reorders the page around the decision and adds a way to check the answer.

Hard rule and definitions: as in `docs/series-planner.md`.

## 1. Fixes

- Give the series board a `key` of the series id, so the selected game resets when the series changes.
- The search box must match team names, not team ids.
- The `support` label overlaps the player name in the game columns; give the role column enough width.
- Put the selected series and game in the URL hash (`#s=<seriesId>&g=<gameNumber>`) and restore them on load
  and on `hashchange`.
- Update the comment on `burnedChampions`: the rule is confirmed in all 569 multi-game series.

## 2. Planning mode

Selecting game N means "we are about to draft game N".

- **Hide the future.** Games N and later are not shown. In their place, one button: "Reveal game N".
- **Default game:** game 3 when the series has one, otherwise game 2.
- **Series state line** under the title: the score going into game N and which team has which side in game N,
  for example "NONGSHIM RED FORCE 2–0 OKSavingsBank BRION · game 3: BRION blue, NONGSHIM red".
- **Compact history.** Earlier games shrink to one narrow card each: winner, the five picks per team in role
  order, and bans as one wrapped line of tiles per team (not ten rows). A team keeps the same colour in every
  game; show the side as a small label.

## 3. The pool matrix (the main view, directly under the series state line)

A grid with five rows (top, jungle, mid, bot, support) and two columns (one per team), so opposing players
sit side by side.

Each cell shows:

- Player name and a one-line summary: champions left, champions burned, and the share of the player's prior
  games that were on burned champions. Example: "14 left · 5 burned · 41% of games burned".
- Available champions as tiles, most played first, each with games played and time since last played
  relative to the series date ("12 g · 3 w ago"). Visible text, not a tooltip.
- Burned champions as struck-through tiles, each marked with the game that burned it ("G1").
- If the player has fewer than 10 prior games in the data, a note: "limited history (n games)".

The burned strip stays, as one line above the matrix.

## 3b. Corrections after review of sections 1 to 3

- **"% of games burned" is wrong.** It shows values like 211% and 260%. It must be the player's prior games
  on burned champions divided by all the player's prior games, so it can never exceed 100%. Put the
  calculation in `packages/shared` with a test.
- **History cards cut off picks.** Each team line shows three of five champions and a truncated team name.
  Show all five picks; let the card be as wide as it needs, and use the short form of long team names only
  if the full name does not fit.
- **Only one reveal button.** With game 3 selected the page offers "Reveal Game 3", "Reveal Game 4" and
  "Reveal Game 5". Show only the button for the selected game; later games stay hidden until "Next game".
- **State does not reset between series.** The `key` is on a `div` inside `SeriesBoard`, which resets
  nothing. Put `key={seriesId}` on the `<SeriesBoard>` element itself.
- **"0w ago".** Use days under two weeks ("3 d ago"), weeks after that.

## 4. Reveal

"Reveal game N" shows what was actually picked in game N, inside the matrix:

- A pick that was in the player's available pool is highlighted in place, with its rank in that pool.
- A pick that was not in the pool is added as a separate tile marked "new" (first time in the data).
- A summary line: "8 of 10 picks came from the available pools".

After the reveal, a "Next game" button moves to game N+1 when it exists.

## 5. Backtest

Add `backtest` to `packages/shared`, with tests, and run it in the pipeline over every game numbered 2 or
higher in a multi-game series:

- Share of picks that were in the player's available pool as of that series.
- Share that were among the player's top 3 and top 5 available champions.
- The same three numbers restricted to players with at least 20 prior games.

Print the results and write them to `backtest.json` in the output folder. Do not tune anything to improve
the numbers; report them as they are.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:data` all pass. Stop after section 3 and report, then
again at the end.
