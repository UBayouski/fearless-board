// Tests for note.ts: facts builder, prompt, and checker.

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  noteFacts, checkNote, NOTE_PROMPT, NOTE_PROMPT_VERSION,
  type NoteFacts, type WrittenNote, type NoteNames,
} from './note.ts'
import type { GamePlan, GamePlanPlayer, PoolEntry, PickLikelihood, Role } from './types.ts'
import type { SeriesOutlook, OutlookPlayer } from './outlook.ts'

// ── Helper: build a minimal GamePlan ─────────────────────────────────

function buildMinimalPlan(): { plan: GamePlan; outlook: SeriesOutlook } {
  const roleOrder: Role[] = ['top', 'jungle', 'mid', 'bot', 'support']
  const teamA = 'teamA'
  const teamB = 'teamB'

  function makePlayer(teamId: string, role: Role, name: string, priorGames: number): GamePlanPlayer {
    const credible: PoolEntry[] = [
      { championId: 'champ1', games: 10, wins: 5, lastPlayed: '2025-01-01' },
      { championId: 'champ2', games: 5, wins: 2, lastPlayed: '2025-01-05' },
    ]
    const burned: PoolEntry[] = [
      { championId: 'champ3', games: 3, wins: 1, lastPlayed: '2024-12-01' },
    ]
    const likelihoods: PickLikelihood[] = [
      { championId: 'champ1', probability: 0.3, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      { championId: 'champ2', probability: 0.2, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      { championId: 'champ4', probability: 0.15, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
    ]
    const startLikelihoods: PickLikelihood[] = [
      { championId: 'champ1', probability: 0.25, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      { championId: 'champ2', probability: 0.2, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      { championId: 'champ3', probability: 0.15, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      { championId: 'champ4', probability: 0.1, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
    ]
    return {
      playerId: `${teamId}-${role}`,
      playerName: name,
      role,
      pool: { credible, burned },
      likelihoods,
      startLikelihoods,
      priorGames,
    }
  }

  const playersA = new Map<Role, GamePlanPlayer>()
  const playersB = new Map<Role, GamePlanPlayer>()
  for (const role of roleOrder) {
    playersA.set(role, makePlayer(teamA, role, `PlayerA${role}`, 25))
    playersB.set(role, makePlayer(teamB, role, `PlayerB${role}`, 25))
  }

  const burned = new Set<string>(['champ3'])
  const burnedByGame = new Map<string, number>()
  burnedByGame.set('champ3', 1)

  const plan: GamePlan = {
    lineup: { [teamA]: [], [teamB]: [] },
    lineupChanged: new Map<string, boolean>(),
    burned,
    burnedByGame,
    availableChampions: new Set<string>(['champ1', 'champ2', 'champ4']),
    players: [[teamA, playersA], [teamB, playersB]],
    unknownRolePlayers: [],
    leverage: new Map<string, any>([
      [teamA, {
        leverage: [
          { championId: 'champ1', threatFromOpponent: 0.26, threatFromOwn: 0.19, leverage: 0.07, opponentHits: [{ playerId: 'teamB-mid', playerName: 'PlayerBmid', probability: 0.26 }], ownHits: [{ playerId: 'teamA-mid', playerName: 'PlayerAmid', probability: 0.19 }] },
          { championId: 'champ2', threatFromOpponent: 0.15, threatFromOwn: 0.10, leverage: 0.05, opponentHits: [{ playerId: 'teamB-top', playerName: 'PlayerBtop', probability: 0.15 }], ownHits: [] },
          { championId: 'champ4', threatFromOpponent: 0.12, threatFromOwn: 0.08, leverage: 0.04, opponentHits: [{ playerId: 'teamB-bot', playerName: 'PlayerBbot', probability: 0.12 }], ownHits: [] },
        ],
        denial: [
          { championId: 'champ1', ownPlayerId: 'teamA-top', ownPlayerName: 'PlayerAtop', ownProbability: 0.3, gamesPlayed: 10, threatFromOpponent: 0.26, opponentHits: [{ playerId: 'teamB-mid', playerName: 'PlayerBmid', probability: 0.26 }] },
        ],
      }],
      [teamB, { leverage: [], denial: [] }],
    ]),
    game: {
      gameId: 'game2',
      gameNumber: 2,
      patch: '14.1',
      sides: { blue: teamA, red: teamB },
      winnerTeamId: null,
      actions: [],
      picks: [],
    },
  }

  const outlookPlayersA: OutlookPlayer[] = []
  const outlookPlayersB: OutlookPlayer[] = []
  for (const role of roleOrder) {
    const gpA = playersA.get(role)!
    const gpB = playersB.get(role)!
    // champ3 is burned; its startLikelihood probability is 0.15
    const burnedShareA = 0.15
    const burnedShareB = 0.15
    outlookPlayersA.push({
      playerId: gpA.playerId,
      playerName: gpA.playerName,
      role: gpA.role,
      burnedShare: burnedShareA,
      expectedBurn: 0.1,
      limitedHistory: gpA.priorGames < 20,
    })
    outlookPlayersB.push({
      playerId: gpB.playerId,
      playerName: gpB.playerName,
      role: gpB.role,
      burnedShare: burnedShareB,
      expectedBurn: 0.1,
      limitedHistory: gpB.priorGames < 20,
    })
  }

  const outlook: SeriesOutlook = {
    teams: [
      { teamId: teamA, players: outlookPlayersA },
      { teamId: teamB, players: outlookPlayersB },
    ],
  }

  return { plan, outlook }
}

function makeNames(): NoteNames {
  return {
    champion: (id: string) => id.replace('champ', 'Champion'),
    player: (id: string) => {
      const match = id.match(/^(team[A-Z])-(\w+)/)
      if (match) return `Player${match[1].charAt(4).toUpperCase()}${match[2].charAt(0).toUpperCase()}${match[2].slice(1)}`
      return id
    },
    team: (id: string) => id === 'teamA' ? 'Team Alpha' : 'Team Beta',
  }
}

// ── Item 2: NOTE_PROMPT ──────────────────────────────────────────────

describe('NOTE_PROMPT', () => {
  it('NOTE_PROMPT_VERSION equals 2', () => {
    assert.strictEqual(NOTE_PROMPT_VERSION, 2)
  })

  it('NOTE_PROMPT contains key instructions', () => {
    assert.ok(NOTE_PROMPT.includes('Fearless Draft'))
    assert.ok(NOTE_PROMPT.includes('Their pools'))
    assert.ok(NOTE_PROMPT.includes('Our pools'))
    assert.ok(NOTE_PROMPT.includes('Bans and picks'))
    assert.ok(NOTE_PROMPT.includes('Do not use "he", "his", "she" or "her"'))
  })
})

// ── Item 1.1: noteFacts on hand-built plan ───────────────────────────

describe('noteFacts', () => {
  it('returns facts with correct structure', () => {
    const { plan, outlook } = buildMinimalPlan()
    const names = makeNames()
    const facts = noteFacts(plan, outlook, names, 'teamA', { own: 1, opponent: 0 })

    assert.strictEqual(facts.team, 'Team Alpha')
    assert.strictEqual(facts.opponent, 'Team Beta')
    assert.strictEqual(facts.game, 2)
    assert.ok(facts.score.includes('Team Alpha'))
    assert.ok(facts.championsGoneForBothTeams.includes('Champion3'))
    assert.strictEqual(facts.ownPlayers.length, 5)
    assert.strictEqual(facts.opponentPlayers.length, 5)
    assert.ok(facts.bansToConsider.length >= 1)
    assert.ok(facts.picksThatAlsoDeny.length >= 1)

    // Check player facts structure
    const topPlayer = facts.ownPlayers.find(p => p.role === 'top')
    assert.ok(topPlayer)
    assert.strictEqual(topPlayer.usualPicksAlreadyGonePct, 15)
    assert.ok(topPlayer.usualPicksAlreadyGone.includes('Champion3'))
    assert.strictEqual(topPlayer.likelyPicksNow.length, 3)
    assert.strictEqual(topPlayer.likelyPicksNow[0].champion, 'Champion1')
    assert.strictEqual(topPlayer.likelyPicksNow[0].likelihoodPct, 30)
  })

  it('includes limitedHistory for players with fewer than 20 games', () => {
    const { plan, outlook } = buildMinimalPlan()
    const names = makeNames()
    // Set one player to have fewer than 20 prior games
    const roleMap = plan.players[0][1]
    const topPlayer = roleMap.get('top')!
    topPlayer.priorGames = 5
    // Update outlook too
    const outlookTeam = outlook.teams[0]
    const outlookTop = outlookTeam.players.find(p => p.role === 'top')!
    outlookTop.limitedHistory = true

    const facts = noteFacts(plan, outlook, names, 'teamA', { own: 1, opponent: 0 })
    const topFacts = facts.ownPlayers.find(p => p.role === 'top')
    assert.ok(topFacts)
    assert.strictEqual(topFacts.limitedHistory, true)
  })

  it('filters bans to gap > 2 points', () => {
    const { plan, outlook } = buildMinimalPlan()
    const names = makeNames()
    const facts = noteFacts(plan, outlook, names, 'teamA', { own: 1, opponent: 0 })
    for (const ban of facts.bansToConsider) {
      const gap = ban.chanceOpponentPicksItPct - ban.chanceWePickItPct
      assert.ok(gap > 2, `Expected gap > 2, got ${gap} for ${ban.champion}`)
    }
  })
})

// ── Item 1.3: checkNote ──────────────────────────────────────────────

function makeTestFacts(): NoteFacts {
  return {
    team: 'Team Alpha',
    opponent: 'Team Beta',
    game: 3,
    score: 'Team Alpha 1 - 1 Team Beta',
    championsGoneForBothTeams: ['Champion1', 'Champion2'],
    ownPlayers: [
      { player: 'Alice', role: 'top', usualPicksAlreadyGonePct: 51, usualPicksAlreadyGone: ['Champion1'], likelyPicksNow: [{ champion: 'Champion3', likelihoodPct: 25, gamesPlayed: 10 }] },
    ],
    opponentPlayers: [
      { player: 'Bob', role: 'mid', usualPicksAlreadyGonePct: 30, usualPicksAlreadyGone: ['Champion2'], likelyPicksNow: [{ champion: 'Champion4', likelihoodPct: 20, gamesPlayed: 8 }] },
    ],
    bansToConsider: [
      { champion: 'Champion3', chanceOpponentPicksItPct: 35, chanceWePickItPct: 10, gapPoints: 25, opponentPlayer: 'Bob' },
    ],
    picksThatAlsoDeny: [
      { champion: 'Champion5', ownPlayer: 'Alice', ownLikelihoodPct: 15, chanceOpponentPicksItPct: 25 },
    ],
  }
}

function makePassingNote(): WrittenNote {
  return {
    headline: 'Alice has lost 51% of usual picks before game 3',
    points: [
      { title: 'Their pools', text: 'Bob has lost 30% of usual picks including Champion2. They are likely to pick Champion4.' },
      { title: 'Our pools', text: 'Alice has lost 51% of usual picks including Champion1. They are likely to pick Champion3.' },
      { title: 'Bans and picks', text: 'Banning Champion3 prevents a 35% opponent pick at a 10% cost. Picking Champion5 takes a pick from Bob.' },
    ],
  }
}

const allChampionNames = ['Champion1', 'Champion2', 'Champion3', 'Champion4', 'Champion5', 'Champion6', 'Champion7']

describe('checkNote: passing note', () => {
  it('returns no problems for a valid note', () => {
    const facts = makeTestFacts()
    const note = makePassingNote()
    const problems = checkNote(facts, note, allChampionNames)
    assert.strictEqual(problems.length, 0, `Expected no problems, got: ${problems.map(p => p.detail).join('; ')}`)
  })
})

describe('checkNote: unknown champion', () => {
  it('detects a champion not in the facts', () => {
    const facts = makeTestFacts()
    const note: WrittenNote = {
      headline: 'Champion6 is a great pick',
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Bans and picks', text: 'Banning Champion3 is recommended.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const champProblem = problems.find(p => p.rule === 'unknown_champion')
    assert.ok(champProblem, 'Expected unknown_champion problem')
    assert.ok(champProblem.detail.includes('Champion6'))
  })
})

describe('checkNote: unknown percentage', () => {
  it('detects a percentage not in the facts', () => {
    const facts = makeTestFacts()
    const note: WrittenNote = {
      headline: 'Alice has lost 99% of usual picks',
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Bans and picks', text: 'Banning Champion3 is recommended.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const pctProblem = problems.find(p => p.rule === 'unknown_percentage')
    assert.ok(pctProblem, 'Expected unknown_percentage problem')
    assert.ok(pctProblem.detail.includes('99%'))
  })
})

describe('checkNote: field name', () => {
  it('detects a field name from the facts', () => {
    const facts = makeTestFacts()
    const note: WrittenNote = {
      headline: 'Alice usualPicksAlreadyGonePct is high',
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Bans and picks', text: 'Banning Champion3 is recommended.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const fieldProblem = problems.find(p => p.rule === 'field_name')
    assert.ok(fieldProblem, 'Expected field_name problem')
  })
})

describe('checkNote: pronoun', () => {
  it('detects pronoun "his" as a whole word', () => {
    const facts = makeTestFacts()
    const note: WrittenNote = {
      headline: 'Alice has lost 51% of his usual picks',
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Bans and picks', text: 'Banning Champion3 is recommended.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const pronounProblem = problems.find(p => p.rule === 'pronoun')
    assert.ok(pronounProblem, 'Expected pronoun problem')
    assert.ok(pronounProblem.detail.includes('his'))
  })
})

describe('checkNote: four points', () => {
  it('detects more than three points', () => {
    const facts = makeTestFacts()
    const note: WrittenNote = {
      headline: 'Alice has lost 51% of usual picks',
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Bans and picks', text: 'Banning Champion3 is recommended.' },
        { title: 'Extra point', text: 'This should not be here.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const pointsProblem = problems.find(p => p.rule === 'wrong_number_of_points')
    assert.ok(pointsProblem, 'Expected wrong_number_of_points problem')
  })
})

describe('checkNote: too many percentages', () => {
  it('detects more than six percentages', () => {
    const facts = makeTestFacts()
    const note: WrittenNote = {
      headline: '51% 30% 25% 20% 35% 10% 15%',
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Bans and picks', text: 'Banning Champion3 is recommended.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const pctProblem = problems.find(p => p.rule === 'too_many_percentages')
    assert.ok(pctProblem, 'Expected too_many_percentages problem')
  })
})

describe('checkNote: forbidden words', () => {
  it('detects "will win"', () => {
    const facts = makeTestFacts()
    const note: WrittenNote = {
      headline: 'Team Alpha will win game 3',
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Bans and picks', text: 'Banning Champion3 is recommended.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const forbidden = problems.find(p => p.rule === 'forbidden_word')
    assert.ok(forbidden, 'Expected forbidden_word problem')
    assert.ok(forbidden.detail.includes('will win'))
  })

  it('detects "advantage"', () => {
    const facts = makeTestFacts()
    const note: WrittenNote = {
      headline: 'Team Alpha has the advantage',
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Bans and picks', text: 'Banning Champion3 is recommended.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const forbidden = problems.find(p => p.rule === 'forbidden_word')
    assert.ok(forbidden, 'Expected forbidden_word problem')
    assert.ok(forbidden.detail.includes('advantage'))
  })
})

describe('checkNote: too many words', () => {
  it('detects more than 150 words', () => {
    const facts = makeTestFacts()
    const longText = Array(160).fill('word').join(' ')
    const note: WrittenNote = {
      headline: longText,
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Bans and picks', text: 'Banning Champion3 is recommended.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const wordsProblem = problems.find(p => p.rule === 'too_many_words')
    assert.ok(wordsProblem, 'Expected too_many_words problem')
  })
})

describe('checkNote: missing title', () => {
  it('detects missing required title', () => {
    const facts = makeTestFacts()
    const note: WrittenNote = {
      headline: 'Alice has lost 51% of usual picks',
      points: [
        { title: 'Their pools', text: 'Bob has lost 30% of usual picks.' },
        { title: 'Our pools', text: 'Alice has lost 51% of usual picks.' },
        { title: 'Wrong title', text: 'Banning Champion3 is recommended.' },
      ],
    }
    const problems = checkNote(facts, note, allChampionNames)
    const titleProblem = problems.find(p => p.rule === 'missing_title')
    assert.ok(titleProblem, 'Expected missing_title problem')
    assert.ok(titleProblem.detail.includes('Bans and picks'))
  })
})

describe('checkNote: whole champion names', () => {
  it('does not take "Vi" from inside "Viktor"', () => {
    const facts = noteFactsFixtureWith('Viktor')
    const note = { headline: 'Viktor is the likely pick.', points: [
      { title: 'Their pools', text: 'Bob is most likely to pick Viktor.' },
      { title: 'Our pools', text: 'Nothing stands out.' },
      { title: 'Bans and picks', text: 'No ban stands out.' },
    ] }
    assert.deepEqual(checkNote(facts, note, ['Vi', 'Viktor']), [])
  })
})

function noteFactsFixtureWith(champion: string) {
  return {
    team: 'A', opponent: 'B', game: 2, score: 'A 1 - 0 B', championsGoneForBothTeams: [],
    ownPlayers: [], bansToConsider: [], picksThatAlsoDeny: [],
    opponentPlayers: [{ player: 'Bob', role: 'mid' as const, usualPicksAlreadyGonePct: 0, usualPicksAlreadyGone: [], likelyPicksNow: [{ champion, likelihoodPct: 20, gamesPlayed: 3 }] }],
  }
}
