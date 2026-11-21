/* ── URL hash helpers ─────────────────────────────────────────── */

export function parseHash(): { seriesId: string | null; gameNumber: number | null } {
  const hash = window.location.hash.slice(1) // strip '#'
  const params = new URLSearchParams(hash)
  return {
    seriesId: params.get('s') ?? null,
    gameNumber: params.has('g') ? Number(params.get('g')) : null,
  }
}

export function setHash(seriesId: string, gameNumber: number) {
  window.location.hash = `s=${seriesId}&g=${gameNumber}`
}

export function clearHash() {
  window.location.hash = ''
}
