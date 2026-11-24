import type { DraftSession, SeriesDraft } from '@fearless-board/shared'
import { DRAFT_ORDER } from '@fearless-board/shared'
import { useState } from 'react'
import { useUi } from '../ui'
import { ChampionSearch } from './ChampionSearch'

/** Where a new phase starts in a team's ten slots: three bans, three picks, two bans, two picks. */
const PHASE_STARTS = new Set([3, 6, 8])

/**
 * The practice draft strip: whose turn it is and what happened last, the controls, and one row of slots
 * per team. Each slot keeps its "ban" or "pick" label after it is filled.
 */
export function DraftStrip({
  draft,
  gameNumber,
  session,
  actingTeamId,
  unavailable,
  canReplay,
  replayConfirm,
  onBan,
  onUndo,
  onReset,
  onFirstTeam,
  onExit,
  onReveal,
  onReplay,
  onReplayCancel,
  onReplayNext,
}: {
  draft: SeriesDraft
  gameNumber: number
  session: DraftSession
  /** The team to act, or null when the draft is complete. */
  actingTeamId: string | null
  unavailable: Set<string>
  /** The real draft of this game is known and can be replayed. */
  canReplay: boolean
  /** The user has asked to replay and has not confirmed yet. */
  replayConfirm: boolean
  onBan: (championId: string) => void
  onUndo: () => void
  onReset: () => void
  onFirstTeam: (teamId: string) => void
  onExit: () => void
  onReveal: () => void
  onReplay: () => void
  onReplayCancel: () => void
  onReplayNext: () => void
}) {
  const { teamMap, championMap } = useUi()
  // Phones show a compact bar; the slots and the less used controls open on demand
  const [orderOpen, setOrderOpen] = useState(false)
  const name = (teamId: string) => teamMap.get(teamId)?.name ?? teamId
  const champion = (id: string) => championMap.get(id)?.name ?? id
  const { actions, firstTeamId } = session
  const secondTeamId = draft.teamIds.find(id => id !== firstTeamId) ?? draft.teamIds[1]
  const teamOfSide = (side: string) => (side === '1' ? firstTeamId : secondTeamId)

  const turn = actions.length
  const slot = turn < DRAFT_ORDER.length ? DRAFT_ORDER[turn] : null
  const type = slot ? (slot[2] === 'b' ? 'ban' : 'pick') : null
  const inReplay = session.replay !== null
  const last = actions.at(-1)
  const canUndo = actions.length > 0 && !inReplay
  const canReset = actions.length > 0

  const status = !slot || !actingTeamId
    ? 'Draft complete'
    : `${name(actingTeamId)} to ${type}`
  const detail = [
    inReplay ? 'Replay of the real draft.' : '',
    last ? `Last: ${name(last.teamId)} ${last.type === 'ban' ? 'banned' : 'picked'} ${champion(last.championId)}.` : '',
    !slot || inReplay ? '' : type === 'ban' ? 'Choose a ban from "Bans to consider", or search.' : `Choose a champion in ${name(actingTeamId ?? '')}'s column.`,
  ].filter(Boolean).join(' ')

  return (
    <div className={`strip${orderOpen ? ' open' : ''}`}>
      <div className="turn" role="status">
        <strong>{status}</strong>
        <p>{detail}</p>
      </div>
      <div className="turn">
        {type === 'ban' && !inReplay && (
          <ChampionSearch placeholder="Search a champion to ban" unavailable={unavailable} championMap={championMap} onSelect={onBan} />
        )}
        {/* Not `disabled`: a button that disables itself under the keyboard would drop the focus */}
        <button id="draft-undo" type="button" className="ghost" aria-disabled={!canUndo} onClick={() => canUndo && onUndo()}>Undo</button>
        <button type="button" className="ghost more" aria-disabled={!canReset} onClick={() => canReset && onReset()}>Reset</button>
        {inReplay ? (
          <button type="button" className="ghost" onClick={onReplayNext} disabled={session.replay!.remaining.length === 0}>
            {session.replay!.remaining.length > 0 ? 'Next action' : 'Replay complete'}
          </button>
        ) : canReplay && (
          <>
            <button type="button" className="ghost more" onClick={onReplay}>{replayConfirm ? 'Confirm replay' : 'Replay the real draft'}</button>
            {replayConfirm && <span className="soft">This shows the actual picks of this game.</span>}
            {replayConfirm && <button type="button" className="ghost" onClick={onReplayCancel}>Cancel</button>}
          </>
        )}
        <button type="button" className="ghost order-toggle" aria-expanded={orderOpen} aria-controls="draft-order" onClick={() => setOrderOpen(open => !open)}>
          {orderOpen ? 'Less' : `Draft order, ${actions.length} of ${DRAFT_ORDER.length}`}
        </button>
        <button type="button" className="ghost more" onClick={onExit}>Exit practice</button>
        <button type="button" className="ghost more" onClick={onReveal}>Reveal game {gameNumber}</button>
        {actions.length === 0 && !inReplay && (
          <div className="seg more" role="group" aria-label="Team that acts first">
            {draft.teamIds.map(teamId => (
              <button key={teamId} type="button" aria-pressed={teamId === firstTeamId} onClick={() => onFirstTeam(teamId)}>
                {name(teamId)} first
              </button>
            ))}
          </div>
        )}
      </div>
      <div id="draft-order" className="order">
      {draft.teamIds.map((teamId) => {
        const slots = DRAFT_ORDER.map((entry, index) => ({ entry, index })).filter(({ entry }) => teamOfSide(entry[0]) === teamId)
        return (
          <div key={teamId} className="slotrow">
            <b>{name(teamId)}</b>
            <div className="slots">
              {slots.map(({ entry, index }, k) => {
                const kind = entry[2] === 'b' ? 'ban' : 'pick'
                const action = index < actions.length ? actions[index] : null
                const classes = `slot ${kind}${action ? ' filled' : ''}${index === turn ? ' current' : ''}${PHASE_STARTS.has(k) ? ' gapbefore' : ''}`
                return (
                  <span key={index} className={classes}>
                    <small>{kind}</small>
                    <span className="v">{action ? champion(action.championId) : ''}</span>
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}
