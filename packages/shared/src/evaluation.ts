// Evaluation: backtests and calibration.

import type {
  SeriesDraft, PickRow, PickModel, Role, PickExample, PickLikelihood,
  BacktestGame, BacktestPlayer, BacktestSummary, CalibrationBin,
  LeverageBacktestGroup, LiveDraftGroup, GameDraft, PlayerRef, PlayerPick,
} from './types.ts'
import { burnedChampions, playerPool, crediblePool } from './rules.ts'
import { pickFeatures, pickLikelihoods, threat, banLeverage, conditionLikelihoods, draftSlotType } from './model.ts'

/**
 * Convert roleCounts champions map to two separate maps for pickFeatures.
 */
function buildRolePickMaps(
  rc: { champions: Record<string, [number, number]> },
): { rolePicks45: Map<string, number>; rolePicksAll: Map<string, number> } {
  const rolePicks45 = new Map<string, number>()
  const rolePicksAll = new Map<string, number>()
  for (const [champId, counts] of Object.entries(rc.champions)) {
    rolePicks45.set(champId, counts[0])
    rolePicksAll.set(champId, counts[1])
  }
  return { rolePicks45, rolePicksAll }
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
 * Calibrate the model: bin every candidate's probability and measure the share
 * actually picked in each bin.
 *
 * Bins: 0-2%, 2-5%, 5-10%, 10-20%, 20%+.
 */
export function calibrateModel(
  model: PickModel,
  examples: readonly PickExample[],
): CalibrationBin[] {
  interface Pair { prob: number; actual: boolean }
  const pairs: Pair[] = []

  for (const ex of examples) {
    const likelihoods = pickLikelihoods(model, ex.candidates)
    for (const l of likelihoods) {
      pairs.push({ prob: l.probability * 100, actual: l.championId === ex.actualChampionId })
    }
  }

  const bins: { label: string; low: number; high: number }[] = [
    { label: '0-2%', low: 0, high: 2 },
    { label: '2-5%', low: 2, high: 5 },
    { label: '5-10%', low: 5, high: 10 },
    { label: '10-20%', low: 10, high: 20 },
    { label: '20%+', low: 20, high: Infinity },
  ]

  return bins.map((bin) => {
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
}

/**
 * Backtest ban leverage on a set of games.
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

  const allBanChecks: GameBanCheck[] = []

  for (const draft of seriesList) {
    if (!draft.roleCounts || !draft.championsSeen) {
      throw new Error(`Series ${draft.seriesId} missing roleCounts or championsSeen — pipeline did not attach them`)
    }

    for (const game of draft.games) {
      const bans = game.actions.filter(a => a.type === 'ban')
      if (bans.length === 0) continue

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

  interface GameCache {
    likelihoodsByPlayer: Map<string, PickLikelihood[]>
    available: Set<string>
    threatRanking: string[]
    metaRanking: string[]
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

      const { rolePicks45, rolePicksAll } = buildRolePickMaps(rc)

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

      if (likelihoods.length === 0) {
        throw new Error(`Player ${pick.playerId} (${pick.playerName}) with role ${role} has empty likelihoods in series ${draft.seriesId} game ${gameNumber}`)
      }

      likelihoodsByPlayer.set(pick.playerId, likelihoods)
    }

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
      threatRanking: [],
      metaRanking,
    }
    gameCache.set(key, cache)
    return cache
  }

  function evaluateBans(bans: GameBanCheck[]): LeverageBacktestGroup {
    let leverageTop5 = 0, leverageTop8 = 0
    let threatTop5 = 0, threatTop8 = 0
    let metaTop5 = 0, metaTop8 = 0

    const byTeamGame = new Map<string, GameBanCheck[]>()
    for (const bc of bans) {
      const teamKey = `${bc.draft.seriesId}:${bc.gameNumber}:${bc.banningTeamId}`
      const list = byTeamGame.get(teamKey) ?? []
      list.push(bc)
      byTeamGame.set(teamKey, list)
    }

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

      const leverageList = banLeverage(
        oppPlayerLikelihoods,
        ownPlayerLikelihoods,
        oppPlayers,
        ownPlayers,
        cache.available,
      )
      const leverageRankMap = new Map<string, number>()
      leverageList.forEach((e, i) => leverageRankMap.set(e.championId, i + 1))

      for (const ban of teamBans) {
        const bannedChampionId = ban.bannedChampionId

        const leverageRank = leverageRankMap.get(bannedChampionId) ?? 0
        if (leverageRank >= 1 && leverageRank <= 5) leverageTop5++
        if (leverageRank >= 1 && leverageRank <= 8) leverageTop8++

        const threatRank = threatRanking.indexOf(bannedChampionId) + 1
        if (threatRank >= 1 && threatRank <= 5) threatTop5++
        if (threatRank >= 1 && threatRank <= 8) threatTop8++

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
 * Backtest live draft conditioning.
 *
 * Returns pick backtest results and second-phase ban backtest results.
 * The first team is determined from the actual draft actions (not hard-coded to blue).
 */
export function backtestLiveDraft(
  seriesList: readonly SeriesDraft[],
  picks: readonly PickRow[],
  model: PickModel,
  playerRole: Map<string, Role | null>,
): {
  all: LiveDraftGroup
  byPickPosition: { name: string; conditioned: { top1: number; top3: number; top5: number; picks: number }; unconditioned: { top1: number; top3: number; top5: number } }[]
  /** Second-phase ban backtest: share of bans in top 5/8 by ban leverage. */
  secondPhaseBans: {
    all: { bans: number; leverageTop5: number; leverageTop8: number; unconditionedTop5: number; unconditionedTop8: number }
    games2Plus: { bans: number; leverageTop5: number; leverageTop8: number; unconditionedTop5: number; unconditionedTop8: number }
  }
  /** Share of red-first games per league and year. */
  redFirstShare: { league: string; year: string; totalGames: number; redFirstGames: number; share: number }[]
} {
  interface PickCheck {
    series: SeriesDraft
    game: GameDraft
    pick: PlayerPick
    playerLikelihoods: PickLikelihood[]
    pickPosition: number
    firstTeamId: string
  }

  interface SecondPhaseBanCheck {
    series: SeriesDraft
    game: GameDraft
    gameNumber: number
    banningTeamId: string
    bannedChampionId: string
    actionsBeforeBan: { type: 'ban' | 'pick'; teamId: string; championId: string; playerId?: string }[]
    firstTeamId: string
  }

  const allPickChecks: PickCheck[] = []
  const allSecondPhaseBanChecks: SecondPhaseBanCheck[] = []

  // Track red-first games per league/year
  const redFirstStats = new Map<string, { total: number; redFirst: number }>()

  for (const draft of seriesList) {
    if (!draft.roleCounts || !draft.championsSeen) continue

    for (const game of draft.games) {
      if (game.actions.length < 10) continue

      const burned = burnedChampions(draft.games, game.gameNumber)
      const allChampionIds = new Set(draft.championsSeen)

      // Determine first team from actual draft actions
      const firstAction = game.actions[0]
      const firstTeamId = firstAction.teamId
      const secondTeamId = draft.teamIds.find(t => t !== firstTeamId)
      if (!secondTeamId) continue

      // Track red-first: the first team is the red side
      const redSideTeamId = game.sides.red
      const isRedFirst = firstTeamId === redSideTeamId
      const league = draft.event
      const year = draft.scheduledStart.substring(0, 4)
      const key = `${league}|${year}`
      const stats = redFirstStats.get(key) ?? { total: 0, redFirst: 0 }
      stats.total++
      if (isRedFirst) stats.redFirst++
      redFirstStats.set(key, stats)

      // Build unconditioned likelihoods for each player
      const playerLikelihoods = new Map<string, PickLikelihood[]>()
      for (const pick of game.picks) {
        const role = playerRole.get(pick.playerId)
        if (!role) {
          playerLikelihoods.set(pick.playerId, [])
          continue
        }

        const rc = draft.roleCounts[role]
        if (!rc) {
          playerLikelihoods.set(pick.playerId, [])
          continue
        }

        const { rolePicks45, rolePicksAll } = buildRolePickMaps(rc)

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
        playerLikelihoods.set(pick.playerId, likelihoods)
      }

      const teamPickCount = new Map<string, number>()
      const champToPlayer = new Map<string, string>()
      for (const pick of game.picks) {
        champToPlayer.set(pick.championId, pick.playerId)
      }

      const playerToPick = new Map<string, typeof game.picks[0]>()
      for (const pick of game.picks) {
        playerToPick.set(pick.playerId, pick)
      }

      // Replay draft actions in order, using DRAFT_ORDER with first/second team
      const condUnavailable = new Set(burned)
      const condPickedPlayers = new Set<string>()

      // Second-phase bans are slots 12-15 (indices)
      const secondPhaseBanSlots = new Set<number>()
      for (let i = 12; i <= 15; i++) {
        if (draftSlotType(i) === 'b') secondPhaseBanSlots.add(i)
      }

      for (let actionIdx = 0; actionIdx < game.actions.length; actionIdx++) {
        const action = game.actions[actionIdx]

        // Check if this action is a second-phase ban
        if (action.type === 'ban' && secondPhaseBanSlots.has(actionIdx)) {
          allSecondPhaseBanChecks.push({
            series: draft,
            game,
            gameNumber: game.gameNumber,
            banningTeamId: action.teamId,
            bannedChampionId: action.championId,
            actionsBeforeBan: game.actions.slice(0, actionIdx).map(a => ({
              type: a.type,
              teamId: a.teamId,
              championId: a.championId,
            })),
            firstTeamId,
          })
        }

        if (action.type === 'ban') {
          condUnavailable.add(action.championId)
        } else if (action.type === 'pick') {
          const playerId = champToPlayer.get(action.championId)
          if (!playerId) {
            condUnavailable.add(action.championId)
            continue
          }

          const pickRow = playerToPick.get(playerId)
          if (!pickRow) {
            condUnavailable.add(action.championId)
            continue
          }

          const teamId = pickRow.teamId
          const pos = (teamPickCount.get(teamId) ?? 0) + 1
          teamPickCount.set(teamId, pos)

          const uncondLikelihoods = playerLikelihoods.get(playerId) ?? []

          allPickChecks.push({
            series: draft,
            game,
            pick: pickRow,
            playerLikelihoods: uncondLikelihoods,
            pickPosition: pos,
            firstTeamId,
          })

          condPickedPlayers.add(playerId)
          condUnavailable.add(action.championId)
        }
      }
    }
  }

  // ── Pick backtest ──────────────────────────────────────────────

  interface LiveDraftRow {
    conditionedRank: number
    unconditionedRank: number
    pickPosition: number
  }

  const allRows: LiveDraftRow[] = []
  const byPosition = new Map<number, LiveDraftRow[]>()

  for (const check of allPickChecks) {
    const { pick, playerLikelihoods: uncondLikelihoods, pickPosition } = check

    const uncondRank = uncondLikelihoods.findIndex(l => l.championId === pick.championId) + 1

    const gameActions = check.game.actions
    const pickActionIdx = gameActions.findIndex(a => a.type === 'pick' && a.championId === pick.championId)

    if (pickActionIdx >= 0) {
      const condUnavailable = new Set(burnedChampions(check.series.games, check.game.gameNumber))
      const condPickedPlayers = new Set<string>()

      const champToPlayer2 = new Map<string, string>()
      for (const p of check.game.picks) {
        champToPlayer2.set(p.championId, p.playerId)
      }

      for (let i = 0; i < pickActionIdx; i++) {
        const a = gameActions[i]
        if (a.type === 'ban') {
          condUnavailable.add(a.championId)
        } else if (a.type === 'pick') {
          const pid = champToPlayer2.get(a.championId)
          if (pid) {
            condPickedPlayers.add(pid)
          }
          condUnavailable.add(a.championId)
        }
      }

      const condLikelihoods = conditionLikelihoods(
        uncondLikelihoods,
        condUnavailable,
        pick.playerId,
        condPickedPlayers,
      )
      const condRank = condLikelihoods.findIndex(l => l.championId === pick.championId) + 1

      const row: LiveDraftRow = {
        conditionedRank: condRank,
        unconditionedRank: uncondRank,
        pickPosition,
      }
      allRows.push(row)

      const posList = byPosition.get(pickPosition) ?? []
      posList.push(row)
      byPosition.set(pickPosition, posList)
    }
  }

  function computeHitRates(rows: LiveDraftRow[], key: 'conditionedRank' | 'unconditionedRank'): { top1: number; top3: number; top5: number } {
    let top1 = 0, top3 = 0, top5 = 0
    for (const row of rows) {
      const rank = row[key]
      if (rank >= 1 && rank <= 1) top1++
      if (rank >= 1 && rank <= 3) top3++
      if (rank >= 1 && rank <= 5) top5++
    }
    const n = rows.length
    const pct = (v: number) => n > 0 ? Math.round(v / n * 1000) / 10 : 0
    return { top1: pct(top1), top3: pct(top3), top5: pct(top5) }
  }

  const allConditioned = computeHitRates(allRows, 'conditionedRank')
  const allUnconditioned = computeHitRates(allRows, 'unconditionedRank')

  const all: LiveDraftGroup = {
    name: 'all picks',
    picks: allRows.length,
    conditioned: allConditioned,
    unconditioned: allUnconditioned,
  }

  const byPickPosition: { name: string; conditioned: { top1: number; top3: number; top5: number; picks: number }; unconditioned: { top1: number; top3: number; top5: number } }[] = []

  for (let pos = 1; pos <= 5; pos++) {
    const rows = byPosition.get(pos) ?? []
    if (rows.length === 0) continue

    const cond = computeHitRates(rows, 'conditionedRank')
    const uncond = computeHitRates(rows, 'unconditionedRank')

    byPickPosition.push({
      name: `pick ${pos}`,
      conditioned: { ...cond, picks: rows.length },
      unconditioned: uncond,
    })
  }

  // ── Second-phase ban backtest ──────────────────────────────────

  function evaluateSecondPhaseBans(bans: SecondPhaseBanCheck[]) {
    let leverageTop5 = 0, leverageTop8 = 0
    let unconditionedTop5 = 0, unconditionedTop8 = 0

    const cache = new Map<string, {
      likelihoodsByPlayer: Map<string, PickLikelihood[]>
      available: Set<string>
      teamPlayers: Map<string, { playerLikelihoods: PickLikelihood[][]; players: PlayerRef[] }>
    }>()

    for (const ban of bans) {
      const key = `${ban.series.seriesId}:${ban.game.gameNumber}`
      let cached = cache.get(key)
      if (!cached) {
        const game = ban.game
        const burned = burnedChampions(ban.series.games, game.gameNumber)
        const allChampionIds = new Set(ban.series.championsSeen!)
        const available = new Set<string>()
        for (const c of allChampionIds) {
          if (!burned.has(c)) available.add(c)
        }

        const likelihoodsByPlayer = new Map<string, PickLikelihood[]>()
        const teamPlayers = new Map<string, { playerLikelihoods: PickLikelihood[][]; players: PlayerRef[] }>()

        for (const pick of game.picks) {
          const role = playerRole.get(pick.playerId)
          if (!role) {
            likelihoodsByPlayer.set(pick.playerId, [])
            continue
          }
          const rc = ban.series.roleCounts?.[role]
          if (!rc) {
            likelihoodsByPlayer.set(pick.playerId, [])
            continue
          }
          const { rolePicks45, rolePicksAll } = buildRolePickMaps(rc)
          const candidates = pickFeatures(
            pick.playerId, ban.series.scheduledStart, picks, burned,
            rolePicks45, rolePicksAll, rc.total45, rc.totalAll, allChampionIds,
          )
          const likelihoods = pickLikelihoods(model, candidates)
          likelihoodsByPlayer.set(pick.playerId, likelihoods)

          const list = teamPlayers.get(pick.teamId)
          if (!list) {
            teamPlayers.set(pick.teamId, { playerLikelihoods: [], players: [] })
          }
          const t = teamPlayers.get(pick.teamId)!
          t.playerLikelihoods.push(likelihoods)
          t.players.push({ id: pick.playerId, name: pick.playerName, role })
        }

        cached = { likelihoodsByPlayer, available, teamPlayers }
        cache.set(key, cached)
      }

      const banningTeamId = ban.banningTeamId
      const oppTeamId = ban.series.teamIds.find(t => t !== banningTeamId)
      if (!oppTeamId) continue

      const ownTeam = cached.teamPlayers.get(banningTeamId)
      const oppTeam = cached.teamPlayers.get(oppTeamId)
      if (!ownTeam || !oppTeam) continue

      // Build conditioned likelihoods: apply all actions before this ban
      const condUnavailable = new Set(burnedChampions(ban.series.games, ban.game.gameNumber))
      const condPickedPlayers = new Set<string>()
      const champToPlayer = new Map<string, string>()
      for (const p of ban.game.picks) champToPlayer.set(p.championId, p.playerId)

      for (const a of ban.actionsBeforeBan) {
        condUnavailable.add(a.championId)
        if (a.type === 'pick' && a.playerId) {
          condPickedPlayers.add(a.playerId)
        }
      }

      // Condition each player's likelihoods
      const ownCondLikelihoods = ownTeam.players.map((player, i) => {
        if (condPickedPlayers.has(player.id)) return []
        return conditionLikelihoods(ownTeam.playerLikelihoods[i], condUnavailable, player.id, condPickedPlayers)
      })
      const oppCondLikelihoods = oppTeam.players.map((player, i) => {
        if (condPickedPlayers.has(player.id)) return []
        return conditionLikelihoods(oppTeam.playerLikelihoods[i], condUnavailable, player.id, condPickedPlayers)
      })

      // Conditioned ban leverage
      const condAvailable = new Set<string>()
      for (const c of cached.available) {
        if (!condUnavailable.has(c)) condAvailable.add(c)
      }

      const leverageList = banLeverage(
        oppCondLikelihoods, ownCondLikelihoods, oppTeam.players, ownTeam.players, condAvailable,
      )
      const leverageRankMap = new Map<string, number>()
      leverageList.forEach((e, i) => leverageRankMap.set(e.championId, i + 1))

      // Unconditioned ban leverage (before draft)
      const uncondLeverageList = banLeverage(
        oppTeam.playerLikelihoods, ownTeam.playerLikelihoods, oppTeam.players, ownTeam.players, cached.available,
      )
      const uncondLeverageRankMap = new Map<string, number>()
      uncondLeverageList.forEach((e, i) => uncondLeverageRankMap.set(e.championId, i + 1))

      const bannedChampionId = ban.bannedChampionId
      const levRank = leverageRankMap.get(bannedChampionId) ?? 0
      if (levRank >= 1 && levRank <= 5) leverageTop5++
      if (levRank >= 1 && levRank <= 8) leverageTop8++

      const uncondRank = uncondLeverageRankMap.get(bannedChampionId) ?? 0
      if (uncondRank >= 1 && uncondRank <= 5) unconditionedTop5++
      if (uncondRank >= 1 && uncondRank <= 8) unconditionedTop8++
    }

    const n = bans.length
    const pct = (v: number) => n > 0 ? Math.round(v / n * 1000) / 10 : 0
    return {
      bans: n,
      leverageTop5: pct(leverageTop5),
      leverageTop8: pct(leverageTop8),
      unconditionedTop5: pct(unconditionedTop5),
      unconditionedTop8: pct(unconditionedTop8),
    }
  }

  const allSecondPhaseBans = evaluateSecondPhaseBans(allSecondPhaseBanChecks)
  const games2PlusBans = evaluateSecondPhaseBans(allSecondPhaseBanChecks.filter(b => b.gameNumber >= 2))

  const secondPhaseBans = {
    all: { ...allSecondPhaseBans },
    games2Plus: { ...games2PlusBans },
  }

  // ── Red-first share per league/year ────────────────────────────

  const redFirstShare: { league: string; year: string; totalGames: number; redFirstGames: number; share: number }[] = []
  for (const [key, stats] of redFirstStats) {
    const [league, year] = key.split('|')
    redFirstShare.push({
      league,
      year,
      totalGames: stats.total,
      redFirstGames: stats.redFirst,
      share: stats.total > 0 ? Math.round(stats.redFirst / stats.total * 1000) / 10 : 0,
    })
  }
  redFirstShare.sort((a, b) => a.league.localeCompare(b.league) || a.year.localeCompare(b.year))

  return { all, byPickPosition, secondPhaseBans, redFirstShare }
}

/**
 * Run a backtest over every game numbered 2 or higher in multi-game series.
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

        totalPicks++
        if (inPool) totalInPool++
        if (rank >= 1 && rank <= 3) totalInTop3++
        if (rank >= 1 && rank <= 5) totalInTop5++

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

