import { validCanvasControl, projectCanvasResult, type CanvasActionRequest, type CanvasResult } from '../../shared/canvasControlProtocol.js';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import { deleteCanvasNodes, cloneCanvasNodes, hasGeneratingCanvasNodes } from '../canvas/canvasClipboard';
import { disconnectCanvasNodes } from '../canvas/canvasConnections';
import { cleanupCanvasGroups, groupCanvasNodes, ungroupCanvasNodes, renameCanvasGroup, type CanvasGroup } from '../canvas/canvasGroups';
import { gridLayoutCanvasNodes } from '../canvas/canvasLayout';

import { configureCanvasModel, modelKey, modeKey, modelParameters } from './canvasModelControl';

type Snapshot = { nodes: CanvasNode[]; groups: CanvasGroup[] };
interface Runtime {
  projectId: string;
  snapshot(): Snapshot;
  create(type: string, point: { x: number; y: number }, projectId: string): CanvasNode;
  commit(before: Snapshot, after: Snapshot): void;
  configure?(nodes: CanvasNode[], id: string, patch: Partial<CanvasNode>): CanvasNode[];
  connect?(nodes: CanvasNode[], sourceId: string, targetId: string, sourcePort?: number): CanvasNode[];
  measure?(node: CanvasNode): { width: number; height: number };
  selection?(): string[];
  focus?(nodeIds: string[]): void;
}

/** One instance per open document. Plans on copies; a failed batch never partially applies. */
export function createCanvasControlExecutor(getRuntime: () => Runtime | null) {
  let fingerprint = '', revision = crypto.randomUUID();
  const receipts = new Map<string, { command: string; result: CanvasResult }>();
  const undo = new Map<string, { before: Snapshot; after: string }>();
  const refresh = (snapshot: Snapshot) => {
    const next = JSON.stringify(snapshot);
    if (next !== fingerprint) { fingerprint = next; revision = crypto.randomUUID(); }
  };
  return (request: CanvasActionRequest, preparedAsset?: CanvasNode | CanvasNode[]): CanvasResult => {
    const runtime = getRuntime();
    if (!Number.isFinite(request.expiresAt) || request.expiresAt <= Date.now()) return { ok: false, code: 'UNCONFIRMED' };
    if (!runtime || runtime.projectId !== request.projectId) return { ok: false, code: 'UNAVAILABLE' };
    if (!validCanvasControl(request.command)) return { ok: false, code: 'INVALID' };
    const signature = JSON.stringify([request.projectId, request.sessionId, request.command]);
    const previous = receipts.get(request.requestId);
    if (previous) return previous.command === signature ? previous.result : { ok: false, code: 'INVALID' };
    const current = runtime.snapshot();
    refresh(current);
    const command = request.command;
    if (command.action === 'budgets' || command.action === 'prepareBudget' || command.action === 'revokeBudget' || command.action === 'runGeneration' || command.action === 'product' || command.action === 'workflows') return { ok: false, code: 'UNAVAILABLE' };
    if (command.action === 'assets' || command.action === 'models' || command.action === 'prepareGeneration' || command.action === 'projects' || command.action === 'project' || command.action === 'tasks' || command.action === 'cancelTask') return { ok: false, code: 'UNAVAILABLE' };
    if (command.action === 'read') {
      try { return projectCanvasResult({ ok: true, revision, nodes: current.nodes.map(node => ({ ...node, parameters: JSON.stringify(Object.fromEntries(modelParameters(node.type, String(node[modelKey(node.type)] || '')).map(parameter => [parameter.key, node[parameter.key === 'mode' ? modeKey(node.type) : parameter.key] ?? parameter.default]))) })), groups: current.groups, selectedNodeIds: runtime.selection?.() || [] }); }
      catch { return { ok: false, code: 'UNAVAILABLE' }; }
    }
    if (command.action === 'focus') {
      if (!runtime.focus) return { ok: false, code: 'UNAVAILABLE' };
      if (command.nodeIds.some(id => !current.nodes.some(node => node.id === id))) return { ok: false, code: 'NOT_FOUND' };
      runtime.focus(command.nodeIds);
      return { ok: true, revision };
    }
    if (command.revision !== revision) return { ok: false, code: 'CONFLICT' };
    let next = structuredClone(current);
    const created: Array<{ ref: string; id: string }> = [];
    if (command.action === 'workflow' && command.operation === 'configure') {
      if (!preparedAsset || Array.isArray(preparedAsset) || preparedAsset.id !== command.nodeId || preparedAsset.projectId !== runtime.projectId) return { ok: false, code: 'INVALID' };
      const index = next.nodes.findIndex(node => node.id === command.nodeId && node.kind === 'workflow' && node.status !== 'loading');
      if (index < 0) return { ok: false, code: 'UNAVAILABLE' };
      next.nodes[index] = preparedAsset;
    } else if (command.action === 'importAsset' || command.action === 'media' || command.action === 'workflow') {
      if (!preparedAsset) return { ok: false, code: 'UNAVAILABLE' };
      const assets = Array.isArray(preparedAsset) ? preparedAsset : [preparedAsset];
      if (!assets.length || assets.length > 100 || new Set(assets.map(node => node.id)).size !== assets.length || assets.some(asset => asset.projectId !== runtime.projectId || next.nodes.some(node => node.id === asset.id))) return { ok: false, code: 'INVALID' };
      next.nodes.push(...assets);
      assets.forEach((asset, index) => created.push({ ref: command.action === 'importAsset' ? command.assetId : command.action === 'workflow' ? command.definitionId : `${command.nodeId}:${index}`, id: asset.id }));
    } else if (command.action === 'undo') {
      const original = undo.get(command.operationId);
      if (!original) return { ok: false, code: 'NOT_FOUND' };
      if (original.after !== fingerprint) return { ok: false, code: 'CONFLICT' };
      next = structuredClone(original.before);
    } else {
      const ids = new Map<string, string>();
      const resolve = (id: string) => ids.get(id) || id;
      const availableRef = (ref: string) => !ids.has(ref) && !next.nodes.some(node => node.id === ref) && !next.groups.some(group => group.id === ref);
      for (const operation of command.operations) {
        if (operation.kind === 'create') {
          if (!availableRef(operation.ref)) return { ok: false, code: 'INVALID' };
          const node = runtime.create(operation.type, { x: operation.x, y: operation.y }, runtime.projectId);
          node.title = operation.title || '';
          node.prompt = operation.prompt || '';
          next.nodes.push(node);
          ids.set(operation.ref, node.id);
          created.push({ ref: operation.ref, id: node.id });
        } else if (operation.kind === 'connect' || operation.kind === 'disconnect') {
          const sourceId = resolve(operation.sourceId), targetId = resolve(operation.targetId);
          if (!next.nodes.some(node => node.id === sourceId) || !next.nodes.some(node => node.id === targetId)) return { ok: false, code: 'NOT_FOUND' };
          if (operation.kind === 'connect') {
            if (!runtime.connect) return { ok: false, code: 'UNAVAILABLE' };
            // Following incoming edges from the proposed source must never reach the target.
            const pending = [sourceId], seen = new Set<string>();
            while (pending.length) {
              const id = pending.pop()!;
              if (id === targetId) return { ok: false, code: 'INVALID' };
              if (seen.has(id)) continue;
              seen.add(id);
              pending.push(...(next.nodes.find(node => node.id === id)?.parentIds || []).filter(Boolean));
            }
            const connected = runtime.connect(next.nodes, sourceId, targetId, operation.sourcePort);
            if (connected === next.nodes) return { ok: false, code: 'INVALID' };
            next.nodes = connected;
          } else {
            const target = next.nodes.find(node => node.id === targetId)!;
            if (operation.targetPort !== undefined && target.parentIds?.[operation.targetPort] !== sourceId) return { ok: false, code: 'NOT_FOUND' };
            if (!target.parentIds?.includes(sourceId)) return { ok: false, code: 'NOT_FOUND' };
            next.nodes = disconnectCanvasNodes(next.nodes, { parentId: sourceId, childId: targetId, portIndex: operation.targetPort });
          }
        } else if (operation.kind === 'group' || operation.kind === 'arrange') {
          const nodeIds = operation.nodeIds.map(resolve);
          if (new Set(nodeIds).size !== nodeIds.length || nodeIds.some(id => !next.nodes.some(node => node.id === id))) return { ok: false, code: 'NOT_FOUND' };
          if (operation.kind === 'group') {
            if (!availableRef(operation.ref)) return { ok: false, code: 'INVALID' };
            const groupId = crypto.randomUUID();
            next = groupCanvasNodes(next, nodeIds, { groupId, label: operation.label });
            ids.set(operation.ref, groupId);
            created.push({ ref: operation.ref, id: groupId });
          } else {
            if (!runtime.measure) return { ok: false, code: 'UNAVAILABLE' };
            const measure = runtime.measure;
            next.nodes = gridLayoutCanvasNodes(next.nodes, nodeIds, operation.columns, { getWidth: node => measure(node).width, getHeight: node => measure(node).height });
          }
        } else if (operation.kind === 'ungroup' || operation.kind === 'renameGroup') {
          const id = resolve(operation.groupId);
          if (!next.groups.some(group => group.id === id)) return { ok: false, code: 'NOT_FOUND' };
          if (operation.kind === 'ungroup') next = ungroupCanvasNodes(next, id);
          else next.groups = renameCanvasGroup(next.groups, id, operation.label);
        } else if (operation.kind === 'duplicate') {
          const originals = operation.nodes.map(item => next.nodes.find(node => node.id === resolve(item.nodeId)));
          if (originals.some(node => !node)) return { ok: false, code: 'NOT_FOUND' };
          if (new Set(originals.map(node => node!.id)).size !== originals.length) return { ok: false, code: 'INVALID' };
          if (hasGeneratingCanvasNodes(originals as CanvasNode[]) || operation.nodes.some(item => !availableRef(item.ref))) return { ok: false, code: 'INVALID' };
          const copied = cloneCanvasNodes(originals as CanvasNode[], { offset: 0, createId: () => crypto.randomUUID(), targetPoint: { x: operation.x, y: operation.y }, preserveParentConnections: true });
          next.nodes.push(...copied.newNodes);
          operation.nodes.forEach((item, index) => {
            const id = copied.newNodes[index].id;
            ids.set(item.ref, id); created.push({ ref: item.ref, id });
          });
        } else {
          const id = ids.get(operation.nodeId) || operation.nodeId;
          const index = next.nodes.findIndex(node => node.id === id);
          if (index < 0) return { ok: false, code: 'NOT_FOUND' };
          if (operation.kind === 'configure') {
            if (!runtime.configure) return { ok: false, code: 'UNAVAILABLE' };
            const patch = configureCanvasModel(next.nodes[index], operation.model, operation.parameters);
            if (!patch) return { ok: false, code: 'INVALID' };
            next.nodes = runtime.configure(next.nodes, id, patch);
          } else if (operation.kind === 'update') next.nodes[index] = { ...next.nodes[index], ...operation.patch };
          else {
            next.nodes = deleteCanvasNodes(next.nodes, [id]);
            next.groups = next.groups.map(group => ({ ...group, nodeIds: group.nodeIds.filter(nodeId => nodeId !== id) }));
            next = cleanupCanvasGroups(next);
          }
        }
      }
    }
    if (next.nodes.some(node => !Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 1000000 || Math.abs(node.y) > 1000000)) return { ok: false, code: 'INVALID' };
    // Validate the outgoing size before committing anything.
    if (created.length > 100) return { ok: false, code: 'UNAVAILABLE' };
    const operationId = crypto.randomUUID();
    runtime.commit(current, next);
    refresh(runtime.snapshot());
    undo.set(operationId, { before: structuredClone(current), after: fingerprint });
    if (command.action === 'undo') undo.delete(command.operationId);
    const result: CanvasResult = { ok: true, revision, operationId, created };
    receipts.set(request.requestId, { command: signature, result });
    if (receipts.size > 100) receipts.delete(receipts.keys().next().value!);
    if (undo.size > 50) undo.delete(undo.keys().next().value!);
    return result;
  };
}
