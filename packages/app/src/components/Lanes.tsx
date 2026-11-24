import type { ReactNode } from 'react'
import type { GamePlan, GamePlanPlayer, PickLikelihood, Role } from '@fearless-board/shared'
import { PLANNING_PICKS, pctText, ROLES, useUi } from '../ui'
import { ChampIcon, ChampName } from './ChampIcon'
import { ChampionSearch } from './ChampionSearch'

/** How many options the picking team's players get in a practice draft. */
const DRAFT_PICKS = 10

type Side = 'left' | 'right'
/** A lane row is a role, or the players whose role is not known. */
export type Row = Role | 'unknown'

/** The player of a team in a row; `null` if the team has nobody there. */
function playerAt(plan: GamePlan, teamId: string, row: Row): GamePlanPlayer | null {
  if (row === 'unknown') return plan.unknownRolePlayers.find(([id]) => id === teamId)?.[1][0] ?? null
  return plan.players.find(([id]) => id === teamId)?.[1].get(row) ?? null
}

/**
 * The board: the two teams facing each other, roles down a centre spine. `lane` renders one player.
 * On phones one role shows at a time, chosen with the buttons above.
 */
export function Board({
  plan,
  teamIds,
  activeRole,
  onRole,
  lane,
}: {
  plan: GamePlan
  teamIds: [string, string]
  activeRole: Row
  onRole: (role: Row) => void
  lane: (player: GamePlanPlayer, teamId: string, side: Side, index: number) => ReactNode
}) {
  const rows: Row[] = plan.unknownRolePlayers.some(([, players]) => players.length > 0) ? [...ROLES, 'unknown'] : [...ROLES]
  const label = (row: Row) => (row === 'unknown' ? 'role unknown' : row)
  const cell = (row: Row, t: 0 | 1, i: number) => {
    const side: Side = t === 0 ? 'left' : 'right'
    const player = playerAt(plan, teamIds[t], row)
    return player ? lane(player, teamIds[t], side, i * 2 + t) : <div className={`lane ${side}`} />
  }
  return (
    <div>
      <nav className="roles" aria-label="Role">
        {rows.map(row => (
          <button key={row} type="button" aria-pressed={row === activeRole} onClick={() => onRole(row)}>
            {label(row)}
          </button>
        ))}
      </nav>
      <div className="board">
        {rows.map((row, i) => (
          <section key={row} className={`lanes${row === activeRole ? ' active' : ''}`} aria-label={label(row)}>
            {cell(row, 0, i)}
            <div className="spine" aria-hidden="true">{label(row)}</div>
            {cell(row, 1, i)}
          </section>
        ))}
      </div>
    </div>
  )
}

/** One forecast tile. It is a button only where a click picks the champion. */
function Tile({
  entry,
  index,
  max,
  played,
  onPick,
  className = '',
}: {
  entry: PickLikelihood
  index: number
  max: number
  /** Whether the player has played the champion before; a dashed border if not. */
  played: boolean
  onPick?: () => void
  className?: string
}) {
  const classes = `tile${index === 0 ? ' lead' : ''}${played ? '' : ' new'}${className ? ` ${className}` : ''}`
  const bar = <span className="lk"><i style={{ width: `${Math.round((entry.probability / max) * 100)}%` }} /></span>
  const text = (
    <>
      <span className="nm"><ChampName id={entry.championId} /></span>
      <span className="pc num">{pctText(entry.probability)}</span>
      {bar}
    </>
  )
  const body = (
    <>
      <ChampIcon id={entry.championId} />
      {index === 0 ? <span className="txt">{text}</span> : text}
    </>
  )
  return onPick
    ? <button type="button" className={classes} onClick={onPick}>{body}</button>
    : <div className={classes}>{body}</div>
}

/** The player's name with how much of the pool is left and burned, and the bar for the burned share. */
function Who({ player, burnedShare, meter = true }: { player: GamePlanPlayer; burnedShare: number; meter?: boolean }) {
  const share = Math.round(burnedShare * 100)
  return (
    <>
      <div className="who">
        <h4>{player.playerName}</h4>
        <p>
          <span className="num">{player.pool.credible.length}</span> left, <b className="num">{share}% of usual picks burned</b>
        </p>
        {player.substitute && <span className="flag">substitute</span>}
        {player.priorGames < 20 && <span className="flag">limited history</span>}
      </div>
      {meter && <div className="meter" title={`${share}% of usual picks burned`}><i style={{ width: `${share}%` }} /></div>}
    </>
  )
}

const playedSet = (player: GamePlanPlayer) => new Set([...player.pool.credible, ...player.pool.burned].map(e => e.championId))

/** Planning: five ranked picks, sized by likelihood, and the burned champions folded behind their count. */
export function PlanningLane({ player, side, burnedShare, burnedByGame }: {
  player: GamePlanPlayer
  side: Side
  burnedShare: number
  burnedByGame: Map<string, number>
}) {
  const five = player.likelihoods.slice(0, PLANNING_PICKS)
  const played = playedSet(player)
  const burned = [...player.pool.burned].sort((a, b) => b.games - a.games).slice(0, 4)
  return (
    <div className={`lane ${side}`}>
      <Who player={player} burnedShare={burnedShare} />
      {five.length > 0
        ? <div className="row">{five.map((l, k) => <Tile key={l.championId} entry={l} index={k} max={five[0].probability} played={played.has(l.championId)} />)}</div>
        : <p className="removed">No forecast: no earlier games for this player.</p>}
      {player.pool.burned.length > 0 && (
        <details className="gone-d">
          <summary><span className="num">{player.pool.burned.length}</span> burned champions</summary>
          <div className="burnt">
            {burned.map(e => (
              <span key={e.championId} className="chip">
                <ChampIcon id={e.championId} />
                <span><ChampName id={e.championId} />, game {burnedByGame.get(e.championId) ?? '?'}</span>
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

/** Practice draft: ten options as buttons for the picking team, five dimmed for the other, or the pick made. */
export function DraftLane({
  player,
  side,
  burnedShare,
  acting,
  pickedChampion,
  replayRank,
  removed,
  unavailable,
  onPick,
}: {
  player: GamePlanPlayer
  side: Side
  burnedShare: number
  /** This player's team is on a pick turn and the player has not picked yet. */
  acting: boolean
  pickedChampion?: string
  /** In a replay: the rank the pick had just before it was made; 0 means outside the top ten. */
  replayRank?: number
  /** The champion the last action took out of this player's top ten, shown for one step. */
  removed?: { championId: string; type: 'ban' | 'pick' }
  unavailable: Set<string>
  onPick: (championId: string) => void
}) {
  const { championMap } = useUi()
  if (pickedChampion) {
    return (
      <div className={`lane ${side}`}>
        <Who player={player} burnedShare={burnedShare} />
        <div className="row">
          <div className="tile lead">
            <ChampIcon id={pickedChampion} />
            <span className="txt">
              <span className="nm"><ChampName id={pickedChampion} /></span>
              <span className="pc word">picked</span>
            </span>
          </div>
          {replayRank !== undefined && (
            <span className="picked-rank">
              {replayRank > 0 ? `rank ${replayRank} in the list before the pick` : 'outside the top 10 before the pick'}
            </span>
          )}
        </div>
      </div>
    )
  }
  const list = player.likelihoods.slice(0, acting ? DRAFT_PICKS : PLANNING_PICKS)
  const played = playedSet(player)
  return (
    <div className={`lane ${side}${acting ? '' : ' dim'}`}>
      <Who player={player} burnedShare={burnedShare} />
      <div className={`row${acting ? ' ten' : ''}`}>
        {list.map((l, k) => (
          <Tile key={l.championId} entry={l} index={k} max={list[0].probability} played={played.has(l.championId)} onPick={acting ? () => onPick(l.championId) : undefined} />
        ))}
      </div>
      {removed && (
        <p className="removed">
          <s><ChampName id={removed.championId} /></s> {removed.type === 'ban' ? 'banned' : 'picked'}, no longer in this list
        </p>
      )}
      {acting && (
        <ChampionSearch placeholder={`Other champion for ${player.playerName}`} unavailable={unavailable} championMap={championMap} onSelect={onPick} />
      )}
    </div>
  )
}

/** What the reveal knows about one player's real pick. */
export interface RevealedPick {
  championId: string
  /** Rank in the forecast before the draft; 0 if the champion was not in it. */
  rank: number
}

const isHit = (pick: RevealedPick) => pick.rank >= 1 && pick.rank <= PLANNING_PICKS
const likelihoodOf = (player: GamePlanPlayer, pick: RevealedPick) => (pick.rank > 0 ? player.likelihoods[pick.rank - 1].probability : 0)

/** Reveal, first level: the real pick, the strip of five forecasts where there is room, and the rank. */
export function ResultLane({ player, side, pick, index }: { player: GamePlanPlayer; side: Side; pick: RevealedPick; index: number }) {
  const hit = isHit(pick)
  return (
    <div className={`lane result ${side}`} style={{ ['--i' as string]: index }}>
      <ChampIcon id={pick.championId} />
      <div className="id">
        <strong><ChampName id={pick.championId} /></strong>
        <span>{player.playerName}</span>
      </div>
      <ol className="mini" aria-label={`Forecast for ${player.playerName}`}>
        {player.likelihoods.slice(0, PLANNING_PICKS).map((l, k) => (
          <StripEntry key={l.championId} entry={l} matched={hit && k === pick.rank - 1} />
        ))}
      </ol>
      <div className={`rank ${hit ? 'hit' : 'miss'}`}>
        <strong className="num">{pick.rank ? `#${pick.rank}` : 'none'}</strong>
        {hit ? 'in the top five' : pick.rank ? 'outside the top five' : 'not in the forecast'}
      </div>
    </div>
  )
}

function StripEntry({ entry, matched }: { entry: PickLikelihood; matched: boolean }) {
  const { championMap } = useUi()
  return (
    <li className={matched ? 'was' : ''} title={championMap.get(entry.championId)?.name}>
      <ChampIcon id={entry.championId} named />
      <span className="nm"><ChampName id={entry.championId} /></span>
      <span className="num">{pctText(entry.probability)}</span>
    </li>
  )
}

/** Reveal, second level: the real pick large beside the role, then the five named forecasts with the match marked. */
export function TableLane({ player, side, pick, index, burnedShare }: {
  player: GamePlanPlayer
  side: Side
  pick: RevealedPick
  index: number
  burnedShare: number
}) {
  const hit = isHit(pick)
  const five = player.likelihoods.slice(0, PLANNING_PICKS)
  const played = playedSet(player)
  const label = hit ? `rank ${pick.rank}, in the top five` : pick.rank ? `rank ${pick.rank}, outside the top five` : 'not in the forecast'
  return (
    <div className={`lane shown ${side}`}>
      <Who player={player} burnedShare={burnedShare} meter={false} />
      <div className="row table">
        <div className={`tile lead actual ${hit ? 'hit2' : 'miss2'}`} style={{ ['--i' as string]: index }}>
          <span className="tag">{label}</span>
          <ChampIcon id={pick.championId} />
          <span className="txt">
            <span className="nm"><ChampName id={pick.championId} /></span>
            {pick.rank > 0 && <span className="pc num">{pctText(likelihoodOf(player, pick))}</span>}
          </span>
        </div>
        {five.map((l, k) => (
          <Tile key={l.championId} entry={l} index={k + 1} max={five[0].probability} played={played.has(l.championId)} className={hit && k === pick.rank - 1 ? 'was' : 'off'} />
        ))}
      </div>
    </div>
  )
}
