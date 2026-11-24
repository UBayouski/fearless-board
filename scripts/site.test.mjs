import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NOTE_PROMPT_VERSION } from '../packages/shared/src/note.ts'

function writeJson(site, file, value) {
  writeFileSync(join(site, file), JSON.stringify(value))
}

function buildSite(t, { needsCleanup = false } = {}) {
  const site = mkdtempSync(join(tmpdir(), 'fearless-site-'))
  t.after(() => rmSync(site, { recursive: true, force: true }))
  mkdirSync(join(site, 'assets'))
  mkdirSync(join(site, 'data/notes'), { recursive: true })
  writeFileSync(join(site, 'index.html'), '<script src="assets/app.js"></script>')
  writeFileSync(join(site, 'assets/app.js'), 'console.log("draft")')
  writeJson(site, 'data/manifest.json', { notes: { count: 6 } })
  writeJson(site, 'data/series-index.json', [{ seriesId: '101' }, { seriesId: '202' }])
  writeJson(site, 'data/101.json', { seriesId: '101' })
  writeJson(site, 'data/202.json', { seriesId: '202' })
  const teams = { red: { headline: 'Red note' }, blue: { headline: 'Blue note' } }
  writeJson(site, 'data/notes/101.json', { promptVersion: NOTE_PROMPT_VERSION, games: { 1: teams, 2: teams } })
  writeJson(site, 'data/notes/202.json', {
    promptVersion: needsCleanup ? NOTE_PROMPT_VERSION - 1 : NOTE_PROMPT_VERSION,
    games: { 1: teams },
  })
  if (needsCleanup) {
    mkdirSync(join(site, 'data-demo'))
    writeJson(site, 'data-demo/demo.json', {})
    writeJson(site, 'data/manifest.json.before', {})
    writeJson(site, 'data/303.json', { seriesId: '303' })
  }
  return site
}

function run(script, site) {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, script), site], {
    cwd: join(import.meta.dirname, '..'), encoding: 'utf8',
  })
  assert.ifError(result.error)
  return result
}

test('clean removes unwanted files and counts the remaining team notes per game', (t) => {
  const site = buildSite(t, { needsCleanup: true })
  const result = run('clean-site.mjs', site)
  assert.equal(result.status, 0, result.stderr)
  for (const file of ['data-demo', 'data/manifest.json.before', 'data/303.json', 'data/notes/202.json']) {
    assert.ok(!existsSync(join(site, file)), `expected ${file} to be removed`)
  }
  for (const file of ['index.html', 'assets/app.js', 'data/series-index.json', 'data/101.json', 'data/202.json', 'data/notes/101.json']) {
    assert.ok(existsSync(join(site, file)), `expected ${file} to be kept`)
  }
  const manifest = JSON.parse(readFileSync(join(site, 'data/manifest.json'), 'utf8'))
  assert.equal(manifest.notes.count, 4)
})

test('check passes on the cleaned folder', (t) => {
  const site = buildSite(t, { needsCleanup: true })
  const clean = run('clean-site.mjs', site)
  assert.equal(clean.status, 0, clean.stderr)
  const check = run('check-site.mjs', site)
  assert.equal(check.status, 0, check.stderr)
  assert.match(check.stdout, /Site build checks passed/)
})

for (const [problem, file, change] of [
  ['extra CSV', 'data/extra.csv', (site, file) => writeFileSync(join(site, file), 'a,b')],
  ['environment file', '.env', (site, file) => writeFileSync(join(site, file), 'MODE=test')],
  ['missing indexed series', 'data/202.json', (site, file) => rmSync(join(site, file))],
  ['key-like text in a script', 'assets/app.js', (site, file) => writeFileSync(join(site, file), `const fake = "AIza${'x'.repeat(30)}"`)],
  ['incorrect note count', 'data/manifest.json', (site, file) => writeJson(site, file, { notes: { count: 5 } })],
]) {
  test(`check rejects ${problem} and names ${file}`, (t) => {
    const site = buildSite(t)
    change(site, file)
    const check = run('check-site.mjs', site)
    assert.equal(check.status, 1, check.stderr || check.stdout)
    assert.ok(check.stderr.includes(file), `expected ${file} in stderr:\n${check.stderr}`)
  })
}