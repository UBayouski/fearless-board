// Data shapes shared by the pipeline and the app.

export type Side = 'blue' | 'red'

export interface TeamRef {
  id: string
  name: string
}

export interface ChampionRef {
  id: string
  name: string
  /** File name of the champion's square icon on Riot's Data Dragon, written by the pipeline. */
  icon?: string
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
  /** Optional: notes model and number of notes (one per team and game), set by pnpm data and the site and demo builds. */
  notes?: { model: string; count: number }
  /** "demo" for the demo build; absent for the full build. */
  mode?: 'demo'
  /** Data Dragon release the champion icons are loaded from. */
  ddragon?: string
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

/** A champion entry in a player's pool. */
export interface PoolEntry {
  championId: string
  games: number
  wins: number
  lastPlayed: string
}

// ── Model types ──────────────────────────────────────────────────────

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
  /** Plain share of picks in this role: recent (45-day) and all-time. Present when built via buildPickLikelihoods. */
  roleShare?: { recent: number | null; allTime: number }
}

// ── Backtest types ───────────────────────────────────────────────────

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

// ── Calibration types ────────────────────────────────────────────────

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

// ── Ban leverage types ───────────────────────────────────────────────

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

// ── Live draft types ─────────────────────────────────────────────────

/**
 * One slot in the draft turn order. "1" = first team, "2" = second team.
 * "b" = ban, "p" = pick.
 * The first team is determined from the actual draft data; it is not always the blue side.
 */
export type DraftSlot = '1-b' | '2-b' | '1-p' | '2-p'

/** One action entered during live draft. */
export interface DraftActionInput {
  type: 'ban' | 'pick'
  teamId: string
  championId: string
  playerId?: string // required for picks
}

/** One row of the live draft backtest result. */
export interface LiveDraftRow {
  /** Rank of the actual pick in the conditioned list (1-based), or 0 if not found. */
  conditionedRank: number
  /** Rank of the actual pick in the unconditioned list (1-based), or 0 if not found. */
  unconditionedRank: number
  /** The pick's position within the team (1 = first pick, 2 = second, etc.). */
  pickPosition: number
}

/** One group of live draft backtest results. */
export interface LiveDraftGroup {
  name: string
  picks: number
  /** Model hit rates on the conditioned list. */
  conditioned: { top1: number; top3: number; top5: number }
  /** Model hit rates on the unconditioned list. */
  unconditioned: { top1: number; top3: number; top5: number }
}

// ── Lineup types ─────────────────────────────────────────────────────

/** One team's lineup: five players with their roles. */
export interface LineupPlayer {
  playerId: string
  playerName: string
  role: Role | null
}

/** The lineup for one game, keyed by team ID. */
export interface Lineup {
  [teamId: string]: LineupPlayer[]
}

/** Result of lineupBefore: lineup for each team plus whether lineup changed per team. */
export interface LineupResult {
  lineup: Lineup
  /** True if a team's lineup differed between any two earlier games. Keyed by team ID. */
  lineupChanged: Map<string, boolean>
}

// ── Game plan types ──────────────────────────────────────────────────

/** One player's data for the game plan. */
export interface GamePlanPlayer {
  playerId: string
  playerName: string
  role: Role | null
  pool: { credible: PoolEntry[]; burned: PoolEntry[] }
  likelihoods: PickLikelihood[]
  /** Model list computed with nothing burned (all champions seen so far). Used for series outlook. */
  startLikelihoods: PickLikelihood[]
  /** Sum of `games` over the pool: total number of earlier games for this player. */
  priorGames: number
  /** True if this player is a substitute (not in the lineup shown before reveal). */
  substitute?: boolean
}

/** Ban leverage and denial picks for one team in the game plan. */
export interface GamePlanTeamLeverage {
  leverage: BanLeverageEntry[]
  denial: DenialPickEntry[]
}

/** Complete game plan for one series and game number. */
export interface GamePlan {
  lineup: Lineup
  /** Whether each team's lineup changed during earlier games. */
  lineupChanged: Map<string, boolean>
  burned: Set<string>
  burnedByGame: Map<string, number>
  availableChampions: Set<string>
  /** Players keyed by team ID, then by role. */
  players: [string, Map<Role, GamePlanPlayer>][]
  /** Players without a known role, keyed by team ID. */
  unknownRolePlayers: [string, GamePlanPlayer[]][]
  /** Leverage data keyed by team ID. */
  leverage: Map<string, GamePlanTeamLeverage>
  game: GameDraft
}
