import type { WorkflowCanvasBlueprint } from '../local/workflowManagerClient';

export interface DramaAsset {
  id: string; kind: 'character' | 'scene'; name: string; prompt: string;
  englishName?: string; voice?: string; width: number; height: number; questions: string[];
}
export interface DramaSegment {
  id: string; title: string; duration: number; characterIds: string[]; sceneId: string;
  blocking: string; endState: string;
  shots: Array<{ action: string; dialogue: Array<{ characterId: string; text: string; voiceover?: boolean }> }>;
}
export interface DramaPlan {
  schemaVersion: 1; id: string; revision: number; projectId: string; bundleId: string; bundleVersion: string;
  title: string; script: { name: string; text: string }; assets: DramaAsset[]; segments: DramaSegment[];
  questions: string[]; approvedRevision?: number; createdAt: string; updatedAt: string;
}
export interface DramaAssetExecution {
  planId: string; projectId: string; planRevision: number; assetId: string; attemptId: string;
  attemptNumber: number; kind: 'character' | 'scene'; name: string; width: number; height: number;
  stateRevision?: number;
  status: 'pending' | 'success' | 'failed' | 'cancelled' | 'unknown'; phase: string; retryable: boolean;
  remoteMayContinue?: boolean; runId?: string; error?: string; code?: string;
  outputs: Array<{ mediaId: string; url: string; mediaKind: 'image' }>;
}
export interface DramaExecution {
  planId: string; projectId: string; planRevision: number; assets: DramaAssetExecution[];
}
export interface DramaComposition {
  planId: string; projectId: string; planRevision: number;
  assets: Array<DramaAssetExecution & { mediaId: string; url: string; mediaKind: 'image' }>;
  segments: Array<{
    segmentId: string; title: string; blueprint: WorkflowCanvasBlueprint; values: Record<string, unknown>;
    inputBindings: Array<{ bindingKey: string; assetId: string; attemptId: string; mediaId: string; picture: number; mediaKind: 'image' }>;
  }>;
}

export class DramaClientError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); this.name = 'DramaClientError'; }
}

export function createDramaClient(fetcher: typeof fetch = globalThis.fetch) {
  const base = '/api/agent/drama';
  async function call<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetcher(`${base}${route}`, {
      method, cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    let payload: T & { error?: string; code?: string };
    try { payload = await response.json(); }
    catch { throw new DramaClientError('本机返回了无法识别的响应，请查询任务状态，不要重复提交。', 'DRAMA_RESPONSE_INVALID', response.status); }
    if (!response.ok) throw new DramaClientError(payload.error || '文戏制作请求失败。', payload.code || 'DRAMA_REQUEST_FAILED', response.status);
    return payload;
  }
  const route = (planId: string) => `/plans/${encodeURIComponent(planId)}`;
  return {
    async importScript(file: File) {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('无法读取剧本文件。'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.readAsDataURL(file);
      });
      return (await call<{ script: { name: string; text: string } }>('/script', 'POST', { name: file.name, contentBase64 })).script;
    },
    async create(input: { projectId: string; script: { name: string; text: string }; model: string; requestId: string }) {
      return (await call<{ plan: DramaPlan }>('/plans', 'POST', { ...input, confirmPaidExecution: true, maxPlanningCalls: 1 })).plan;
    },
    async list(projectId: string) { return (await call<{ plans: DramaPlan[] }>(`/plans?projectId=${encodeURIComponent(projectId)}`)).plans; },
    async get(id: string, projectId: string) { return (await call<{ plan: DramaPlan }>(`${route(id)}?projectId=${encodeURIComponent(projectId)}`)).plan; },
    async save(plan: DramaPlan) {
      return (await call<{ plan: DramaPlan }>(route(plan.id), 'PUT', {
        projectId: plan.projectId, expectedRevision: plan.revision,
        plan: { title: plan.title, assets: plan.assets, segments: plan.segments, questions: plan.questions },
      })).plan;
    },
    async approve(plan: DramaPlan) { return (await call<{ plan: DramaPlan }>(`${route(plan.id)}/approve`, 'POST', { projectId: plan.projectId, expectedRevision: plan.revision })).plan; },
    async execution(plan: DramaPlan) {
      return call<DramaExecution>(`${route(plan.id)}/execution?projectId=${encodeURIComponent(plan.projectId)}`);
    },
    async generate(plan: DramaPlan, assetId: string, attemptId: string, retryOfAttemptId?: string) {
      return call<DramaAssetExecution>(`${route(plan.id)}/assets/${encodeURIComponent(assetId)}/generate`, 'POST', {
        projectId: plan.projectId, planRevision: plan.revision, attemptId,
        confirmPaidExecution: true, maxAssets: 1, ...(retryOfAttemptId ? { retryOfAttemptId } : {}),
      });
    },
    async compose(plan: DramaPlan) {
      return call<DramaComposition>(`${route(plan.id)}/compose`, 'POST', {
        projectId: plan.projectId, planRevision: plan.revision, confirmAssets: true,
      });
    },
  };
}
export type DramaClient = ReturnType<typeof createDramaClient>;
