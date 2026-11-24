// Fails unless dist-site holds only the app and the draft data the organisers allowed to show:
// the app files, manifest, series index, one file per series, compact picks, model weights, backtest
// summary, and notes. No match files, no extracts, no env files, no demo folder.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const site = resolve('packages/app/dist-site')
if (!existsSync(site)) {
  console.error(`Error: ${site} does not exist. Run pnpm build:site first.`)
  process.exit(1)
}

const allowed = [
  /^index\.html$/,
  /^favicon\.svg$/,
  /^assets\/[\w.-]+\.(js|css|woff2?)$/,
  /^data\/(manifest|series-index|picks|model|backtest)\.json$/,
  /^data\/\d+\.json$/,
  /^data\/notes\/\d+\.json$/,
]
let errors = 0
const fail = (message) => { console.error(`FAIL: ${message}`); errors++ }

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else files.push(relative(site, path).split(sep).join('/'))
  }
}
walk(site)
for (const f of files) if (!allowed.some((re) => re.test(f))) fail(`unexpected file ${f}`)

const index = JSON.parse(readFileSync(resolve(site, 'data/series-index.json'), 'utf8'))
const seriesFiles = files.filter((f) => /^data\/\d+\.json$/.test(f))
if (seriesFiles.length !== index.length) fail(`${seriesFiles.length} series files but ${index.length} entries in the index`)

// No secret may end up in the bundle
for (const f of files.filter((name) => name.endsWith('.js'))) {
  const text = readFileSync(resolve(site, f), 'utf8')
  if (/AIza[0-9A-Za-z_-]{20,}|RGAPI-|GEMINI_API_KEY/.test(text)) fail(`${f} contains something that looks like an API key`)
}

const size = files.reduce((sum, f) => sum + statSync(resolve(site, f)).size, 0)
if (errors > 0) {
  console.error(`\n${errors} check(s) failed. The site build is not safe to deploy.`)
  process.exit(1)
}
console.log(`Site build checks passed: ${files.length} files, ${(size / 1024 / 1024).toFixed(1)} MB, ${index.length} series.`)
