# Redesign: the board as a draft desk

## Why

The page worked but was flat: three quarters of the text at 12 px or less, three colours carrying all of
it, 94 identical tiles, and the series story split across four places. Nothing on it could only belong to
a Fearless Draft tool. This redesign changes layout, type, colour and the three views. It changes no
calculation, no model output, no data format and no demo packaging.

## Reference

The agreed design is a static mockup kept outside this repository, because it embeds the picks and bans of
one series: `hackathon/cloud9/mockups/board-final-two-level.html` (with `game5.js`). It shows game 5 of
G2 Esports against Movistar KOI. Views and options by address: `?view=planning|draft|reveal`,
`&theme=light|dark`, `&icons=off`. Earlier mockups in that folder are superseded. Where this document and
the mockup disagree, this document wins; say so in the review.

The mockup was frozen on 2026-11-23. Further design changes go into this document, not into the mockup.

Do not copy the mockup or its data file into this repository.

## The design

### Shared by all views

- **Scoreboard:** open on the page background, with no box and no gradient. Four parts, top to bottom:
  1. A quiet line of match details in sentence case: league, stage and game number
     ("LEC Spring 2026, playoffs, game 5"). No date. The game number is bold and in the normal text
     colour; the rest is muted.
  2. Both team names and the score in the display face. The score is about a fifth larger than the names
     (68 px against 56 px on a wide screen). The dash has the same weight and colour as the digits.
  3. The side of each team under its name, capitalised as a label: "Blue side", "Red side". Not in full
     capitals.
  4. One short line for the state of the game, on its own, in the normal text colour and bold. It does
     not repeat the game number, which is in the details line: "Score before the draft" in planning and
     practice; after reveal "G2 Esports won this game", or "G2 Esports won the series" when that game
     decided it. It is never green: green means a forecast hit only.
  The game number appears once in the header. It also labels the game's box in the burn track and the
  "Reveal game N" button, where it identifies a game and an action.
- **Burn track:** the five games as one strip, and the game navigation. A played game shows its ten picks
  as charred chips, one row per team, the winner's name stronger. The current game has a heavy border and
  the count of champions burned for both teams. Later games are empty. It replaces the game buttons, the
  two history cards and the "Burned Champions" strip. On reveal it shrinks to one line per game.
- **Themes:** light ("daylight", the default look) and dark, with a switch. First visit follows the system
  setting; the choice is remembered.
- **Icons:** a switch between champion icons and names only. Names only renders no image element, so
  nothing is requested from Riot's server.
- **Type:** Big Shoulders Display for names, scores and numbers; Figtree for text. Both bundled with the
  app, not loaded from Google. Text is 13 px or larger, except the two-line draft slots and tags.
- **Colour roles, strictly:** blue and red for map side only; ember for burned only; green for a forecast
  hit only; amber for a real pick outside the top five only. Everything else is neutral.
- **Collapsible panels:** one design everywhere: the arrow marker, then a bold label. No "show" or "hide"
  links. A panel remembers whether it is open while the view is rebuilt.
- **Percentages:** a positive likelihood that rounds to zero is shown as "<1%", never "0%". Use the real
  probability for this, not the rounded figure.
- **Mirroring:** the left team's content runs toward the centre. Its likeliest pick is nearest the role
  spine and its least likely at the outer edge, in planning, in the reveal strip and in the comparison.

### Planning

- Teams face each other, roles down a centre spine, each team's picks growing outward from it.
- Per player: the name, then "N left, X% of usual picks burned"; a thin bar for that share; five ranked
  picks; and one folded line, "N burned champions", that opens to show up to four of them with their game.
- The first pick is a large tile with a large percentage; ranks two to five are smaller. Size and the bar
  under each tile carry the likelihood. A champion the player has not played has a dashed border.
- Tiles are plain content, not buttons.
- Side column for one team: the planning-team switch at the top, the pre-game note, bans to consider,
  picks that also deny. The series outlook and the pick-cost search move here as collapsed sections.
- The note is open by default and can be folded; it stays folded when the team is switched. It shows the
  headline, the three points and the attribution line.
- "Reveal game N" is the one filled button. "Practice the draft" is outlined.

### Practice draft

- A sticky strip: whose turn and what the last action was, Undo, Exit, Reveal, and one slot row per team
  grouped as three bans, three picks, two bans, two picks.
- Each slot has two lines: "ban" or "pick", and the champion once entered. The label stays after the slot
  is filled.
- On a pick turn the acting team's players show ten options as buttons in two rows of five; the other
  team shows five and is dimmed. A player who has picked shows the pick.
- On a ban turn the rows under "Bans to consider" are buttons, and the champion search is in the strip.
- The side column shows picks that also deny first, then bans. The note is not shown: it was written
  before the draft.
- Revealing during a draft ends the draft, as now.

### Reveal: two levels

**First level, always shown: the result.**

- Two counts in one bar: forecast hits (real picks ranked in the top five) and picks from available pools.
  Both are computed from the data.
- Five paired rows. Per player: the real pick with the player's name, and the rank with "in the top five"
  or "outside the top five". Rank blocks have one width, so they line up down each column.
- Where there is room, each row also has a strip of the five forecast icons with their percentages, no
  names. "Room" means each team's lane is at least about 600 px wide, which is a window of roughly
  1,300 px. Below that the rows show the real pick and rank only, still with two teams side by side. The
  real pick's name is never squeezed or cut to make space for the strip. (The mockup shows the strip from
  761 px and breaks between there and about 1,250 px; do not copy its breakpoint.) The
  one that matched keeps its colour, gets a green ring on the icon and a green percentage; the others are
  greyed (icons only; the percentages keep their contrast). A row that is all grey is a miss. In names-only
  mode the strip shows names in place of icons.
- On phones the first level has no forecasts at all: the real pick and its rank only.
- The line under the heading describes what is on screen. With the strip: "The real pick and its rank in
  the forecast. Icons show the five the forecast expected." Wherever the strip is hidden, only the first
  sentence. In names-only mode it says "names", not "icons".
- The whole first level fits a 1920 x 1080 screen without scrolling.

**Second level, "Compare with forecasts", collapsed: the investigation.**

- The table: per player, the real pick as a large tile beside the role with a tag ("rank 2, in the top
  five" in green, "rank 21, outside the top five" in amber with a dashed border), followed by the five
  forecast tiles with names and percentages. The matched forecast has a green border; the others are greyed.
- Each player's name is followed by "N left, X% of usual picks burned".
- It remembers whether it is open across theme changes and when the user leaves and returns to the reveal.

**Below:** the bans of the game, open, one column per team, left-aligned.

The real picks land in sequence when the view opens. This is the only motion on the page that the user
did not trigger, and it is off under `prefers-reduced-motion`.

### Phone

- One role at a time, chosen from five buttons, with both players side by side.
- Every prediction is one row with the champion's full name and the percentage. No name is cut.
- The burn track scrolls sideways inside its own strip and starts at the current game.
- On reveal each level has its own role selector; they stay in sync.
- No page-level sideways scroll at 390 px or 320 px.

### Accessibility

- Focus returns to the control that was used, never to a twin of it elsewhere on the page. After a view
  change it goes to the view's heading; after a role, team, theme or icon switch it stays on the button
  pressed, in the same group; after a pick it goes to Undo.
- Icons that stand alone (the burn track, the reveal strip) carry the champion's name as their text
  alternative.
- The strip's icons are not focusable. "Compare with forecasts" is the keyboard route to the champion
  names: its toggle directly follows the rows in the tab order, and the comparison always shows names.
- Every control is at least 44 px tall.
- Text contrast is 4.5:1 or better in both themes.

## Decided in the mockup reviews

| Point | Decision |
| --- | --- |
| Reveal | Two levels: the result first, the comparison table behind "Compare with forecasts" |
| First level on desktop | Keeps a five-icon forecast strip without names |
| First level on phones | Real pick and rank only |
| Forecasts that did not happen | Greyed out; the match keeps its colour |
| Matched forecast in the strip | A ring on the icon, not a box around icon and percentage |
| Pre-game note | Open by default, foldable; hidden in the practice draft and on reveal |
| Bans of the revealed game | Open by default, left-aligned |
| Rank labels | Fixed width, aligned to the outer edge of each column |
| Collapsible panels | One design: arrow marker and bold label |
| Burned champions per player | Folded behind "N burned champions" |
| Pool label | "N left, X% of usual picks burned" beside every player's name |
| Draft slots | Keep the "ban" or "pick" label after they are filled |
| Zero percentages | "<1%" for a positive likelihood that rounds to zero |
| Left team | Mirrored everywhere, including the reveal strip |
| Header | Open layout, no box or gradient; details line with the game number in bold above the names; score a fifth larger than the names; "Blue side" / "Red side"; the game's state on its own line under the score |
| Forecast strip | Only where each lane is about 600 px or wider |

## Left for the build

1. **Reveal height.** The first level must be fully visible at 1920 x 1080 without scrolling. Measure it in
   the app; the mockup's heights are a guide only.
2. **Planning height.** The mockup's planning view is about 1,570 px tall. Measure it in the app after
   step 3 and report it; do not trade away the larger first-pick tile or the open note to shorten it.
3. **Note headline.** Stored headlines often restate the score ("Game 5 is tied..."), which now sits under
   a scoreboard saying the same. Change the prompt so the headline must be a pool fact and may not be the
   score, raise the prompt version, regenerate the notes of the featured series (138 notes, about $0.30,
   needs the user's go-ahead), and re-check them.
4. **Champion icon file names.** The pipeline writes each champion's Data Dragon file name and the Data
   Dragon version into the manifest. The app never derives a file name from a display name.
5. **Riot notice.** The footer carries Riot's legal notice, copied word for word from Riot's policy page.
6. **Long names.** "Renata Glasc" is cut in the comparison tiles at some widths. Let a name wrap to two
   lines there.
7. **Not in the mockup, must keep working:** the series list, the pick-cost search, the series outlook,
   draft replay, a ban turn in the practice draft, a lineup change during a series, a team without a note.

## Decisions taken at the build (2026-11-23)

- Built by Claude directly, not through Junie.
- Icons are on by default (`ICONS_DEFAULT` in `App.tsx`); the visitor's choice is remembered. Before the
  demo is hosted the project must be registered on Riot's Developer Portal, or the default set to names only.
- The app opens on the last game of the default series (game 5 for the default series).

## As built: where the app differs from this document

- **Lanes adapt to their own width, not the window's.** Each lane is a size container. Below about 500 px
  of lane content the first tile shrinks; below about 400 px (tablets with two teams side by side, and
  phones) each prediction is one full-name row. The comparison table tightens below 600 px and stacks below
  470 px. A long name takes a second line before it is cut.
- **The side column sits beside the board from 1,340 px;** below that it moves under the board.
- **The forecast strip on reveal, and the sentence about it, appear from a 1,320 px window** (about 600 px
  per lane).
- **Bans on a ban turn:** the side column switches to the team that is banning and lists six rows.
- **Riot notice:** the footer text matches the wording on Riot's general developer policies page, checked on
  2026-11-23 (the League docs page words it slightly differently; the general page is the one the hackathon
  rules point to).
- **Not done yet:** the note headline change and regenerating the notes (item 3 below); a contrast measurement; a keyboard-only and a screen-reader pass.

## Build steps

Each step leaves the app working and ends with the checks below.

1. **Foundations:** colour tokens for both themes, the two typefaces, the theme switch, the icon setting,
   the manifest fields for icons, the Riot notice, the "<1%" rule.
2. **Header and burn track:** the scoreboard and the series strip as navigation.
3. **Planning board:** facing lanes, likelihood tiles as plain content, the pool label, folded burned
   panels, the side column.
4. **Reveal:** the counts, the first-level rows with the strip, the comparison table, bans, the motion.
5. **Practice draft:** the strip with two-line slots, clickable picks and bans, undo, reset, replay, on the
   existing logic.
6. **Phone and accessibility:** full-name rows, the bare first level, 320 px, focus, text alternatives,
   touch size, reduced motion, contrast.

## Checks after every step

- `pnpm typecheck`, `pnpm test`, `pnpm lint` (no warnings), `pnpm build`, `pnpm build:demo`,
  `pnpm check:data`.
- A click-through in a real browser at 1920, 1440, 1280, 1024, 900, 770, 390 and 320 px in both themes,
  every view re-run after the last edit of the step. At every width: no page-level sideways scroll, no
  element outside its lane, and no name squeezed or cut.
- The reveal counts for the default series compared with an independent recomputation.
- Render tests that look for old class names are rewritten with the markup; none is weakened. New cases:
  the planning board contains no buttons; the reveal shows both counts from the data; the practice draft
  shows ten buttons per player for the acting team only; no percentage reads "0%" for a positive value.

## Not changing

The pick model, the ban and denial calculations, the draft rules, the series outlook, the note check, the
data format, the demo build and its guards.
