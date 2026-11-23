// Pure draft session logic for live draft mode.

import type {
  DraftActionInput, GamePlan, GamePlanPlayer, GamePlanTeamLeverage,
  PlayerRef, Role,
} from './types.ts'
import { DRAFT_ORDER, conditionLikelihoods, banLeverage, denialPicks } from './model.ts'

// ── Draft Session ────────────────────────────────────────────────────

/**
 * A draft session tracks the state of a live draft for one game.
 */
export interface DraftSession {
  /** The team that acts first (not necessarily blue). */
  firstTeamId: string
  /** Ordered list of actions entered so far. */
  actions: DraftActionInput[]
  /** Replay state, or null if not in replay mode. */
  replay: { remaining: DraftActionInput[] } | null
}

/** Events dispatched to the draft reducer. */
export type DraftEvent =
  | { type: 'ban'; championId: string }
  | { type: 'pick'; playerId: string; championId: string }
  | { type: 'undo' }
  | { type: 'reset' }
  | { type: 'setFirstTeam'; teamId: string }
  | { type: 'startReplay'; actions: DraftActionInput[] }
  | { type: 'replayNext' }

/** Context needed by the reducer to validate events. */
export interface DraftContext {
  teamIds: string[]
  burned: Set<string>
  /** Player IDs on each team (for pick validation). */
  teamPlayers: Map<string, Set<string>>
}

/**
 * Determine the team acting at a given turn index.
 */
export function actingTeam(session: DraftSession, teamIds: string[]): string | null {
  const slot = DRAFT_ORDER[session.actions.length]
  if (!slot) return null
  const side = slot[0] as '1' | '2'
  if (side === '1') return session.firstTeamId
  const second = teamIds.find(id => id !== session.firstTeamId)
  return second ?? null
}

/**
 * Get the current slot type ('b' or 'p') for the next turn.
 */
export function currentSlotType(session: DraftSession): 'b' | 'p' | null {
  const slot = DRAFT_ORDER[session.actions.length]
  if (!slot) return null
  return slot[2] as 'b' | 'p'
}

/**
 * Pure reducer for draft session state.
 * Returns the same session (rejected) when an event is invalid.
 */
export function draftReducer(
  session: DraftSession,
  event: DraftEvent,
  ctx: DraftContext,
): DraftSession {
  switch (event.type) {
    case 'setFirstTeam': {
      // Only allow if no actions yet
      if (session.actions.length > 0) return session
      return { ...session, firstTeamId: event.teamId }
    }

    case 'reset': {
      return { ...session, actions: [], replay: null }
    }

    case 'ban': {
      // Reject: not a ban turn
      const slot = DRAFT_ORDER[session.actions.length]
      if (!slot || slot[2] !== 'b') return session
      // Reject: champion already unavailable
      if (ctx.burned.has(event.championId) || session.actions.some(a => a.championId === event.championId)) {
        return session
      }
      const teamId = actingTeam(session, ctx.teamIds)
      if (!teamId) return session
      return {
        ...session,
        actions: [...session.actions, { type: 'ban', teamId, championId: event.championId }],
      }
    }

    case 'pick': {
      // Reject: not a pick turn
      const slot = DRAFT_ORDER[session.actions.length]
      if (!slot || slot[2] !== 'p') return session
      // Reject: player already picked
      if (session.actions.some(a => a.type === 'pick' && a.playerId === event.playerId)) {
        return session
      }
      // Reject: player not on the acting team
      const teamId = actingTeam(session, ctx.teamIds)
      if (!teamId) return session
      const teamPlayerSet = ctx.teamPlayers.get(teamId)
      if (!teamPlayerSet?.has(event.playerId)) return session
      // Reject: champion already unavailable
      if (ctx.burned.has(event.championId) || session.actions.some(a => a.championId === event.championId)) {
        return session
      }
      return {
        ...session,
        actions: [...session.actions, { type: 'pick', teamId, championId: event.championId, playerId: event.playerId }],
      }
    }

    case 'undo': {
      if (session.actions.length === 0) return session
      const newActions = session.actions.slice(0, -1)
      const lastAction = session.actions[session.actions.length - 1]
      // During replay, put the action back at the front of remaining
      if (session.replay) {
        return {
          ...session,
          actions: newActions,
          replay: { remaining: [lastAction, ...session.replay.remaining] },
        }
      }
      return { ...session, actions: newActions }
    }

    case 'startReplay': {
      return {
        ...session,
        actions: [],
        replay: { remaining: event.actions },
      }
    }

    case 'replayNext': {
      if (!session.replay || session.replay.remaining.length === 0) return session
      const action = session.replay.remaining[0]
      return {
        ...session,
        actions: [...session.actions, action],
        replay: { remaining: session.replay.remaining.slice(1) },
      }
    }
  }
}

// ── Live Game Plan ───────────────────────────────────────────────────

/**
 * Compute the first team from a game's real draft actions.
 */
export function firstTeamOfGame(gameActions: DraftActionInput[]): string | null {
  if (gameActions.length === 0) return null
  return gameActions[0].teamId
}

/**
 * Build a GamePlan with conditioned likelihoods and recomputed leverage
 * for the current draft session state. Also returns the last removed champion
 * so the UI can show it as a struck tile for one step.
 */
export function liveGamePlan(
  plan: GamePlan,
  session: DraftSession,
): GamePlan & { lastRemoved: { championId: string; type: 'ban' | 'pick' } | null } {
  // Derive unavailable champions and picked players from session actions
  const unavailable = new Set(plan.burned)
  const pickedPlayers = new Set<string>()
  for (const a of session.actions) {
    unavailable.add(a.championId)
    if (a.type === 'pick' && a.playerId) {
      pickedPlayers.add(a.playerId)
    }
  }

  // Condition likelihoods for every player
  const newPlayers: [string, Map<Role, GamePlanPlayer>][] = []
  const newUnknownRolePlayers: [string, GamePlanPlayer[]][] = []

  for (const [teamId, roleMap] of plan.players) {
    const newRoleMap = new Map<Role, GamePlanPlayer>()
    for (const [role, gp] of roleMap) {
      const cond = conditionLikelihoods(gp.likelihoods, unavailable, gp.playerId, pickedPlayers)
      newRoleMap.set(role, { ...gp, likelihoods: cond })
    }
    newPlayers.push([teamId, newRoleMap])
  }

  for (const [teamId, gps] of plan.unknownRolePlayers) {
    const newGps = gps.map(gp => ({
      ...gp,
      likelihoods: conditionLikelihoods(gp.likelihoods, unavailable, gp.playerId, pickedPlayers),
    }))
    newUnknownRolePlayers.push([teamId, newGps])
  }

  // Recompute leverage for each team
  const newLeverage = new Map<string, GamePlanTeamLeverage>()
  const roleOrder: Role[] = ['top', 'jungle', 'mid', 'bot', 'support']
  const teamIds = plan.players.map(([tid]) => tid)

  for (const teamId of teamIds) {
    const oppTeamId = teamIds.find(t => t !== teamId)
    if (!oppTeamId) continue

    const ownPlayersData = newPlayers.find(([tid]) => tid === teamId)?.[1]
    const oppPlayersData = newPlayers.find(([tid]) => tid === oppTeamId)?.[1]
    if (!ownPlayersData || !oppPlayersData) continue

    const ownPlayerLikelihoods = roleOrder.map(r => ownPlayersData.get(r)?.likelihoods ?? [])
    const oppPlayerLikelihoods = roleOrder.map(r => oppPlayersData.get(r)?.likelihoods ?? [])

    const ownPlayers: PlayerRef[] = roleOrder.map(r => {
      const gp = ownPlayersData.get(r)
      return { id: gp?.playerId ?? '', name: gp?.playerName ?? '', role: gp?.role ?? null }
    })
    const oppPlayers: PlayerRef[] = roleOrder.map(r => {
      const gp = oppPlayersData.get(r)
      return { id: gp?.playerId ?? '', name: gp?.playerName ?? '', role: gp?.role ?? null }
    })

    // Build player pools for denial picks
    const ownPlayerPools = new Map<string, Map<string, number>>()
    for (const [, gp] of ownPlayersData) {
      const champGames = new Map<string, number>()
      for (const entry of gp.pool.credible) champGames.set(entry.championId, entry.games)
      for (const entry of gp.pool.burned) champGames.set(entry.championId, entry.games)
      ownPlayerPools.set(gp.playerId, champGames)
    }

    const leverageEntries = banLeverage(oppPlayerLikelihoods, ownPlayerLikelihoods, oppPlayers, ownPlayers, plan.availableChampions)
    const denialEntries = denialPicks(ownPlayerLikelihoods, oppPlayerLikelihoods, ownPlayers, oppPlayers, plan.availableChampions, ownPlayerPools)

    newLeverage.set(teamId, { leverage: leverageEntries, denial: denialEntries })
  }

  // 6.2.3: Track the last removed champion for one-step visibility
  const lastAction = session.actions.length > 0 ? session.actions[session.actions.length - 1] : null
  const lastRemoved = lastAction ? { championId: lastAction.championId, type: lastAction.type } : null

  return {
    ...plan,
    players: newPlayers,
    unknownRolePlayers: newUnknownRolePlayers,
    leverage: newLeverage,
    lastRemoved,
  }
}
