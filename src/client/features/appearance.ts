import { useLayoutEffect } from 'react';
import type { Profile } from '../storage/repository.js';

// IndexedDB remains authoritative. This tiny mirror is used only by the
// blocking bootstrap to avoid a wrong-theme flash while preferences load.
export function cacheAppearance(theme: Profile['theme']) {
  try {
    localStorage.setItem('command-table-appearance', theme);
  } catch {
    // Storage denial must not prevent changing this session's appearance.
  }
}

export function useAppearance(preference: Profile['theme']) {
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
      const root = document.documentElement;
      root.dataset.theme = theme;
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
  }, [preference]);
}
