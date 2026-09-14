import { validCanvasControl, type CanvasActionHandler, type CanvasActionRequest, type CanvasResult } from '../../shared/canvasControlProtocol.js';
export const productOperations = { upload: '选择并上传素材', replace: '选择文件替换素材', download: '保存媒体到本机', saveAsset: '保存到素材库', resize: '调整图片尺寸', workflowManager: '导入或管理执行工作流', runWorkflow: '运行工作流' };
export type ProductOperation = keyof typeof productOperations;
export function createCanvasProductControl(execute: CanvasActionHandler, getRuntime: () => { projectId: string; invoke(operation: ProductOperation, nodeId?: string): Promise<void> | void } | null) {
  const items = new Map<string, { id: string; sessionId: string; label: string; state: 'pending' | 'opened' | 'cancelled' | 'unconfirmed'; request: CanvasActionRequest }>(), listeners = new Set<() => void>();
  let snapshot: Array<Omit<ReturnType<typeof items.get> & object, 'request'>> = [];
  const retired = new Set<string>();
  const publish = () => { snapshot = [...items.values()].map(({ id, sessionId, label, state }) => ({ id, sessionId, label, state })); listeners.forEach(listener => listener()); };
  const active = (request: CanvasActionRequest) => request.projectId === getRuntime()?.projectId && request.expiresAt > Date.now();
  const control: CanvasActionHandler = async (request, signal) => {
    if (!validCanvasControl(request.command)) return { ok: false, code: 'INVALID' };
    if (request.command.action !== 'product') return execute(request, signal);
    if (retired.has(request.requestId)) return { ok: false, code: 'UNCONFIRMED' };
    if (!active(request) || signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
    const before = await execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'read' } });
    if (!active(request) || signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
    if (!before.ok || before.revision !== request.command.revision) return { ok: false, code: 'CONFLICT' };
    const existing = items.get(request.requestId);
    if (existing && JSON.stringify(existing.request.command) !== JSON.stringify(request.command)) return { ok: false, code: 'INVALID' };
    if (!existing) {
      if (items.size >= 50) for (const [id, item] of items) {
        if (item.state === 'pending' && active(item.request)) continue;
        items.delete(id); retired.add(id);
        if (retired.size > 1000) retired.delete(retired.values().next().value!);
        if (items.size < 50) break;
      }
      if (items.size >= 50) return { ok: false, code: 'UNAVAILABLE' };
      items.set(request.requestId, { id: request.requestId, sessionId: request.sessionId, label: productOperations[request.command.operation], state: 'pending', request: { ...request, expiresAt: Date.now() + 600000 } }); publish();
    }
    return { ok: true, revision: before.revision, projectState: 'awaiting-user', projectRequestId: request.requestId };
  };
  return { control, getSnapshot: () => snapshot, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancelSession(sessionId: string) { for (const item of items.values()) if (item.sessionId === sessionId && item.state === 'pending') item.state = 'cancelled'; publish(); },
    cancel(id: string) { const item = items.get(id); if (item?.state === 'pending') { item.state = 'cancelled'; publish(); } },
    async approve(id: string) {
      const item = items.get(id); if (!item || item.state !== 'pending') return;
      item.state = 'opened'; publish();
      try {
        const command = item.request.command;
        if (!active(item.request) || command.action !== 'product') throw Error('Expired');
        const result: CanvasResult = await execute({ ...item.request, requestId: crypto.randomUUID(), command: { action: 'read' } });
        if (!active(item.request) || !result.ok || result.revision !== command.revision) throw Error('Changed');
        await getRuntime()!.invoke(command.operation, command.nodeId);
      } catch { item.state = 'unconfirmed'; publish(); }
    },
  };
}
export type CanvasProductControl = ReturnType<typeof createCanvasProductControl>;
