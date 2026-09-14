import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS, TEXT_MODELS } from '../../config/modelConfig';
import { prepareCanvasGenerationRequest } from '../generation/canvasGeneration';
import { modelKey } from './canvasModelControl';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import type { CanvasCreationControl } from './canvasCreationControl';
import { validCanvasControl, projectCanvasResult, type CanvasActionHandler, type CanvasActionRequest, type CanvasResult } from '../../shared/canvasControlProtocol.js';

export interface GenerationBudget {
  id: string; projectId: string; sessionId: string; state: 'pending' | 'approved' | 'revoked'; expiresAt: number;
  maxRequests: number; maxOutputs: number; budgetMicros: number | null; profiles: string[]; usedRequests: number; usedOutputs: number; reservedMicros: number;
}
const models = { imageModels: IMAGE_MODELS, videoModels: VIDEO_MODELS, audioModels: AUDIO_MODELS, textModels: TEXT_MODELS };
export function createCanvasBudgetControl(execute: CanvasActionHandler, creation: CanvasCreationControl,
  getRuntime: () => { projectId: string; nodes(): CanvasNode[] } | null, fetcher: typeof fetch = globalThis.fetch) {
  let snapshot: GenerationBudget[] = [], error = '';
  const listeners = new Set<() => void>(), receipts = new Map<string, { signature: string; promise: Promise<CanvasResult> }>();
  const publish = () => { snapshot = [...snapshot]; listeners.forEach(listener => listener()); };
  async function api<T>(suffix: string, body?: unknown): Promise<T> {
    const response = await fetcher('/api/agent/budgets' + suffix, { signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '预算操作未确认。'); return result;
  }
  const remember = (grant: GenerationBudget) => { snapshot = [...snapshot.filter(item => item.id !== grant.id), grant]; publish(); };
  async function refresh(projectId: string) {
    try { const grants = await api<GenerationBudget[]>(`?projectId=${encodeURIComponent(projectId)}`); if (getRuntime()?.projectId !== projectId) return; snapshot = grants; error = ''; publish(); }
    catch (problem) { error = problem instanceof Error ? problem.message : '授权读取失败。'; publish(); }
  }
  const active = (request: CanvasActionRequest, signal?: AbortSignal) => !signal?.aborted && Date.now() < request.expiresAt && getRuntime()?.projectId === request.projectId;
  async function handle(request: CanvasActionRequest, signal?: AbortSignal): Promise<CanvasResult> {
    if (!active(request, signal)) return { ok: false, code: 'UNAVAILABLE' };
    const before = await execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'read' } });
    if (!before.ok) return before;
    const command = request.command;
    try {
      if (command.action === 'budgets') {
        const grants = await api<GenerationBudget[]>(`?projectId=${encodeURIComponent(request.projectId)}`);
        if (!active(request, signal)) return { ok: false, code: 'UNAVAILABLE' };
        snapshot = grants; publish(); return projectCanvasResult({ ok: true, revision: before.revision, budgets: grants });
      }
      if (command.action === 'revokeBudget') {
        const grant = await api<GenerationBudget>(`/${encodeURIComponent(command.authorizationId)}/revoke`, { projectId: request.projectId });
        remember(grant); return projectCanvasResult({ ok: true, revision: before.revision, budgets: [grant] });
      }
      if (command.action !== 'prepareBudget' && command.action !== 'runGeneration') return { ok: false, code: 'INVALID' };
      if (command.revision !== before.revision) return { ok: false, code: 'CONFLICT' };
      if (command.action === 'runGeneration') {
        const grants = await api<GenerationBudget[]>(`?projectId=${encodeURIComponent(request.projectId)}`);
        const grant = grants.find(grant => grant.id === command.authorizationId && grant.state === 'approved' && grant.expiresAt > Date.now());
        const plan = creation.getSnapshot().find(plan => plan.id === command.generationPlanId && plan.projectId === request.projectId && plan.sessionId === request.sessionId && plan.state === 'pending' && plan.expiresAt > Date.now() && !plan.recovered);
        if (!grant || !plan || !active(request, signal)) return { ok: false, code: 'UNAVAILABLE' };
        const current = await execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'read' } });
        if (!current.ok || current.revision !== command.revision) return { ok: false, code: 'CONFLICT' };
        void creation.approve(plan.id, grant.id).catch(() => { error = '批次执行未确认，请核对原任务。'; publish(); }).finally(() => refresh(request.projectId));
        return { ok: true, revision: current.revision, generationPlanId: plan.id, generationState: 'running' };
      }
      const runtime = getRuntime()!, nodes = structuredClone(runtime.nodes()), sampleRequests = [];
      for (const nodeId of command.nodeIds) {
        const node = nodes.find(node => node.id === nodeId);
        if (!node || !['Image', 'Video', 'Audio', 'Text'].includes(node.type)) return { ok: false, code: 'NOT_FOUND' };
        const connected = await execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'models', type: node.type as 'Image' | 'Video' | 'Audio' | 'Text', model: String(node[modelKey(node.type)] || '') } });
        if (!connected.ok || !connected.models?.length) return { ok: false, code: 'UNAVAILABLE' };
        sampleRequests.push(await prepareCanvasGenerationRequest(nodes, node, request.projectId, models));
      }
      const current = await execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'read' } });
      if (!current.ok || current.revision !== command.revision || !active(request, signal)) return { ok: false, code: 'CONFLICT' };
      const grant = await api<GenerationBudget>('', { id: crypto.randomUUID(), projectId: request.projectId, sessionId: request.sessionId,
        maxRequests: command.maxRequests, maxOutputs: command.maxOutputs, minutes: command.minutes,
        budgetMicros: command.budgetCny === undefined ? null : Math.round(command.budgetCny * 1000000), sampleRequests });
      remember(grant); return projectCanvasResult({ ok: true, revision: current.revision, budgets: [grant] });
    } catch { return { ok: false, code: 'UNCONFIRMED' }; }
  }
  const control: CanvasActionHandler = (request, signal) => {
    if (!validCanvasControl(request.command)) return { ok: false, code: 'INVALID' };
    if (!['budgets', 'prepareBudget', 'revokeBudget', 'runGeneration'].includes(request.command.action)) return execute(request, signal);
    if (request.command.action === 'budgets') return handle(request, signal);
    const signature = JSON.stringify(request), old = receipts.get(request.requestId);
    if (old) return old.signature === signature ? old.promise : { ok: false, code: 'INVALID' };
    if (receipts.size >= 500) return { ok: false, code: 'UNAVAILABLE' };
    const promise = handle(request, signal); receipts.set(request.requestId, { signature, promise }); return promise;
  };
  return { control, refresh, getSnapshot: () => snapshot, getError: () => error,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async approve(id: string) {
      const grant = snapshot.find(item => item.id === id && item.state === 'pending' && item.projectId === getRuntime()?.projectId);
      if (!grant) return;
      try { remember(await api<GenerationBudget>(`/${encodeURIComponent(id)}/approve`, { projectId: grant.projectId })); error = ''; }
      catch (problem) { error = problem instanceof Error ? problem.message : '授权未确认。'; publish(); }
    },
    async revoke(id: string) {
      const grant = snapshot.find(item => item.id === id && item.projectId === getRuntime()?.projectId); if (!grant) return;
      try { remember(await api<GenerationBudget>(`/${encodeURIComponent(id)}/revoke`, { projectId: grant.projectId })); }
      catch (problem) { error = problem instanceof Error ? problem.message : '撤销未确认。'; publish(); }
    },
  };
}
export type CanvasBudgetControl = ReturnType<typeof createCanvasBudgetControl>;
