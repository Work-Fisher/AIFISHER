import type { GenerationBatch } from './canvasCreationControl';
export interface GenerationPlanRecord extends GenerationBatch { revision: number }
export function createGenerationPlanClient(fetcher: typeof fetch = globalThis.fetch) {
  const base = '/api/agent/plans';
  async function request<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    if (!response.ok) throw Error('批次记录未确认，请核对原任务。'); return response.json();
  }
  return {
    list: (projectId: string) => request<GenerationPlanRecord[]>(`${base}?projectId=${encodeURIComponent(projectId)}`),
    prepare: (batch: GenerationBatch) => request<GenerationPlanRecord>(base, batch),
    claim: (batch: GenerationPlanRecord) => request<GenerationPlanRecord>(`${base}/${encodeURIComponent(batch.id)}/claim`, { projectId: batch.projectId, revision: batch.revision }),
    record: (batch: GenerationPlanRecord, nodeId: string, state: string, attemptId?: string) => request<GenerationPlanRecord>(`${base}/${encodeURIComponent(batch.id)}/record`, { projectId: batch.projectId, revision: batch.revision, nodeId, state, attemptId }),
    finish: (batch: GenerationPlanRecord) => request<GenerationPlanRecord>(`${base}/${encodeURIComponent(batch.id)}/finish`, { projectId: batch.projectId, revision: batch.revision }),
  };
}
export type GenerationPlanClient = ReturnType<typeof createGenerationPlanClient>;
