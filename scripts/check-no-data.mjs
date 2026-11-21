// Fails if any licensed hackathon data (or an extract of it) is tracked or staged in git.
// Run before every commit and push: `pnpm check:data`.
import { execFileSync } from 'node:child_process'

const forbidden = /\.(zst|jsonl|parquet|sqlite|duckdb)$|stl-hackathon-2026-grid-starter|^packages\/app\/public\/data\//i

const list = (args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean)

const files = new Set([...list(['ls-files']), ...list(['diff', '--cached', '--name-only'])])
const hits = [...files].filter((f) => forbidden.test(f))

if (hits.length > 0) {
  console.error('Licensed data files are tracked or staged. Remove them before committing:')
  for (const f of hits) console.error('  ' + f)
  process.exit(1)
}
console.log(`OK: ${files.size} tracked or staged files, no hackathon data among them.`)
