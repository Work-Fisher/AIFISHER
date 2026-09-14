import type { CanvasNode } from '../nodes/canvasNodeOperations';
import { validCanvasControl, projectCanvasResult, type CanvasActionHandler, type CanvasActionRequest, type CanvasResult } from '../../shared/canvasControlProtocol.js';

export function createCanvasTaskControl(execute: CanvasActionHandler, getRuntime: () => { projectId: string; nodes(): CanvasNode[] } | null, fetcher: typeof fetch = globalThis.fetch): CanvasActionHandler {
  const receipts = new Map<string, { signature: string; promise: Promise<CanvasResult> }>();
  async function handle(request: CanvasActionRequest, signal?: AbortSignal): Promise<CanvasResult> {
    const active = () => !signal?.aborted && Date.now() < request.expiresAt && getRuntime()?.projectId === request.projectId;
    if (!active()) return { ok: false, code: 'UNAVAILABLE' };
    const command = request.command;
    if (command.action !== 'tasks' && command.action !== 'cancelTask') return { ok: false, code: 'INVALID' };
    const before = await execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'read' } });
    if (!before.ok) return before;
    if (command.action === 'cancelTask' && command.revision !== before.revision) return { ok: false, code: 'CONFLICT' };
    const nodes = getRuntime()!.nodes();
    const ids = command.action === 'cancelTask' ? [command.nodeId] : command.nodeIds || nodes.filter(node => node.generationAttemptId || node.executionState).slice(0, 100).map(node => node.id);
    if (ids.some(id => !nodes.some(node => node.id === id))) return { ok: false, code: 'NOT_FOUND' };
    const tasks = [];
    try {
      for (const id of ids) {
        if (!active()) return { ok: false, code: 'UNCONFIRMED' };
        const node = nodes.find(node => node.id === id)!;
        const execution = node.executionState as { runId?: string } | undefined;
        const runId = typeof execution?.runId === 'string' ? execution.runId : undefined;
        const attemptId = typeof node.generationAttemptId === 'string' ? node.generationAttemptId : undefined;
        if (!runId && !attemptId) {
          tasks.push({ nodeId: id, status: command.action === 'cancelTask' ? 'unsupported' : node.status === 'success' ? 'success' : node.status === 'error' ? 'failed' : 'missing', remoteMayContinue: false,
            ...(typeof node.textContent === 'string' ? { text: node.textContent } : {}) }); continue;
        }
        const latest = getRuntime()!.nodes().find(node => node.id === id);
        if (!latest || latest.generationAttemptId !== node.generationAttemptId || JSON.stringify(latest.executionState) !== JSON.stringify(node.executionState)) return { ok: false, code: 'CONFLICT' };
        const cancel = command.action === 'cancelTask';
        const url = runId ? `/api/workflow-runs/${encodeURIComponent(runId)}${cancel ? '/cancel' : ''}`
          : cancel ? `/api/generation-cancel/${encodeURIComponent(id)}` : `/api/generation-status/${encodeURIComponent(id)}?attemptId=${encodeURIComponent(attemptId!)}`;
        const response = await fetcher(url, { signal, ...(cancel ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId, projectId: request.projectId }) } : {}) });
        if (!response.ok) return { ok: false, code: cancel ? 'UNCONFIRMED' : 'UNAVAILABLE' };
        const result = await response.json();
        if (!active()) return { ok: false, code: 'UNCONFIRMED' };
        const after = getRuntime()!.nodes().find(node => node.id === id);
        if (!after || after.generationAttemptId !== node.generationAttemptId || JSON.stringify(after.executionState) !== JSON.stringify(node.executionState)) return { ok: false, code: 'CONFLICT' };
        if (!cancel && (runId ? result.runId !== runId : result.attemptId !== attemptId)) return { ok: false, code: 'UNCONFIRMED' };
        const status = result.status === 'cancelled' && result.remoteMayContinue !== false ? 'cancelling'
          : ['success', 'failed', 'cancelled', 'unknown', 'missing'].includes(result.status) ? result.status : 'pending';
        tasks.push({ nodeId: id, status, remoteMayContinue: result.remoteMayContinue === true || cancel && result.remoteMayContinue !== false,
          ...(typeof result.text === 'string' ? { text: result.text } : {}) });
      }
      return projectCanvasResult({ ok: true, revision: before.revision, tasks });
    } catch { return { ok: false, code: command.action === 'cancelTask' ? 'UNCONFIRMED' : 'UNAVAILABLE' }; }
  }
  return (request, signal) => {
    if (!validCanvasControl(request.command)) return { ok: false, code: 'INVALID' };
    if (!['tasks', 'cancelTask'].includes(request.command.action)) return execute(request, signal);
    if (request.command.action === 'tasks') return handle(request, signal);
    const signature = JSON.stringify(request), old = receipts.get(request.requestId);
    if (old) return old.signature === signature ? old.promise : { ok: false, code: 'INVALID' };
    if (receipts.size >= 500) return { ok: false, code: 'UNAVAILABLE' };
    const promise = handle(request, signal); receipts.set(request.requestId, { signature, promise }); return promise;
  };
}
