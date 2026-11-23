import { useState } from 'react'
import type { SeriesDraft, TeamRef, WrittenNote } from '@fearless-board/shared'
import './NoteBlock.css'

/** A model id as a name: "gemini-3.8-flash" becomes "Gemini 3.8 Flash". */
function modelName(raw: string): string {
  return raw.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export function NoteBlock({
  draft,
  teamMap,
  notesData,
  gameNumber,
  draftMode,
}: {
  draft: SeriesDraft
  teamMap: Map<string, TeamRef>
  notesData: { model: string; games: Record<string, Record<string, WrittenNote>> }
  gameNumber: number
  draftMode: boolean
}) {
  const [noteTeamIdx, setNoteTeamIdx] = useState(0)
  const noteForGame = notesData?.games[String(gameNumber)]

  // If the selected team has no note, show the other team's
  const shownIdx = noteForGame?.[draft.teamIds[noteTeamIdx]] ? noteTeamIdx : 1 - noteTeamIdx
  const note: WrittenNote | undefined = noteForGame?.[draft.teamIds[shownIdx]]
  const noteModel = notesData?.model

  // No note, no block
  if (!note) return null

  const noteIsDimmed = draftMode

  return (
    <div className={`note-block ${noteIsDimmed ? 'note-block-dimmed' : ''}`}>
      <div className="note-header">
        <span className="note-label">Pre-game note</span>
        <div className="note-switch">
          {draft.teamIds.map((teamId, idx) => {
            const teamName = teamMap.get(teamId)?.name ?? teamId
            const hasNote = !!noteForGame?.[teamId]
            return (
              <button
                key={teamId}
                type="button"
                className={`note-team-btn ${idx === shownIdx ? 'selected' : ''} ${!hasNote ? 'disabled' : ''}`}
                onClick={() => hasNote && setNoteTeamIdx(idx)}
                disabled={!hasNote}
              >
                {teamName}
              </button>
            )
          })}
        </div>
      </div>
      <div className="note-headline">{note.headline}</div>
      {note.points.map((point, idx) => (
        <div key={idx} className="note-point">
          <span className="note-point-title">{point.title} — </span>
          <span className="note-point-text">{point.text}</span>
        </div>
      ))}
      <div className="note-attribution">
        Written by {modelName(noteModel ?? '')} from the figures on this board.
      </div>
      {noteIsDimmed && (
        <div className="note-draft-label">written before this draft</div>
      )}
    </div>
  )
}
