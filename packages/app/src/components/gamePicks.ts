import type { GameDraft, PlayerRef } from '@fearless-board/shared'

type Pick = GameDraft['picks'][number]

const ROLE_ORDER = ['top', 'jungle', 'mid', 'bot', 'support']

/** The picks of a game by team, each team's picks in role order (unknown roles last). */
export function picksByTeamInRoleOrder(picks: Pick[], playerMap: Map<string, PlayerRef>): Map<string, Pick[]> {
  const rank = (pick: Pick) => {
    const at = ROLE_ORDER.indexOf(playerMap.get(pick.playerId)?.role ?? '')
    return at === -1 ? ROLE_ORDER.length : at
  }
  const byTeam = new Map<string, Pick[]>()
  for (const pick of picks) {
    const list = byTeam.get(pick.teamId) ?? []
    list.push(pick)
    byTeam.set(pick.teamId, list)
  }
  for (const list of byTeam.values()) list.sort((a, b) => rank(a) - rank(b))
  return byTeam
}
