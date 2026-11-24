// The file name of a champion's square icon on Riot's Data Dragon, from the champion's display name.
// Data Dragon names its files after an internal key: the display name without spaces and punctuation,
// with a few exceptions. The pipeline writes the result into the manifest; the app never derives it.

/** The Data Dragon release the icon addresses are pinned to. */
export const DDRAGON_VERSION = '16.23.1'

/** Display names whose key is not simply the name with spaces and punctuation removed. */
const EXCEPTIONS: Record<string, string> = {
  "Bel'Veth": 'Belveth',
  "Cho'Gath": 'Chogath',
  "Kai'Sa": 'Kaisa',
  "Kha'Zix": 'Khazix',
  LeBlanc: 'Leblanc',
  'Nunu & Willump': 'Nunu',
  'Renata Glasc': 'Renata',
  "Vel'Koz": 'Velkoz',
  Wukong: 'MonkeyKing',
}

export function championIcon(name: string): string {
  const key = EXCEPTIONS[name] ?? name.replace(/[^A-Za-z0-9]/gu, '')
  return `${key}.png`
}
