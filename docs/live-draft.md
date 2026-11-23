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
