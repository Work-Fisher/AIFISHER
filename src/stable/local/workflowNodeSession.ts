import type * as ReactTypes from 'react';
import type {
  WorkflowCanvasNodeRecord,
  WorkflowCanvasNodesAdapter,
  WorkflowCanvasInputSlot,
} from './workflowCanvasNodes';
import type { WorkflowRun, WorkflowSeedAdvancement } from './workflowManagerClient';
import { WorkflowViewExpiredError } from './workflowRunObserver';

type NodePatch = Partial<WorkflowCanvasNodeRecord>;
type ConnectedNode = Record<string, unknown> & { id: string; type: string };
interface Snapshot {
  node: WorkflowCanvasNodeRecord;
  connectedNodes: ConnectedNode[];
  projectId: string;
}
const workflowRunRequestEvent = 'fisherai:workflow-node-run-request';
type RunRequest = { projectId: string; nodeId: string; accepted: boolean; isCurrent?: () => boolean; resolve(value: boolean): void };
/** Requests the mounted node's existing execution owner; never creates a second runner. */
export function requestWorkflowNodeRun(projectId: string, nodeId: string, isCurrent?: () => boolean): Promise<boolean> {
  return new Promise(resolve => {
    const detail: RunRequest = { projectId, nodeId, accepted: false, isCurrent, resolve };
    window.dispatchEvent(new CustomEvent(workflowRunRequestEvent, { detail }));
    if (!detail.accepted) resolve(false);
  });
}
interface Options {
  getSnapshot(): Snapshot;
  onUpdate(id: string, patch: NodePatch): void;
  onUploading(slot: number | null): void;
}

function definitionKey(node: WorkflowCanvasNodeRecord): string {
  const ref = node.workflowRef;
  return JSON.stringify([
    node.canvasNodeHash,
    ref?.definitionId,
    ref?.bindingSetId,
    ref?.deploymentId,
    ref?.attestationId,
  ]);
}

function needsOriginalRun(node: WorkflowCanvasNodeRecord): boolean {
  const state = node.executionState;
  const cleanup = state?.inputCleanup;
  return (
    node.status === 'loading' ||
    state?.status === 'observing-paused' ||
    (!!cleanup && typeof cleanup === 'object' && 'state' in cleanup && cleanup.state === 'pending')
  );
}

export function createWorkflowNodeSession(adapter: WorkflowCanvasNodesAdapter, options: Options) {
  const initial = options.getSnapshot();
  const initialDefinition = definitionKey(initial.node);
  let disposed = false;
  let operation: object | undefined;
  let cancelPending = false;
  let uploadPending = false;
  const settledRuns = new Set<string>();
  const appliedSeeds = new Set<string>();
  let latest = initial.node;
  let lastProp = latest;
  const current = () => {
    const snapshot = options.getSnapshot();
    return (
      !disposed &&
      snapshot.node.id === initial.node.id &&
      snapshot.projectId === initial.projectId &&
      definitionKey(snapshot.node) === initialDefinition
    );
  };
  const node = () => {
    const next = options.getSnapshot().node;
    if (next !== lastProp) {
      latest = next;
      lastProp = next;
    }
    return latest;
  };
  const patch = (update: NodePatch) => {
    if (!current()) return;
    latest = { ...node(), ...update };
    options.onUpdate(latest.id, update);
  };
  const showError = (error: unknown) => {
    if (!current() || error instanceof WorkflowViewExpiredError) return;
    // Adapter errors already contain the recovery state. Never erase it in the view.
    if (node().errorMessage) return;
    const message = error instanceof Error ? error.message : String(error);
    patch({
      errorMessage: message,
      errorSummary: adapter.getErrorSummary({ ...node(), errorMessage: message }),
      isWorkflowErrorDetailsOpen: false,
    });
  };
  const applySeeds = (run?: WorkflowRun | null) => {
    if (!current()) return;
    const source = node();
    const id = run?.runId ?? source.executionState?.runId;
    const advancements = run?.seedAdvancements ?? source.executionState?.seedAdvancements;
    if (
      typeof id !== 'string' ||
      appliedSeeds.has(id) ||
      !Array.isArray(advancements) ||
      !advancements.length
    )
      return;
    if (source.executionState?.runId !== id) return;
    appliedSeeds.add(id);
    const values = source.parameterValues;
    const next = adapter.applySeedAdvancements(values, advancements as WorkflowSeedAdvancement[]);
    if (next !== values) patch({ parameterValues: next });
  };
  const execute = async (kind: 'run' | 'resume', continuePaused = false, authorized?: () => boolean) => {
    if (!current() || operation || authorized && !authorized()) return;
    const source = node();
    if (kind === 'run' && source.status === 'loading') return;
    const runId = kind === 'resume' ? source.executionState?.runId : undefined;
    if (kind === 'resume' && (typeof runId !== 'string' || settledRuns.has(runId))) return;
    const token = {};
    operation = token;
    let observedId = runId;
    const scope = {
      getNode: node,
      isCurrent: () =>
        current() &&
        operation === token &&
        (!!observedId || !authorized || authorized()) &&
        (!observedId ||
          (node().executionState?.runId === observedId && !settledRuns.has(String(observedId)))),
    };
    const receive = (update: NodePatch) => {
      if (!scope.isCurrent()) return;
      patch(update);
      if (typeof update.executionState?.runId === 'string')
        observedId = update.executionState.runId;
      applySeeds();
    };
    try {
      const snapshot = options.getSnapshot();
      const result =
        kind === 'run'
          ? await adapter.run(source, snapshot.connectedNodes, snapshot.projectId, receive, scope)
          : await adapter.resume(source, receive, scope, continuePaused);
      if (scope.isCurrent()) applySeeds(result);
    } catch (error) {
      if (scope.isCurrent()) showError(error);
    } finally {
      if (operation === token) operation = undefined;
    }
  };
  return {
    dispose() {
      disposed = true;
      operation = undefined;
    },
    patch,
    applySeeds,
    run: (authorized?: () => boolean) => execute('run', false, authorized),
    resume: () => execute('resume', true),
    observe: () => execute('resume'),
    async cancel() {
      if (!current() || cancelPending) return;
      const source = node(),
        runId = source.executionState?.runId;
      if (typeof runId !== 'string') return;
      cancelPending = true;
      const scope = {
        getNode: node,
        isCurrent: () =>
          current() && node().executionState?.runId === runId && !settledRuns.has(runId),
      };
      try {
        const result = await adapter.cancel(
          source,
          (update) => {
            if (scope.isCurrent()) patch(update);
          },
          scope,
        );
        if (scope.isCurrent() && result && result.status !== 'loading') settledRuns.add(runId);
      } catch (error) {
        if (scope.isCurrent()) showError(error);
      } finally {
        cancelPending = false;
      }
    },
    async reconcile() {
      const source = node();
      if (!current() || operation || needsOriginalRun(source)) return;
      try {
        const next = await adapter.reconcileNode(source);
        // A field revision request must not replace edits made while it was in flight.
        if (current() && next && node() === source) patch(next);
      } catch {
        /* A lookup failure cannot invalidate the saved workflow. */
      }
    },
    async upload(slot: WorkflowCanvasInputSlot, file: File) {
      if (!current() || uploadPending || !file) return;
      uploadPending = true;
      const source = node();
      options.onUploading(slot.slotIndex);
      try {
        const uploaded = await adapter.uploadInputAsset(
          source,
          slot.slotIndex,
          file,
          initial.projectId,
        );
        if (!current()) return;
        const latestSlot = adapter
          .getInputSlots(node())
          .find((candidate) => candidate.slotIndex === slot.slotIndex);
        if (!latestSlot || latestSlot.id !== slot.id || node().parentIds[slot.slotIndex]) return;
        window.dispatchEvent(
          new CustomEvent('fisherai:add-workflow-input-node', {
            detail: { workflowNodeId: source.id, slotIndex: slot.slotIndex, sourceNode: uploaded },
          }),
        );
      } catch (error) {
        showError(error);
      } finally {
        uploadPending = false;
        if (current()) options.onUploading(null);
      }
    },
  };
}

export function useWorkflowNodeSession(
  React: Pick<typeof ReactTypes, 'useRef' | 'useEffect' | 'useLayoutEffect'>,
  adapter: WorkflowCanvasNodesAdapter | undefined,
  snapshot: Snapshot,
  onUpdate: Options['onUpdate'],
  onUploading: Options['onUploading'],
) {
  const latestRef = React.useRef({ snapshot, onUpdate, onUploading });
  React.useLayoutEffect(() => {
    latestRef.current = { snapshot, onUpdate, onUploading };
  }, [snapshot, onUpdate, onUploading]);
  const definition = definitionKey(snapshot.node);
  const ownerRef = React.useRef<ReturnType<typeof createWorkflowNodeSession> | null>(null);
  React.useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<RunRequest>).detail;
      if (detail.projectId !== snapshot.projectId || detail.nodeId !== snapshot.node.id || !ownerRef.current) return;
      detail.accepted = true;
      void Promise.resolve(ownerRef.current.run(detail.isCurrent)).then(() => detail.resolve(true), () => detail.resolve(false));
    };
    window.addEventListener(workflowRunRequestEvent, receive);
    return () => window.removeEventListener(workflowRunRequestEvent, receive);
  }, [snapshot.projectId, snapshot.node.id]);
  React.useEffect(() => {
    if (!adapter) return;
    const session = createWorkflowNodeSession(adapter, {
      getSnapshot: () => latestRef.current.snapshot,
      onUpdate: (id, patch) => latestRef.current.onUpdate(id, patch),
      onUploading: (slot) => latestRef.current.onUploading(slot),
    });
    ownerRef.current = session;
    return () => {
      session.dispose();
      if (ownerRef.current === session) ownerRef.current = null;
    };
  }, [adapter, snapshot.node.id, snapshot.projectId, definition]);
  React.useEffect(() => {
    void ownerRef.current?.reconcile();
  }, [adapter, snapshot.node.id, snapshot.projectId, definition]);
  React.useEffect(() => {
    const cleanup = snapshot.node.executionState?.inputCleanup;
    const pendingCleanup =
      !!cleanup && typeof cleanup === 'object' && 'state' in cleanup && cleanup.state === 'pending';
    if (
      snapshot.node.executionState?.runId &&
      (snapshot.node.status === 'loading' || pendingCleanup) &&
      snapshot.node.executionState?.status !== 'observing-paused'
    )
      void ownerRef.current?.observe();
  }, [
    adapter,
    snapshot.node.id,
    snapshot.projectId,
    snapshot.node.executionState?.runId,
    snapshot.node.executionState?.inputCleanup,
    snapshot.node.executionState?.status,
    snapshot.node.status,
    definition,
  ]);
  React.useEffect(() => {
    ownerRef.current?.applySeeds();
  }, [snapshot.node.executionState?.runId, snapshot.node.executionState?.seedAdvancements]);
  const missing = () =>
    onUpdate(snapshot.node.id, { errorMessage: '工作流运行组件尚未加载，请刷新画布后重试' });
  return {
    run: () => ownerRef.current?.run() ?? missing(),
    resume: () => ownerRef.current?.resume() ?? missing(),
    cancel: () => ownerRef.current?.cancel() ?? missing(),
    upload: (slot: WorkflowCanvasInputSlot, file: File) => ownerRef.current?.upload(slot, file),
  };
}
