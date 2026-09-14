import crypto from 'node:crypto';
import { CodexError } from './codexProcess.js';
import { validCanvasControl, projectCanvasResult } from '../../../src/shared/canvasControlProtocol.js';

/** Pending capabilities belong to this authenticated user's service and originating turn. */
export function createCanvasControlBridge({ timeout = 120000 } = {}) {
  const pending = new Map();
  return {
    dispatch(run, command) {
      if (!run.canvasControl || run.cancelled || !validCanvasControl(command)) return Promise.resolve({ ok: false, code: 'INVALID' });
      if (run.canvasCalls >= 100 || [...pending.values()].some(item => item.run === run)) return Promise.resolve({ ok: false, code: 'UNAVAILABLE' });
      run.canvasCalls = (run.canvasCalls || 0) + 1;
      const requestId = crypto.randomUUID();
      return new Promise(resolve => {
        const finish = result => {
          clearTimeout(item.timer);
          pending.delete(requestId);
          resolve(result);
        };
        const item = { run, finish, timer: setTimeout(() => finish({ ok: false, code: 'UNCONFIRMED' }), timeout) };
        pending.set(requestId, item);
        run.emit('canvas_action', { requestId, projectId: run.projectId, sessionId: run.sessionId, command, expiresAt: Date.now() + timeout - 1000 });
      });
    },
    complete(requestId, body) {
      const item = pending.get(requestId);
      if (!item || item.run.cancelled || body?.projectId !== item.run.projectId || body?.sessionId !== item.run.sessionId)
        throw new CodexError('画布操作已失效或不属于当前对话。', 'CODEX_ACTION_SCOPE', 409);
      let result;
      try { result = projectCanvasResult(body.result); }
      catch { throw new CodexError('画布执行结果无效。', 'CODEX_ACTION_RESULT', 400); }
      item.finish(result);
      return { success: true };
    },
    cancel(run) {
      for (const item of pending.values()) if (item.run === run) item.finish({ ok: false, code: 'UNCONFIRMED' });
    },
  };
}
