import { createContext, useContext } from 'react'
import type { ChampionRef, TeamRef } from '@fearless-board/shared'

/** What every part of the board needs to show a champion or a team. */
export interface BoardUi {
  championMap: Map<string, ChampionRef>
  teamMap: Map<string, TeamRef>
  /** Champion icons on. When off no image element is rendered, so nothing is requested from Riot's server. */
  icons: boolean
  /** Data Dragon release the icons are loaded from; without it there are no icons. */
  ddragon?: string
}

export const UiContext = createContext<BoardUi>({ championMap: new Map(), teamMap: new Map(), icons: false })

export const useUi = () => useContext(UiContext)

/** A likelihood as text. A positive value that rounds to zero is "<1%", never "0%". */
export function pctText(probability: number): string {
  const rounded = Math.round(probability * 100)
  return rounded === 0 && probability > 0 ? '<1%' : `${rounded}%`
}

export const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export const ROLES = ['top', 'jungle', 'mid', 'bot', 'support'] as const

/** How many ranked picks a player shows when planning, and what counts as a forecast hit on reveal. */
export const PLANNING_PICKS = 5
