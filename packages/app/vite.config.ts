import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Three builds, chosen by the mode, so no env file is needed:
// - `--mode demo`: reads `data-demo` (20 featured series, plans precomputed) and writes `dist-demo`.
// - `--mode site`: the hosted site. The full data (all series, drafts only), written to `dist-site`
//   and cleaned and checked by `scripts/clean-site.mjs` and `scripts/check-site.mjs`.
// - any other mode: the full local build in `dist`.
const OUT_DIR: Record<string, string> = { demo: 'dist-demo', site: 'dist-site' }
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_DATA_DIR': JSON.stringify(mode === 'demo' ? 'data-demo' : 'data'),
  },
  build: {
    outDir: OUT_DIR[mode] ?? 'dist',
  },
}))
