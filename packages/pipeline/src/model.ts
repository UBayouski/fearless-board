// Model training: builds examples, trains, and evaluates the pick model.
// Extracted from index.ts per docs/refactor.md section 5.

import type { SeriesDraft, Role, PickRow, PickModel, PickExample } from '@fearless-board/shared'
import { pickFeatures, trainPickModel, pickLikelihoods, burnedChampions, playerPool, crediblePool } from '@fearless-board/shared'

interface SeriesMeta {
  allChampionIds: Set<string>
  rolePicks45: Map<Role, Map<string, number>>
  rolePicksAll: Map<Role, Map<string, number>>
  totalRole45: Map<Role, number>
  totalRoleAll: Map<Role, number>
}

export interface TrainingResult {
  evalModel: PickModel
  finalModel: PickModel
  modelGroups: ModelGroup[]
  testMeanLL: number
  seriesMeta: Map<string, SeriesMeta>
}

export interface ModelGroup {
  name: string
  picks: number
  model: { top1: number; top3: number; top5: number; top10: number }
  gamesPlayed: { top1: number; top3: number; top5: number; top10: number }
}

export function trainAndEvaluate(
  drafts: SeriesDraft[],
  allPicks: PickRow[],
  playerRole: Map<string, Role | null>,
  splitDate: string,
): TrainingResult {
  console.log('Building pick likelihood model...')

  // Index: playerId -> PickRow[] sorted by scheduledStart
  const picksByPlayer = new Map<string, PickRow[]>()
  for (const p of allPicks) {
    let list = picksByPlayer.get(p.playerId)
    if (!list) {
      list = []
      picksByPlayer.set(p.playerId, list)
    }
    list.push(p)
  }
  for (const [, list] of picksByPlayer) {
    list.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  }

  // Build examples once for all series
  const seriesMeta = new Map<string, SeriesMeta>()
  const allExamplesList: { example: PickExample; seriesDate: string; gameNumber: number; priorGames: number }[] = []

  for (const draft of drafts) {
    const seriesDate = draft.scheduledStart

    // Build allChampionIds: every champion picked in any series before this one
    const allChampionIds = new Set<string>()
    for (const p of allPicks) {
      if (p.scheduledStart < seriesDate) {
        allChampionIds.add(p.championId)
      }
    }

    // Skip if fewer than 80 champions have appeared (per spec)
    if (allChampionIds.size < 80) {
      seriesMeta.set(draft.seriesId, { allChampionIds, rolePicks45: new Map(), rolePicksAll: new Map(), totalRole45: new Map(), totalRoleAll: new Map() })
      continue
    }

    // Build role-level pick counts for this series
    const cutoff45 = Date.parse(seriesDate) - 45 * 24 * 60 * 60 * 1000
    const rolePicks45Map = new Map<Role, Map<string, number>>()
    const rolePicksAllMap = new Map<Role, Map<string, number>>()
    const totalRole45Map = new Map<Role, number>()
    const totalRoleAllMap = new Map<Role, number>()

    for (const role of ['top', 'jungle', 'mid', 'bot', 'support'] as Role[]) {
      const p45 = new Map<string, number>()
      const pAll = new Map<string, number>()
      let t45 = 0, tAll = 0

      for (const p of allPicks) {
        if (p.scheduledStart >= seriesDate) continue
        const pr = playerRole.get(p.playerId)
        if (pr !== role) continue

        const c = p.championId
        pAll.set(c, (pAll.get(c) ?? 0) + 1)
        tAll++
        if (Date.parse(p.scheduledStart) >= cutoff45) {
          p45.set(c, (p45.get(c) ?? 0) + 1)
          t45++
        }
      }

      rolePicks45Map.set(role, p45)
      rolePicksAllMap.set(role, pAll)
      totalRole45Map.set(role, t45)
      totalRoleAllMap.set(role, tAll)
    }

    seriesMeta.set(draft.seriesId, { allChampionIds, rolePicks45: rolePicks45Map, rolePicksAll: rolePicksAllMap, totalRole45: totalRole45Map, totalRoleAll: totalRoleAllMap })

    // For each game in this series, build examples for each pick
    for (const game of draft.games) {
      const burned = burnedChampions(draft.games, game.gameNumber)

      for (const pick of game.picks) {
        const role = playerRole.get(pick.playerId)
        if (!role) continue

        const meta = seriesMeta.get(draft.seriesId)
        if (!meta) continue

        const candidates = pickFeatures(
          pick.playerId,
          seriesDate,
          allPicks,
          burned,
          meta.rolePicks45.get(role) ?? new Map(),
          meta.rolePicksAll.get(role) ?? new Map(),
          meta.totalRole45.get(role) ?? 0,
          meta.totalRoleAll.get(role) ?? 0,
          allChampionIds,
        )

        if (candidates.length === 0) continue

        // Count prior games for this player
        const playerPicks = picksByPlayer.get(pick.playerId) ?? []
        let priorGames = 0
        for (const pp of playerPicks) {
          if (pp.scheduledStart < seriesDate) priorGames++
        }

        allExamplesList.push({
          example: {
            playerId: pick.playerId,
            role,
            seriesDate,
            candidates,
            actualChampionId: pick.championId,
          },
          seriesDate,
          gameNumber: game.gameNumber,
          priorGames,
        })
      }
    }
  }

  // Split examples at the split date
  const trainExamples = allExamplesList.filter(e => e.seriesDate < splitDate).map(e => e.example)
  const evalExamples = allExamplesList.filter(e => e.seriesDate >= splitDate)

  console.log(`  Training examples: ${trainExamples.length}`)
  console.log(`  Evaluation examples: ${evalExamples.length}`)

  // Train model on pre-2026 data
  console.log('  Training model...')
  const evalModel = trainPickModel(trainExamples)
  console.log(`  Weights: [${evalModel.weights.map(w => w.toFixed(4)).join(', ')}]`)
  console.log(`  Training log-likelihood: ${evalModel.meanLogLikelihood.toFixed(4)} (${evalModel.iterations} iterations)`)

  // Evaluate model on 2026+ data
  function evaluateModelOnExamples(model: PickModel, examples: typeof evalExamples) {
    const groups: ModelGroup[] = []

    type GroupFilter = (e: typeof evalExamples[0]) => boolean
    const groupDefs: { name: string; filter: GroupFilter }[] = [
      { name: 'all', filter: () => true },
      { name: 'games 2+', filter: e => e.gameNumber >= 2 },
      { name: 'games 2+, 20+ prior games', filter: e => e.gameNumber >= 2 && e.priorGames >= 20 },
    ]

    for (const { name, filter } of groupDefs) {
      const filtered = examples.filter(filter)
      if (filtered.length === 0) continue

      let top1 = 0, top3 = 0, top5 = 0, top10 = 0
      let gpTop1 = 0, gpTop3 = 0, gpTop5 = 0, gpTop10 = 0

      for (const item of filtered) {
        const { example } = item

        // Model evaluation
        const likelihoods = pickLikelihoods(model, example.candidates)
        const actualRank = likelihoods.findIndex(l => l.championId === example.actualChampionId) + 1

        if (actualRank >= 1 && actualRank <= 1) top1++
        if (actualRank >= 1 && actualRank <= 3) top3++
        if (actualRank >= 1 && actualRank <= 5) top5++
        if (actualRank >= 1 && actualRank <= 10) top10++

        // Games played evaluation: use playerPool + crediblePool (board's ranking)
        const pool = playerPool(allPicks, example.playerId, example.seriesDate)
        const series = drafts.find(d => d.scheduledStart === example.seriesDate)
        if (series) {
          const game = series.games.find(g => g.gameNumber === item.gameNumber)
          if (game) {
            const burned = burnedChampions(series.games, game.gameNumber)
            const { credible: cred } = crediblePool(pool, burned)
            const gpRank = cred.findIndex((e) => e.championId === example.actualChampionId) + 1

            if (gpRank >= 1 && gpRank <= 1) gpTop1++
            if (gpRank >= 1 && gpRank <= 3) gpTop3++
            if (gpRank >= 1 && gpRank <= 5) gpTop5++
            if (gpRank >= 1 && gpRank <= 10) gpTop10++
          }
        }
      }

      const n = filtered.length
      const pct = (v: number) => Math.round(v / n * 1000) / 10

      groups.push({
        name,
        picks: n,
        model: { top1: pct(top1), top3: pct(top3), top5: pct(top5), top10: pct(top10) },
        gamesPlayed: { top1: pct(gpTop1), top3: pct(gpTop3), top5: pct(gpTop5), top10: pct(gpTop10) },
      })
    }

    return groups
  }

  const modelGroups = evaluateModelOnExamples(evalModel, evalExamples)

  console.log('\n  Model evaluation (2026+ games):')
  for (const g of modelGroups) {
    console.log(`  ${g.name} (${g.picks} picks):`)
    console.log(`    Model       — Top 1: ${g.model.top1}%, Top 3: ${g.model.top3}%, Top 5: ${g.model.top5}%, Top 10: ${g.model.top10}%`)
    console.log(`    Games played — Top 1: ${g.gamesPlayed.top1}%, Top 3: ${g.gamesPlayed.top3}%, Top 5: ${g.gamesPlayed.top5}%, Top 10: ${g.gamesPlayed.top10}%`)
  }

  // Train final model on all data
  console.log('\n  Training final model on all data...')
  const allExamples = allExamplesList.map(e => e.example)
  console.log(`  All examples: ${allExamples.length}`)
  const finalModel = trainPickModel(allExamples)
  console.log(`  Final weights: [${finalModel.weights.map(w => w.toFixed(4)).join(', ')}]`)
  console.log(`  Final log-likelihood: ${finalModel.meanLogLikelihood.toFixed(4)} (${finalModel.iterations} iterations)`)

  // Compute test log-likelihood
  let testLL = 0
  let testLLCount = 0
  for (const item of evalExamples) {
    const likelihoods = pickLikelihoods(evalModel, item.example.candidates)
    const actual = likelihoods.find(l => l.championId === item.example.actualChampionId)
    if (actual) {
      testLL += Math.log(actual.probability)
      testLLCount++
    }
  }
  const testMeanLL = testLLCount > 0 ? testLL / testLLCount : 0
  console.log(`\n  Test log-likelihood: ${testMeanLL.toFixed(4)} (${testLLCount} examples)`)

  return { evalModel, finalModel, modelGroups, testMeanLL, seriesMeta }
}
