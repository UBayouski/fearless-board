import { readFileSync } from 'node:fs'
import Papa from 'papaparse'

export interface GameRow {
  title: string
  series_id: string
  game_id: string
  game_number: string
  map: string
  patch: string
  started_at: string
  finished: string
  winner_team_id: string
  team1_id: string
  team1_name: string
  team1_side: string
  team1_score: string
  team2_id: string
  team2_name: string
  team2_side: string
  team2_score: string
}

export interface RosterRow {
  title: string
  series_id: string
  game_id: string
  game_number: string
  team_id: string
  team_name: string
  side: string
  player_id: string
  player_name: string
  character_id: string
  character_name: string
  participation_status: string
}

export interface TeamRow {
  title: string
  team_id: string
  name: string
  other_names: string
  series_count: string
  events: string
  first_seen: string
  last_seen: string
}

export interface CharacterRow {
  title: string
  character_id: string
  name: string
  games_played: string
}

export interface SeriesRow {
  series_id: string
  event: string
  stage: string
  scheduled_start: string
  teams: string
  file: string
}

export function parseCSV<T>(file: string): T[] {
  const content = readFileSync(file, 'utf8')
  const result = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true })
  return result.data as T[]
}
