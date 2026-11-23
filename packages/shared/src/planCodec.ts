// Encode and decode GamePlan to/from compact JSON.

import type {
  GamePlan, GamePlanPlayer, PoolEntry, PickLikelihood, PickFeatures,
  Role, Lineup, ThreatHit,
  GamePlanTeamLeverage, GameDraft,
} from './types.ts'

// ── Encoded formats ──────────────────────────────────────────────────

/** One encoded likelihood entry: champion index, probability, role share. */
type EncodedLikelihood = [
  champion: number, // index into the champion list
  probability: number, // rounded to 5 decimals
  recentRoleShare: number | null, // rounded to 4 decimals
  allTimeRoleShare: number, // rounded to 4 decimals
]

/** One encoded player. */
interface EncodedPlayer {
  id: string
  name: string
  role: Role | null
  credible: [number, number, number, string][] // [champIdx, games, wins, lastPlayed]
  burned: [number, number, number, string][]   // [champIdx, games, wins, lastPlayed]
  likelihoods: EncodedLikelihood[]
  startLikelihoods: EncodedLikelihood[]
  priorGames: number
  substitute?: boolean
}

/** One encoded team leverage. */
interface EncodedTeamLeverage {
  leverage: {
    c: number // champion index
    tO: number // threatFromOpponent
    tY: number // threatFromOwn
    l: number // leverage
    oH: [string, string, number][] // opponentHits: [playerId, playerName, probability]
    yH: [string, string, number][] // ownHits
  }[]
  denial: {
    c: number // champion index
    oId: string // ownPlayerId
    oName: string // ownPlayerName
    oP: number // ownProbability
    g: number // gamesPlayed
    tO: number // threatFromOpponent
    oH: [string, string, number][] // opponentHits
  }[]
}

/** The top-level encoded plan object. */
export interface EncodedPlan {
  champions: string[] // champion id list
  lineup: [string, { id: string; name: string; role: Role | null }[]][] // [teamId, players]
  lineupChanged: [string, boolean][]
  burned: number[] // champion indexes
  burnedByGame: [number, number][] // [champIdx, gameNumber]
  available: number[] // champion indexes
  players: [string, [Role, EncodedPlayer][]][] // [teamId, [[role, player]...]]
  unknownRole: [string, EncodedPlayer[]][] // [teamId, players]
  leverage: [string, EncodedTeamLeverage][] // [teamId, leverage]
  game: GameDraft
}

// ── Encode ────────────────────────────────────────────────────────────

/**
 * Encode a GamePlan to plain JSON with compact representation.
 * - Likelihoods keep championId as index, probability (5 decimals), roleShare (4 decimals).
 * - Features are dropped (no component reads them; decode fills with zeros).
 * - startLikelihoods stored once per player.
 */
export function encodePlan(plan: GamePlan): EncodedPlan {
  // Build champion list from all likelihoods and pools
  const champSet = new Set<string>()
  for (const [, roleMap] of plan.players) {
    for (const [, gp] of roleMap) {
      for (const l of gp.likelihoods) champSet.add(l.championId)
      for (const l of gp.startLikelihoods) champSet.add(l.championId)
      for (const e of gp.pool.credible) champSet.add(e.championId)
      for (const e of gp.pool.burned) champSet.add(e.championId)
    }
  }
  for (const [, players] of plan.unknownRolePlayers) {
    for (const gp of players) {
      for (const l of gp.likelihoods) champSet.add(l.championId)
      for (const l of gp.startLikelihoods) champSet.add(l.championId)
      for (const e of gp.pool.credible) champSet.add(e.championId)
      for (const e of gp.pool.burned) champSet.add(e.championId)
    }
  }
  // Also add burned and available champions
  for (const c of plan.burned) champSet.add(c)
  for (const c of plan.availableChampions) champSet.add(c)

  const champions = [...champSet].sort()
  const champIdx = new Map<string, number>()
  champions.forEach((c, i) => champIdx.set(c, i))

  function encLikelihood(l: PickLikelihood): EncodedLikelihood {
    const round4 = (v: number) => Math.round(v * 10000) / 10000
    return [
      champIdx.get(l.championId)!,
      Math.round(l.probability * 100000) / 100000,
      l.roleShare && l.roleShare.recent !== null ? round4(l.roleShare.recent) : null,
      l.roleShare ? round4(l.roleShare.allTime) : 0,
    ]
  }

  function encPoolEntry(e: PoolEntry): [number, number, number, string] {
    return [champIdx.get(e.championId)!, e.games, e.wins, e.lastPlayed]
  }

  function encPlayer(gp: GamePlanPlayer): EncodedPlayer {
    return {
      id: gp.playerId,
      name: gp.playerName,
      role: gp.role,
      credible: gp.pool.credible.map(encPoolEntry),
      burned: gp.pool.burned.map(encPoolEntry),
      likelihoods: gp.likelihoods.map(encLikelihood),
      startLikelihoods: gp.startLikelihoods.map(encLikelihood),
      priorGames: gp.priorGames,
      substitute: gp.substitute,
    }
  }

  function encThreatHit(h: ThreatHit): [string, string, number] {
    return [h.playerId, h.playerName, h.probability]
  }

  function encTeamLeverage(lev: GamePlanTeamLeverage): EncodedTeamLeverage {
    return {
      leverage: lev.leverage.map(e => ({
        c: champIdx.get(e.championId)!,
        tO: e.threatFromOpponent,
        tY: e.threatFromOwn,
        l: e.leverage,
        oH: e.opponentHits.map(encThreatHit),
        yH: e.ownHits.map(encThreatHit),
      })),
      denial: lev.denial.map(e => ({
        c: champIdx.get(e.championId)!,
        oId: e.ownPlayerId,
        oName: e.ownPlayerName,
        oP: e.ownProbability,
        g: e.gamesPlayed,
        tO: e.threatFromOpponent,
        oH: e.opponentHits.map(encThreatHit),
      })),
    }
  }

  return {
    champions,
    lineup: Object.entries(plan.lineup).map(([teamId, players]) => [
      teamId,
      players.map(lp => ({ id: lp.playerId, name: lp.playerName, role: lp.role })),
    ]),
    lineupChanged: [...plan.lineupChanged],
    burned: [...plan.burned].map(c => champIdx.get(c)!),
    burnedByGame: [...plan.burnedByGame.entries()].map(([champId, gameNum]) => [champIdx.get(champId)!, gameNum]),
    available: [...plan.availableChampions].map(c => champIdx.get(c)!),
    players: plan.players.map(([teamId, roleMap]) => [
      teamId,
      [...roleMap].map(([role, gp]) => [role, encPlayer(gp)]),
    ]),
    unknownRole: plan.unknownRolePlayers.map(([teamId, players]) => [teamId, players.map(encPlayer)]),
    leverage: [...plan.leverage].map(([teamId, lev]) => [teamId, encTeamLeverage(lev)]),
    game: plan.game,
  }
}

// ── Decode ────────────────────────────────────────────────────────────

/**
 * Decode an EncodedPlan back to a GamePlan.
 * Features are filled with zeros (not used by any component).
 */
export function decodePlan(encoded: EncodedPlan): GamePlan {
  const { champions } = encoded
  const zeroFeatures: PickFeatures = { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 }

  function decLikelihood(el: EncodedLikelihood): PickLikelihood {
    return {
      championId: champions[el[0]],
      probability: el[1],
      features: zeroFeatures,
      roleShare: { recent: el[2], allTime: el[3] },
    }
  }

  function decPoolEntry(entry: [number, number, number, string]): PoolEntry {
    return {
      championId: champions[entry[0]],
      games: entry[1],
      wins: entry[2],
      lastPlayed: entry[3],
    }
  }

  function decPlayer(ep: EncodedPlayer): GamePlanPlayer {
    return {
      playerId: ep.id,
      playerName: ep.name,
      role: ep.role,
      pool: {
        credible: ep.credible.map(decPoolEntry),
        burned: ep.burned.map(decPoolEntry),
      },
      likelihoods: ep.likelihoods.map(decLikelihood),
      startLikelihoods: ep.startLikelihoods.map(decLikelihood),
      priorGames: ep.priorGames,
      substitute: ep.substitute,
    }
  }

  function decThreatHit(th: [string, string, number]): ThreatHit {
    return { playerId: th[0], playerName: th[1], probability: th[2] }
  }

  function decTeamLeverage(elt: EncodedTeamLeverage): GamePlanTeamLeverage {
    return {
      leverage: elt.leverage.map(e => ({
        championId: champions[e.c],
        threatFromOpponent: e.tO,
        threatFromOwn: e.tY,
        leverage: e.l,
        opponentHits: e.oH.map(decThreatHit),
        ownHits: e.yH.map(decThreatHit),
      })),
      denial: elt.denial.map(e => ({
        championId: champions[e.c],
        ownPlayerId: e.oId,
        ownPlayerName: e.oName,
        ownProbability: e.oP,
        gamesPlayed: e.g,
        threatFromOpponent: e.tO,
        opponentHits: e.oH.map(decThreatHit),
      })),
    }
  }

  // Rebuild burnedByGame: encoded as [champIdx, gameNumber]
  const burnedByGame = new Map<string, number>()
  for (const [champIdx, gameNum] of encoded.burnedByGame) {
    burnedByGame.set(champions[champIdx], gameNum)
  }

  const lineup: Lineup = {}
  for (const [teamId, players] of encoded.lineup) {
    lineup[teamId] = players.map(lp => ({
      playerId: lp.id,
      playerName: lp.name,
      role: lp.role,
    }))
  }

  const lineupChanged = new Map<string, boolean>(encoded.lineupChanged)
  const burned = new Set(encoded.burned.map(i => champions[i]))
  const availableChampions = new Set(encoded.available.map(i => champions[i]))

  const players: [string, Map<Role, GamePlanPlayer>][] = encoded.players.map(([teamId, roleEntries]) => [
    teamId,
    new Map(roleEntries.map(([role, ep]) => [role, decPlayer(ep)])),
  ])

  const unknownRolePlayers: [string, GamePlanPlayer[]][] = encoded.unknownRole.map(
    ([teamId, eps]) => [teamId, eps.map(decPlayer)],
  )

  const leverage = new Map<string, GamePlanTeamLeverage>(
    encoded.leverage.map(([teamId, elt]) => [teamId, decTeamLeverage(elt)]),
  )

  return {
    lineup,
    lineupChanged,
    burned,
    burnedByGame,
    availableChampions,
    players,
    unknownRolePlayers,
    leverage,
    game: encoded.game,
  }
}
