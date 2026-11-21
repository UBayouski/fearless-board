# Series planner: first working board

Goal: open a real series in the app, step through its games, and see for any game what is burned and which
champions each opposing player still has. This is the core of the product; styling comes later.

## Hard rule

Same as `docs/data-spike.md`: match data and anything built from it stays out of git. Output goes only to
`packages/app/public/data/`. Tests use hand-written fixtures. Run `pnpm check:data` before every commit.

## Definitions

- **Burned:** a champion picked by either team in an earlier game of the series. Unavailable to both teams for
  the rest of the series. Bans do not carry over. Confirmed in all 569 multi-game series in the data.
- **Credible option:** a champion the player has actually played in the data, before the date of the series
  being viewed, that is not burned. Always shown with games played and the date last played.
- **As of:** every pool is computed only from games scheduled before the series being viewed. The board must
  never use later games to describe an earlier decision.

## Tasks

### 1. Pipeline fixes

- Two games end up with no picks. Find the cause and fix it, or report why they have none.
- `burnedChampions` in `packages/shared` reads `actions`, but 5 games have no draft actions. Make it read
  `picks`, and keep the tests passing. Add a test for a game with picks and no actions.
- Report counts correctly: games with all 20 draft actions, games with fewer, games with none.
- Write compact JSON (no indentation). Drop `--experimental-strip-types` from the start script; Node 24 does
  not need it.

### 2. Aggregates for the app

The app must not load 745 files. Add to the pipeline output:

- `series-index.json`: one entry per series (id, scheduled start, event, stage, both team ids, number of
  games, series winner), sorted by date.
- `picks.json`: one compact row per player pick across all games (scheduled start, series id, game number,
  team id, player id, champion id, won). The app builds pools from this.
- Player names in the manifest (id and name), so rows can carry ids only.

Add the types to `packages/shared`. Report the size of each file.

Check whether the data gives a player's role (top, jungle, mid, bot, support), for example through roster
order. Report what you find; do not guess roles.

**Stop here and report before task 3.**

### 2b. Corrections after review of tasks 1 and 2

- **Drop unplayed games.** The two games without picks (series 2782419 game 2, series 2885343 game 1) have
  `finished` = `False`, no patch and no champions in `meta/games.csv`: they were never played. Exclude games
  that are not finished from every output file and from the counts. `gameCount` in the series index must
  match. Expected total: 1,737 games.
- **Make `picks.json` compact.** It is 3 MB because every row repeats long keys and a 36-character champion
  id. Write rows as arrays, with champions, players, teams and series referenced by their index in lists
  stored once in the same file. Target: under 500 KB. Put the decoding function in `packages/shared`, with a
  test, so the app never handles the raw arrays.
- **Roles.** The data has no role field, and roster order is not reliable: a player sits in their usual
  position in the list in only 72% of games. Find a method that is reliable and measure it. Two candidates:
  (a) each player's most frequent list position, accepted only if the five players of a team then cover five
  different positions in nearly all games; (b) each player's map position in the first minutes of the game,
  from the match files. Report the share of team-games where the method gives five distinct roles. If neither
  is reliable, say so; the board will then list players without roles.

### 2c. Roles, second attempt

Result of 2b: roster order gives five distinct roles in only 57.9% of team-games, so it is rejected. The
report also said the match files hold no player positions. That is not correct: positions are not in the
event payloads, but every `seriesState` snapshot has `games[].teams[].players[].position` (`x`, `y`), and
`games[].clock.currentSeconds` gives the game time. Checked on series 2754338: at 163 s and 270 s the ten
players are clearly spread over the lanes.

A role is a stable property of a player, so assign roles per player, not per game:

1. For each game, take snapshots between about 150 s and 300 s of game time and average each player's
   position.
2. Classify within each team: mid is the player nearest the centre of the map; the two players who stay
   close to each other in a side lane are the bot duo; the player alone in the other side lane is top; the
   remaining player is the jungler. Do not assume top lane is the upper-left one: teams swap lanes (in series
   2754338 game 1 the top laners start in the lower-right lane).
3. Split the duo into bot carry and support with end-of-game numbers from the final snapshot (the support has
   far fewer unit kills and less money).
4. Give each player the role they get in most of their games. Report: the share of team-games where the five
   players get five distinct roles, and the players whose role is unclear (under 80% agreement).

Write the result as `role` on each player in the manifest (`top`, `jungle`, `mid`, `bot`, `support`, or null
when unclear). If the share of team-games with five distinct roles is under 95%, report that and stop.

The other two corrections in 2b (drop unplayed games, compact `picks.json`) are still open.

### 2d. Roles, corrected method

Result of 2c: 112 of 282 players end up with no role, and the split of the rest is impossible (56 top, 56
mid, 28 bot, 16 support, 14 jungle; there must be about as many of each). Well-known junglers, supports and
bot carries are all unassigned. No wrong labels were found, only missing ones. The reported 99.4% is not a
useful measure: it counts games where the per-game classifier produced five roles, which it does by
construction.

Position alone cannot find junglers and supports. Use item purchases, which are unambiguous, and position
only for the rest. Checked on series 2754338 game 1:

1. **Support:** the player who buys `World Atlas` (`player-purchased-item` events, item name in the target).
2. **Jungle:** the player who buys a jungle pet item at the start (`Gustwalker Hatchling`,
   `Mosstomper Seedling`, `Scorchclaw Pup`). First list every distinct item bought in the first 60 seconds
   across the data and confirm these names; item names may differ by patch.
3. **Bot:** of the three remaining players, the one closest to the support on average between 90 s and 300 s.
4. **Mid:** of the two remaining, the one closer to the centre of the map in that window.
5. **Top:** the last one.

Then give each player the role they get in most of their games, as before.

Measure it properly:

- Share of team-games where steps 1 and 2 each find exactly one player. Expected near 100%.
- Number of players per role. Expected roughly equal.
- Share of team-games where the five players' assigned (majority) roles are five distinct roles. Target 95%.
- List the players with under 80% agreement, with their game counts.

Also: the pipeline now takes 283 s. Read each match file once for both drafts and roles, and report the new
run time.

### 2e. Roles, verified method (replaces 2c and 2d)

Result of 2d: 97 players unassigned and only 3.6% of team-games with five distinct roles. Two assumptions in
2d were wrong: jungle pet items never appear as purchases in the data, and `World Atlas` is bought in only
73.5% of team-games. Remove the item-based code.

The method below was run over all 745 match files (3,461 team-games) before being written here. It uses only
the end-of-game state: the `seriesState` inside each `series-ended-game` event, for the game in `target.id`.

1. **Jungle:** the player with the most neutral-monster objectives. Sum `completionCount` over the player's
   `objectives` whose `type` starts with `slay`. In 3,393 of 3,461 team-games the top player has at least
   twice the count of the next one.
2. **Support:** of the other four, the player with the lowest `totalMoneyEarned`. Where exactly one player
   bought `World Atlas`, this picks the same player in 2,542 of 2,544 team-games.
3. Take each player's majority label over all their games. Result: 279 of 282 players have 80% agreement or
   more (57 jungle, 54 support, 168 other). The three exceptions are Zelt (4 games), BlindWalker (4 games)
   and Malrang (37 games: 27 jungle, 10 support, a real role change). Give Malrang and the two others their
   majority role.

Still to do, for the 168 other players (top, mid, bot):

4. **Bot:** of the three, the one closest on average to their team's support between 90 s and 300 s of game
   time (positions from `seriesState` snapshots, as in 2c).
5. **Mid:** of the remaining two, the one closer to the centre of the map in that window. **Top:** the last.
6. Majority label per player, as above.

Report: players per role (expect about 56 each), the share of team-games where the five majority roles are
distinct (target 95%), and players under 80% agreement with their game counts. Keep reading each match file
only once, and report the run time.

### 3. Shared logic, with tests

In `packages/shared`, pure functions with `node:test` cases:

- `playerPool(picks, playerId, asOf)`: champions the player played before `asOf`, each with games, wins and
  last played date, sorted by games then recency.
- `crediblePool(pool, burned)`: the pool without burned champions, and separately the burned entries, so the
  board can show what the player has lost.

### 4. The board

React, no new UI library. Champions are text tiles for now (no champion images until we know they may be used).

- **Series picker:** list from `series-index.json`, with a filter by team and by event. Default to multi-game
  series.
- **Series view:** one column per game, each showing both teams' picks and bans in draft order, sides and
  winner. Games without draft actions show picks only, marked as such.
- **Burned strip:** the champions burned before the selected game, grouped by the game that burned them.
- **Game selector:** choosing game N shows, for each player of each team, the credible pool as of this series
  and before game N, with games played and last played, and the burned part of the pool struck through.
- Load the selected series file on demand; load the index and `picks.json` once.

**Stop here and report.** Include a screenshot of a best-of-five at game 3.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:data` all pass. No files outside
`packages/app/public/data/` contain generated data.
