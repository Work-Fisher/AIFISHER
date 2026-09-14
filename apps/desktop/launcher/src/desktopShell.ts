import type {
  DesktopUpdateBridge,
  DesktopUpdateEvent,
} from '../../../../src/update/desktopUpdateModel';
import type { OpenCanvasResult, PrepareCanvasResult } from './canvasEntry';

export type IdentityState =
  | 'notConfigured'
  | 'signedOut'
  | 'authenticating'
  | 'authenticated'
  | 'invalidCredentials'
  | 'rateLimited'
  | 'expired'
  | 'networkUnavailable';

export type IdentityViewState = {
  state: IdentityState;
  authenticated: boolean;
  rememberedEmail: string | null;
  message: string;
};

export type IdentityFieldErrors = {
  email: string | null;
  displayName: string | null;
  password: string | null;
  confirmation: string | null;
};

export type IdentityActionResult = {
  accepted: boolean;
  problem: boolean;
  message: string;
  fieldErrors: IdentityFieldErrors;
  pendingEmail: string | null;
  mailboxUrl: string | null;
};

export type ShellInfo = {
  version: string;
  productVersion: string | null;
  platform: string;
  architecture: string;
};

/** The launcher's view of the Electron main process, exposed by apps/desktop/src/preload.cjs. */
export interface AifisherShell {
  info(): Promise<ShellInfo>;
  identity: {
    status(): Promise<IdentityViewState>;
    restore(): Promise<IdentityViewState>;
    recheck(): Promise<IdentityViewState>;
    signIn(request: {
      email: string;
      password: string;
      rememberEmail: boolean;
    }): Promise<IdentityViewState>;
    register(request: {
      email: string;
      displayName: string;
      password: string;
      confirmation: string;
      confirmationWasPasted: boolean;
    }): Promise<IdentityActionResult>;
    recoverPassword(request: { email: string }): Promise<IdentityActionResult>;
    signOut(): Promise<IdentityViewState>;
  };
  canvas: {
    prepare(): Promise<PrepareCanvasResult>;
    open(userInitiated: boolean): Promise<OpenCanvasResult>;
  };
  update: {
    status(): Promise<DesktopUpdateEvent>;
    prepare(): Promise<DesktopUpdateEvent>;
    apply(): Promise<DesktopUpdateEvent>;
    onProgress(listener: (event: DesktopUpdateEvent) => void): () => void;
  };
  openExternal(url: string): Promise<void>;
  onClearSecrets(listener: () => void): () => void;
}

declare global {
  interface Window {
    aifisherShell?: AifisherShell;
  }
}

export function desktopShell(): AifisherShell {
  const shell = window.aifisherShell;
  if (!shell) throw new Error('AIFISHER 桌面环境不可用。');
  return shell;
}

export function updateBridge(shell: AifisherShell): DesktopUpdateBridge {
  return {
    invoke: (command) =>
      command === 'update_status'
        ? shell.update.status()
        : command === 'update_prepare'
          ? shell.update.prepare()
          : shell.update.apply(),
    listen: async (_event, handler) => shell.update.onProgress(handler),
  };
}
