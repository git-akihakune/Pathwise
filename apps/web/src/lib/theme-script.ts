// Static, application-owned code only. Runs before paint, independently of React hydration.
export const THEME_SCRIPT = `(() => {
  let theme = 'system';
  try {
    const saved = localStorage.getItem('pathwise-theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  document.documentElement.classList.toggle('dark', theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
})();`;
