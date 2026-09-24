// Runs before the app/styles load. Keep this external for the site's CSP.
(() => {
  let preference;
  try {
    preference = localStorage.getItem('command-table-appearance');
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
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#090d14' : '#f5f1e8');
})();
