/* GENERATED from llm-editor src/editor/theme.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
const THEME_KEY = 'llm-editor:theme';
const THEMES = new Set(['system', 'light', 'dark']);

function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEMES.has(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Set the editor colour mode without coupling it to any host. */
export function setTheme(value) {
  const theme = THEMES.has(value) ? value : 'system';
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
  root.style.colorScheme = theme === 'system' ? 'light dark' : theme;

  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
  });
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage is optional */ }
  return theme;
}

document.querySelectorAll('[data-theme-choice]').forEach(button => {
  button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
});
setTheme(storedTheme());
