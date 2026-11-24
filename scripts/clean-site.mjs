// After `vite build --mode site`: keep only what the hosted site needs.
// Vite copies all of public/, so the demo folder and any leftovers are removed here, and so are notes
// written with an older prompt (their checks were weaker; see docs/written-note.md).
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const site = resolve('packages/app/dist-site')
if (!existsSync(site)) {
  console.error(`Error: ${site} does not exist.`)
  process.exit(1)
}

const currentPrompt = Number(/NOTE_PROMPT_VERSION = (\d+)/.exec(readFileSync(resolve('packages/shared/src/note.ts'), 'utf8'))?.[1])
if (!currentPrompt) {
  console.error('Error: NOTE_PROMPT_VERSION not found in packages/shared/src/note.ts')
  process.exit(1)
}

let removed = 0
const remove = (path) => { rmSync(path, { recursive: true, force: true }); removed++ }

if (existsSync(resolve(site, 'data-demo'))) remove(resolve(site, 'data-demo'))
const data = resolve(site, 'data')
// `pnpm data` does not delete series files of earlier runs, so keep only the series in the index
const indexed = new Set(JSON.parse(readFileSync(resolve(data, 'series-index.json'), 'utf8')).map((e) => e.seriesId))
for (const f of readdirSync(data)) {
  if (!f.endsWith('.json') && f !== 'notes') remove(resolve(data, f))
  else if (/^\d+\.json$/.test(f) && !indexed.has(f.slice(0, -5))) remove(resolve(data, f))
}
const notes = resolve(data, 'notes')
let kept = 0
if (existsSync(notes)) {
  for (const f of readdirSync(notes)) {
    const note = JSON.parse(readFileSync(resolve(notes, f), 'utf8'))
    if (note.promptVersion !== currentPrompt) remove(resolve(notes, f))
    else kept++
  }
}
console.log(`Site cleanup: removed ${removed} files or folders; kept ${kept} notes (prompt version ${currentPrompt}).`)
