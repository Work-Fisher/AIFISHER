import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS, TEXT_MODELS } from '../../config/modelConfig';
import {
  prepareCanvasGenerationRequest,
  type GenerationAuthorization,
} from '../generation/canvasGeneration';
import { createSourceSettingsClient } from '../generation/sourceSettingsClient';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import { canvasModels, modelKey, modelParameters } from './canvasModelControl';
import type { GenerationPlanClient, GenerationPlanRecord } from './generationPlanClient';
import {
  validCanvasControl,
  projectCanvasResult,
  type CanvasActionHandler,
  type CanvasActionRequest,
  type CanvasResult,
} from '../../shared/canvasControlProtocol.js';

export type GenerationBatch = {
  id: string;
  projectId: string;
  sessionId: string;
  expiresAt: number;
  state: 'pending' | 'running' | 'finished' | 'cancelled';
  recovered?: boolean;
  authorizationId?: string;
  items: {
    nodeId: string;
    title: string;
    model: string;
    parameters: string;
    count: number;
    references: string[];
    dependsOn?: string[];
    state: 'pending' | 'submitted' | 'success' | 'failed' | 'unconfirmed' | 'stopped';
  }[];
};
interface Runtime {
  projectId: string;
  nodes(): CanvasNode[];
  generate(id: string, authorization: GenerationAuthorization): Promise<void> | undefined;
}
const models = {
  imageModels: IMAGE_MODELS,
  videoModels: VIDEO_MODELS,
  audioModels: AUDIO_MODELS,
  textModels: TEXT_MODELS,
};
// Full transitive input snapshots stay in memory; no storage paths/media URLs are sent to the model.
function inputs(nodes: CanvasNode[], id: string): CanvasNode[] {
  const found = new Map<string, CanvasNode>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Cyclic input');
    if (found.has(id)) return;
    const node = nodes.find((item) => item.id === id);
    if (!node) throw new Error('Missing input');
    found.set(id, node);
    visiting.add(id);
    (node.parentIds || []).filter(Boolean).forEach(visit);
    visiting.delete(id);
  };
  visit(id);
  return [...found.values()];
}
const generatedFields = new Set(['status', 'resultUrl', 'resultUrls', 'currentResultCount', 'resultAspectRatio', 'lastFrame', 'textContent', 'networkUrl',
  'generationStartTime', 'generationAttemptId', 'generationDurationMs', 'generationDiagnosticCode', 'errorMessage']);
function configuration(node: CanvasNode) {
  return JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key]) => !generatedFields.has(key) && !(node.type === 'Video' && key === 'aspectRatio'))));
}
export function createCanvasCreationControl(
  execute: CanvasActionHandler,
  getRuntime: () => Runtime | null,
  fetcher: typeof fetch = globalThis.fetch,
  journal?: GenerationPlanClient,
) {
  const source = createSourceSettingsClient(fetcher);
  const entries = new Map<
    string,
    { batch: GenerationBatch; signatures: string[]; requests: string[]; record?: GenerationPlanRecord }
  >();
  const receipts = new Map<string, { signature: string; promise: Promise<CanvasResult> }>();
  const listeners = new Set<() => void>();
  let snapshot: GenerationBatch[] = [];
  let restoreError = '';
  const publish = () => {
    snapshot = [...entries.values()].map((entry) => structuredClone(entry.batch));
    listeners.forEach((listener) => listener());
  };
  const read = (request: CanvasActionRequest) =>
    execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'read' } });
  const active = (request: CanvasActionRequest) =>
    Date.now() < request.expiresAt && getRuntime()?.projectId === request.projectId;
  async function handle(request: CanvasActionRequest, signal?: AbortSignal): Promise<CanvasResult> {
    if (!active(request) || signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
    const before = await read(request);
    if (!before.ok) return before;
    const command = request.command;
    if (command.action !== 'models' && command.action !== 'prepareGeneration')
      return { ok: false, code: 'INVALID' };
    try {
      const blocks = await source.getBlocks({ signal });
      if (!active(request) || signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
      if (command.action === 'models') {
        const allowed = new Set(canvasModels(command.type).map((item) => item.name));
        return projectCanvasResult({
          ok: true,
          revision: before.revision,
          models: blocks.flatMap((block) =>
            block.media
              .filter((media) => media.kind === command.type.toLowerCase())
              .flatMap((media) =>
                media.models
                  .filter(
                    (model) =>
                      model.configured &&
                      allowed.has(model.name) &&
                      (!command.model || command.model === model.name),
                  )
                  .map((model) => ({
                    name: model.name,
                    source: block.label,
                    parameters: command.model
                      ? JSON.stringify(modelParameters(command.type, model.name))
                      : '指定 model 查询有效参数',
                  })),
              ),
          ),
        });
      }
      const current = await read(request);
      if (!current.ok || current.revision !== command.revision)
        return { ok: false, code: 'CONFLICT' };
      const runtime = getRuntime();
      if (!runtime) return { ok: false, code: 'UNAVAILABLE' };
      const nodes = structuredClone(runtime.nodes());
      let selected = command.nodeIds.map((id) => nodes.find((node) => node.id === id));
      if (
        selected.some(
          (node) =>
            !node ||
            !canvasModels(node.type).some((model) => model.name === node[modelKey(node.type)]) ||
            node.status === 'loading' ||
            node.generationAttemptId,
        )
      )
        return { ok: false, code: 'INVALID' };
      const ordered: CanvasNode[] = [], remaining = new Set(command.nodeIds);
      while (remaining.size) {
        const next = selected.find(node => node && remaining.has(node.id) && inputs(nodes, node.id).slice(1).every(parent => !remaining.has(parent.id)));
        if (!next) return { ok: false, code: 'INVALID' };
        ordered.push(next); remaining.delete(next.id);
      }
      selected = ordered;
      // One pending batch per conversation prevents piling up duplicate fee authorizations.
      if (
        [...entries.values()].some(
          (entry) =>
            entry.batch.sessionId === request.sessionId &&
            (entry.batch.state === 'running' ||
              (entry.batch.state === 'pending' && entry.batch.expiresAt > Date.now())),
        )
      )
        return { ok: false, code: 'CONFLICT' };
      if (entries.size >= 20) {
        const old = [...entries].find(
          ([, entry]) =>
            entry.batch.state !== 'running' &&
            (entry.batch.state !== 'pending' || entry.batch.expiresAt <= Date.now()),
        );
        if (!old) return { ok: false, code: 'UNAVAILABLE' };
        entries.delete(old[0]);
      }
      const batch: GenerationBatch = {
        id: crypto.randomUUID(),
        projectId: request.projectId,
        sessionId: request.sessionId,
        expiresAt: Date.now() + 10 * 60000,
        state: 'pending',
        items: [],
      };
      const signatures: string[] = [],
        requests: string[] = [];
      for (const node of selected as CanvasNode[]) {
        const model = String(node[modelKey(node.type)]);
        if (
          !blocks.some((block) =>
            block.media.some(
              (media) =>
                media.kind === node.type.toLowerCase() &&
                media.models.some((item) => item.name === model && item.configured),
            ),
          )
        )
          return { ok: false, code: 'UNAVAILABLE' };
        const dependencies = inputs(nodes, node.id);
        if (dependencies.some((input) => input.status === 'loading' || input.generationAttemptId))
          return { ok: false, code: 'CONFLICT' };
        const dependsOn = dependencies.slice(1).filter(input => command.nodeIds.includes(input.id)).map(input => input.id);
        const prepared = await prepareCanvasGenerationRequest(
          nodes,
          node,
          request.projectId,
          models,
        );
        if (!Number.isSafeInteger(Number('generateCount' in prepared ? prepared.generateCount : 1)))
          return { ok: false, code: 'INVALID' };
        signatures.push(JSON.stringify(dependencies));
        requests.push(JSON.stringify(prepared));
        const labels: Record<string, string> = {
          prompt: '提示词',
          resolution: '分辨率',
          aspectRatio: '比例',
          duration: '时长（秒）',
          generateCount: '生成数量',
          imageMode: '图片模式',
          videoMode: '视频模式',
          audioMode: '音频模式',
          languageMode: '文本模式',
          quality: '质量',
          detail: '细节',
          web_search: '联网搜索',
          lyrics: '歌词',
        };
        modelParameters(node.type, model).forEach((item) => {
          labels[item.key] = item.label;
        });
        const display = Object.entries(prepared)
          .filter(
            ([key, value]) =>
              ![
                'nodeId',
                'projectId',
                'cost',
                'imageModel',
                'videoModel',
                'audioModel',
                'textModel',
                'videoUrl',
              ].includes(key) && ['string', 'number', 'boolean'].includes(typeof value),
          )
          .map(([key, value]) => `${labels[key] || key}：${value}`)
          .join('\n');
        batch.items.push({
          nodeId: node.id,
          title: String(node.title || node.id),
          model,
          parameters: dependsOn.length ? `${display}\n关联输入使用本批上游成功后的新结果。` : display,
          count: Number('generateCount' in prepared ? prepared.generateCount : 1),
          references: dependencies.slice(1).map((input) => String(input.title || input.id)),
          dependsOn,
          state: 'pending',
        });
      }
      if (batch.items.reduce((sum, item) => sum + item.count, 0) > 100)
        return { ok: false, code: 'INVALID' };
      const after = await read(request);
      if (!active(request) || signal?.aborted || !after.ok || after.revision !== command.revision)
        return { ok: false, code: 'CONFLICT' };
      const record = journal ? await journal.prepare(batch) : undefined;
      if (!active(request) || signal?.aborted) return { ok: false, code: 'UNCONFIRMED' };
      entries.set(batch.id, { batch, signatures, requests, record });
      if (entries.size > 20) {
        const old = [...entries].find(
          ([, entry]) => !['pending', 'running'].includes(entry.batch.state),
        );
        if (old) entries.delete(old[0]);
      }
      publish();
      return {
        ok: true,
        revision: after.revision,
        generationPlanId: batch.id,
        generationState: 'awaiting-approval',
      };
    } catch {
      return { ok: false, code: 'UNAVAILABLE' };
    }
  }
  const control: CanvasActionHandler = (request, signal) => {
    if (!validCanvasControl(request.command)) return { ok: false, code: 'INVALID' };
    if (!['models', 'prepareGeneration'].includes(request.command.action))
      return execute(request, signal);
    const signature = JSON.stringify(request);
    const prior = receipts.get(request.requestId);
    if (prior)
      return prior.signature === signature ? prior.promise : { ok: false, code: 'INVALID' };
    const promise = handle(request, signal);
    receipts.set(request.requestId, { signature, promise });
    if (receipts.size > 100) receipts.delete(receipts.keys().next().value!);
    return promise;
  };
  // This method is held by the UI only. It is deliberately absent from canvas_control.
  async function approve(id: string, authorizationId?: string) {
    const entry = entries.get(id);
    if (!entry || entry.batch.state !== 'pending' || entry.batch.recovered) return;
    const { batch, signatures, requests } = entry;
    if (Date.now() >= batch.expiresAt) {
      batch.items.forEach((item) => {
        item.state = 'stopped';
      });
      batch.state = 'finished';
      publish();
      return;
    }
    batch.state = 'running';
    batch.authorizationId = authorizationId;
    publish(); // Claim before the first await; duplicate clicks cannot resubmit.
    const unchanged = (index: number) => {
      const runtime = getRuntime();
      try {
        return (
          batch.state === 'running' &&
          runtime?.projectId === batch.projectId &&
          JSON.stringify(inputs(runtime.nodes(), batch.items[index].nodeId)) === signatures[index]
        );
      } catch {
        return false;
      }
    };
    try {
      if (!batch.items.every((_, index) => unchanged(index))) return;
      if (journal && entry.record) entry.record = await journal.claim(entry.record);
      for (const [index, item] of batch.items.entries()) {
        if (!unchanged(index)) break;
        if (item.dependsOn?.length) {
          const runtime = getRuntime()!, nodes = runtime.nodes(), target = nodes.find(node => node.id === item.nodeId)!;
          requests[index] = JSON.stringify(await prepareCanvasGenerationRequest(nodes, target, batch.projectId, models));
          if (!unchanged(index)) break;
        }
        const originalNode = getRuntime()!.nodes().find(node => node.id === item.nodeId)!;
        let submitted = false;
        await getRuntime()!.generate(item.nodeId, {
          authorizationId,
          planId: journal ? batch.id : undefined,
          valid: () => unchanged(index),
          request: requests[index],
          reserve: async attemptId => {
            if (journal && entry.record) entry.record = await journal.record(entry.record, item.nodeId, 'submitted', attemptId);
          },
          submitted: () => {
            submitted = true;
            item.state = 'submitted';
            publish();
          },
        });
        const node =
          getRuntime()?.projectId === batch.projectId
            ? getRuntime()!
                .nodes()
                .find((node) => node.id === item.nodeId)
            : undefined;
        item.state = !submitted
          ? 'stopped'
          : node?.status === 'success' && !node.generationAttemptId
            ? 'success'
            : node?.status === 'error' && !node.generationAttemptId
              ? 'failed'
              : 'unconfirmed';
        if (item.state === 'success' && node) {
          if (configuration(originalNode) !== configuration(node)) break;
          for (let next = index + 1; next < batch.items.length; next++) {
            const expected: CanvasNode[] = JSON.parse(signatures[next]);
            signatures[next] = JSON.stringify(expected.map(input => input.id === item.nodeId ? node : input));
          }
        }
        publish();
        if (journal && entry.record) {
          const persisted = entry.record.items.find(candidate => candidate.nodeId === item.nodeId);
          if (persisted?.state === 'submitted') entry.record = await journal.record(entry.record, item.nodeId, ['success', 'failed'].includes(item.state) ? item.state : 'unconfirmed');
        }
        if (item.state !== 'success') break;
      }
    } catch {
      /* No retry. Original generation attempt/recovery remains authoritative. */
    } finally {
      batch.items.forEach((item) => {
        if (item.state === 'pending') item.state = 'stopped';
        else if (item.state === 'submitted') item.state = 'unconfirmed';
      });
      batch.state = 'finished';
      if (journal && entry.record) {
        try { entry.record = await journal.finish(entry.record); }
        catch { batch.items.forEach(item => { if (item.state !== 'success' && item.state !== 'failed') item.state = 'unconfirmed'; }); }
      }
      publish();
    }
  }
  return {
    control,
    approve,
    async restore(projectId: string) {
      if (!journal || getRuntime()?.projectId !== projectId) return;
      let records: GenerationPlanRecord[];
      try { records = await journal.list(projectId); restoreError = ''; }
      catch { restoreError = '批次记录读取失败，已保留原任务；请先核对节点状态，勿重复生成。'; publish(); return; }
      if (getRuntime()?.projectId !== projectId) return;
      for (const record of records) {
        if (entries.has(record.id)) continue;
        const batch: GenerationBatch = { ...record, recovered: true, state: record.state === 'cancelled' ? 'cancelled' : 'finished',
          items: record.items.map(item => ({ ...item, state: item.state === 'submitted' ? 'unconfirmed' : item.state === 'pending' ? 'stopped' : item.state })) };
        entries.set(batch.id, { batch, record, signatures: [], requests: [] });
      }
      publish();
    },
    getSnapshot: () => snapshot,
    getError: () => restoreError,
    cancelSession(sessionId: string) {
      for (const entry of entries.values()) if (entry.batch.sessionId === sessionId && ['pending', 'running'].includes(entry.batch.state)) entry.batch.state = 'cancelled';
      publish();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel: async (id: string) => {
      const entry = entries.get(id);
      if (entry && ['pending', 'running'].includes(entry.batch.state)) {
        entry.batch.state = 'cancelled';
        publish();
        if (journal && entry.record) {
          try { entry.record = await journal.finish(entry.record); } catch { /* Keep local stop; never replay. */ }
        }
      }
    },
  };
}
export type CanvasCreationControl = ReturnType<typeof createCanvasCreationControl>;
