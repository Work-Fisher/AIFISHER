import { createWorkflowManagerClient } from '../local/workflowManagerClient';
import { createWorkflowCanvasNodes, normalizeNumericParameterValues } from '../local/workflowCanvasNodes';
import type { WorkflowCanvasBlueprint } from '../local/workflowManagerClient';
import type { CanvasNode } from '../nodes/canvasNodeOperations';
import type { createCanvasControlExecutor } from './canvasControlExecutor';
import { validCanvasControl, projectCanvasResult, type CanvasActionHandler, type CanvasResult } from '../../shared/canvasControlProtocol.js';

export function createCanvasWorkflowControl(execute: CanvasActionHandler, insert: ReturnType<typeof createCanvasControlExecutor>, getRuntime: () => { projectId: string; nodes(): CanvasNode[] } | null, fetcher: typeof fetch = fetch): CanvasActionHandler {
  const client = createWorkflowManagerClient(fetcher), adapter = createWorkflowCanvasNodes(client), receipts = new Map<string, { signature: string; promise: Promise<CanvasResult> }>();
  const handle: CanvasActionHandler = async (request, signal) => {
    const active = () => !signal?.aborted && Date.now() < request.expiresAt && getRuntime()?.projectId === request.projectId;
    if (!active()) return { ok: false, code: 'UNAVAILABLE' };
    const before = await execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'read' } }), command = request.command;
    if (!before.ok) return before;
    if (command.action !== 'workflows' && command.action !== 'workflow') return { ok: false, code: 'INVALID' };
    if (command.action === 'workflow' && command.revision !== before.revision) return { ok: false, code: 'CONFLICT' };
    try {
      if (command.action === 'workflows') {
        const definitions = await client.listDefinitions(), offset = command.offset || 0;
        if (!active()) return { ok: false, code: 'UNAVAILABLE' };
        return projectCanvasResult({ ok: true, revision: before.revision, workflows: definitions.slice(offset, offset + 50).map(item => ({ id: item.id, name: item.name })), nextOffset: offset + 50 < definitions.length ? offset + 50 : null });
      }
      if (command.operation === 'configure') {
        const node = getRuntime()!.nodes().find(node => node.id === command.nodeId);
        if (!node || node.kind !== 'workflow' || node.status === 'loading') return { ok: false, code: 'UNAVAILABLE' };
        const schema = Array.isArray(node.parameterSchema) ? node.parameterSchema as WorkflowCanvasBlueprint['parameterSchema'] : [];
        const values: Record<string, unknown> = { ...command.parameters };
        for (const [key, value] of Object.entries(command.parameters)) {
          const parameter = schema.find(parameter => parameter.key === key), control = parameter?.control;
          if (!control) return { ok: false, code: 'INVALID' };
          const kind = String(control.kind).toLowerCase();
          if (kind === 'select' ? !control.options?.some(option => option.id === value)
            : ['number', 'slider'].includes(kind) ? typeof value !== 'number'
            : ['boolean', 'toggle'].includes(kind) ? typeof value !== 'boolean'
            : kind === 'seed' ? !(typeof value === 'number' ? Number.isSafeInteger(value) : value && typeof value === 'object')
            : typeof value !== 'string') return { ok: false, code: 'INVALID' };
        }
        try { normalizeNumericParameterValues(schema.filter(parameter => Object.hasOwn(values, parameter.key)), values); }
        catch { return { ok: false, code: 'INVALID' }; }
        if (!active()) return { ok: false, code: 'UNAVAILABLE' };
        return insert(request, { ...node, projectId: request.projectId, parameterValues: { ...(node.parameterValues as object || {}), ...values } });
      }
      const snapshot = await client.getEditorSnapshot(command.definitionId);
      if (!active()) return { ok: false, code: 'UNAVAILABLE' };
      if (!snapshot.bindingSet || !snapshot.deployment) return command.operation === 'describe'
        ? projectCanvasResult({ ok: true, revision: before.revision, workflows: [{ id: snapshot.definition.id, name: snapshot.definition.name, ready: false }] }) : { ok: false, code: 'UNAVAILABLE' };
      const blueprint = await client.createCanvasNode(command.definitionId, { bindingSetId: snapshot.bindingSet.id, deploymentId: snapshot.deployment.id, ...(snapshot.attestation ? { attestationId: snapshot.attestation.id } : {}) });
      if (!active()) return { ok: false, code: 'UNAVAILABLE' };
      if (command.operation === 'describe') return projectCanvasResult({ ok: true, revision: before.revision, workflows: [{ id: command.definitionId, name: blueprint.title, ready: true,
        parameters: JSON.stringify({ parameters: blueprint.parameterSchema.map(item => ({ key: item.key, label: item.label, kind: item.control.kind, minimum: item.control.minimum, maximum: item.control.maximum, options: item.control.options })), inputPorts: blueprint.inputPorts.map(({ label, mediaKind, required, portIndex }) => ({ label, mediaKind, required, portIndex })), outputPorts: blueprint.outputPorts.map(({ label, mediaKind, portIndex }) => ({ label, mediaKind, portIndex })) }) }] });
      return insert(request, { ...adapter.createNode(blueprint, { x: command.x, y: command.y }), projectId: request.projectId } as CanvasNode);
    } catch { return { ok: false, code: 'UNAVAILABLE' }; }
  };
  return (request, signal) => {
    if (!validCanvasControl(request.command)) return { ok: false, code: 'INVALID' };
    if (!['workflows', 'workflow'].includes(request.command.action)) return execute(request, signal);
    const signature = JSON.stringify(request), old = receipts.get(request.requestId);
    if (old) return old.signature === signature ? old.promise : { ok: false, code: 'INVALID' };
    if (receipts.size >= 500) return { ok: false, code: 'UNAVAILABLE' };
    const promise = Promise.resolve(handle(request, signal)); receipts.set(request.requestId, { signature, promise }); return promise;
  };
}
