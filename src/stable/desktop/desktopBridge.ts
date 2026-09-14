import type { DesktopUpdateEvent } from '../../update/desktopUpdateModel';
import type { AifisherShell, IdentityViewState } from '../../../apps/desktop/launcher/src/desktopShell';

export type CanvasAccountView = IdentityViewState & { userId: string | null; displayName: string | null; offline?: boolean };
export interface CanvasAccountBridge {
  status(): Promise<CanvasAccountView>;
  signIn: (input: Parameters<AifisherShell['identity']['signIn']>[0]) => Promise<CanvasAccountView>;
  signOut(): Promise<CanvasAccountView>;
  register: AifisherShell['identity']['register'];
  recoverPassword: AifisherShell['identity']['recoverPassword'];
  submitFeedback(body: Record<string, unknown>, userId: string | null): Promise<{ status: number; payload: Record<string, unknown> }>;
  onChange(listener: (view: CanvasAccountView) => void): () => void;
  onClearSecrets(listener: () => void): () => void;
}

/** Exposed by the Electron preload (ADR-0035); absent when the canvas runs in a plain browser. */
export interface AifisherDesktopBridge {
  readonly version: string;
  readonly integratedTitleBar?: boolean;
  readonly account?: CanvasAccountBridge;
  /** Optional for older desktop shells; only affects native chrome, not stored preferences. */
  setTheme?(theme: 'dark' | 'light'): Promise<void>;
  update: {
    status(): Promise<DesktopUpdateEvent>;
    prepare(): Promise<DesktopUpdateEvent>;
    check?(): Promise<DesktopUpdateEvent>;
    source?(): Promise<{ directory: string | null; enabled: boolean }>;
    selectLocalSource?(): Promise<{ directory: string | null; enabled: boolean }>;
    resetSource?(): Promise<{ directory: string | null; enabled: boolean }>;
    apply(): Promise<DesktopUpdateEvent>;
    onProgress(listener: (event: DesktopUpdateEvent) => void): () => void;
  };
  returnToLogin(): Promise<void>;
  switchWorkspace?(): Promise<void>;
  openAdmin?(): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
  pathForFile(file: File): string; // 没有本机路径时返回 ''
  onBackendState(listener: (state: 'ready' | 'reconnecting') => void): () => void;
}

declare global {
  interface Window {
    aifisherDesktop?: AifisherDesktopBridge;
  }
}

export function desktopBridge(windowObject: Window | null = window): AifisherDesktopBridge | null {
  return windowObject?.aifisherDesktop ?? null;
}
