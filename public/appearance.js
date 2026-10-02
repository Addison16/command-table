// Runs before the app/styles load. Keep this external for the site's CSP.
(() => {
  let preference;
  let style;
  try {
    preference = localStorage.getItem('command-table-appearance');
    const cached = localStorage.getItem('command-table-style');
    if (cached) style = JSON.parse(cached);
  } catch {
    // A denied preference cache falls back to the device setting.
  }
  const theme =
    preference === 'light' || preference === 'dark'
      ? preference
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  // Validate the optional cache before using it as a selector. IndexedDB is
  // authoritative once the app loads, including when this cache is unreadable.
  const colorTheme = ['classic', 'arcane', 'forest', 'ocean', 'ember', 'monochrome'].includes(
    style?.colorTheme,
  )
    ? style.colorTheme
    : 'classic';
  document.documentElement.dataset.colorTheme = colorTheme;
  document.documentElement.dataset.accentColor = [
    'theme',
    'gold',
    'violet',
    'green',
    'blue',
    'rose',
    'teal',
    'copper',
  ].includes(style?.accentColor)
    ? style.accentColor
    : 'theme';
  document.documentElement.dataset.tableFinish = [
    'glow',
    'tabletop',
    'celestial',
    'verdant',
    'obsidian',
    'aurora',
    'gilded',
    'plain',
  ].includes(style?.tableFinish)
    ? style.tableFinish
    : 'glow';
  // These page colors match appearance.css and theme.css before CSS is ready.
  const pageColors = {
    classic: ['#f5f1e8', '#090d14'],
    arcane: ['#f4f0fa', '#100d1b'],
    forest: ['#eff4e9', '#091411'],
    ocean: ['#edf5f8', '#07131c'],
    ember: ['#fbf1e9', '#1b1010'],
    monochrome: ['#f2f3f5', '#101214'],
  };
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', pageColors[colorTheme][theme === 'dark' ? 1 : 0]);
})();
