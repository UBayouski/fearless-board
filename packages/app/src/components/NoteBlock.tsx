import type { TeamRef, WrittenNote } from '@fearless-board/shared'
import './NoteBlock.css'

/** A model id as a name: "gemini-3.8-flash" becomes "Gemini 3.8 Flash". */
function modelName(raw: string): string {
  return raw.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export function NoteBlock({
  teamId,
  teamMap,
  notesData,
  gameNumber,
  draftMode,
}: {
  teamId: string
  teamMap: Map<string, TeamRef>
  notesData: { model: string; games: Record<string, Record<string, WrittenNote>> }
  gameNumber: number
  draftMode: boolean
}) {
  const note = notesData.games[String(gameNumber)]?.[teamId]
  const noteModel = notesData?.model

  // No note, no block
  if (!note) return null

  const noteIsDimmed = draftMode

  return (
    <div className={`note-block ${noteIsDimmed ? 'note-block-dimmed' : ''}`}>
      <div className="note-header">
        <span className="note-label">Pre-game note</span>
        <strong>{teamMap.get(teamId)?.name ?? teamId}</strong>
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
