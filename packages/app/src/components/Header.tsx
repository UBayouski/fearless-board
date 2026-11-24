import { useEffect, useRef } from 'react'
import type { PlayerRef, SeriesDraft } from '@fearless-board/shared'
import { capitalise, useUi } from '../ui'
import { ChampIcon, ChampName } from './ChampIcon'
import { picksByTeamInRoleOrder } from './gamePicks'

export type BoardView = 'planning' | 'draft' | 'reveal'

/**
 * The matchup: a quiet details line, both names with the score, each team's side, and one line for the
 * state of the game. The game number appears once, in the details line.
 */
export function Scoreboard({ draft, gameNumber, revealed }: { draft: SeriesDraft; gameNumber: number; revealed: boolean }) {
  const { teamMap } = useUi()
  const game = draft.games.find(g => g.gameNumber === gameNumber)
  const name = (teamId: string) => teamMap.get(teamId)?.name ?? teamId
  const through = revealed ? gameNumber : gameNumber - 1
  const wins = draft.teamIds.map(teamId => draft.games.filter(g => g.gameNumber <= through && g.winnerTeamId === teamId).length)
  // The data holds played games only, so the last game of a series is the one that decided it
  const decided = gameNumber === draft.games.length
  const state = revealed && game?.winnerTeamId
    ? `${name(game.winnerTeamId)} won ${decided ? 'the series' : 'this game'}`
    : 'Score before the draft'
  const side = (teamId: string) => (game?.sides.blue === teamId ? 'blue' : game?.sides.red === teamId ? 'red' : null)
  const team = (teamId: string) => {
    const s = side(teamId)
    return (
      <div className="team">
        {name(teamId)}
        {s && <span className={`side ${s}`}>{`${capitalise(s)} side`}</span>}
      </div>
    )
  }
  return (
    <>
      <p className="details" title={new Date(draft.scheduledStart).toLocaleDateString()}>
        {draft.event.replace(' - ', ' ')}, {draft.stage.toLowerCase()}, <b>game {gameNumber}</b>
      </p>
      <div className="score">
        {team(draft.teamIds[0])}
        <div className="tally num">
          <span className="sr">Score </span>{wins[0]}<small>–</small>{wins[1]}
        </div>
        {team(draft.teamIds[1])}
      </div>
      <p className="state">{state}</p>
    </>
  )
}

/**
 * The series as one strip, and the game navigation. Played games show their ten picks charred; the current
 * game is marked; a later game can be opened once the current one is revealed.
 */
export function BurnTrack({
  draft,
  gameNumber,
  view,
  burnedCount,
  playerMap,
  onSelectGame,
}: {
  draft: SeriesDraft
  gameNumber: number
  view: BoardView
  /** Champions burned for both teams entering the current game. */
  burnedCount: number
  playerMap: Map<string, PlayerRef>
  onSelectGame: (gameNumber: number) => void
}) {
  const { teamMap, icons } = useUi()
  const strip = useRef<HTMLElement>(null)
  const revealed = view === 'reveal'

  // On narrow screens the strip scrolls sideways inside its own box: keep the current game in view
  useEffect(() => {
    const el = strip.current
    const now = el?.querySelector<HTMLElement>('.now')
    if (el && now && el.scrollWidth > el.clientWidth) el.scrollLeft = now.offsetLeft - el.offsetLeft
  }, [gameNumber, view])

  return (
    <section
      ref={strip}
      className={`track${revealed ? ' slim' : ''}`}
      aria-label="Series so far"
      style={{ gridTemplateColumns: `repeat(${draft.games.length}, minmax(0, 1fr))` }}
    >
      {draft.games.map((g) => {
        const current = g.gameNumber === gameNumber
        const played = g.gameNumber < gameNumber || (current && revealed)
        const winner = g.winnerTeamId ? teamMap.get(g.winnerTeamId)?.name ?? g.winnerTeamId : null
        const heading = (
          <h3>
            Game {g.gameNumber}{' '}
            {played && winner && <em>{`${winner} won`}</em>}
            {current && !revealed && <em>{view === 'draft' ? 'draft in progress' : 'planning now'}</em>}
          </h3>
        )
        if (current) {
          return (
            <div key={g.gameId} className="game now" aria-current="step">
              {heading}
              {!revealed && (
                <>
                  <div className="gone num">{burnedCount}</div>
                  <p>champions burned for both teams</p>
                </>
              )}
            </div>
          )
        }
        const picks = played ? picksByTeamInRoleOrder(g.picks, playerMap) : null
        // A later game opens once the current one is revealed; earlier games are always open
        const reachable = g.gameNumber < gameNumber || (revealed && g.gameNumber === gameNumber + 1)
        return (
          <button key={g.gameId} type="button" className="game" disabled={!reachable} onClick={() => onSelectGame(g.gameNumber)}>
            {heading}
            {picks && !revealed && draft.teamIds.map(teamId => (
              <div key={teamId} className="burnrow">
                <b className={g.winnerTeamId === teamId ? 'won' : ''}>{teamMap.get(teamId)?.name ?? teamId}</b>
                <div className="chips">
                  {(picks.get(teamId) ?? []).map(pick => (
                    <span key={pick.championId} className="chip">
                      {icons ? <ChampIcon id={pick.championId} named /> : <span><ChampName id={pick.championId} /></span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </button>
        )
      })}
    </section>
  )
}
