import { projectCanvasResult, type CanvasActionHandler, type CanvasActionRequest } from '../../shared/canvasControlProtocol.js';

export interface ExternalGrant { id: string; expiresAt: number; manageProjects: boolean; revoked: boolean; thisWindow: boolean }
export function createCanvasExternalClient(projectId: string, execute: CanvasActionHandler, fetcher: typeof fetch = globalThis.fetch, onRevokeSession: (sessionId: string) => void = () => {}) {
  let clientId = crypto.randomUUID();
  const listeners = new Set<() => void>();
  let state = { grants: [] as ExternalGrant[], command: '', codexCommand: '', desktopCommand: '', expiresAt: 0, error: '', connected: false }, stopped = false, running = false, lifecycle = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let abort = new AbortController();
  const actions = new Map<string, AbortController>();
  const publish = (next: Partial<typeof state>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  async function api<T>(path: string, body: object = {}): Promise<T> {
    const response = await fetcher('/api/agent/external/' + path, { method: 'POST', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, clientId, projectId }) });
    if (!response.ok) throw Object.assign(Error('外部连接未确认，请回到目标项目窗口重新配对。'), { status: response.status });
    return response.json();
  }
  async function refresh() { publish({ grants: await api<ExternalGrant[]>('list') }); }
  const control: CanvasActionHandler = async (request, signal) => {
    if (request.projectId !== projectId || stopped || signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
    let lease: { external: boolean };
    try { lease = await api('claim', { requestId: request.requestId }); }
    catch { publish({ error: '此项目正在由其他窗口控制或已有操作未结束。请在目标窗口接管后继续。' }); return { ok: false, code: 'UNAVAILABLE' }; }
    try { return await execute(request, signal); }
    finally { if (!lease.external) await api('finish', { requestId: request.requestId }).catch(() => {}); }
  };
  async function start() {
    if (running) return;
    // A delayed release from the previous mount must never release this new lease.
    if (stopped) clientId = crypto.randomUUID();
    stopped = false; running = true; abort = new AbortController();
    const generation = ++lifecycle;
    const runSignal = abort.signal;
    let failures = 0;
    const retry = (milliseconds: number) => new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); runSignal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, milliseconds);
      runSignal.addEventListener('abort', finish, { once: true });
      if (runSignal.aborted) finish();
    });
    const ownHeartbeat = setInterval(() => { if (!stopped && generation === lifecycle) void api('heartbeat').catch(() => publish({ error: '连接保活失败，请核对本机登录状态。' })); }, 10000);
    heartbeat = ownHeartbeat;
    try {
      // Registration does not steal another window's active ownership. Pairing is the explicit activation.
      while (!stopped && generation === lifecycle) {
        let requests: Array<CanvasActionRequest | { cancelRequestId: string } | { revokeSessionId: string }>;
        try { requests = await api<typeof requests>('poll'); failures = 0; }
        catch (error) {
          if (stopped || generation !== lifecycle) break;
          if (error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) throw error;
          publish({ connected: false, error: '正在恢复本机连接…' });
          await retry(Math.min(1000 * 2 ** failures++, 10000));
          continue;
        }
        if (stopped || generation !== lifecycle) break;
        publish({ connected: true, error: '' });
        for (const request of requests) {
          if (stopped) break;
          if ('revokeSessionId' in request) { onRevokeSession(request.revokeSessionId); continue; }
          if ('cancelRequestId' in request) { actions.get(request.cancelRequestId)?.abort(); continue; }
          const action = new AbortController(); actions.set(request.requestId, action);
          void (async () => {
            try {
              const signal = AbortSignal.any([abort.signal, action.signal]);
              const result = await control(request, signal);
              if (signal.aborted) return;
              await api('complete', { requestId: request.requestId, result: projectCanvasResult(result) });
              if (result.ok && result.afterTurn && !signal.aborted) await result.afterTurn();
            } catch { if (!stopped && !action.signal.aborted) publish({ error: '操作回执未确认，请核对画布；不会自动重提。' }); }
            finally { actions.delete(request.requestId); }
          })();
        }
        if (!stopped) await refresh().catch(() => {});
      }
    } catch { if (!stopped && generation === lifecycle) publish({ connected: false, error: '外部连接已暂停。请重新配对；未确认操作不会自动重提。' }); }
    finally { if (generation === lifecycle) running = false; clearInterval(ownHeartbeat); }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSnapshot: () => state,
    control, start, stop() { stopped = true; running = false; lifecycle++; clearInterval(heartbeat); abort.abort(); for (const action of actions.values()) action.abort(); void fetcher('/api/agent/external/release', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, projectId }) }).catch(() => {}); },
    async activate() {
      try { await api('activate'); publish({ error: '' }); await refresh(); }
      catch { publish({ error: '暂时无法接管，请等待正在执行的操作结束并核对登录状态。' }); }
    },
    async pair(manageProjects: boolean) {
      publish({ command: '', codexCommand: '', desktopCommand: '', expiresAt: 0 });
      try {
        await api('activate');
        const pairing = await api<{ command: string; codexCommand?: string; desktopCommand?: string; expiresAt: number }>('pair', { manageProjects });
        publish({ ...pairing, error: '' }); await refresh();
        if (!state.connected && !stopped) void start();
      } catch { publish({ error: '无法配对，请保持目标项目窗口打开并检查本机登录状态。' }); }
    },
    async revoke(id: string) {
      for (const action of actions.values()) action.abort();
      if (id) onRevokeSession(`external-${id}`);
      try { await api('revoke', { id }); publish({ command: '', codexCommand: '', desktopCommand: '', expiresAt: 0 }); await refresh(); }
      catch { publish({ error: '撤销结果未确认，请关闭画布或退出登录以终止连接。' }); }
    },
  };
}
export type CanvasExternalClient = ReturnType<typeof createCanvasExternalClient>;
