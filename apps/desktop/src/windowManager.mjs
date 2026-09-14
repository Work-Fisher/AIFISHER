import { APP_HOST, APP_ORIGIN, APP_SCHEME } from './appProtocol.mjs';

export const CANVAS_URL = `${APP_ORIGIN}/`;
export const LAUNCHER_URL = `${APP_ORIGIN}/launcher/`;
// The title strip follows the page: launcher stays dark, canvas uses its account theme.
export const LAUNCHER_SURFACE = '#050505';
export const CANVAS_SURFACE = '#111111';
export const LIGHT_CANVAS_SURFACE = '#f6f7f9';
export const TITLE_BAR_HEIGHT = 32;
export const CANVAS_TITLE_BAR_HEIGHT = 36;
const WINDOW_SYMBOL_COLOR = '#d4d4d4';
const LIGHT_WINDOW_SYMBOL_COLOR = '#182230';
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
// The host fills the whole window behind the WebContentsView. A drag region on
// html/body intercepts native mouse input even over that child view on Windows.
const TITLE_STRIP_URL = `data:text/html;charset=utf-8,${encodeURIComponent(
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:${LAUNCHER_SURFACE};user-select:none}.title-strip{height:${TITLE_BAR_HEIGHT}px;-webkit-app-region:drag}</style></head><body><div class="title-strip"></div></body></html>`,
)}`;

export function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST;
  } catch {
    return false;
  }
}

export function isExternalUrl(value) {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function surfaceColorFor(url, theme = 'dark') {
  if (String(url || '').startsWith(LAUNCHER_URL)) return LAUNCHER_SURFACE;
  return theme === 'light' ? LIGHT_CANVAS_SURFACE : CANVAS_SURFACE;
}

const isCanvasUrl = (url) => isAppUrl(url) && new URL(url).pathname === '/';

function webPreferences(preload) {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    spellcheck: false,
  };
}

// One window for launcher and canvas. The launcher keeps a separate native strip; the canvas
// fills the window and reserves the right of its draggable header for native window controls.
// Navigation never leaves aifisher://app;
// external links open in the system browser, and app pages such as /diagnostics open in an app
// window.
export function createMainWindow({
  BrowserWindow,
  WebContentsView,
  shell,
  preload,
  icon,
  ipcMain,
  nativeTheme,
}) {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    center: true,
    show: false,
    title: 'AIFISHER',
    icon,
    backgroundColor: LAUNCHER_SURFACE,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: LAUNCHER_SURFACE,
      symbolColor: WINDOW_SYMBOL_COLOR,
      height: TITLE_BAR_HEIGHT,
    },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  window.removeMenu();
  const view = new WebContentsView({ webPreferences: webPreferences(preload) });
  view.setBackgroundColor(LAUNCHER_SURFACE);
  window.contentView.addChildView(view);
  let canvasChrome = false;
  const applyTitleStrip = () => {
    void window.webContents.executeJavaScript(`document.querySelector('.title-strip')?.style.setProperty('display', '${canvasChrome ? 'none' : 'block'}')`).catch(() => {});
  };
  window.webContents.on('dom-ready', applyTitleStrip);
  const layout = () => {
    const { width, height } = window.getContentBounds();
    view.setBounds({
      x: 0,
      y: canvasChrome ? 0 : TITLE_BAR_HEIGHT,
      width,
      height: Math.max(0, height - (canvasChrome ? 0 : TITLE_BAR_HEIGHT)),
    });
  };
  layout();
  window.on('resize', layout);

  let surface = LAUNCHER_SURFACE;
  let currentTheme = 'dark';
  let navigating = false;
  const updateChrome = (url) => {
    const changed = canvasChrome !== isCanvasUrl(url);
    canvasChrome = isCanvasUrl(url);
    if (changed) applyTitleStrip();
    layout();
    window.setTitleBarOverlay({ color: surface, symbolColor: currentTheme === 'light' ? LIGHT_WINDOW_SYMBOL_COLOR : WINDOW_SYMBOL_COLOR, height: canvasChrome ? CANVAS_TITLE_BAR_HEIGHT : TITLE_BAR_HEIGHT });
  };
  if (nativeTheme) nativeTheme.themeSource = 'dark';
  const paint = (color, theme = 'dark') => {
    if (nativeTheme) nativeTheme.themeSource = theme;
    if (color === surface && theme === currentTheme) return;
    surface = color;
    currentTheme = theme;
    window.setBackgroundColor(color);
    window.setTitleBarOverlay({
      color,
      symbolColor: theme === 'light' ? LIGHT_WINDOW_SYMBOL_COLOR : WINDOW_SYMBOL_COLOR,
      height: canvasChrome ? CANVAS_TITLE_BAR_HEIGHT : TITLE_BAR_HEIGHT,
    });
    view.setBackgroundColor(color);
    const script = `document.documentElement.style.background = document.body.style.background = ${JSON.stringify(color)}; document.documentElement.style.colorScheme = ${JSON.stringify(theme)}`;
    void window.webContents.executeJavaScript(script).catch(() => {});
  };
  view.webContents.on('did-start-navigation', ({ url, isSameDocument, isMainFrame }) => {
    if (!isMainFrame || isSameDocument || !isAppUrl(url)) return;
    // Never carry the previous account's appearance through a full page navigation. The new
    // canvas applies its own account preference after hydration; login remains dark.
    navigating = true;
    updateChrome(url);
    paint(surfaceColorFor(url));
  });
  view.webContents.on('did-navigate', (_event, url) => {
    navigating = false;
    updateChrome(url);
    paint(surfaceColorFor(url));
  });
  if (ipcMain) {
    ipcMain.handle('desktop:set-theme', (event, theme) => {
      if (
        event.sender !== view.webContents ||
        event.senderFrame !== view.webContents.mainFrame ||
        navigating ||
        !isCanvasUrl(event.senderFrame?.url) ||
        !isCanvasUrl(view.webContents.getURL())
      ) {
        throw new Error('UNTRUSTED_SENDER');
      }
      if (theme !== 'dark' && theme !== 'light') throw new Error('INVALID_THEME');
      paint(surfaceColorFor(CANVAS_URL, theme), theme);
    });
    window.once('closed', () => ipcMain.removeHandler('desktop:set-theme'));
  }

  // Clicking the strip focuses the window; typing still belongs to the page.
  window.on('focus', () => view.webContents.focus());
  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
  });
  // The strip never navigates: a file dropped on it would otherwise replace it with file://.
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void window.loadURL(TITLE_STRIP_URL);
  guardNavigation(view.webContents, { shell, preload, icon });
  return { window, contents: view.webContents };
}

function guardNavigation(contents, { shell, preload, icon }) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          icon,
          backgroundColor: CANVAS_SURFACE,
          autoHideMenuBar: true,
          webPreferences: webPreferences(preload),
        },
      };
    }
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    // A file dropped outside the canvas drop zones would otherwise replace the page with file://.
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });
  contents.on('did-create-window', (child) =>
    guardNavigation(child.webContents, { shell, preload, icon }),
  );
}
