import { ChampionIconsIcon, DarkIcon, LightIcon, NamesOnlyIcon } from './SwitchIcons'

type HeaderSwitchesProps = {
  icons: boolean
  theme: 'light' | 'dark'
  onIcons: (value: boolean) => void
  onTheme: (value: 'light' | 'dark') => void
}

export function HeaderSwitches({ icons, theme, onIcons, onTheme }: HeaderSwitchesProps) {
  return (
    <>
      <div className="seg header-switch" role="group" aria-label="Champion icons">
        <button type="button" aria-label="Champion icons" title="Champion icons" aria-pressed={icons} onClick={() => onIcons(true)}>
          <ChampionIconsIcon />
          <span className="switch-word">Icons</span>
        </button>
        <button type="button" aria-label="Names only" title="Names only" aria-pressed={!icons} onClick={() => onIcons(false)}>
          <NamesOnlyIcon />
          <span className="switch-word">Names</span>
        </button>
      </div>
      <div className="seg header-switch" role="group" aria-label="Theme">
        <button type="button" aria-label="Light theme" title="Light theme" aria-pressed={theme === 'light'} onClick={() => onTheme('light')}>
          <LightIcon />
          <span className="switch-word">Light</span>
        </button>
        <button type="button" aria-label="Dark theme" title="Dark theme" aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}>
          <DarkIcon />
          <span className="switch-word">Dark</span>
        </button>
      </div>
    </>
  )
}