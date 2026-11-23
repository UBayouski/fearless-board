# Live draft mode

## Why

The board stops being useful when the draft starts: it shows likelihoods from before the first ban. During
a real draft, every ban and pick changes what the remaining players can take. This task lets the user enter
bans and picks as they happen, and updates the cells and the ban panel after each one. No new model: the
existing likelihoods are recomputed over the champions still available.

Hard rule and definitions as in `docs/pick-model.md` and `docs/leverage.md`.

## 1. Calculation (`packages/shared`, pure functions with tests)

`conditionLikelihoods(list, unavailable)`: remove the unavailable champions from a player's likelihood list
and rescale the rest to sum to 1. A player who has already picked in this game has no list.

Draft state for one game: an ordered list of actions `{ type: 'ban' | 'pick', teamId, championId, playerId? }`.
From it derive: the champions unavailable in this game (burned, banned, picked), the players who have
picked, and whose turn it is.

**Draft order.** Do not hard-code it from memory. Read the order of ban and pick turns from the draft
actions in the data (side and type per position), print the most common sequence and how many games follow
it, and use that sequence. Games that deviate (missed bans) are handled by position, not by count.

Tests: rescaled lists sum to 1; a banned champion disappears from all ten lists; a picked champion
disappears from all lists and the picking player's list becomes empty; the turn order follows the sequence.

## 2. Backtest (pipeline)

On the test period (series from 2026-01-01, model trained on earlier series), replay each game's real draft
in order. For every pick, take the picking player's list conditioned on all earlier actions of that game,
and record the rank of the actual pick.

- Report top 1, 3 and 5 for the conditioned list and for the list before the draft, on the same picks: all
  picks, and separately by pick position within the team (first to fifth).
- For bans in the second ban phase, report the share in the top 5 and top 8 of ban leverage computed on the
  conditioned lists, against the same lists before the draft.
- Write to `backtest.json` under `liveDraft` and print. Report the numbers as they are. Later picks should
  be easier to rank once earlier ones are known; if they are not, say so and stop.

A pick action in the data has a team and a champion; the player comes from the game's pick list.

## 2b. Corrections after review of sections 1 and 2

The pick backtest is right; an independent recomputation gives the same numbers (top 5: 74.2% conditioned
against 62.8% before the draft).

- **The draft order is hard-coded with blue side first, and that is wrong for half of the 2026 games.** In
  the data, 1,477 of 1,721 complete drafts start with the blue side and 242 with the red side. All 242 are
  from 2026 (LEC: 100 of 239, LCS: 143 of 210): the team that acts first is no longer tied to the side.
  - Keep one turn pattern, expressed as "first team" and "second team", not as blue and red.
  - `draftState` takes the team that acts first as input.
  - In draft mode the user chooses which team acts first (default: the blue side), and the replay takes it
    from the real draft.
  - Add the share of red-first games per league and year to the pipeline's printed summary, and a test for
    a red-first draft.
- **The second-phase ban backtest is missing.** Section 2 asked for the share of second-phase bans in the
  top 5 and top 8 of ban leverage on the conditioned lists, against the lists before the draft.
- **A limit to state in the README:** the pick backtest ranks champions for the player who actually made
  the pick. During a real draft the board does not know which role a team fills next; the user sees all
  open players' lists.

Stop after these corrections and report the second-phase ban table.

## 3. Board

A "Draft game N" button next to "Reveal game N", only in planning mode. It opens draft mode for that game:

- **Draft bar** above the matrix: the turn sequence as 20 slots in two rows (one per team, in the matrix's
  team order), filled as actions are entered, the current slot marked, with the side colours. An "Undo"
  button removes the last action; "Reset" clears all.
- **Entering a ban:** click a row in "Bans to consider", or type a champion name in a search field in the
  draft bar. It fills the current slot if that slot is a ban.
- **Entering a pick:** on a pick turn, the tiles in the picking team's cells become buttons; clicking one
  records that champion for that player. Each open cell also has a small "other champion" search for a
  pick that is not listed. The other team's cells are not clickable on that turn.
- **After each action:** banned and picked champions leave every list, the picking player's cell collapses
  to the pick, all remaining lists are rescaled, and the ban panel is recomputed. A champion that was just
  removed is shown for that one step as a struck tile with "banned" or "picked", so the change is visible.
- **Replay the real draft:** a button that enters the real actions of game N one at a time ("Next action"),
  marking for each pick the rank it had in the player's list at that moment. This shows the future, so it
  is labelled as a replay and asks for confirmation once, like the reveal.
- Leaving draft mode, or changing game or series, clears the draft. Nothing is stored.

The page must stay usable at 1920 x 1080: the draft bar is one compact block, and the matrix stays in view.

## 4. README

Add a short "Live draft" paragraph to "Method" with the backtest table.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm data`, `pnpm build`, `pnpm check:data` pass. Stop after section 2 and
report the turn sequence found in the data and the backtest table; then continue with sections 3 and 4.

## 5. Corrections after review of sections 3 and 4

The draft bar, the first-team choice and ban entry by search exist, and all checks pass. But draft mode does
not work for picks, and about half of section 3 is missing. The checks did not catch it because nothing
tests a draft in progress. Fix the structure first (5.1), then the behaviour (5.2), then the tests (5.3).

### 5.1 Structure: one pure draft session in `packages/shared`

The draft logic is spread over `SeriesBoard.tsx` as six handlers that each recompute the acting team. Move
it to `packages/shared/src/draft.ts` as pure functions with tests, and keep the components thin:

- `DraftSession = { firstTeamId, actions, replay: { remaining: DraftActionInput[] } | null }`.
- `draftReducer(session, event, context)` with events `ban`, `pick`, `undo`, `reset`, `setFirstTeam`,
  `startReplay`, `replayNext`. It rejects (returns the same session) a ban on a pick turn, a pick on a ban
  turn, a pick by a player of the team that is not acting, a pick by a player who already picked, and any
  champion that is unavailable. `undo` during a replay puts the action back at the front of `remaining`.
- `actingTeam(session, teamIds)` – the one place that turns a slot into a team id.
- `liveGamePlan(plan, session)` – returns a `GamePlan` of the same shape with conditioned likelihood lists
  for every player and **ban leverage and denial picks recomputed from those lists**. `PoolMatrix` and
  `LeveragePanel` both receive this plan in draft mode, so they cannot disagree. Remove the separate
  `draftConditioned` prop.
- `firstTeamOfGame(game)` – the team of the first real action, for the replay.

`SeriesBoard` holds the session with `useReducer`.

### 5.2 Behaviour

1. **Picks are recorded under the player's name, not the id** (`PoolMatrixCell.tsx`:
   `onPick(playerName, …)`). So the picked player is never matched: the cell does not collapse and the
   player stays in every calculation. Pass the player id.
2. **The ban panel is not recomputed in draft mode.** It still shows the plan from before the draft. Use
   `liveGamePlan` (5.1).
3. **Rows in "Bans to consider" are not clickable.** On a ban turn, the rows of the acting team's column
   become buttons that enter the ban.
4. **The "other champion" search for picks is missing.** Each open cell of the acting team gets one.
5. **A picked player's cell must collapse to the pick** (champion name, "picked"), not to an empty list.
6. **The removed champion is never shown.** The conditioned lists drop it, so the `draft-unavailable` class
   is never applied. For the one step after an action, show the champion removed by the last action as a
   struck tile labelled "banned" or "picked" in the cells where it was in the top 10 before that action.
7. **Replay:**
   - It takes the first team from the real draft (`firstTeamOfGame`), not from the selector.
   - It asks for confirmation once, like the reveal, and the bar is labelled "Replay of the real draft".
   - For each replayed pick, show the rank the champion had in that player's list just before the pick
     ("picked: rank 3"), or "outside top 10".
   - Manual entry is disabled during a replay.
8. **The default first team is the blue side of this game**, not the first team of the series.
9. **The slots are one wrapped row.** Show two rows, one per team in the matrix's team order, with the team
   name in front; each row holds that team's 10 slots in turn order, with a gap between the two phases.
10. **Changing the game does not clear the draft**, and "Exit Draft" keeps the actions. Both must clear the
    session. Revealing the game also leaves draft mode.
11. **README:** add the limit from section 2b: the backtest ranks champions for the player who actually
    made the pick, while during a real draft the board does not know which role a team fills next. Replace
    "confirming that earlier bans and picks narrow the pool meaningfully" with a plain statement of the
    numbers. Add the second-phase ban row (top 8: 27.3% conditioned against 20.7%).

### 5.3 Tests (required, like the render test)

- `draft.test.ts`: a full 20-action session ends complete; each rejection in 5.1; undo; a red-first
  session; `liveGamePlan` after one ban (the champion is in no list, every list sums to 1, the leverage
  list does not contain it) and after one pick (the player has no list, the champion is gone for all).
- `SeriesBoard` takes an optional `initialSession` prop, used only by tests. Replace the second render case,
  which only checks that the button exists, with a render of a session of 6 bans and 2 picks. Assert: both
  team names in the draft bar, the 8 champion names in the slots, the two picking players' cells show
  "picked", a banned champion appears in no open cell's list, no "NaN" or "undefined".
- Show that the render case fails when the pick is recorded under the player's name again.

Run all checks, then report the two test outputs (failing, then passing).

## 6. Corrections after review of section 5

Done and correct: `draft.ts` with the reducer and `liveGamePlan`, picks by player id, the ban panel
recomputed during a draft, the blue side as default first team, the replay's first team, label and
disabled manual entry. Not done: items 3, 4, 6, 9, 10 and 11 of section 5.2, and half of item 7.

This section is two separate runs. Do 6.1 only, report, and stop. Then 6.2.
In each report, list every numbered item with "done" or "not done" and the file that changed.

### 6.1 Faults

1. **The draft uses the lineup of the game being drafted.** `draftContext.teamPlayers` in `SeriesBoard.tsx`
   is built from `currentGame.picks`, which is the future. Build it from the players in `plan.players` and
   `plan.unknownRolePlayers` (the lineup of the game before).
2. **`pnpm lint` now prints two warnings** (`draftContext` read before its declaration; memoisation not
   preserved). Declare the context before `useReducer`. `pnpm lint` must print no warnings.
3. **Changing the game keeps the old draft and the old first team.** In `App.tsx` the key of `SeriesBoard`
   becomes `${seriesId}-${selectedGame}`, so every game starts clean. Revealing a game leaves draft mode.
4. **`liveGamePlan` has three unused parameters** (`_picks`, `_model`, `_playerRole`). Remove them; take
   the team ids from `plan`, so the signature is `liveGamePlan(plan, session)`.
5. **The third render case is not a test of the fault.** It feeds a wrong session and asserts the wrong
   result. Delete it. In the second case, replace the session with a valid one built by running
   `draftReducer` over 6 different bans and 2 picks (the fixture needs at least 10 champions; the current
   session bans a champion twice and then picks banned champions). Assert on the cells, not on the page:
   the cells of the two players who picked contain the champion name and "picked"; the six banned champions
   appear in no open cell's tile list; both slot rows contain the right names.

### 6.2 Missing parts of the interface

1. **Rows in "Bans to consider" are buttons on a ban turn** (acting team's column only). `LeveragePanel`
   gets `onBan` and the acting team id.
2. **"Other champion" search in each open cell of the picking team**, for a pick that is not in the list.
   Share one small search component with the ban search in the draft bar.
3. **The removed champion stays visible for one step.** `liveGamePlan` also returns
   `lastRemoved: { championId, type } | null`. A cell that had this champion in its top 10 before the last
   action shows it as a struck tile labelled "banned" or "picked". The `unavailable` prop on the cell is
   never true today; remove it.
4. **A picked cell shows the champion's name** with "picked", not the word alone.
5. **Replay:** confirmation once before it starts, with the same wording pattern as the reveal. For each
   replayed pick the picked cell shows "rank N in the list before the pick" or "outside the top 10". The
   rank is computed from the plan one action earlier.
6. **Two slot rows**, one per team in the matrix's team order, team name in front, 10 slots each in turn
   order, a gap between the two phases, the current slot marked.
7. **README:** add the limit (the backtest ranks champions for the player who actually picked; during a
   real draft the board does not know which role a team fills next). Replace the sentence that ends with
   "confirming that earlier bans and picks narrow the pool meaningfully" with the numbers only. Add the
   second-phase ban row: top 8, 27.3% conditioned against 20.7% before the draft.
8. **One render case per item 1 to 6**, using `initialSession`.

All checks pass, and `pnpm lint` prints no warnings.
