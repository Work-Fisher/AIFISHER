import type * as React from 'react';
import {
  installCanvasAutoSave,
  type AutoSaveReason,
  type CanvasAutoSaveController,
} from './canvasAutoSave';

type ReactHooks = Pick<typeof React, 'useRef' | 'useEffect'>;
export interface CanvasAutoSaveProps {
  isDirty: boolean;
  nodes: readonly unknown[];
  groups?: readonly unknown[];
  title?: string;
  onSave: () => Promise<unknown>;
  interval?: number;
  documentId?: string | null;
  enabled: boolean;
  hasActiveOperations?: boolean;
}

interface SaveSession {
  controller: CanvasAutoSaveController;
  closed: boolean;
  props: CanvasAutoSaveProps;
}

declare global {
  interface Window {
    __FISHERAI_BEFORE_DESKTOP_UPDATE__?: () => Promise<void>;
  }
}

function signature(props: CanvasAutoSaveProps): string | undefined {
  try {
    return JSON.stringify([props.nodes, props.groups, props.title]);
  } catch {
    // An unserializable document must not be mistaken for an unchanged node count.
    return undefined;
  }
}

function documentState(session: SaveSession) {
  return {
    isDirty: session.props.isDirty,
    nodeCount: session.props.nodes.length,
    signature: session.props.isDirty ? signature(session.props) : undefined,
  };
}

/**
 * One controller and listener set for one enabled canvas/project lifetime.
 * ADR-0035: the canvas lives in one window, so the open document owns its saves without
 * focus tracking; a stale writer is still stopped by the workflow revision conflict.
 */
export function useCanvasAutoSave(hooks: ReactHooks, props: CanvasAutoSaveProps) {
  const sessionRef = hooks.useRef<SaveSession | null>(null);
  const lastSaveTime = hooks.useRef(Date.now());

  // Runs before setup/scheduling effects, so no timer captures an obsolete render.
  hooks.useEffect(() => {
    if (sessionRef.current) sessionRef.current.props = props;
  });

  hooks.useEffect(() => {
    if (!props.enabled) return;
    const session: SaveSession = {
      controller: installCanvasAutoSave().createController(),
      closed: false,
      props,
    };
    sessionRef.current = session;
    const save = () => session.props.onSave();
    const saveBeforeUpdate = async () => {
      session.controller.cancelScheduled();
      const result = await session.controller.attempt('edit', documentState(session), save, true);
      if (result !== 'saved' && result !== 'clean') {
        throw new Error(result === 'busy' ? '画布正在保存，请稍后再试。' : '画布尚未保存成功，请先保存后再更新。');
      }
      if (session.props.hasActiveOperations) {
        throw new Error('画布已保存。仍有任务正在处理，请等待任务结束后再更新。');
      }
    };
    window.__FISHERAI_BEFORE_DESKTOP_UPDATE__ = saveBeforeUpdate;
    const attempt = (reason: AutoSaveReason, force = false) => {
      if (session.closed) return;
      void session.controller
        .attempt(reason, documentState(session), save, force)
        .then((result) => {
          if (result === 'saved' && !session.closed && sessionRef.current === session)
            lastSaveTime.current = session.controller.getLastSaveTime();
        });
    };
    // Leaving the window writes the latest edit now instead of waiting for the next timer.
    const flush = () => {
      session.controller.cancelScheduled();
      attempt('hidden', true);
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const beforeUnload = () => {
      // beforeunload can be cancelled. Only pagehide terminates the lifecycle.
      session.controller.cancelScheduled();
      attempt('pagehide', true);
    };
    const pageHide = () => {
      attempt('pagehide', true);
      session.closed = true;
      session.controller.dispose();
    };
    const pageShow = () => {
      if (!session.closed) return;
      session.controller = installCanvasAutoSave().createController();
      session.closed = false;
    };
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    document.addEventListener('visibilitychange', hidden);
    const timer = window.setInterval(() => attempt('interval'), props.interval ?? 60_000);
    return () => {
      if (window.__FISHERAI_BEFORE_DESKTOP_UPDATE__ === saveBeforeUpdate) {
        delete window.__FISHERAI_BEFORE_DESKTOP_UPDATE__;
      }
      session.closed = true;
      session.controller.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
      window.clearInterval(timer);
      window.removeEventListener('blur', flush);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [props.enabled, props.documentId, props.interval]);

  hooks.useEffect(() => {
    const session = sessionRef.current;
    if (!session || session.closed) return;
    session.controller.schedule(
      () => documentState(session),
      () => session.props.onSave(),
    );
  }, [props.isDirty, props.nodes, props.groups, props.title, props.enabled, props.documentId]);
  return { lastSaveTime: lastSaveTime.current };
}
