import { useMemo } from 'react'
import type { GamePlan, WrittenNote } from '@fearless-board/shared'
import { pickCost, seriesOutlook } from '@fearless-board/shared'
import { pctText, ROLES, useUi } from '../ui'
import { ChampIcon, ChampName } from './ChampIcon'
import { ChampionSearch } from './ChampionSearch'
import type { BoardView } from './Header'

/** A model id as a name: "gemini-3.8-flash" becomes "Gemini 3.8 Flash". */
function modelName(raw: string): string {
  return raw.split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

/** Bans listed normally, and on a ban turn, when the rows are the way to enter a ban. */
const BANS_SHOWN = 3
const BANS_ON_BAN_TURN = 6

/**
 * The side column: advice for one team. The planning-team switch, the pre-game note, bans to consider,
 * picks that also deny, and two folded sections: the series outlook and what a pick costs.
 */
export function Rail({
  plan,
  teamIds,
  team,
  onTeam,
  view,
  gameNumber,
  note,
  noteModel,
  banTurn,
  onBan,
  costChampion,
  onCostChampion,
  unavailable,
}: {
  /** The plan the advice is read from: the live plan during a practice draft. */
  plan: GamePlan
  teamIds: [string, string]
  /** The team the column advises. */
  team: string
  onTeam: (teamId: string) => void
  view: BoardView
  gameNumber: number
  note?: WrittenNote
  noteModel?: string
  /** True on a ban turn of `team`: the ban rows enter the ban. */
  banTurn: boolean
  onBan: (championId: string) => void
  costChampion: string | null
  onCostChampion: (championId: string | null) => void
  unavailable: Set<string>
}) {
  const { teamMap, championMap } = useUi()
  const name = (teamId: string) => teamMap.get(teamId)?.name ?? teamId
  const advice = plan.leverage.get(team)
  const outlook = useMemo(() => seriesOutlook(plan), [plan])
  const cost = useMemo(() => (costChampion ? pickCost(plan, costChampion) : null), [plan, costChampion])

  // A ban is worth listing when the opponent's chance is clearly above the own team's
  const bans = (advice?.leverage ?? [])
    .filter(e => Math.round((e.threatFromOpponent - e.threatFromOwn) * 100) > 2)
    .slice(0, banTurn ? BANS_ON_BAN_TURN : BANS_SHOWN)
  const denial = (advice?.denial ?? []).slice(0, 3)

  const banRows = (
    <section>
      <h3>Bans to consider</h3>
      {banTurn && <p className="hint">{name(team)} to ban: choose a row, or search above.</p>}
      {bans.length === 0 && <p className="why">No ban stands out.</p>}
      {bans.map((e) => {
        const from = e.opponentHits[0]?.playerName ?? 'opponent'
        const body = (
          <>
            <ChampIcon id={e.championId} />
            <span className="nm"><ChampName id={e.championId} /></span>
            <span className="gap num">+{Math.round((e.threatFromOpponent - e.threatFromOwn) * 100)}</span>
            <span className="why">{from} {pctText(e.threatFromOpponent)}, your side {pctText(e.threatFromOwn)}</span>
          </>
        )
        return banTurn
          ? <button key={e.championId} type="button" className="opt" onClick={() => onBan(e.championId)}>{body}</button>
          : <div key={e.championId} className="opt">{body}</div>
      })}
    </section>
  )

  const denyRows = denial.length > 0 && (
    <section>
      <h3>Picks that also deny</h3>
      {denial.map(e => (
        <button key={e.championId} type="button" className="opt" onClick={() => onCostChampion(e.championId)} title="Show what this pick costs both teams">
          <ChampIcon id={e.championId} />
          <span className="nm"><ChampName id={e.championId} /></span>
          <span className="gap num">{pctText(e.ownProbability)}</span>
          <span className="why">
            for {e.ownPlayerName}, takes it from {e.opponentHits[0]?.playerName ?? 'the opponent'} ({pctText(e.threatFromOpponent)})
          </span>
        </button>
      ))}
    </section>
  )

  const brief = note && view === 'planning' && (
    <section className="note">
      <details open>
        <summary>Before game {gameNumber}</summary>
        <p className="hl">{note.headline}</p>
        {note.points.map((point, i) => (
          <p key={i}><b>{point.title}.</b> {point.text}</p>
        ))}
        <footer>Written by {modelName(noteModel ?? '')} from the figures on this board.</footer>
      </details>
    </section>
  )

  return (
    <aside className="rail" aria-label={`Advice for ${name(team)}`}>
      <section>
        <h3>Planning for</h3>
        <div className="seg" role="group" aria-label="Planning team">
          {teamIds.map(teamId => (
            <button key={teamId} type="button" aria-pressed={teamId === team} onClick={() => onTeam(teamId)}>
              {name(teamId)}
            </button>
          ))}
        </div>
      </section>
      {view === 'draft' ? <>{banRows}{denyRows}</> : <>{brief}{banRows}{denyRows}</>}

      <section>
        <details className="fold" open={costChampion !== null || undefined}>
          <summary>What does a pick cost?</summary>
          <div className="cost">
            <ChampionSearch placeholder="Search a champion" unavailable={unavailable} championMap={championMap} onSelect={onCostChampion} />
            {costChampion && cost && (
              <>
                <p>
                  <b><ChampName id={costChampion} /></b>{' '}
                  {unavailable.has(costChampion) ? '(no longer available)' : 'is gone for the rest of the series once picked. It takes from each list:'}
                </p>
                {teamIds.map((teamId) => {
                  const wanted = (cost.players.get(teamId) ?? []).filter(p => p.probability >= 0.01)
                  return (
                    <p key={teamId}>
                      <b>{name(teamId)}:</b>{' '}
                      {wanted.length > 0 ? wanted.map(p => `${p.playerName} ${pctText(p.probability)}`).join(', ') : "in nobody's list"}
                      <span className="soft">, combined {pctText(cost.combined.get(teamId) ?? 0)}</span>
                    </p>
                  )
                })}
                <button type="button" className="ghost" onClick={() => onCostChampion(null)}>Clear</button>
              </>
            )}
          </div>
        </details>
      </section>

      <section>
        <details className="fold">
          <summary>Series outlook</summary>
          {teamIds.map((teamId) => {
            const players = outlook.teams.find(t => t.teamId === teamId)?.players ?? []
            return (
              <table key={teamId} className="outlook">
                <caption>{name(teamId)}</caption>
                <tbody>
                  {ROLES.map((role) => {
                    const p = players.find(x => x.role === role)
                    if (!p) return null
                    return (
                      <tr key={p.playerId}>
                        <td>{p.playerName}</td>
                        <td className="n">{Math.round(p.burnedShare * 100)}% burned</td>
                        <td className="n soft">{p.limitedHistory ? 'limited history' : `+${Math.round(p.expectedBurn * 100)}% this game`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          })}
        </details>
      </section>
    </aside>
  )
}
