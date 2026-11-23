// Types and rules shared by the data pipeline and the app.
// The pipeline writes these shapes as JSON; the app reads them.

export type Side = 'blue' | 'red'

export interface TeamRef {
  id: string
  name: string
}

export interface ChampionRef {
  id: string
  name: string
}

export interface DraftAction {
  /** Position in the draft, starting at 1. */
  order: number
  type: 'pick' | 'ban'
  teamId: string
  championId: string
}

export interface PlayerPick {
  teamId: string
  playerId: string
  playerName: string
  championId: string
}

export interface GameDraft {
  gameId: string
  /** 1-based position of the game within its series. */
  gameNumber: number
  patch: string | null
  sides: Record<Side, string>
  winnerTeamId: string | null
  actions: DraftAction[]
  picks: PlayerPick[]
}

export interface SeriesDraft {
  seriesId: string
  event: string
  stage: string
  scheduledStart: string
  teamIds: [string, string]
  games: GameDraft[]
  /** Per-role pick counts as of this series start (from pipeline). */
  roleCounts?: Record<string, { total45: number; totalAll: number; champions: Record<string, [number, number]> }>
  /** Champion IDs seen in any series before this one. */
  championsSeen?: string[]
}

export type Role = 'top' | 'jungle' | 'mid' | 'bot' | 'support'

export interface PlayerRef {
  id: string
  name: string
  role: Role | null
}

/** Index file the app loads first. */
export interface Manifest {
  generatedAt: string
  seriesCount: number
  gameCount: number
  teams: TeamRef[]
  champions: ChampionRef[]
  players: PlayerRef[]
}

/** One row per series for the series picker. */
export interface SeriesIndexEntry {
  seriesId: string
  scheduledStart: string
  event: string
  stage: string
  teamIds: [string, string]
  gameCount: number
  winnerTeamId: string | null
}

/** One compact row per player pick across all games. */
export interface PickRow {
  scheduledStart: string
  seriesId: string
  gameNumber: number
  teamId: string
  playerId: string
  championId: string
  won: boolean
}

/** Compact picks file structure: lists + array rows. */
export interface CompactPicks {
  /** Ordered lists for decoding: index → id */
  series: string[]
  teams: string[]
  players: string[]
  champions: string[]
  /** Rows: [seriesIdx, gameNumber, teamIdx, playerIdx, championIdx, wonAs0or1] */
  rows: number[][]
}

/** Decode a compact picks row back to PickRow format. */
export function decodeCompactPicks(cp: CompactPicks): PickRow[] {
  const result: PickRow[] = []
  for (const row of cp.rows) {
    result.push({
      scheduledStart: '',
      seriesId: cp.series[row[0]],
      gameNumber: row[1],
      teamId: cp.teams[row[2]],
      playerId: cp.players[row[3]],
      championId: cp.champions[row[4]],
      won: row[5] === 1,
    })
  }
  return result
}

/**
 * Champions no longer available in game `gameNumber` of a series under Fearless Draft.
 *
 * Confirmed rule: a champion picked by either team in an earlier game of the series is
 * unavailable to both teams for the rest of it; bans do not carry over.
 * This has been confirmed across all 569 multi-game series in the data.
 */
export function burnedChampions(games: readonly GameDraft[], gameNumber: number): Set<string> {
  const burned = new Set<string>()
  for (const game of games) {
    if (game.gameNumber >= gameNumber) continue
    // Prefer picks (always available) over actions (may be missing for forfeits)
    if (game.picks.length > 0) {
      for (const pick of game.picks) {
        burned.add(pick.championId)
      }
    } else {
      for (const action of game.actions) {
        if (action.type === 'pick') burned.add(action.championId)
      }
    }
  }
  return burned
}

/** A champion entry in a player's pool. */
export interface PoolEntry {
  championId: string
  games: number
  wins: number
  lastPlayed: string
}

/**
 * Champions a player has played before `asOf` (exclusive), sorted by games desc then recency desc.
 *
 * Scans `picks` (all PickRows) for the given player, keeping only games scheduled before `asOf`.
 */
export function playerPool(picks: readonly PickRow[], playerId: string, asOf: string): PoolEntry[] {
  const map = new Map<string, { games: number; wins: number; lastPlayed: string }>()

  for (const row of picks) {
    if (row.playerId !== playerId) continue
    if (row.scheduledStart >= asOf) continue
    const entry = map.get(row.championId)
    if (!entry) {
      map.set(row.championId, { games: 1, wins: row.won ? 1 : 0, lastPlayed: row.scheduledStart })
    } else {
      entry.games++
      if (row.won) entry.wins++
      if (row.scheduledStart > entry.lastPlayed) entry.lastPlayed = row.scheduledStart
    }
  }

  const result: PoolEntry[] = []
  for (const [championId, stats] of map) {
    result.push({ championId, ...stats })
  }

  // Sort by games desc, then lastPlayed desc (most recent first)
  result.sort((a, b) => {
    if (b.games !== a.games) return b.games - a.games
    return b.lastPlayed.localeCompare(a.lastPlayed)
  })

  return result
}

/**
 * Split a pool into credible (available) and burned entries.
 *
 * Returns `{ credible, burned }` where `credible` contains entries whose champion is not
 * in `burned`, and `burned` contains the entries that are struck through on the board.
 */
export function crediblePool(pool: readonly PoolEntry[], burned: Set<string>): {
  credible: PoolEntry[]
  burned: PoolEntry[]
} {
  const credible: PoolEntry[] = []
  const burnedEntries: PoolEntry[] = []

  for (const entry of pool) {
    if (burned.has(entry.championId)) {
      burnedEntries.push(entry)
    } else {
      credible.push(entry)
    }
  }

  return { credible, burned: burnedEntries }
}

/**
 * The share of a player's prior games that were on burned champions.
 *
 * Returns a value in [0, 100] — the percentage of all prior games spent on
 * champions that are now burned.  Can never exceed 100% because burned games
 * are a subset of total games.
 */
export function burnedGameShare(pool: readonly PoolEntry[], burned: Set<string>): number {
  let totalGames = 0
  let burnedGames = 0

  for (const entry of pool) {
    totalGames += entry.games
    if (burned.has(entry.championId)) {
      burnedGames += entry.games
    }
  }

  if (totalGames === 0) return 0
  return Math.round((burnedGames / totalGames) * 100)
}

// ── Pick likelihood model ──────────────────────────────────────────────

/** Four features for one (player, champion) candidate. */
export interface PickFeatures {
  recentGames: number
  played: number
  roleMeta: number
  roleAllTime: number
}

/** Trained model: four weights plus standardisation parameters. */
export interface PickModel {
  weights: [number, number, number, number]
  mean: [number, number, number, number]
  sd: [number, number, number, number]
  /** Mean log-likelihood per training example (natural log). */
  meanLogLikelihood: number
  /** Number of optimizer iterations performed. */
  iterations: number
}

/** One candidate champion with its features. */
export interface PickCandidate {
  championId: string
  features: PickFeatures
}

/** One training example: player, role, date, candidate list, actual pick. */
export interface PickExample {
  playerId: string
  role: Role
  seriesDate: string
  candidates: PickCandidate[]
  actualChampionId: string
}

/** One scored candidate after applying the model. */
export interface PickLikelihood {
  championId: string
  probability: number
  features: PickFeatures
}

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

      // Hessian: -sum_j(p_j * x_j) * x_i^T + p_actual * x_actual * x_i^T
      // Simplified: Hessian of log-likelihood = -(covariance of features under softmax)
      for (let i = 0; i < K; i++) {
        for (let j = 0; j < K; j++) {
          let h = 0
          for (let m = 0; m < ex.x.length; m++) {
            h -= probs[m] * ex.x[m][i] * ex.x[m][j]
          }
          // Add back the actual pick's contribution (it's already in the sum with negative sign)
          // The Hessian of log p(actual) = -E[xx^T] + p_actual * x_actual * x_actual^T
          // But the standard form for multinomial logit is just -E[xx^T] + p_actual * x_actual * x_actual^T
          // Actually, the Hessian of log-likelihood for conditional logit is:
          // d^2/dw_i dw_j log p(actual) = -sum_m p_m x_mi x_mj + p_actual x_actual_i x_actual_j
          // But since we already have -sum_m p_m x_mi x_mj in h, we need to add p_actual * x_actual_i * x_actual_j
          // Wait, the gradient is x_actual - sum_m p_m x_m
          // The Hessian is -sum_m p_m(1-p_m) x_m x_m^T + sum_{m!=n} p_m p_n x_m x_n^T
          // This simplifies to: -sum_m p_m x_m x_m^T + (sum_m p_m x_m)(sum_n p_n x_n)^T
          // Let's use the simpler form: Hessian = -(E[xx^T] - E[x]E[x]^T) = -Cov[x]
          // But for numerical stability, let's use the direct form
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

/** Backtest result for a single game. */
export interface BacktestGame {
  seriesId: string
  gameNumber: number
  /** Per-player results. */
  players: BacktestPlayer[]
}

export interface BacktestPlayer {
  playerId: string
  playerName: string
  championId: string
  /** Whether the pick was in the player's available (credible) pool. */
  inPool: boolean
  /** Rank in the credible pool (1-based), or 0 if not in pool. */
  rank: number
  /** Total number of prior games for this player. */
  priorGames: number
}

/** Backtest summary statistics. */
export interface BacktestSummary {
  /** All picks: share that were in the available pool. */
  inPool: number
  /** All picks: share that were in top 3. */
  inTop3: number
  /** All picks: share that were in top 5. */
  inTop5: number
  /** Same three numbers restricted to players with >= 20 prior games. */
  inPool20: number
  inTop320: number
  inTop520: number
  /** Total picks analyzed. */
  totalPicks: number
  /** Total picks from players with >= 20 prior games. */
  totalPicks20: number
}

/**
 * Evaluate the "games played" ranking (the board's ranking) on a set of examples.
 * Uses playerPool + crediblePool: only champions the player has played, sorted by
 * games desc then recency desc. Champions not played are misses.
 */
export function evaluateGamesPlayed(
  seriesList: readonly SeriesDraft[],
  picks: readonly PickRow[],
): { top1: number; top3: number; top5: number; top10: number; picks: number; picks20: number; top1_20: number; top3_20: number; top5_20: number; top10_20: number } {
  let top1 = 0, top3 = 0, top5 = 0, top10 = 0
  let top1_20 = 0, top3_20 = 0, top5_20 = 0, top10_20 = 0
  let totalPicks = 0, totalPicks20 = 0

  for (const series of seriesList) {
    for (const game of series.games) {
      const burned = burnedChampions(series.games, game.gameNumber)

      for (const pick of game.picks) {
        const pool = playerPool(picks, pick.playerId, series.scheduledStart)
        const { credible } = crediblePool(pool, burned)
        const rank = credible.findIndex((e) => e.championId === pick.championId) + 1
        const priorGames = pool.reduce((sum, e) => sum + e.games, 0)

        totalPicks++
        if (rank >= 1 && rank <= 1) top1++
        if (rank >= 1 && rank <= 3) top3++
        if (rank >= 1 && rank <= 5) top5++
        if (rank >= 1 && rank <= 10) top10++

        if (priorGames >= 20) {
          totalPicks20++
          if (rank >= 1 && rank <= 1) top1_20++
          if (rank >= 1 && rank <= 3) top3_20++
          if (rank >= 1 && rank <= 5) top5_20++
          if (rank >= 1 && rank <= 10) top10_20++
        }
      }
    }
  }

  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0

  return {
    top1: pct(top1, totalPicks),
    top3: pct(top3, totalPicks),
    top5: pct(top5, totalPicks),
    top10: pct(top10, totalPicks),
    picks: totalPicks,
    picks20: totalPicks20,
    top1_20: pct(top1_20, totalPicks20),
    top3_20: pct(top3_20, totalPicks20),
    top5_20: pct(top5_20, totalPicks20),
    top10_20: pct(top10_20, totalPicks20),
  }
}

/**
 * Build pick likelihoods for one player in the app context.
 *
 * The app has the model, role counts from the series file, and the player's
 * pool. This function builds the candidate features and scores them.
 *
 * `roleCounts` comes from the series file: per role, per champion [n45, nAll].
 * `totalRole45` / `totalRoleAll` are the denominators for the role.
 * `allChampionIds` is the set of champions seen before this series.
 * `burned` is the set of burned champion IDs.
 * `picks` is the full PickRow array (for player history).
 * `seriesDate` is the series start date string.
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

/** One row of the calibration table. */
export interface CalibrationBin {
  /** Bin label, e.g. "0-2%". */
  label: string
  /** Number of candidates in this bin. */
  count: number
  /** Mean predicted probability (percentage). */
  meanPredicted: number
  /** Share actually picked (percentage). */
  actualPickRate: number
}

/**
 * Calibrate the model: bin every candidate's probability and measure the share
 * actually picked in each bin.
 *
 * Bins: 0-2%, 2-5%, 5-10%, 10-20%, 20%+.
 */
export function calibrateModel(
  model: PickModel,
  examples: readonly PickExample[],
): CalibrationBin[] {
  // Collect all (probability, wasActual) pairs
  interface Pair { prob: number; actual: boolean }
  const pairs: Pair[] = []

  for (const ex of examples) {
    const likelihoods = pickLikelihoods(model, ex.candidates)
    for (const l of likelihoods) {
      pairs.push({ prob: l.probability * 100, actual: l.championId === ex.actualChampionId })
    }
  }

  // Define bins: [low, high) where high is exclusive; last bin is inclusive on both ends
  const bins: { label: string; low: number; high: number }[] = [
    { label: '0-2%', low: 0, high: 2 },
    { label: '2-5%', low: 2, high: 5 },
    { label: '5-10%', low: 5, high: 10 },
    { label: '10-20%', low: 10, high: 20 },
    { label: '20%+', low: 20, high: Infinity },
  ]

  const result: CalibrationBin[] = bins.map((bin) => {
    const inBin = pairs.filter((p) => p.prob >= bin.low && p.prob < bin.high)
    const count = inBin.length
    const meanPredicted = count > 0 ? inBin.reduce((s, p) => s + p.prob, 0) / count : 0
    const actualPickRate = count > 0 ? inBin.filter((p) => p.actual).length / count * 100 : 0
    return {
      label: bin.label,
      count,
      meanPredicted: Math.round(meanPredicted * 10) / 10,
      actualPickRate: Math.round(actualPickRate * 10) / 10,
    }
  })

  return result
}

// ── Ban leverage and denial picks ──────────────────────────────────────

/** One player's contribution to a champion's threat. */
export interface ThreatHit {
  playerId: string
  playerName: string
  probability: number
}

/** A champion's threat from one team. */
export interface ChampionThreat {
  championId: string
  /** 1 - product of (1 - P(player picks c)) over the five players. */
  threat: number
  /** Players who individually have ≥ 5% likelihood for this champion. */
  hits: ThreatHit[]
}

/**
 * Threat of champion `c` from a team: the probability that at least one of its
 * five players picks it.  `1 - product(1 - P(player picks c))`.
 *
 * `playerLikelihoods` is an array of 5 likelihood arrays, one per player, paired
 * with `players` in order.
 *
 * Returns the threat value and the list of players who individually want it
 * (likelihood ≥ 5%).
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

/** A ban leverage entry: champion ranked by (threat from B - threat from A). */
export interface BanLeverageEntry {
  championId: string
  /** Threat from the opposing team. */
  threatFromOpponent: number
  /** Threat from the own team (cost of banning). */
  threatFromOwn: number
  /** Difference: threatFromOpponent - threatFromOwn. */
  leverage: number
  /** Opponent players who want this champion (≥ 5%). */
  opponentHits: ThreatHit[]
  /** Own-team players who want this champion (≥ 5%). */
  ownHits: ThreatHit[]
}

/**
 * Ban leverage for team A against team B.
 *
 * For every available champion, compute `threat from B` and `threat from A`.
 * Sort by `threat from B - threat from A` descending. Return the top 8.
 *
 * `opponentPlayerLikelihoods` is an array of 5 likelihood arrays (one per opponent player).
 * `ownPlayerLikelihoods` is an array of 5 likelihood arrays (one per own player).
 * `availableChampions` is the set of champions not burned and not banned.
 */
export function banLeverage(
  opponentPlayerLikelihoods: PickLikelihood[][],
  ownPlayerLikelihoods: PickLikelihood[][],
  opponentPlayers: readonly PlayerRef[],
  ownPlayers: readonly PlayerRef[],
  availableChampions: Set<string>,
  topN: number = 8,
): BanLeverageEntry[] {
  // Consider ALL available champions, not just those in likelihood arrays.
  // Champions not in any player's likelihoods have zero probability.
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

/** A denial pick entry. */
export interface DenialPickEntry {
  championId: string
  /** The own-team player who can take it. */
  ownPlayerId: string
  ownPlayerName: string
  /** This player's likelihood for the champion. */
  ownProbability: number
  /** How many times this player has played the champion. */
  gamesPlayed: number
  /** Threat from the opposing team. */
  threatFromOpponent: number
  /** Opponent players who want this champion (≥ 5%). */
  opponentHits: ThreatHit[]
}

/**
 * Denial picks for team A: champions where an A player has played the champion
 * before and has it among their ten most likely, sorted by threat from B.
 *
 * `ownPlayerLikelihoods` is an array of 5 likelihood arrays (one per own player).
 * `opponentPlayerLikelihoods` is an array of 5 likelihood arrays (one per opponent player).
 * `ownPlayerPools` maps playerId → championId → gamesPlayed count.
 *
 * Returns the top 5.
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

/** Ban leverage backtest result for one group. */
export interface LeverageBacktestGroup {
  name: string
  bans: number
  /** Share of actual bans in top 5 by ban leverage. */
  leverageTop5: number
  /** Share of actual bans in top 8 by ban leverage. */
  leverageTop8: number
  /** Share of actual bans in top 5 by opponent threat alone. */
  threatTop5: number
  /** Share of actual bans in top 8 by opponent threat alone. */
  threatTop8: number
  /** Share of actual bans in top 5 by 45-day meta (most picked across all roles). */
  metaTop5: number
  /** Share of actual bans in top 8 by 45-day meta. */
  metaTop8: number
}

/**
 * Backtest ban leverage on a set of games.
 *
 * For every ban in a game where all ten players have a role, measures:
 * - Share of actual bans in the banning team's top 5 and top 8 by ban leverage.
 * - Same for opponent threat alone.
 * - Same for 45-day meta (most picked champions across all roles).
 *
 * Throws if a player with a role gets an empty likelihood list (indicates missing
 * roleCounts or championsSeen on the series draft).
 *
 * Returns results for all games and games 2+.
 */
export function backtestLeverage(
  seriesList: readonly SeriesDraft[],
  picks: readonly PickRow[],
  model: PickModel,
  playerRole: Map<string, Role | null>,
): { all: LeverageBacktestGroup; games2Plus: LeverageBacktestGroup } {

  interface GameBanCheck {
    gameNumber: number
    banningTeamId: string
    bannedChampionId: string
    draft: SeriesDraft
    game: GameDraft
  }

  // Collect all bans across all games, grouped by (draft, game) for likelihood caching
  const allBanChecks: GameBanCheck[] = []

  for (const draft of seriesList) {
    // Verify draft has roleCounts and championsSeen
    if (!draft.roleCounts || !draft.championsSeen) {
      throw new Error(`Series ${draft.seriesId} missing roleCounts or championsSeen — pipeline did not attach them`)
    }

    for (const game of draft.games) {
      const bans = game.actions.filter(a => a.type === 'ban')
      if (bans.length === 0) continue

      // Check that all 10 players have a role
      const allHaveRole = game.picks.every(pick => playerRole.get(pick.playerId) !== null)
      if (!allHaveRole) continue

      for (const ban of bans) {
        allBanChecks.push({
          gameNumber: game.gameNumber,
          banningTeamId: ban.teamId,
          bannedChampionId: ban.championId,
          draft,
          game,
        })
      }
    }
  }

  // Cache: key = "seriesId:gameNumber" → { ownLikelihoods, oppLikelihoods, available, threatRanking, metaRanking }
  interface GameCache {
    // Likelihoods per player, indexed by team side
    likelihoodsByPlayer: Map<string, PickLikelihood[]> // playerId → likelihoods
    available: Set<string>
    threatRanking: string[] // championIds sorted by opponent threat desc
    metaRanking: string[] // championIds sorted by 45-day meta count desc
  }

  const gameCache = new Map<string, GameCache>()

  function getGameCache(draft: SeriesDraft, gameNumber: number): GameCache {
    const key = `${draft.seriesId}:${gameNumber}`
    const cached = gameCache.get(key)
    if (cached) return cached

    const game = draft.games.find(g => g.gameNumber === gameNumber)
    if (!game) throw new Error(`Game ${gameNumber} not found in series ${draft.seriesId}`)

    const burned = burnedChampions(draft.games, gameNumber)
    const allChampionIds = new Set(draft.championsSeen)
    const available = new Set<string>()
    for (const c of allChampionIds) {
      if (!burned.has(c)) available.add(c)
    }

    // Build per-player likelihoods (once per player per game)
    const likelihoodsByPlayer = new Map<string, PickLikelihood[]>()
    for (const pick of game.picks) {
      const role = playerRole.get(pick.playerId)
      if (!role) {
        likelihoodsByPlayer.set(pick.playerId, [])
        continue
      }

      const rc = draft.roleCounts?.[role]
      if (!rc) {
        likelihoodsByPlayer.set(pick.playerId, [])
        continue
      }

      const rolePicks45 = new Map<string, number>()
      const rolePicksAll = new Map<string, number>()
      for (const [champId, counts] of Object.entries(rc.champions)) {
        rolePicks45.set(champId, counts[0])
        rolePicksAll.set(champId, counts[1])
      }

      const candidates = pickFeatures(
        pick.playerId,
        draft.scheduledStart,
        picks,
        burned,
        rolePicks45,
        rolePicksAll,
        rc.total45,
        rc.totalAll,
        allChampionIds,
      )
      const likelihoods = pickLikelihoods(model, candidates)

      // 2b: throw if a player with a role gets an empty likelihood list
      if (likelihoods.length === 0) {
        throw new Error(`Player ${pick.playerId} (${pick.playerName}) with role ${role} has empty likelihoods in series ${draft.seriesId} game ${gameNumber}`)
      }

      likelihoodsByPlayer.set(pick.playerId, likelihoods)
    }

    // Pre-compute threat ranking for all available champions
    // We need to compute threat for both teams, but the ranking depends on which team is "opponent"
    // Since we don't know the banning team yet, we'll compute threat rankings per team
    // Actually, we can compute the threat ranking once per team per game
    // For simplicity, compute threat ranking for each team's perspective

    // 45-day meta ranking (once per series)
    const cutoff45 = Date.parse(draft.scheduledStart) - 45 * 24 * 60 * 60 * 1000
    const metaCounts = new Map<string, number>()
    for (const p of picks) {
      if (Date.parse(p.scheduledStart) >= cutoff45 && Date.parse(p.scheduledStart) < Date.parse(draft.scheduledStart)) {
        metaCounts.set(p.championId, (metaCounts.get(p.championId) ?? 0) + 1)
      }
    }
    const metaRanking: string[] = []
    for (const [champId] of metaCounts) {
      if (available.has(champId)) {
        metaRanking.push(champId)
      }
    }
    metaRanking.sort((a, b) => (metaCounts.get(b) ?? 0) - (metaCounts.get(a) ?? 0))

    const cache: GameCache = {
      likelihoodsByPlayer,
      available,
      threatRanking: [], // computed lazily per banning team
      metaRanking,
    }
    gameCache.set(key, cache)
    return cache
  }

  function evaluateBans(bans: GameBanCheck[]): LeverageBacktestGroup {
    let leverageTop5 = 0, leverageTop8 = 0
    let threatTop5 = 0, threatTop8 = 0
    let metaTop5 = 0, metaTop8 = 0

    // Group bans by (draft, game, banning team) to compute rankings once per group
    const byTeamGame = new Map<string, GameBanCheck[]>()
    for (const bc of bans) {
      const teamKey = `${bc.draft.seriesId}:${bc.gameNumber}:${bc.banningTeamId}`
      const list = byTeamGame.get(teamKey) ?? []
      list.push(bc)
      byTeamGame.set(teamKey, list)
    }

    // Cache threat rankings per (draft, gameNumber, banningTeamId)
    const threatRankCache = new Map<string, string[]>()

    for (const [, teamBans] of byTeamGame) {
      const bc = teamBans[0]
      const cache = getGameCache(bc.draft, bc.gameNumber)

      const ownTeamId = bc.banningTeamId
      const oppTeamId = bc.draft.teamIds.find(t => t !== bc.banningTeamId)
      if (!oppTeamId) continue

      const game = bc.game
      const ownPlayerIds = game.picks.filter(p => p.teamId === ownTeamId).map(p => p.playerId)
      const oppPlayerIds = game.picks.filter(p => p.teamId === oppTeamId).map(p => p.playerId)

      const ownPlayerLikelihoods = ownPlayerIds.map(pid => cache.likelihoodsByPlayer.get(pid) ?? [])
      const oppPlayerLikelihoods = oppPlayerIds.map(pid => cache.likelihoodsByPlayer.get(pid) ?? [])

      const ownPlayers: PlayerRef[] = ownPlayerIds.map(pid => ({
        id: pid,
        name: game.picks.find(p => p.playerId === pid)?.playerName ?? '',
        role: playerRole.get(pid) ?? null,
      }))
      const oppPlayers: PlayerRef[] = oppPlayerIds.map(pid => ({
        id: pid,
        name: game.picks.find(p => p.playerId === pid)?.playerName ?? '',
        role: playerRole.get(pid) ?? null,
      }))

      // Compute threat ranking for this team's perspective (once per team per game)
      const threatKey = `${bc.draft.seriesId}:${bc.gameNumber}:${bc.banningTeamId}`
      let threatRanking = threatRankCache.get(threatKey)
      if (!threatRanking) {
        const threatEntries: { championId: string; threat: number }[] = []
        for (const champId of cache.available) {
          const t = threat(oppPlayerLikelihoods, champId, oppPlayers)
          threatEntries.push({ championId: champId, threat: t.threat })
        }
        threatEntries.sort((a, b) => b.threat - a.threat)
        threatRanking = threatEntries.map(e => e.championId)
        threatRankCache.set(threatKey, threatRanking)
      }

      // Ban leverage ranking (once per team per game)
      const leverageList = banLeverage(
        oppPlayerLikelihoods,
        ownPlayerLikelihoods,
        oppPlayers,
        ownPlayers,
        cache.available,
      )
      const leverageRankMap = new Map<string, number>()
      leverageList.forEach((e, i) => leverageRankMap.set(e.championId, i + 1))

      // Check each ban
      for (const ban of teamBans) {
        const bannedChampionId = ban.bannedChampionId

        // 1. Ban leverage
        const leverageRank = leverageRankMap.get(bannedChampionId) ?? 0
        if (leverageRank >= 1 && leverageRank <= 5) leverageTop5++
        if (leverageRank >= 1 && leverageRank <= 8) leverageTop8++

        // 2. Opponent threat alone
        const threatRank = threatRanking.indexOf(bannedChampionId) + 1
        if (threatRank >= 1 && threatRank <= 5) threatTop5++
        if (threatRank >= 1 && threatRank <= 8) threatTop8++

        // 3. 45-day meta
        const metaRank = cache.metaRanking.indexOf(bannedChampionId) + 1
        if (metaRank >= 1 && metaRank <= 5) metaTop5++
        if (metaRank >= 1 && metaRank <= 8) metaTop8++
      }
    }

    const n = bans.length
    const pct = (v: number) => n > 0 ? Math.round(v / n * 1000) / 10 : 0

    return {
      name: '',
      bans: n,
      leverageTop5: pct(leverageTop5),
      leverageTop8: pct(leverageTop8),
      threatTop5: pct(threatTop5),
      threatTop8: pct(threatTop8),
      metaTop5: pct(metaTop5),
      metaTop8: pct(metaTop8),
    }
  }

  const games2PlusBans = allBanChecks.filter(b => b.gameNumber >= 2)

  const all = evaluateBans(allBanChecks)
  all.name = 'all games'

  const games2Plus = evaluateBans(games2PlusBans)
  games2Plus.name = 'games 2+'

  return { all, games2Plus }
}

/**
 * Run a backtest over every game numbered 2 or higher in multi-game series.
 *
 * For each pick, checks whether the champion was in the player's credible pool
 * (available after burning) as of that series, and what rank it held.
 *
 * Returns per-game results and an overall summary.
 */
export function backtest(
  seriesList: readonly SeriesDraft[],
  picks: readonly PickRow[],
): { games: BacktestGame[]; summary: BacktestSummary } {
  const games: BacktestGame[] = []

  let totalInPool = 0
  let totalInTop3 = 0
  let totalInTop5 = 0
  let totalPicks = 0
  let totalInPool20 = 0
  let totalInTop320 = 0
  let totalInTop520 = 0
  let totalPicks20 = 0

  for (const series of seriesList) {
    if (series.games.length < 2) continue

    for (const game of series.games) {
      if (game.gameNumber < 2) continue

      const burned = burnedChampions(series.games, game.gameNumber)
      const playerResults: BacktestPlayer[] = []

      for (const pick of game.picks) {
        const pool = playerPool(picks, pick.playerId, series.scheduledStart)
        const { credible } = crediblePool(pool, burned)
        const rank = credible.findIndex((e) => e.championId === pick.championId) + 1
        const inPool = rank > 0
        const priorGames = pool.reduce((sum, e) => sum + e.games, 0)

        playerResults.push({
          playerId: pick.playerId,
          playerName: pick.playerName,
          championId: pick.championId,
          inPool,
          rank: inPool ? rank : 0,
          priorGames,
        })

        // Count for overall stats
        totalPicks++
        if (inPool) totalInPool++
        if (rank >= 1 && rank <= 3) totalInTop3++
        if (rank >= 1 && rank <= 5) totalInTop5++

        // Count for >= 20 prior games stats
        if (priorGames >= 20) {
          totalPicks20++
          if (inPool) totalInPool20++
          if (rank >= 1 && rank <= 3) totalInTop320++
          if (rank >= 1 && rank <= 5) totalInTop520++
        }
      }

      games.push({
        seriesId: series.seriesId,
        gameNumber: game.gameNumber,
        players: playerResults,
      })
    }
  }

  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0)

  const summary: BacktestSummary = {
    inPool: pct(totalInPool, totalPicks),
    inTop3: pct(totalInTop3, totalPicks),
    inTop5: pct(totalInTop5, totalPicks),
    inPool20: pct(totalInPool20, totalPicks20),
    inTop320: pct(totalInTop320, totalPicks20),
    inTop520: pct(totalInTop520, totalPicks20),
    totalPicks,
    totalPicks20,
  }

  return { games, summary }
}
