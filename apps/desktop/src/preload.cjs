const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = (channel) => (listener) => {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

function subscribeBackendState(listener) {
  let live = false;
  let active = true;
  const unsubscribe = subscribe('backend:state')((state) => {
    live = true;
    listener(state);
  });
  // A page that loads mid-reconnect sees the current state instead of waiting for the next change.
  invoke('backend:current-state').then(
    (state) => {
      if (active && !live) listener(state);
    },
    () => {},
  );
  return () => {
    active = false;
    unsubscribe();
  };
}

const update = Object.freeze({
  status: () => invoke('update:status'),
  prepare: () => invoke('update:prepare'),
  check: () => invoke('update:check'),
  source: () => invoke('update:source'),
  selectLocalSource: () => invoke('update:select-local-source'),
  resetSource: () => invoke('update:reset-source'),
  apply: () => invoke('update:apply'),
  onProgress: subscribe('update:progress'),
});

// The canvas bridge; see docs/architecture/electron-desktop-shell.md.
contextBridge.exposeInMainWorld('aifisherDesktop', {
  version: ipcRenderer.sendSync('desktop:version'),
  integratedTitleBar: true,
  account: Object.freeze({
    status: () => invoke('account:status'),
    signIn: input => invoke('account:sign-in', input),
    signOut: () => invoke('account:sign-out'),
    register: input => invoke('account:register', input),
    recoverPassword: input => invoke('account:recover-password', input),
    submitFeedback: (body, userId) => invoke('account:submit-feedback', body, userId),
    onChange: subscribe('account:changed'),
    onClearSecrets: subscribe('shell:clear-secrets'),
  }),
  update,
  setTheme: (theme) => {
    if (theme !== 'dark' && theme !== 'light') return Promise.reject(new Error('INVALID_THEME'));
    return invoke('desktop:set-theme', theme);
  },
  returnToLogin: () => invoke('desktop:return-to-login'),
  switchWorkspace: () => invoke('desktop:switch-workspace'),
  openAdmin: () => invoke('desktop:open-admin'),
  showItemInFolder: (target) => invoke('desktop:show-item-in-folder', String(target)),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  onBackendState: subscribeBackendState,
});

// The launcher bridge; the main process only answers identity calls from the launcher page.
contextBridge.exposeInMainWorld('aifisherShell', {
  info: () => invoke('shell:info'),
  identity: Object.freeze({
    status: () => invoke('identity:status'),
    restore: () => invoke('identity:restore'),
    recheck: () => invoke('identity:recheck'),
    signIn: (request) => invoke('identity:sign-in', request),
    register: (request) => invoke('identity:register', request),
    recoverPassword: (request) => invoke('identity:recover-password', request),
    signOut: () => invoke('identity:sign-out'),
  }),
  canvas: Object.freeze({
    prepare: () => invoke('canvas:prepare'),
    open: (userInitiated) => invoke('canvas:open', Boolean(userInitiated)),
  }),
  update,
  openExternal: (url) => invoke('shell:open-external', String(url)),
  onClearSecrets: subscribe('shell:clear-secrets'),
});
