# Design pass

Goal: the board looks like a tool a draft coach would keep open during a series, and reads clearly in a
1080p screen recording. Behaviour does not change in this task; only structure, layout and styling.

No new UI library. No champion images, team logos or game artwork: champions stay text tiles.

## 1. Split the app first

`App.tsx` is 972 lines. Move each component to its own file under `packages/app/src/components/`, data
loading to `src/data.ts`, and hash handling to `src/route.ts`. One CSS file per component or CSS modules;
remove unused rules. No behaviour change: `pnpm typecheck`, `pnpm test` and `pnpm build` must pass before
any styling starts. Commit point.

## 2. Look

One committed dark theme (`color-scheme: dark`). All colours as CSS custom properties on `:root`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0d1014` | page |
| `--surface` | `#151a21` | cards, matrix cells |
| `--surface-2` | `#1d242d` | tiles, inputs |
| `--line` | `#2a323d` | borders, grid lines |
| `--text` | `#e8ebf0` | main text |
| `--muted` | `#8a94a3` | labels, secondary numbers |
| `--ember` | `#ff7a1a` | burned: tags, meters, the burned strip |
| `--hit` | `#3ddc97` | reveal: pick was in the pool |
| `--new` | `#ffd166` | reveal: pick not seen before |
| `--blue-side` | `#5b9dff` | blue side label only |
| `--red-side` | `#ff6b6b` | red side label only |

Blue and red mean map side and nothing else. A team is identified by its column (left or right), never by a
colour, because sides change between games.

Type: `Barlow Condensed` (600) for the title, team names, role labels and big numbers; `Inter` for
everything else, with `font-variant-numeric: tabular-nums` on all numbers. Install both through
`@fontsource` packages so the demo does not depend on a font CDN. Role labels are uppercase with a little
letter-spacing.

Burned is the signature of the product. A burned tile is not just struck through: dim text, a 2 px ember
left edge and the game tag ("G1") in ember. The burned strip uses the same treatment.

## 3. Layout

- **Full-width board.** Replace the permanent sidebar with a series selector in the header: a button showing
  the current series that opens a panel with the existing search, filters and list. The board gets the whole
  width.
- **Header line:** team names large, the score as pips (filled for games won, hollow for games still to
  play in the best-of), and the sides for the selected game with the side colours.
- **Order on the page:** header, game stepper (Game 1 to N as real buttons; the selected one marked), the
  pool matrix, then history cards and the burned strip below it. The matrix must start within the first 300
  px of the page at 1920 x 1080.
- **Matrix cell:** the player name, then "14 left" as a large number, then a burn meter: a thin bar whose
  ember part is the burned share, with the percentage beside it. Tiles follow.
- At widths under 900 px the two team columns stack; nothing scrolls sideways.

## 3c. Corrections after review of sections 2 and 3

- **The header gives away the result.** With game 3 selected it shows "3–2" and pips for all five games.
  Planning mode must never show anything from game N or later. Show the score going into game N ("2–0"),
  with pips filled only for games before N and hollow for the rest. Put each team's pips next to its name,
  so it is clear whose they are.
- **Burned tiles in the matrix lost their treatment.** "Rumble G1" now looks like an available champion.
  Apply section 2: dim text, strike-through, a 2 px ember left edge and the game tag in ember. Keep burned
  tiles on their own line, after the available ones.
- **Text is too small for a recording.** Tile text is about 11 px. Use 14 px for champion names and 12 px
  for the numbers; there is spare width in every cell. "14 left" should be the large number in the cell
  (about 28 px, condensed face), with "5 burned" beside it in ember.
- **Team names are still truncated** in the history cards and ban lines ("OKSavingsBank B…"). The cards have
  room: show full names.

## 4. Tiles

- Each available tile shows the champion name, games played, and a thin bar under the name whose length is
  that champion's share of the player's most-played champion, so comfort is visible without reading numbers.
- Recency: tiles last played more than 12 weeks before the series render at 60% opacity. Keep the "3 w ago"
  text.
- Interactive elements are real `button` elements with visible focus rings. Text contrast at least 4.5:1.
- Burned and reveal states must not rely on colour alone (strike, tag, icon or label as well).

## 5. Reveal

- The revealed pick's tile gets a `--hit` outline and its rank ("#2"); a new pick gets a `--new` outline and
  the word "new".
- The summary line becomes a result banner above the matrix: "8 of 10 picks came from the pools shown".
- A 200 ms highlight transition, disabled under `prefers-reduced-motion`.

## 6. First visit and footer

- With no hash, open the most recent best-of-five in the data at game 3, so a visitor never lands on an
  empty page.
- A small "How reliable is this?" line under the matrix, from `backtest.json`: "Across 993 later games, 76%
  of picks were in the pool shown (86% for players with 20 or more earlier games)." Read the numbers from
  the file; do not hard-code them.
- Footer: "Match data: GRID, provided for the Sky's The Limit 2026 hackathon. Not affiliated with or
  endorsed by Riot Games."
- Set the page title and replace the Vite favicon with a simple original mark (an ember-coloured square with
  a diagonal strike).

## Checks before finishing

`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:data` pass. Stop after section 1 and report; stop
again after section 3; then finish.

## 7. Corrections after review of sections 3c to 6

- **First visit lands on a placeholder player.** The most recent best-of-five (series 2950569) lists G2's top
  laner as `LECTest1`, an account that appears in this one series only and so has no history. Choose the
  default series as the most recent best-of-five in which all ten players have at least 20 earlier games.
- **Flag placeholder accounts.** When a player has no earlier games, the cell shows the name with the note
  "no earlier games in the data" in muted text, not "0 left" as a large number and not an ember warning.
- **Backtest line position.** It sits in the footer below a tall empty area. Put it directly under the
  matrix, and remove the empty space between the burned strip and the footer.
- **Backtest wording.** Include the game count from the file: "Across 993 later games, ...".
