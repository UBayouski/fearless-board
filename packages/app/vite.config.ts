import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `vite build --mode demo` builds the hosted demo: it reads `data-demo` and writes `dist-demo`.
// Every other mode is the full build. The folder follows from the mode, so no env file is needed.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_DATA_DIR': JSON.stringify(mode === 'demo' ? 'data-demo' : 'data'),
  },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
  },
}))
