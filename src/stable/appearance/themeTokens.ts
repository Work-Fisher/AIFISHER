import { desktopBridge } from '../desktop/desktopBridge';

/** Paired semantic colors. Media pixels and media chrome are deliberately theme-independent. */
export const CANVAS_THEMES = {
  dark: {
    canvas: '#050505',
    surface: '#111111',
    'surface-raised': '#1a1a1a',
    input: '#0b0b0b',
    text: '#f2f2f2',
    'text-secondary': '#c2c2c2',
    'text-muted': '#a3a3a3',
    border: '#343434',
    'border-control': '#777777',
    hover: '#292929',
    selected: '#353535',
    'on-selected': '#ffffff',
    primary: '#f2f2f2',
    'on-primary': '#111111',
    focus: '#60a5fa',
    success: '#6ee7b7',
    'success-bg': '#10291f',
    warning: '#fcd34d',
    'warning-bg': '#30250c',
    danger: '#fda4af',
    'danger-bg': '#32161d',
    info: '#93c5fd',
    'info-bg': '#102338',
    'media-bg': '#080808',
    'media-text': '#ffffff',
    shadow: '0 20px 60px #00000070',
    overlay: '#000000b8',
    scrollbar: '#818181',
    'edge-halo': '#050505',
    edge: '#9da9b8',
    'recommendation-surface': '#171717',
  },
  light: {
    canvas: '#ffffff',
    surface: '#f6f7f9',
    'surface-raised': '#ffffff',
    input: '#ffffff',
    text: '#182230',
    'text-secondary': '#475467',
    'text-muted': '#5b6678',
    border: '#cbd1da',
    'border-control': '#7b8796',
    hover: '#e8ecf1',
    selected: '#dde4ed',
    'on-selected': '#182230',
    primary: '#182230',
    'on-primary': '#ffffff',
    focus: '#175cd3',
    success: '#067647',
    'success-bg': '#ecfdf3',
    warning: '#854a0e',
    'warning-bg': '#fffaeb',
    danger: '#b42318',
    'danger-bg': '#fef3f2',
    info: '#175cd3',
    'info-bg': '#eff6ff',
    'media-bg': '#080808',
    'media-text': '#ffffff',
    shadow: '0 16px 48px #18223026',
    overlay: '#18223066',
    scrollbar: '#7b8796',
    'edge-halo': '#ffffff',
    edge: '#475467',
    'recommendation-surface': '#f6f7f9',
  },
} as const;

export type CanvasTheme = keyof typeof CANVAS_THEMES;

export function themeTokenCss() {
  return Object.entries(CANVAS_THEMES)
    .map(
      ([theme, tokens]) =>
        `${theme === 'dark' ? ':root, ' : ''}html[data-af-theme="${theme}"] { color-scheme: ${theme}; ${Object.entries(
          tokens,
        )
          .map(([key, value]) => `--af-${key}: ${value};`)
          .join(' ')} }`,
    )
    .join('\n');
}

export function applyCanvasTheme(
  theme: CanvasTheme,
  target: HTMLElement = document.documentElement,
) {
  target.dataset.afTheme = theme;
  target.style.colorScheme = theme;
  if (target === document.documentElement)
    void desktopBridge()
      ?.setTheme?.(theme)
      .catch(() => {});
}
