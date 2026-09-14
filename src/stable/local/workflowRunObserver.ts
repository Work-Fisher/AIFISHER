import type { WorkflowRun } from './workflowManagerClient';
import type { WorkflowCanvasNodeRecord } from './workflowCanvasNodes';

/** An observer belongs to one mounted canvas/node lifetime, never just its saved ID. */
export interface WorkflowRunScope {
  isCurrent(): boolean;
  getNode?(): WorkflowCanvasNodeRecord;
}

export class WorkflowViewExpiredError extends Error {
  constructor() {
    super('工作流所在画布已变化，停止本次界面查询。');
    this.name = 'WorkflowViewExpiredError';
  }
}

export function requireWorkflowScope(scope?: WorkflowRunScope): void {
  if (scope && !scope.isCurrent()) throw new WorkflowViewExpiredError();
}

interface Subscription {
  scope?: WorkflowRunScope;
  receive(run: WorkflowRun, publishOutputs: boolean): void;
  pause(error: unknown): void;
}

/** Shares transport, not ownership: a reopened canvas must receive its own callbacks. */
export function createWorkflowRunObserver(getRun: (runId: string) => Promise<WorkflowRun>) {
  const active = new Map<
    string,
    { subscribers: Set<Subscription>; promise: Promise<WorkflowRun> }
  >();
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  return (runId: string, subscription: Subscription): Promise<WorkflowRun> => {
    requireWorkflowScope(subscription.scope);
    const existing = active.get(runId);
    if (existing) {
      existing.subscribers.add(subscription);
      return existing.promise;
    }
    const subscribers = new Set([subscription]);
    const current = () => {
      for (const subscriber of subscribers)
        if (subscriber.scope && !subscriber.scope.isCurrent()) subscribers.delete(subscriber);
      if (!subscribers.size) {
        active.delete(runId);
        throw new WorkflowViewExpiredError();
      }
      return [...subscribers];
    };
    const promise = (async () => {
      let errors = 0;
      let cleanupChecks = 0;
      while (true) {
        current();
        let run: WorkflowRun;
        try {
          run = await getRun(runId);
          if (run.runId !== runId) throw new Error('任务回执编号不匹配');
          errors = 0;
        } catch (error) {
          const watchers = current();
          if (++errors >= 6) {
            watchers.forEach((watcher) => watcher.pause(error));
            throw error;
          }
          await delay(Math.min(5_000, 500 * 2 ** (errors - 1)));
          continue;
        }
        const terminal = ['success', 'failed', 'cancelled', 'unknown'].includes(run.status);
        const waitingCleanup =
          terminal && run.inputCleanup?.state === 'pending' && cleanupChecks++ < 12;
        // Keep application callbacks outside the network retry block.
        current().forEach((watcher) => watcher.receive(run, terminal && !waitingCleanup));
        if ((terminal && !waitingCleanup) || run.phase === 'observation-paused') return run;
        await delay(waitingCleanup ? 750 : 900);
      }
    })().finally(() => {
      if (active.get(runId)?.subscribers === subscribers) active.delete(runId);
      subscribers.clear();
    });
    active.set(runId, { subscribers, promise });
    return promise;
  };
}
