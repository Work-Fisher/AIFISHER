import type { WorkflowCanvasBlueprint } from '../local/workflowManagerClient';
import type { WorkflowCanvasNodesAdapter } from '../local/workflowCanvasNodes';

export interface DramaAssetOutput {
  mediaId: string;
  url: string;
  mediaKind: 'image';
}

export interface DramaAssetExecution {
  assetId: string;
  attemptId: string;
  attemptNumber: number;
  stateRevision?: number;
  planRevision: number;
  name: string;
  kind: 'character' | 'scene';
  width: number;
  height: number;
  status: 'pending' | 'success' | 'failed' | 'cancelled' | 'unknown';
  phase?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  remoteMayContinue?: boolean;
  runId?: string;
  outputs: DramaAssetOutput[];
}

export interface DramaExecutionSnapshot {
  planId: string;
  projectId: string;
  planRevision: number;
  assets: DramaAssetExecution[];
}

export interface DramaCanvasComposition extends DramaExecutionSnapshot {
  assets: Array<DramaAssetExecution & DramaAssetOutput>;
  segments: Array<{
    segmentId: string;
    title: string;
    blueprint: WorkflowCanvasBlueprint;
    values: Record<string, unknown>;
    inputBindings: Array<{
      bindingKey: string;
      assetId: string;
      attemptId: string;
      mediaId: string;
      picture: number;
      mediaKind: 'image';
    }>;
  }>;
}

interface DramaOrigin {
  planId: string;
  projectId: string;
  planRevision: number;
  kind: 'asset' | 'segment';
  assetId?: string;
  segmentId?: string;
  attemptId?: string;
  attemptNumber?: number;
  state?: DramaAssetExecution['status'];
  stateRevision?: number;
  layoutAnchor?: { x: number; y: number };
}

export type DramaCanvasNode = Record<string, unknown> & { id: string; type: string; dramaOrigin?: DramaOrigin };

interface PlanForCanvas {
  id: string;
  projectId: string;
  revision: number;
  assets: Array<{ id: string; prompt: string }>;
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) throw new Error('制作节点标识无效');
  return value;
}

export function dramaAssetNodeId(planId: string, assetId: string, attemptId: string): string {
  // Length-prefixed components avoid ambiguous concatenation; no mutable display labels in IDs.
  return `drama-asset:${[planId, assetId, attemptId].map((part) => `${safeId(part).length}:${part}`).join(':')}`;
}

function segmentNodeId(planId: string, revision: number, segmentId: string): string {
  return `drama-segment:${safeId(planId)}:${revision}:${safeId(segmentId)}`;
}

function localImage(url: string, projectId: string): boolean {
  const prefix = `/library/media/${encodeURIComponent(projectId)}/images/`;
  return url.startsWith(prefix) && /^[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif|avif)$/i.test(url.slice(prefix.length));
}

export function buildDramaAssetNodes(
  plan: PlanForCanvas,
  execution: DramaExecutionSnapshot,
): DramaCanvasNode[] {
  if (plan.id !== execution.planId || plan.projectId !== execution.projectId || plan.revision !== execution.planRevision) {
    throw new Error('制作计划或项目已经变化，请刷新状态');
  }
  return execution.assets.filter((asset) => asset.planRevision === plan.revision).map((asset) => {
    const index = plan.assets.findIndex((item) => item.id === asset.assetId);
    const definition = plan.assets[index];
    if (!definition) throw new Error('生成结果不属于当前制作计划');
    const output = asset.outputs[0];
    if (asset.status === 'success' && (!output || !localImage(output.url, plan.projectId) || !output.mediaId)) {
      throw new Error('生成图像没有落入当前项目，不能加入画布');
    }
    const ratio = Number(asset.width) / Number(asset.height);
    const width = 340;
    return {
      id: dramaAssetNodeId(plan.id, asset.assetId, asset.attemptId),
      type: 'Upload Image', title: asset.name, prompt: definition.prompt, projectId: plan.projectId,
      x: 120 + (index % 3) * 420, y: 140 + Math.floor(index / 3) * 680,
      width, height: Math.max(180, Math.min(610, width / (Number.isFinite(ratio) && ratio > 0 ? ratio : 1))),
      status: asset.status === 'pending' ? 'loading' : asset.status === 'unknown' ? 'failed' : asset.status,
      progress: asset.status === 'success' ? 100 : 0,
      model: 'Upload', mediaType: 'image', uploadPending: asset.status === 'pending',
      parentIds: [], sourcePortIndices: [],
      ...(asset.status === 'success' ? { resultUrl: output.url,
        resultUrls: asset.outputs.map((item) => {
          if (!localImage(item.url, plan.projectId)) throw new Error('输出素材不属于当前项目');
          return item.url;
        }), assetId: output.mediaId } : {}),
      errorMessage: asset.error || '',
      dramaOrigin: { planId: plan.id, projectId: plan.projectId, planRevision: plan.revision,
        kind: 'asset', assetId: asset.assetId, attemptId: asset.attemptId,
        attemptNumber: asset.attemptNumber, state: asset.status, stateRevision: asset.stateRevision },
    };
  });
}

export function buildDramaCanvasNodes(
  composition: DramaCanvasComposition,
  adapter: Pick<WorkflowCanvasNodesAdapter, 'createNode' | 'getInputSlots'>,
): DramaCanvasNode[] {
  safeId(composition.planId); safeId(composition.projectId);
  const plan = { id: composition.planId, projectId: composition.projectId, revision: composition.planRevision,
    assets: composition.assets.map((asset) => ({ id: asset.assetId, prompt: '' })) };
  const nodes = buildDramaAssetNodes(plan, composition);
  const byReference = new Map(composition.assets.map((asset) => [`${asset.assetId}:${asset.attemptId}`, asset]));
  for (const [index, segment] of composition.segments.entries()) {
    if (segment.blueprint.workflowRef.verificationStatus !== 'draft' || segment.blueprint.workflowRef.attestationId) {
      throw new Error('文戏组合必须创建待首次验证的工作流草稿');
    }
    const workflow = adapter.createNode(structuredClone(segment.blueprint), { x: 1520, y: 140 + index * 680 });
    workflow.id = segmentNodeId(composition.planId, composition.planRevision, segment.segmentId);
    workflow.title = segment.title;
    workflow.parameterValues = structuredClone(segment.values);
    const slots = adapter.getInputSlots(workflow);
    const used = new Set<number>();
    for (const binding of segment.inputBindings) {
      const source = byReference.get(`${binding.assetId}:${binding.attemptId}`);
      if (!source || source.mediaId !== binding.mediaId || source.status !== 'success') {
        throw new Error('文戏引用的资产版本已经变化');
      }
      const slot = slots.find((item) => item.bindingKey === binding.bindingKey && item.itemIndex === 0 && item.mediaKind === 'image');
      if (!slot || used.has(slot.slotIndex)) throw new Error('工作流图片输入槽已经变化，不能猜测连接顺序');
      used.add(slot.slotIndex);
      workflow.parentIds[slot.slotIndex] = dramaAssetNodeId(composition.planId, binding.assetId, binding.attemptId);
      workflow.sourcePortIndices[slot.slotIndex] = 0;
    }
    nodes.push({ ...workflow, projectId: composition.projectId,
      dramaOrigin: { planId: composition.planId, projectId: composition.projectId, planRevision: composition.planRevision,
        kind: 'segment', segmentId: segment.segmentId } });
  }
  return nodes;
}

/** Apply only inside the stable canvas' functional transaction, never a stale UI snapshot. */
export function mergeDramaCanvasNodes(
  current: readonly DramaCanvasNode[],
  incoming: readonly DramaCanvasNode[],
  { projectId, expectedProjectId }: { projectId: string; expectedProjectId: string },
): DramaCanvasNode[] {
  if (!projectId || projectId !== expectedProjectId) throw new Error('当前项目已切换，未写入生成结果');
  const byId = new Map(current.map((node) => [node.id, node]));
  const output = [...current];
  const positions = new Map(current.map((node, index) => [node.id, index]));
  const anchors = new Map<string, { x: number; y: number }>();
  for (const node of current) {
    const origin = node.dramaOrigin;
    if (origin?.projectId === projectId && !anchors.has(origin.planId)) {
      anchors.set(origin.planId, origin.layoutAnchor || { x: 0, y: 0 });
    }
  }
  for (const candidate of incoming) {
    const origin = candidate.dramaOrigin;
    if (!origin || origin.projectId !== projectId || candidate.projectId !== projectId) {
      throw new Error('制作结果不属于当前项目');
    }
    const previous = byId.get(candidate.id);
    if (!previous) {
      const copy = structuredClone(candidate);
      let anchor = anchors.get(origin.planId);
      if (!anchor) {
        const rightEdges = output.map((node) => Number(node.x) + Math.max(0, Number(node.width) || 0))
          .filter((value) => Number.isFinite(value) && Math.abs(value) < 1_000_000);
        anchor = { x: rightEdges.length ? Math.max(...rightEdges) + 180 - 120 : 0, y: 0 };
        anchors.set(origin.planId, anchor);
      }
      copy.x = Number(copy.x) + anchor.x;
      copy.y = Number(copy.y) + anchor.y;
      copy.dramaOrigin = { ...origin, layoutAnchor: { ...anchor } };
      positions.set(copy.id, output.length);
      byId.set(copy.id, copy);
      output.push(copy);
      continue;
    }
    const prior = previous.dramaOrigin;
    if (!prior || prior.planId !== origin.planId || prior.projectId !== origin.projectId || prior.kind !== origin.kind) {
      throw new Error('画布已有不同来源的同名节点，未覆盖用户内容');
    }
    // Composition is insert-once: repeated clicks cannot reset edited parameters, ports, geometry or results.
    if (origin.kind === 'segment') continue;
    if (prior.attemptId !== origin.attemptId || prior.assetId !== origin.assetId
      || prior.planRevision !== origin.planRevision || prior.attemptNumber !== origin.attemptNumber) continue;
    if ((prior.stateRevision || 0) > (origin.stateRevision || 0)) continue;
    if (prior.state === 'success' || (['failed', 'cancelled'].includes(prior.state || '') && origin.state === 'pending')) continue;
    const next: DramaCanvasNode = { ...previous,
      status: candidate.status, progress: candidate.progress, errorMessage: candidate.errorMessage,
      uploadPending: candidate.uploadPending,
      dramaOrigin: { ...structuredClone(origin), layoutAnchor: prior.layoutAnchor || anchors.get(origin.planId) },
      ...(origin.state === 'success' ? { resultUrl: candidate.resultUrl, resultUrls: candidate.resultUrls,
        assetId: candidate.assetId } : {}),
    };
    output[positions.get(next.id)!] = next;
    byId.set(next.id, next);
  }
  return output;
}
