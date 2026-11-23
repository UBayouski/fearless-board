// Remove the "data" folder from dist-demo after Vite build.
// Vite copies the entire public/ folder, which includes data-demo/.
// We need to remove any "data" folder that might have been copied.

import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const distDemo = resolve('packages/app/dist-demo')

if (!existsSync(distDemo)) {
  console.error(`Error: ${distDemo} does not exist.`)
  process.exit(1)
}

// Remove data/ folder if it exists (Vite may copy it from public/)
const dataFolder = resolve(distDemo, 'data')
if (existsSync(dataFolder)) {
  rmSync(dataFolder, { recursive: true, force: true })
  console.log('Removed dist-demo/data/')
}

console.log('Demo build cleanup complete.')
