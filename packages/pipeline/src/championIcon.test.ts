import { test } from 'node:test'
import assert from 'node:assert/strict'
import { championIcon } from './championIcon.ts'

test('championIcon: plain names lose spaces and punctuation', () => {
  assert.equal(championIcon('Ahri'), 'Ahri.png')
  assert.equal(championIcon('Lee Sin'), 'LeeSin.png')
  assert.equal(championIcon('Dr. Mundo'), 'DrMundo.png')
  assert.equal(championIcon('Jarvan IV'), 'JarvanIV.png')
  assert.equal(championIcon("K'Sante"), 'KSante.png')
  assert.equal(championIcon("Kog'Maw"), 'KogMaw.png')
  assert.equal(championIcon("Rek'Sai"), 'RekSai.png')
})

test('championIcon: the exceptions', () => {
  assert.equal(championIcon('Wukong'), 'MonkeyKing.png')
  assert.equal(championIcon('Renata Glasc'), 'Renata.png')
  assert.equal(championIcon('Nunu & Willump'), 'Nunu.png')
  assert.equal(championIcon('LeBlanc'), 'Leblanc.png')
  assert.equal(championIcon("Kai'Sa"), 'Kaisa.png')
  assert.equal(championIcon("Cho'Gath"), 'Chogath.png')
  assert.equal(championIcon("Kha'Zix"), 'Khazix.png')
  assert.equal(championIcon("Vel'Koz"), 'Velkoz.png')
  assert.equal(championIcon("Bel'Veth"), 'Belveth.png')
})
