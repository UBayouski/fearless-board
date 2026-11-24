# Written pre-game note (Gemini)

## Why

The board shows many numbers. Between two games a coach has a few minutes. A short written note that names
the two or three things that stand out makes the board faster to read. It adds no analysis of its own: it
is written from the board's figures by a language model, and every champion and percentage in it is
checked against those figures before it is shown.

A prototype on four series worked: each note took 3 to 6 seconds, about 1,600 input and 220 output tokens
(about $0.002 at the current price of $0.75 / $3.75 per million tokens), and passed the check. Notes are
generated in the pipeline, not in the browser: the key never reaches the app, and the page stays static.

## Rules that must hold

- The key is read from `.env` (`GEMINI_API_KEY`, `GEMINI_MODEL`). It is never printed, logged, written to a
  file or put in a URL (send it in the `x-goog-api-key` header).
- Only the facts object below is sent: names and percentages the board already shows. No match files, no
  raw events.
- `pnpm data` must work without a key and must not call the API. Notes are a separate, opt-in command.
- A note that fails the check is not shown. There is no fallback text written by hand.

This brief is three runs. Do one section, report every numbered item as "done" or "not done" with the file
changed, and stop.

## 1. Facts and check (`packages/shared/src/note.ts`, pure functions with tests)

1. `noteFacts(plan, outlook, names, teamId)` returns this object for one team before one game (`names`
   gives champion, player and team names; percentages are whole numbers):

   ```
   { team, opponent, game, score: "G2 Esports 0 - 2 Movistar KOI",
     championsGoneForBothTeams: [name],
     ownPlayers / opponentPlayers: [{ player, role, usualPicksAlreadyGonePct, limitedHistory?: true,
         usualPicksAlreadyGone: [up to 3 names, the burned champions highest in startLikelihoods],
         likelyPicksNow: [up to 3 of { champion, likelihoodPct, gamesPlayed }] }],
     bansToConsider: [up to 3 of { champion, chanceOpponentPicksItPct, chanceWePickItPct, gapPoints, opponentPlayer }],
         only rows where the gap is above 2 points, in the board's order,
     picksThatAlsoDeny: [up to 3 of { champion, ownPlayer, ownLikelihoodPct, chanceOpponentPicksItPct }] }
   ```

2. `NOTE_PROMPT`: the system text, exactly as in the appendix, and `NOTE_PROMPT_VERSION = 2`.
3. `checkNote(facts, note, championNames)` returns a list of problems (empty means it passes):
   - a champion name from `championNames` that is in the note and not in the facts;
   - a percentage in the note ("51%") whose number is not a value in the facts;
   - more than six percentages; more than 150 words; not exactly three points with the three titles;
   - any of: "favour", "favor", "advantage", "ahead", "will win", "will lose", "likely to win";
   - a field name from the facts ("Pct", "usualPicks", "likelyPicksNow");
   - "he", "his", "she", "her" as whole words.
4. Type `WrittenNote = { headline: string, points: { title: string, text: string }[] }`.
5. Tests: a passing note; one failing case for each rule in item 3 (an invented champion, a number not in
   the facts, a field name, a pronoun, four points); `noteFacts` on a hand-built plan.

## 2. Generation (`packages/pipeline/src/notes.ts`, command `pnpm data:notes`)

1. For every series with two or more games, every game from 2 on and both teams: build the facts from the
   same `gamePlan` and `seriesOutlook` the board uses. No note for game 1 (nothing is burned yet).
2. Call `POST https://generativelanguage.googleapis.com/v1beta/models/<GEMINI_MODEL>:generateContent` with
   `systemInstruction` = `NOTE_PROMPT`, the facts as JSON text, and `generationConfig: { responseMimeType:
   "application/json", temperature: 0.3, thinkingConfig: { thinkingLevel: "low" } }` ("minimal" is
   rejected by this model). Use `fetch`; add no SDK.
3. Check the reply with `checkNote`. On a failed check or invalid JSON, ask once more; if it fails again,
   store the failure and write no note for that team and game.
4. Cache in `packages/pipeline/.cache/notes.json` (the folder is git-ignored), keyed by a SHA-256 of the
   model id, the prompt version and the facts. A second run with unchanged data makes no API call.
5. Six requests at a time. On HTTP 429 or 5xx wait and retry up to four times with a growing delay; on
   another 4xx stop the run with the status and the API's message.
6. Options: `--limit N` (stop after N new API calls), `--series <id>` (one series only).
7. Output: `packages/app/public/data/notes/<seriesId>.json` as
   `{ model, promptVersion, games: { "<gameNumber>": { "<teamId>": WrittenNote } } }`. The manifest gets
   `notes: { model, count }` so the app knows whether notes exist.
8. Summary printed at the end: notes written, from cache, new calls, failed checks (with series, game and
   the problem), input and output tokens, and the cost at the prices in two constants at the top of the
   file ($0.75 and $3.75 per million; they double on 2027-01-01).
9. If `GEMINI_API_KEY` is empty, print one line saying notes were skipped and exit with code 0.

Then run `pnpm data:notes --limit 20`, report the summary and three of the notes, and stop. Do not run it
without a limit; the full run is started by hand after review.

## 3. Board and README

1. A "Pre-game note" block at the top of the "Series outlook" panel, when a note exists for the selected
   game: a two-way switch between the teams (matrix order, first team selected), the headline, and the
   three points as short paragraphs with their titles.
2. Under it, small: "Written by <model> from the figures on this board. Every champion and percentage in
   it was checked against them." The model name comes from the notes file.
3. The note is written before the draft. In draft mode, once an action is entered, it is shown dimmed with
   "written before this draft".
4. No note, no block: game 1, series without notes, or a failed check leave no empty frame.
5. The app loads `notes/<seriesId>.json` only if the manifest says notes exist, and a missing file is not
   an error.
6. Render cases: a note given through props shows the headline and three titles for the first team; no
   note shows no block; no "NaN" or "undefined".
7. README: a "Written note" paragraph under "Method" (what is sent, that it runs on a paid Gemini project
   so prompts are not used to improve Google's products, the check, the cost of a full run from the
   summary), `pnpm data:notes` under the commands, and `.env` setup. State the limit: the note restates the
   board's figures; it contains no judgement of its own.

8. Clean-up from review (WebStorm reports both): in `note.ts` the player facts are built twice with the
   same 20 lines (players with a role, players without); use one helper. In `notes.ts` decode the picks
   with `decodeCompactPicks` instead of a copy of it.
9. `pnpm data` rewrites `manifest.json` and so drops `notes`. Make `pnpm data` keep an existing `notes`
   entry when the notes folder still exists.
10. Notes exist only where there is enough history (`noteWorthwhile`), so many early series have none.
    The README says so.

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm lint` (no warnings), `pnpm data`, `pnpm build`, `pnpm check:data` pass.
No number in `backtest.json` may change. `git status` must show no file under `.cache` or `public/data`.

## Appendix: `NOTE_PROMPT`

```
You write a short pre-game note for the coach of one League of Legends team in a Fearless Draft series (a champion picked by either team in an earlier game is gone for both teams for the rest of the series).
You get facts as JSON, computed by a planning board. "We" is the team in "team".
What the coach needs is the two or three things that stand out, not a list of every player:
- "Their pools": the opponent player who has lost the most of their usual picks (name what is gone and what they are most likely to pick now), and the one who has lost the least.
- "Our pools": the same for our team, in the same order.
- "Bans and picks": the one or two bans from "bansToConsider" with the largest gap between the two chances, and one pick from "picksThatAlsoDeny", saying which opponent it takes a pick from.
Rules:
- Use only names and numbers that appear in the facts. Never add a champion, a player, a number or a fact from your own knowledge of the game.
- Never write a field name from the JSON. Say it in words: "has lost 51% of his usual picks", "a 25% chance".
- At most two players per point and at most five percentages in the whole note.
- For a ban you may quote "gapPoints", the difference between the two chances, as "an 8-point gap" (never with a percent sign). Do not work out any other number yourself.
- Do not predict who wins, and do not say that a team is favoured, ahead, or at an advantage or disadvantage. The score may be stated in a point, never in the headline.
- Do not give reasons from game knowledge (matchups, synergy, meta strength).
- Do not use "he", "his", "she" or "her" for a player; repeat the name or use "they".
- Plain English, short sentences, no hype. If a list in the facts is empty, say so in a few words.
Return JSON: { "headline": one sentence of at most 14 words naming the single most notable fact about a player's pool (for example who has lost the most of their usual picks); never the score, the game number or which team leads, "points": exactly three objects { "title", "text" } with titles "Their pools", "Our pools", "Bans and picks", each text at most 40 words }.
```
