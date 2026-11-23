// Backtests: calibration, ban leverage, and live draft backtests.
// Extracted from index.ts per docs/refactor.md section 5.

import type { SeriesDraft, Role, PickRow } from '@fearless-board/shared'
import { backtestLeverage, backtestLiveDraft } from '@fearless-board/shared'
import type { TrainingResult } from './model.js'

export interface SeriesMeta {
  allChampionIds: Set<string>
  rolePicks45: Map<Role, Map<string, number>>
  rolePicksAll: Map<Role, Map<string, number>>
  totalRole45: Map<Role, number>
  totalRoleAll: Map<Role, number>
}

export function runBacktests(
  drafts: SeriesDraft[],
  allPicks: PickRow[],
  playerRole: Map<string, Role | null>,
  splitDate: string,
  training: TrainingResult,
) {
  const { evalModel } = training

  // Ban leverage backtest
  console.log('\nRunning ban leverage backtest...')
  const testSeries = drafts.filter(d => d.scheduledStart >= splitDate)
  console.log(`  Test series: ${testSeries.length}`)

  const leverageResult = backtestLeverage(
    testSeries,
    allPicks,
    evalModel,
    playerRole,
  )

  console.log('  Ban leverage backtest:')
  for (const group of [leverageResult.all, leverageResult.games2Plus]) {
    console.log(`  ${group.name} (${group.bans} bans):`)
    console.log(`    Leverage  — Top 5: ${group.leverageTop5}%, Top 8: ${group.leverageTop8}%`)
    console.log(`    Threat    — Top 5: ${group.threatTop5}%, Top 8: ${group.threatTop8}%`)
    console.log(`    Meta      — Top 5: ${group.metaTop5}%, Top 8: ${group.metaTop8}%`)
  }

  // Live draft backtest
  console.log('\nRunning live draft backtest...')
  const liveDraftResult = backtestLiveDraft(
    testSeries,
    allPicks,
    evalModel,
    playerRole,
  )

  console.log('  Live draft backtest:')
  console.log(`  ${liveDraftResult.all.name} (${liveDraftResult.all.picks} picks):`)
  console.log(`    Conditioned   — Top 1: ${liveDraftResult.all.conditioned.top1}%, Top 3: ${liveDraftResult.all.conditioned.top3}%, Top 5: ${liveDraftResult.all.conditioned.top5}%`)
  console.log(`    Unconditioned — Top 1: ${liveDraftResult.all.unconditioned.top1}%, Top 3: ${liveDraftResult.all.unconditioned.top3}%, Top 5: ${liveDraftResult.all.unconditioned.top5}%`)
  console.log('  By pick position:')
  for (const pos of liveDraftResult.byPickPosition) {
    console.log(`    ${pos.name} (${pos.conditioned.picks} picks):`)
    console.log(`      Conditioned   — Top 1: ${pos.conditioned.top1}%, Top 3: ${pos.conditioned.top3}%, Top 5: ${pos.conditioned.top5}%`)
    console.log(`      Unconditioned — Top 1: ${pos.unconditioned.top1}%, Top 3: ${pos.unconditioned.top3}%, Top 5: ${pos.unconditioned.top5}%`)
  }

  // Second-phase ban backtest
  console.log('\n  Second-phase ban backtest:')
  for (const [label, group] of [['all', liveDraftResult.secondPhaseBans.all], ['games 2+', liveDraftResult.secondPhaseBans.games2Plus]] as [string, typeof liveDraftResult.secondPhaseBans.all][]) {
    console.log(`  ${label} (${group.bans} bans):`)
    console.log(`    Conditioned leverage   — Top 5: ${group.leverageTop5}%, Top 8: ${group.leverageTop8}%`)
    console.log(`    Unconditioned leverage — Top 5: ${group.unconditionedTop5}%, Top 8: ${group.unconditionedTop8}%`)
  }

  // Red-first share
  if (liveDraftResult.redFirstShare.length > 0) {
    console.log('\n  Red-first games per league/year:')
    for (const r of liveDraftResult.redFirstShare) {
      console.log(`    ${r.league} ${r.year}: ${r.redFirstGames} / ${r.totalGames} = ${r.share}%`)
    }
  }

  return { leverageResult, liveDraftResult }
}
