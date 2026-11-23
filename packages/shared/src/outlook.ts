// Series outlook: burned share, expected burn, pick cost, and combined panel data.

import type {
  GamePlan, GamePlanPlayer, PickLikelihood, Role,
} from './types.ts'

// ── Types ────────────────────────────────────────────────────────────

/** One player's outlook data for the series panel. */
export interface OutlookPlayer {
  playerId: string
  playerName: string
  role: Role | null
  /** Share of the player's series-start likelihood list already burned (0–1). */
  burnedShare: number
  /** Expected share of the current likelihood list removed by the coming game (0–1). */
  expectedBurn: number
  /** True if the player has fewer than 20 earlier games. */
  limitedHistory: boolean
}

/** One team's outlook: one row per role. */
export interface OutlookTeam {
  teamId: string
  players: OutlookPlayer[]
}

/** Full series outlook result for the panel. */
export interface SeriesOutlook {
  teams: OutlookTeam[]
}

/** Pick cost for one player: probability of the champion in their current list. */
export interface PickCostPlayer {
  playerId: string
  playerName: string
  /** Probability of this champion in the player's current likelihood list. */
  probability: number
}

/** Pick cost result: per-player and per-team combined figures. */
export interface PickCostResult {
  /** Per-player costs, keyed by team ID. */
  players: Map<string, PickCostPlayer[]>
  /** Combined threat per team: 1 − Π(1 − P). */
  combined: Map<string, number>
}

// ── Functions ────────────────────────────────────────────────────────

/**
 * 1.2: Share of a player's startLikelihoods that are already burned.
 * Sum of probabilities over burned champions, clamped to [0, 1].
 */
export function burnedShare(player: GamePlanPlayer, burned: Set<string>): number {
  let sum = 0
  for (const l of player.startLikelihoods) {
    if (burned.has(l.championId)) {
      sum += l.probability
    }
  }
  return Math.min(1, Math.max(0, sum))
}

/**
 * 1.3: Expected share of each player's current list removed by the coming game.
 *
 * For each player, computes Σ P(c) · (1 − Π over all ten players (1 − P_player(c)))
 * over the player's likelihoods. This is the expected probability mass that will
 * be removed when one pick per player happens.
 */
export function expectedBurn(plan: GamePlan): Map<string, number> {
  // Collect all 10 players' likelihoods
  const allPlayers: { playerId: string; likelihoods: PickLikelihood[] }[] = []
  for (const [, roleMap] of plan.players) {
    for (const [, gp] of roleMap) {
      allPlayers.push({ playerId: gp.playerId, likelihoods: gp.likelihoods })
    }
  }
  // Add unknown-role players
  for (const [, unknownList] of plan.unknownRolePlayers) {
    for (const gp of unknownList) {
      allPlayers.push({ playerId: gp.playerId, likelihoods: gp.likelihoods })
    }
  }

  const result = new Map<string, number>()
  for (const player of allPlayers) {
    let expected = 0
    for (const l of player.likelihoods) {
      // Threat from all 10 players picking this champion
      let product = 1
      for (const other of allPlayers) {
        const otherP = other.likelihoods.find(o => o.championId === l.championId)?.probability ?? 0
        product *= 1 - otherP
      }
      const threat = 1 - product
      expected += l.probability * threat
    }
    result.set(player.playerId, Math.min(1, Math.max(0, expected)))
  }

  return result
}

/**
 * 1.4: For a given champion, what probability does it have in each player's
 * current list? Also computes per-team combined threat.
 *
 * Works on a live plan too (after bans and picks in draft mode).
 */
export function pickCost(plan: GamePlan, championId: string): PickCostResult {
  const players = new Map<string, PickCostPlayer[]>()
  const combined = new Map<string, number>()

  for (const [teamId, roleMap] of plan.players) {
    const teamPlayers: PickCostPlayer[] = []
    let product = 1
    for (const [, gp] of roleMap) {
      const p = gp.likelihoods.find(l => l.championId === championId)?.probability ?? 0
      teamPlayers.push({ playerId: gp.playerId, playerName: gp.playerName, probability: p })
      product *= 1 - p
    }
    // Add unknown-role players for this team
    const unknownList = plan.unknownRolePlayers.find(([tid]) => tid === teamId)?.[1] ?? []
    for (const gp of unknownList) {
      const p = gp.likelihoods.find(l => l.championId === championId)?.probability ?? 0
      teamPlayers.push({ playerId: gp.playerId, playerName: gp.playerName, probability: p })
      product *= 1 - p
    }
    players.set(teamId, teamPlayers)
    combined.set(teamId, 1 - product)
  }

  return { players, combined }
}

/**
 * 1.5: Combined series outlook for the panel.
 * Per team and role: burned share, expected burn, and limited history flag.
 */
export function seriesOutlook(plan: GamePlan): SeriesOutlook {
  const expBurn = expectedBurn(plan)
  const teams: OutlookTeam[] = []

  for (const [teamId, roleMap] of plan.players) {
    const players: OutlookPlayer[] = []
    for (const [, gp] of roleMap) {
      players.push({
        playerId: gp.playerId,
        playerName: gp.playerName,
        role: gp.role,
        burnedShare: burnedShare(gp, plan.burned),
        expectedBurn: expBurn.get(gp.playerId) ?? 0,
        limitedHistory: gp.priorGames < 20,
      })
    }
    // Add unknown-role players
    const unknownList = plan.unknownRolePlayers.find(([tid]) => tid === teamId)?.[1] ?? []
    for (const gp of unknownList) {
      players.push({
        playerId: gp.playerId,
        playerName: gp.playerName,
        role: null,
        burnedShare: burnedShare(gp, plan.burned),
        expectedBurn: expBurn.get(gp.playerId) ?? 0,
        limitedHistory: gp.priorGames < 20,
      })
    }
    teams.push({ teamId, players })
  }

  return { teams }
}
