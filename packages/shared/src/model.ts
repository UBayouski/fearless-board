// Model: features, training, likelihoods, threat, leverage, denial picks, game plan, and live draft.

import type {
  PickFeatures, PickModel, PickCandidate, PickLikelihood, PickExample,
  Role, PickRow, SeriesDraft, PlayerRef,
  BanLeverageEntry, DenialPickEntry, ThreatHit,
  DraftSlot, DraftActionInput,
  GamePlan, GamePlanPlayer, GamePlanTeamLeverage,
} from './types.ts'
import { burnedChampions, crediblePool, playerPool, lineupBefore } from './rules.ts'

// ── Pick features and training ───────────────────────────────────────

/**
 * Build features for every candidate champion for one player before one game.
 *
 * Candidates are every champion picked at least once in `allPicks` before
 * `seriesDate`, minus the `burned` set. Bans are not used.
 *
 * `rolePicks45` and `rolePicksAll` pre-aggregate role-level counts so the
 * function is pure and fast.
 */
export function pickFeatures(
  playerId: string,
  seriesDate: string,
  allPicks: readonly PickRow[],
  burned: Set<string>,
  rolePicks45: Map<string, number>,  // championId -> count in 45-day window
  rolePicksAll: Map<string, number>, // championId -> count all-time
  totalRole45: number,               // N45
  totalRoleAll: number,              // N all-time
  allChampionIds: Set<string>,       // every champion seen before seriesDate
): PickCandidate[] {
  // Build per-player champion stats from earlier games
  const playerChamp = new Map<string, { count: number; lastDays: number[] }>()
  for (const row of allPicks) {
    if (row.playerId !== playerId) continue
    if (row.scheduledStart >= seriesDate) continue
    const entry = playerChamp.get(row.championId)
    if (!entry) {
      const days = (Date.parse(seriesDate) - Date.parse(row.scheduledStart)) / (24 * 60 * 60 * 1000)
      playerChamp.set(row.championId, { count: 1, lastDays: [days] })
    } else {
      entry.count++
      const days = (Date.parse(seriesDate) - Date.parse(row.scheduledStart)) / (24 * 60 * 60 * 1000)
      entry.lastDays.push(days)
    }
  }

  const candidates: PickCandidate[] = []
  for (const champId of allChampionIds) {
    if (burned.has(champId)) continue

    const pc = playerChamp.get(champId)
    const played = pc ? 1 : 0

    // recentGames = ln(1 + sum exp(-daysAgo/90))
    let recentSum = 0
    if (pc) {
      for (const d of pc.lastDays) {
        recentSum += Math.exp(-d / 90)
      }
    }
    const recentGames = Math.log(1 + recentSum)

    // roleMeta = ln((n45 + 0.5) / (N45 + 40))
    const n45 = rolePicks45.get(champId) ?? 0
    const roleMeta = Math.log((n45 + 0.5) / (totalRole45 + 40))

    // roleAllTime = same over all earlier games
    const nAll = rolePicksAll.get(champId) ?? 0
    const roleAllTime = Math.log((nAll + 0.5) / (totalRoleAll + 40))

    candidates.push({
      championId: champId,
      features: { recentGames, played, roleMeta, roleAllTime },
    })
  }

  return candidates
}

/**
 * Train a conditional logit model: maximise log-likelihood of the actual pick
 * among its candidates. Newton's method with line search, no randomness.
 *
 * Returns weights, standardisation params, mean log-likelihood, and iteration count.
 */
export function trainPickModel(examples: readonly PickExample[]): PickModel {
  const K = 4 // number of features
  const featureKeys: (keyof PickFeatures)[] = ['recentGames', 'played', 'roleMeta', 'roleAllTime']

  // Compute mean and sd of features across all training candidates
  const sums = new Array(K).fill(0)
  const sqSums = new Array(K).fill(0)
  let nFeatures = 0
  for (const ex of examples) {
    for (const cand of ex.candidates) {
      for (let k = 0; k < K; k++) {
        const v = cand.features[featureKeys[k]]
        sums[k] += v
        sqSums[k] += v * v
      }
      nFeatures++
    }
  }

  const mean: number[] = sums.map((s) => nFeatures > 0 ? s / nFeatures : 0)
  const sd: number[] = sqSums.map((s, k) => nFeatures > 0 ? Math.sqrt(s / nFeatures - mean[k] * mean[k]) : 1)
  // Guard against zero sd
  for (let k = 0; k < K; k++) {
    if (sd[k] < 1e-12) sd[k] = 1
  }

  // Standardise features helper
  const std = (v: number, k: number) => (v - mean[k]) / sd[k]

  // Pre-compute standardised feature matrix for each example
  interface ExStd {
    x: number[][] // candidates x K (standardised)
    actualIdx: number
  }
  const exStd: ExStd[] = []
  for (const ex of examples) {
    const actualIdx = ex.candidates.findIndex((c) => c.championId === ex.actualChampionId)
    if (actualIdx < 0) continue
    const x: number[][] = []
    for (const c of ex.candidates) {
      const row = new Array(K)
      for (let k = 0; k < K; k++) {
        row[k] = std(c.features[featureKeys[k]], k)
      }
      x.push(row)
    }
    exStd.push({ x, actualIdx })
  }

  // Initialise weights to zero
  let w = new Array(K).fill(0)

  // Compute log-likelihood
  function logLikelihood(w: number[]): number {
    let ll = 0
    let n = 0
    for (const ex of exStd) {
      const scores = ex.x.map((row) => {
        let s = 0
        for (let k = 0; k < K; k++) s += w[k] * row[k]
        return s
      })
      const maxS = Math.max(...scores)
      const exps = scores.map((s) => Math.exp(s - maxS))
      const sumE = exps.reduce((a, b) => a + b, 0)
      ll += ex.actualIdx >= 0 ? Math.log(exps[ex.actualIdx] / sumE) : 0
      n++
    }
    return n > 0 ? ll / n : 0
  }

  // Newton's method with line search
  const maxIter = 50
  const gradThreshold = 1e-8
  let iterations = 0
  let bestLL = logLikelihood(w)

  for (let iter = 0; iter < maxIter; iter++) {
    iterations++

    // Compute gradient and Hessian
    const grad = new Array(K).fill(0)
    const hess: number[][] = []
    for (let k = 0; k < K; k++) hess.push(new Array(K).fill(0))
    let nEx = 0

    for (const ex of exStd) {
      // Softmax probabilities
      const scores = ex.x.map((row) => {
        let s = 0
        for (let k = 0; k < K; k++) s += w[k] * row[k]
        return s
      })
      const maxS = Math.max(...scores)
      const exps = scores.map((s) => Math.exp(s - maxS))
      const sumE = exps.reduce((a, b) => a + b, 0)
      const probs = exps.map((e) => e / sumE)

      // Gradient: for each example, gradient of log p(actual) = x_actual - sum_j(p_j * x_j)
      for (let k = 0; k < K; k++) {
        let g = ex.x[ex.actualIdx][k]
        for (let j = 0; j < ex.x.length; j++) {
          g -= probs[j] * ex.x[j][k]
        }
        grad[k] += g
      }

      // Hessian: -sum_j(p_j * x_j) * x_i^T
      for (let i = 0; i < K; i++) {
        for (let j = 0; j < K; j++) {
          let h = 0
          for (let m = 0; m < ex.x.length; m++) {
            h -= probs[m] * ex.x[m][i] * ex.x[m][j]
          }
          hess[i][j] += h
        }
      }
      nEx++
    }

    // Average gradient and Hessian
    for (let k = 0; k < K; k++) grad[k] /= nEx
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) hess[i][j] /= nEx
    }

    // Check convergence: max gradient component
    let maxGrad = 0
    for (let k = 0; k < K; k++) {
      if (Math.abs(grad[k]) > maxGrad) maxGrad = Math.abs(grad[k])
    }
    if (maxGrad < gradThreshold) break

    // Solve Hessian * step = -gradient (Newton step)
    // Since Hessian is negative definite (we're maximizing), we solve (-Hessian) * step = gradient
    // Add small regularization for numerical stability
    const reg = 1e-6
    const negHess: number[][] = []
    for (let i = 0; i < K; i++) {
      negHess.push(new Array(K))
      for (let j = 0; j < K; j++) {
        negHess[i][j] = -hess[i][j] + (i === j ? reg : 0)
      }
    }

    // Solve using Gaussian elimination (K=4, small system)
    const augmented: number[][] = []
    for (let i = 0; i < K; i++) {
      augmented.push([...negHess[i], grad[i]])
    }

    // Forward elimination with partial pivoting
    for (let col = 0; col < K; col++) {
      // Find pivot
      let maxRow = col
      let maxVal = Math.abs(augmented[col][col])
      for (let row = col + 1; row < K; row++) {
        if (Math.abs(augmented[row][col]) > maxVal) {
          maxVal = Math.abs(augmented[row][col])
          maxRow = row
        }
      }
      // Swap rows
      const temp = augmented[col]
      augmented[col] = augmented[maxRow]
      augmented[maxRow] = temp

      // Eliminate below
      for (let row = col + 1; row < K; row++) {
        const factor = augmented[row][col] / augmented[col][col]
        for (let j = col; j <= K; j++) {
          augmented[row][j] -= factor * augmented[col][j]
        }
      }
    }

    // Back substitution
    const step = new Array(K)
    for (let i = K - 1; i >= 0; i--) {
      let sum = augmented[i][K]
      for (let j = i + 1; j < K; j++) {
        sum -= augmented[i][j] * step[j]
      }
      step[i] = sum / augmented[i][i]
    }

    // Line search: halve step while log-likelihood doesn't improve
    let stepSize = 1
    let newW = new Array(K)
    let newLL: number
    do {
      for (let k = 0; k < K; k++) newW[k] = w[k] + stepSize * step[k]
      newLL = logLikelihood(newW)
      stepSize /= 2
    } while (newLL <= bestLL && stepSize > 1e-10)

    if (newLL > bestLL) {
      w = newW
      bestLL = newLL
    } else {
      // Can't improve, stop
      break
    }
  }

  return {
    weights: w as [number, number, number, number],
    mean: mean as [number, number, number, number],
    sd: sd as [number, number, number, number],
    meanLogLikelihood: bestLL,
    iterations,
  }
}

/**
 * Score candidates with the trained model and return softmax probabilities, sorted desc.
 */
export function pickLikelihoods(model: PickModel, candidates: PickCandidate[]): PickLikelihood[] {
  if (candidates.length === 0) return []

  const K = 4
  const featureKeys: (keyof PickFeatures)[] = ['recentGames', 'played', 'roleMeta', 'roleAllTime']

  const scored = candidates.map((c) => {
    let score = 0
    for (let k = 0; k < K; k++) {
      const v = (c.features[featureKeys[k]] - model.mean[k]) / model.sd[k]
      score += model.weights[k] * v
    }
    return { championId: c.championId, score, features: c.features }
  })

  // Softmax
  const maxScore = Math.max(...scored.map((s) => s.score))
  const exps = scored.map((s) => Math.exp(s.score - maxScore))
  const sumExps = exps.reduce((a, b) => a + b, 0)

  const result: PickLikelihood[] = scored.map((s, i) => ({
    championId: s.championId,
    probability: exps[i] / sumExps,
    features: s.features,
  }))

  // Sort by probability descending
  result.sort((a, b) => b.probability - a.probability)

  return result
}

/**
 * Build pick likelihoods for one player in the app context.
 */
export function buildPickLikelihoods(
  model: PickModel,
  playerId: string,
  role: Role,
  seriesDate: string,
  picks: readonly PickRow[],
  burned: Set<string>,
  roleCounts: Record<string, { total45: number; totalAll: number; champions: Record<string, [number, number]> }>,
  allChampionIds: Set<string>,
): PickLikelihood[] {
  const rc = roleCounts[role]
  if (!rc) return []

  const rolePicks45 = new Map<string, number>()
  const rolePicksAll = new Map<string, number>()
  for (const [champId, counts] of Object.entries(rc.champions)) {
    rolePicks45.set(champId, counts[0])
    rolePicksAll.set(champId, counts[1])
  }

  const candidates = pickFeatures(
    playerId,
    seriesDate,
    picks,
    burned,
    rolePicks45,
    rolePicksAll,
    rc.total45,
    rc.totalAll,
    allChampionIds,
  )

  return pickLikelihoods(model, candidates)
}

// ── Ban leverage and denial picks ────────────────────────────────────

/**
 * Threat of champion `c` from a team: the probability that at least one of its
 * five players picks it.  `1 - product(1 - P(player picks c))`.
 */
export function threat(
  playerLikelihoods: PickLikelihood[][],
  championId: string,
  players: readonly PlayerRef[],
): { threat: number; hits: ThreatHit[] } {
  let product = 1
  const hits: ThreatHit[] = []

  for (let i = 0; i < players.length; i++) {
    const player = players[i]
    const playerLiks = playerLikelihoods[i] ?? []
    const entry = playerLiks.find((l) => l.championId === championId)
    const p = entry ? entry.probability : 0
    product *= 1 - p
    if (p >= 0.05) {
      hits.push({ playerId: player.id, playerName: player.name, probability: p })
    }
  }

  return {
    threat: 1 - product,
    hits,
  }
}

/**
 * Ban leverage for team A against team B.
 */
export function banLeverage(
  opponentPlayerLikelihoods: PickLikelihood[][],
  ownPlayerLikelihoods: PickLikelihood[][],
  opponentPlayers: readonly PlayerRef[],
  ownPlayers: readonly PlayerRef[],
  availableChampions: Set<string>,
  topN: number = 8,
): BanLeverageEntry[] {
  const entries: BanLeverageEntry[] = []
  for (const champId of availableChampions) {
    const oppThreat = threat(opponentPlayerLikelihoods, champId, opponentPlayers)
    const ownThreat = threat(ownPlayerLikelihoods, champId, ownPlayers)
    const leverage = oppThreat.threat - ownThreat.threat

    entries.push({
      championId: champId,
      threatFromOpponent: oppThreat.threat,
      threatFromOwn: ownThreat.threat,
      leverage,
      opponentHits: oppThreat.hits,
      ownHits: ownThreat.hits,
    })
  }

  entries.sort((a, b) => b.leverage - a.leverage)
  return entries.slice(0, topN)
}

/**
 * Denial picks for team A: champions where an A player has played the champion
 * before and has it among their ten most likely, sorted by threat from B.
 */
export function denialPicks(
  ownPlayerLikelihoods: PickLikelihood[][],
  opponentPlayerLikelihoods: PickLikelihood[][],
  ownPlayers: readonly PlayerRef[],
  opponentPlayers: readonly PlayerRef[],
  availableChampions: Set<string>,
  /** Map from playerId to championId → gamesPlayed count. */
  ownPlayerPools: Map<string, Map<string, number>>,
  topN: number = 5,
): DenialPickEntry[] {
  const entries: DenialPickEntry[] = []

  for (let i = 0; i < ownPlayers.length; i++) {
    const player = ownPlayers[i]
    const playerTop10 = (ownPlayerLikelihoods[i] ?? []).slice(0, 10)

    for (const l of playerTop10) {
      if (!availableChampions.has(l.championId)) continue

      // Check if this player has played the champion
      const pool = ownPlayerPools.get(player.id)
      const gamesPlayed = pool?.get(l.championId) ?? 0
      if (gamesPlayed === 0) continue

      const oppThreat = threat(opponentPlayerLikelihoods, l.championId, opponentPlayers)

      entries.push({
        championId: l.championId,
        ownPlayerId: player.id,
        ownPlayerName: player.name,
        ownProbability: l.probability,
        gamesPlayed,
        threatFromOpponent: oppThreat.threat,
        opponentHits: oppThreat.hits,
      })
    }
  }

  // Deduplicate by championId, keeping the entry with the highest ownProbability
  const byChamp = new Map<string, DenialPickEntry>()
  for (const e of entries) {
    const existing = byChamp.get(e.championId)
    if (!existing || e.ownProbability > existing.ownProbability) {
      byChamp.set(e.championId, e)
    }
  }

  const unique = Array.from(byChamp.values())
  unique.sort((a, b) => b.threatFromOpponent - a.threatFromOpponent)
  return unique.slice(0, topN)
}

// ── Live draft ───────────────────────────────────────────────────────

/**
 * The standard LoL draft order discovered from the data.
 * 1,477 of 1,734 games (85.2%) follow this exact sequence.
 */
export const DRAFT_ORDER: DraftSlot[] = [
  'B-b', 'R-b', 'B-b', 'R-b', 'B-b', 'R-b',  // Phase 1: 6 bans
  'B-p', 'R-p', 'R-p', 'B-p', 'B-p', 'R-p',  // Phase 1: 6 picks
  'R-b', 'B-b', 'R-b', 'B-b',                 // Phase 2: 4 bans
  'R-p', 'B-p', 'B-p', 'R-p',                 // Phase 2: 4 picks
]

/**
 * Derive the current draft state from an ordered list of actions.
 */
export function draftState(
  actions: readonly DraftActionInput[],
  burned: Set<string>,
): {
  unavailable: Set<string>
  pickedPlayers: Set<string>
  turnIndex: number
} {
  const unavailable = new Set(burned)
  const pickedPlayers = new Set<string>()

  for (const a of actions) {
    unavailable.add(a.championId)
    if (a.type === 'pick' && a.playerId) {
      pickedPlayers.add(a.playerId)
    }
  }

  return {
    unavailable,
    pickedPlayers,
    turnIndex: actions.length,
  }
}

/**
 * Remove the unavailable champions from a player's likelihood list
 * and rescale the rest to sum to 1.
 */
export function conditionLikelihoods(
  likelihoods: readonly PickLikelihood[],
  unavailable: Set<string>,
  playerId?: string,
  pickedPlayers?: Set<string>,
): PickLikelihood[] {
  if (pickedPlayers?.has(playerId!)) return []

  const available = likelihoods.filter((l) => !unavailable.has(l.championId))
  if (available.length === 0) return []

  const sum = available.reduce((s, l) => s + l.probability, 0)
  if (sum <= 0) return []

  return available.map((l) => ({
    ...l,
    probability: l.probability / sum,
  }))
}

/**
 * Get the team side for a given turn index in the draft order.
 */
export function draftSlotSide(turnIndex: number): 'B' | 'R' | null {
  if (turnIndex < 0 || turnIndex >= DRAFT_ORDER.length) return null
  return DRAFT_ORDER[turnIndex][0] as 'B' | 'R'
}

/**
 * Get the action type for a given turn index in the draft order.
 */
export function draftSlotType(turnIndex: number): 'b' | 'p' | null {
  if (turnIndex < 0 || turnIndex >= DRAFT_ORDER.length) return null
  return DRAFT_ORDER[turnIndex][2] as 'b' | 'p'
}

// ── Game plan ────────────────────────────────────────────────────────

/**
 * Compute everything needed for one series and game number:
 * lineup, burned champions, each player's pool and likelihood list,
 * and both teams' ban leverage and denial picks.
 *
 * Uses the lineup from game N-1 (or game 1 for game 1).
 */
export function gamePlan(
  draft: SeriesDraft,
  gameNumber: number,
  picks: readonly PickRow[],
  model: PickModel,
  playerRole: Map<string, Role | null>,
): GamePlan {
  const game = draft.games.find(g => g.gameNumber === gameNumber)
  if (!game) throw new Error(`Game ${gameNumber} not found in series ${draft.seriesId}`)

  const burned = burnedChampions(draft.games, gameNumber)

  // Burned by game
  const burnedByGame = new Map<string, number>()
  for (const g of draft.games) {
    if (g.gameNumber >= gameNumber) break
    if (g.picks.length > 0) {
      for (const p of g.picks) {
        if (!burnedByGame.has(p.championId)) {
          burnedByGame.set(p.championId, g.gameNumber)
        }
      }
    }
  }

  // Available champions
  const allChampionIds = draft.championsSeen ? new Set(draft.championsSeen) : new Set<string>()
  const availableChampions = new Set<string>()
  for (const c of allChampionIds) {
    if (!burned.has(c)) availableChampions.add(c)
  }

  // Lineup
  const { lineup, lineupChanged } = lineupBefore(draft, gameNumber)

  // Build player data: use lineup players, not game N players
  const players: [string, Map<Role, GamePlanPlayer>][] = []

  for (const teamId of draft.teamIds) {
    const teamLineup = lineup[teamId] ?? []
    const roleMap = new Map<Role, GamePlanPlayer>()

    for (const lp of teamLineup) {
      const role = playerRole.get(lp.playerId)
      const pool = playerPool(picks, lp.playerId, draft.scheduledStart)
      const { credible, burned: burnedEntries } = crediblePool(pool, burned)

      let likelihoods: PickLikelihood[] = []
      if (role && draft.roleCounts) {
        likelihoods = buildPickLikelihoods(
          model,
          lp.playerId,
          role,
          draft.scheduledStart,
          picks,
          burned,
          draft.roleCounts,
          allChampionIds,
        )
      }

      roleMap.set(role ?? 'top', {
        playerId: lp.playerId,
        playerName: lp.playerName,
        role: role ?? null,
        pool: { credible, burned: burnedEntries },
        likelihoods,
      })
    }

    players.push([teamId, roleMap])
  }

  // Build leverage for each team
  const leverage = new Map<string, GamePlanTeamLeverage>()

  for (const teamId of draft.teamIds) {
    const oppTeamId = draft.teamIds.find(t => t !== teamId)
    if (!oppTeamId) continue

    const [ownPlayersData, oppPlayersData] = players
      .map(([tid, roleMap]) => {
        if (tid === teamId) return { teamId: tid, roleMap }
        return null
      })
      .filter(Boolean) as { teamId: string; roleMap: Map<Role, GamePlanPlayer> }[]

    // Collect players in role order
    const roleOrder: Role[] = ['top', 'jungle', 'mid', 'bot', 'support']

    const ownPlayerLikelihoods = roleOrder.map(r => ownPlayersData.roleMap.get(r)?.likelihoods ?? [])
    const oppPlayerLikelihoods = roleOrder.map(r => oppPlayersData.roleMap.get(r)?.likelihoods ?? [])

    const ownPlayers: PlayerRef[] = roleOrder.map(r => {
      const gp = ownPlayersData.roleMap.get(r)
      return { id: gp?.playerId ?? '', name: gp?.playerName ?? '', role: gp?.role ?? null }
    })
    const oppPlayers: PlayerRef[] = roleOrder.map(r => {
      const gp = oppPlayersData.roleMap.get(r)
      return { id: gp?.playerId ?? '', name: gp?.playerName ?? '', role: gp?.role ?? null }
    })

    // Build player pools for denial picks
    const ownPlayerPools = new Map<string, Map<string, number>>()
    for (const [, gp] of ownPlayersData.roleMap) {
      const champGames = new Map<string, number>()
      for (const entry of gp.pool.credible) {
        champGames.set(entry.championId, entry.games)
      }
      for (const entry of gp.pool.burned) {
        champGames.set(entry.championId, entry.games)
      }
      ownPlayerPools.set(gp.playerId, champGames)
    }

    const leverageEntries = banLeverage(oppPlayerLikelihoods, ownPlayerLikelihoods, oppPlayers, ownPlayers, availableChampions)
    const denialEntries = denialPicks(ownPlayerLikelihoods, oppPlayerLikelihoods, ownPlayers, oppPlayers, availableChampions, ownPlayerPools)

    leverage.set(teamId, { leverage: leverageEntries, denial: denialEntries })
  }

  return {
    lineup,
    lineupChanged,
    burned,
    burnedByGame,
    availableChampions,
    players,
    leverage,
    game,
  }
}
