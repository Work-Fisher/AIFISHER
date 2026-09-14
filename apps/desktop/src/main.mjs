// ADR-0035: one Electron main process owns the window, the tray, identity, the backend and updates.
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  shell,
  Tray,
  utilityProcess,
  WebContentsView,
} from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_SCHEME, APP_SCHEME_PRIVILEGES, createAppProtocolHandler } from './appProtocol.mjs';
import {
  createBackendEnvironment,
  loadReleaseHelpers,
  readIdentityIssuer,
} from './backendEnvironment.mjs';
import { createBackendSupervisor } from './backendSupervisor.mjs';
import { releasePaths, resolveInstallation } from './installation.mjs';
import { createTray } from './tray.mjs';
import {
  CANVAS_URL,
  LAUNCHER_URL,
  createMainWindow,
  isAppUrl,
  isExternalUrl,
} from './windowManager.mjs';
import { createIdentityClient } from './identity/identityClient.mjs';
import { createIdentitySession } from './identity/identitySession.mjs';
import { createLauncherPreferences } from './identity/launcherPreferences.mjs';
import { createCanvasAccount } from './identity/canvasAccount.mjs';
import { chooseLocalWorkspace, createDeviceSession, createDeviceStore } from './identity/deviceSession.mjs';
import { createTokenStore, unprotectLegacyWithPowerShell } from './identity/tokenStore.mjs';
import { confirmUpdateStartup } from './updates/startupConfirmation.mjs';
import { createUpdateCoordinator } from './updates/updateCoordinator.mjs';
import { activateUpdateWindow, shouldDeferLaunch } from './updates/updateLaunchGuard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const installation = resolveInstallation({
  packaged: app.isPackaged,
  executablePath: process.execPath,
  sourceRoot: path.resolve(here, '..', '..', '..'),
});
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60_000;
const BACKEND_RETRY_DELAY_MS = 30_000;
const OPEN_FAILED = '本机服务未能启动，请重试。你的项目仍保存在本机。';

// Chromium's cache and storage stay with the rest of AIFISHER's local state instead of Roaming.
// The single-instance lock below is keyed on this folder, so it must be set first.
app.setPath('userData', path.join(installation.state, 'chromium'));
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: APP_SCHEME_PRIVILEGES }]);
// A manual launch while an update swaps files only brings the update window forward. The check runs
// before the single-instance lock so that the new version started by the update helper keeps it.
const deferredForUpdate = installation.packaged && shouldDeferLaunch({ environment: process.env });
const primaryInstance = !deferredForUpdate && app.requestSingleInstanceLock();
// Stop, upgrade and uninstall scripts start a second copy with --quit to close the running one
// gracefully; closing the window only hides it to the tray.
const quitRequested = process.argv.includes('--quit');

let helpers = null;
let mainWindow = null;
let tray = null;
let appContents = null;
let identity = null;
let account = null;
let accountRestoreStarted = false;
let backend = null;
let updates = null;
let productVersion = app.getVersion();
let quitting = false;
let canvasOpen = false;
let refreshTimer = null;
let backendRetryTimer = null;
let updateHandoff = null;
let workspaceSwitch = null;

async function selectWorkspace(forceChoice = false) {
  return chooseLocalWorkspace({
    usersDirectory: path.join(installation.data, 'users'), forceChoice,
    choose: async (ids) => {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: '选择本机工作区',
        message: '选择要使用的本机项目和 API Key。',
        detail: '工作区分别保留，不会合并或删除原数据。',
        buttons: [...ids.map((id, index) => `工作区 ${index + 1} · ${id.slice(0, 8)}`), '新建本地工作区', '取消'],
        cancelId: ids.length + 1, noLink: true,
      });
      return result.response === ids.length ? 'new' : ids[result.response];
    },
  });
}

function broadcast(channel, payload) {
  if (appContents && !appContents.isDestroyed()) appContents.send(channel, payload);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  appContents?.focus();
}

function senderPath(event) {
  const url = event.senderFrame?.url ?? '';
  if (!isAppUrl(url)) throw new Error('UNTRUSTED_SENDER');
  return new URL(url).pathname;
}

function handle(channel, work, { launcherOnly = false } = {}) {
  ipcMain.handle(channel, (event, ...args) => {
    const pathname = senderPath(event);
    if (launcherOnly && !pathname.startsWith('/launcher/')) throw new Error('UNTRUSTED_SENDER');
    return work(...args);
  });
}

function backendView() {
  return backend?.state() === 'ready' ? 'ready' : 'reconnecting';
}

// While the canvas is open the access token stays warm, which also notices a server-side revocation.
function keepCanvasAlive(active) {
  clearInterval(refreshTimer);
  clearTimeout(backendRetryTimer);
  backendRetryTimer = null;
  refreshTimer = active
    ? setInterval(() => void identity.getAccessToken(), TOKEN_REFRESH_INTERVAL_MS)
    : null;
}

function onBackendState(state) {
  broadcast('backend:state', backendView());
  if (state !== 'failed' || !canvasOpen) return;
  // The supervisor gave up after repeated crashes. The page and its unsaved edits stay put behind
  // the reconnect notice while the backend is retried slowly.
  clearTimeout(backendRetryTimer);
  backendRetryTimer = setTimeout(() => {
    const userId = backend.userId();
    if (canvasOpen && userId) void backend.start(userId).catch(() => {});
  }, BACKEND_RETRY_DELAY_MS);
}

// Rebuilt by "重新检测安装组件" so a repaired install's Identity configuration takes effect.
async function createIdentity() {
  const issuer = await Promise.resolve()
    .then(() => readIdentityIssuer({ installation, helpers }))
    .catch(() => null);
  let client = null;
  if (issuer) {
    try {
      client = createIdentityClient({ issuer, fetchImpl: (url, init) => net.fetch(url, init) });
    } catch {
      client = null;
    }
  }
  const session = createDeviceSession({
    client,
    resolveLocalUser: () => installation.devUserId || selectWorkspace(),
    legacyTokenStore: createTokenStore({
      filePath: installation.tokenFile,
      legacyTauriPath: installation.legacyTokenFile,
      encryptString: (text) => safeStorage.encryptString(text),
      decryptString: (bytes) => safeStorage.decryptString(bytes),
      unprotectLegacy: unprotectLegacyWithPowerShell,
    }),
    store: createDeviceStore({
      filePath: path.join(installation.state, 'device-identity.bin'),
      encryptString: (text) => safeStorage.encryptString(text),
      decryptString: (bytes) => safeStorage.decryptString(bytes),
    }),
  });
  const accountSession = createIdentitySession({ issuer, client,
    tokenStore: createTokenStore({ filePath: installation.tokenFile,
      legacyTauriPath: installation.legacyTokenFile,
      encryptString: text => safeStorage.encryptString(text),
      decryptString: bytes => safeStorage.decryptString(bytes),
      unprotectLegacy: unprotectLegacyWithPowerShell }),
    preferences: createLauncherPreferences({ stateDir: installation.state,
      legacyTauriPath: installation.legacyLauncherPreferences }) });
  account = createCanvasAccount({ session: accountSession, device: session, issuer,
    fetchImpl: (url, init) => net.fetch(url, init) });
  account.onChange(view => broadcast('account:changed', view));
  accountRestoreStarted = false;
  return session;
}

async function openCanvas() {
  const userId = identity.userId();
  if (!userId) return { opened: false, message: '本机工作区尚未就绪，请重试。' };
  try {
    await backend.start(userId);
  } catch {
    return { opened: false, message: OPEN_FAILED };
  }
  canvasOpen = true;
  if (!accountRestoreStarted) {
    accountRestoreStarted = true;
    void account.restore().catch(() => {});
  }
  keepCanvasAlive(true);
  // The canvas loads after the backend is ready, so its preferences hydrate on first paint.
  await appContents.loadURL(CANVAS_URL);
  mainWindow.setTitle('AIFISHER 画布');
  return { opened: true, message: '画布已打开。' };
}

// The page saves its edits before asking. The helper waits only about 2 s for this process, so the
// backend stops before the handoff and the app quits the moment the bridge reports "applying".
function applyUpdate() {
  if (workspaceSwitch) throw new Error('请等待工作区切换完成后再更新');
  updateHandoff ??= updates
    .apply({
      beforeHandoff: async () => {
        keepCanvasAlive(false);
        await backend.stop();
        return true;
      },
      afterFailedHandoff: async () => {
        const userId = backend.userId();
        if (!canvasOpen || !userId) return;
        await backend.start(userId);
        keepCanvasAlive(true);
      },
    })
    .then(
      (event) => {
        quitting = true;
        app.exit(0);
        return event;
      },
      (error) => {
        updateHandoff = null;
        throw error;
      },
    );
  return updateHandoff;
}

function registerIpc() {
  handle('account:status', () => account.status());
  handle('account:sign-in', input => account.signIn(input));
  handle('account:sign-out', () => account.signOut());
  handle('account:register', input => account.register(input));
  handle('account:recover-password', input => account.recoverPassword(input));
  handle('account:submit-feedback', (body, userId) => account.submitFeedback(body, userId));
  ipcMain.on('desktop:version', (event) => {
    event.returnValue = productVersion;
  });
  handle('shell:info', () => ({
    version: app.getVersion(),
    productVersion,
    platform: 'windows',
    architecture: process.arch,
  }));
  handle('shell:open-external', (url) =>
    isExternalUrl(url) ? shell.openExternal(url) : undefined,
  );
  handle('identity:status', () => identity.status(), { launcherOnly: true });
  handle('identity:restore', () => identity.restore(), { launcherOnly: true });
  handle(
    'identity:recheck',
    async () => {
      identity = await createIdentity();
      return identity.restore();
    },
    { launcherOnly: true },
  );
  handle('identity:sign-out', () => account.signOut(), { launcherOnly: true });
  handle(
    'canvas:prepare',
    () => {
      const userId = identity.userId();
      if (!userId) return { prepared: false, message: '本机工作区尚未就绪，请重试。' };
      void backend.start(userId).catch(() => {});
      return { prepared: true, message: '' };
    },
    { launcherOnly: true },
  );
  handle('canvas:open', () => openCanvas(), { launcherOnly: true });
  handle('update:status', () => updates.status());
  handle('update:prepare', () => updates.prepare());
  handle('update:check', () => updates.prepare({ force: true }));
  handle('update:source', () => updates.source());
  handle('update:select-local-source', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '选择本机更新测试目录', properties: ['openDirectory'],
    });
    if (selected.canceled) return updates.source();
    return updates.setSource(selected.filePaths[0]);
  });
  handle('update:reset-source', () => updates.setSource(null));
  handle('update:apply', () => applyUpdate());
  handle('backend:current-state', () => backendView());
  handle('desktop:return-to-login', () => account.signOut());
  handle('desktop:open-admin', async () => {
    const issuer = await readIdentityIssuer({ installation, helpers });
    if (!issuer) throw new Error('管理后台地址尚未配置');
    const target = new URL('/admin', issuer).href;
    if (!isExternalUrl(target)) throw new Error('管理后台地址无效');
    await shell.openExternal(target);
  });
  handle('desktop:switch-workspace', () => {
    workspaceSwitch ??= (async () => {
      if (updateHandoff || quitting) throw new Error('更新过程中暂不能切换工作区');
      const selected = await selectWorkspace(true);
      if (selected === identity.userId()) return;
      if (updateHandoff || quitting) throw new Error('更新过程中暂不能切换工作区');
      const previous = identity.userId();
      keepCanvasAlive(false);
      await backend.stop();
      try {
        await identity.selectLocalUser(selected);
        const opened = await openCanvas();
        if (!opened.opened) throw new Error(opened.message);
      } catch (error) {
        await backend.stop();
        await identity.selectLocalUser(previous);
        await openCanvas();
        throw error;
      }
    })().finally(() => { workspaceSwitch = null; });
    return workspaceSwitch;
  });
  handle('desktop:show-item-in-folder', (target) => shell.showItemInFolder(target));
}

async function start() {
  helpers = await loadReleaseHelpers(installation.tools);
  productVersion = await Promise.resolve()
    .then(() => helpers.loadProductVersion(releasePaths(installation)))
    .catch(() => app.getVersion());
  if (installation.packaged && !process.env.AIFISHER_UPDATE_STARTUP_TRANSACTION) {
    const { resumeManualStartup } = await import(pathToFileURL(path.join(installation.tools, 'manualStartup.mjs')).href);
    await resumeManualStartup({ targetRoot: installation.root, productVersion });
  }
  identity = await createIdentity();
  backend = createBackendSupervisor({
    fork: (...args) => utilityProcess.fork(...args),
    entry: installation.server,
    cwd: installation.code,
    logsDirectory: installation.logs,
    getAccessToken: () => identity.getAccessToken(),
    createEnvironment: ({ userId, pipe }) =>
      createBackendEnvironment({ installation, userId, pipe, helpers }),
  });
  backend.onState(onBackendState);
  updates = createUpdateCoordinator({
    bridgePath: installation.updateBridge,
    installRoot: installation.packaged ? installation.root : null,
    ownerPid: process.pid,
    spawnImpl: spawn,
    sourceSettingsPath: path.join(installation.config, 'local-update-source.json'),
  });
  updates.onProgress((event) => broadcast('update:progress', event));
  protocol.handle(
    APP_SCHEME,
    createAppProtocolHandler({
      backend,
      distDirectory: installation.dist,
      launcherDirectory: installation.launcher,
    }),
  );
  registerIpc();

  // Launcher starts dark; the canvas later applies its account's theme to native window chrome.
  nativeTheme.themeSource = 'dark';
  ({ window: mainWindow, contents: appContents } = createMainWindow({
    BrowserWindow,
    WebContentsView,
    shell,
    ipcMain,
    nativeTheme,
    preload: path.join(here, 'preload.cjs'),
    icon: installation.icon,
  }));
  mainWindow.on('close', (event) => {
    if (quitting) return;
    // Closing hides to the tray; the canvas, its unsaved edits and the backend stay alive.
    event.preventDefault();
    mainWindow.hide();
    broadcast('shell:clear-secrets');
  });
  tray = createTray({
    Tray,
    Menu,
    icon: installation.icon,
    onShow: showWindow,
    onQuit: () => app.quit(),
  });
  appContents.once('did-finish-load', () => {
    // The update helper rolls back unless the new version confirms within 15 s of launch.
    void confirmUpdateStartup({
      environment: process.env,
      productVersion,
      processId: process.pid,
      installRoot: installation.root,
    });
  });

  if (installation.devUserId) {
    await identity.restore();
    await identity.selectLocalUser(installation.devUserId);
    await openCanvas();
  } else {
    await appContents.loadURL(LAUNCHER_URL);
  }
}

if (deferredForUpdate) {
  void activateUpdateWindow({ spawnImpl: spawn }).finally(() => app.exit(0));
} else if (!primaryInstance || quitRequested) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--quit')) app.quit();
    else showWindow();
  });
  app.on('will-quit', () => {
    tray?.destroy();
    tray = null;
  });
  app.on('before-quit', (event) => {
    quitting = true;
    if (!backend || backend.state() === 'stopped') return;
    event.preventDefault();
    keepCanvasAlive(false);
    void backend.stop().finally(() => app.quit());
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error('AIFISHER 启动失败', error);
      app.exit(1);
    });
}
