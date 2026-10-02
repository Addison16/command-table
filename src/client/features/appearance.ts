import { useLayoutEffect } from 'react';
import type { Profile } from '../storage/repository.js';

// IndexedDB remains authoritative. This tiny mirror is used only by the
// blocking bootstrap to avoid a wrong-theme flash while preferences load.
type Appearance = Pick<Profile, 'theme' | 'colorTheme' | 'accentColor' | 'tableFinish'>;

export function cacheAppearance({ theme, colorTheme, accentColor, tableFinish }: Appearance) {
  try {
    localStorage.setItem('command-table-appearance', theme);
    localStorage.setItem('command-table-style', JSON.stringify({ colorTheme, accentColor, tableFinish }));
  } catch {
    // Storage denial must not prevent changing this session's appearance.
  }
}

export function useAppearance({ theme: preference, colorTheme, accentColor, tableFinish }: Appearance) {
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
      const root = document.documentElement;
      root.dataset.theme = theme;
      root.dataset.colorTheme = colorTheme;
      root.dataset.accentColor = accentColor;
      root.dataset.tableFinish = tableFinish;
      root.style.colorScheme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--page-color').trim());
    };
    apply();
    media.addEventListener('change', apply);
    window.addEventListener('pageshow', apply);
    document.addEventListener('visibilitychange', apply);
    return () => {
      media.removeEventListener('change', apply);
      window.removeEventListener('pageshow', apply);
      document.removeEventListener('visibilitychange', apply);
    };
  }, [preference, colorTheme, accentColor, tableFinish]);
}
