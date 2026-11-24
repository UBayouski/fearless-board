import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from './renderHtml'
import { ChampIcon } from './ChampIcon'
import { UiContext } from '../ui'
import type { ChampionRef, TeamRef } from '@fearless-board/shared'

// ── Helpers ──────────────────────────────────────────────────────────


const championMap = new Map<string, ChampionRef>([
  ['c1', { id: 'c1', name: 'Aatrox', icon: 'Aatrox.png' }],
  ['c2', { id: 'c2', name: 'Braum' }], // no icon
])
const teamMap = new Map<string, TeamRef>()

function icon(props: { id: string; named?: boolean }, ui: { icons?: boolean; ddragon?: string } = {}) {
  return React.createElement(
    UiContext.Provider,
    { value: { championMap, teamMap, icons: ui.icons ?? false, ddragon: ui.ddragon } },
    React.createElement(ChampIcon, { id: props.id, named: props.named ?? false }),
  )
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ChampIcon', () => {
  it('icons on, version set, champion with an icon: renders an image with the Data Dragon address and alt when named', async () => {
    const html = await renderToString(icon({ id: 'c1', named: true }, { icons: true, ddragon: '14.1.1' }))

    expect(html).toContain('https://ddragon.leagueoflegends.com/cdn/14.1.1/img/champion/Aatrox.png')
    expect(html).toContain('alt="Aatrox"')
    expect(html).toContain('<img')
  })

  it('icons on, champion without an icon, named: renders the name in the fallback span, no image', async () => {
    const html = await renderToString(icon({ id: 'c2', named: true }, { icons: true, ddragon: '14.1.1' }))

    expect(html).toContain('class="icon-fallback"')
    expect(html).toContain('Braum')
    expect(html).not.toContain('<img')
  })

  it('icons on, no Data Dragon version, named: renders name in fallback span', async () => {
    const html = await renderToString(icon({ id: 'c1', named: true }, { icons: true }))

    expect(html).toContain('class="icon-fallback"')
    expect(html).toContain('Aatrox')
    expect(html).not.toContain('<img')
  })

  it('icons on, champion without icon, not named: renders nothing', async () => {
    const html = await renderToString(icon({ id: 'c2', named: false }, { icons: true, ddragon: '14.1.1' }))

    expect(html).not.toContain('<img')
    expect(html).not.toContain('icon-fallback')
    expect(html).not.toContain('Braum')
  })

  it('icons on, no Data Dragon version, not named: renders nothing', async () => {
    const html = await renderToString(icon({ id: 'c1', named: false }, { icons: true }))

    expect(html).toBe('')
  })

  it('icons off: renders nothing in every case', async () => {
    const withIcon = await renderToString(icon({ id: 'c1', named: true }, { icons: false }))
    expect(withIcon).not.toContain('<img')
    expect(withIcon).not.toContain('icon-fallback')
    expect(withIcon).not.toContain('Aatrox')

    const withoutIcon = await renderToString(icon({ id: 'c2', named: true }, { icons: false }))
    expect(withoutIcon).not.toContain('<img')
    expect(withoutIcon).not.toContain('icon-fallback')
    expect(withoutIcon).not.toContain('Braum')
  })
})
