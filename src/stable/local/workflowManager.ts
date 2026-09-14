import { createOfficialWorkflowGallery, officialWorkflowStyles } from './officialWorkflowGallery';
import type { OfficialWorkflow } from './workflowManagerClient';
import { activateModal } from '../design/modalFocus';
import type {
  BindingCandidate,
  BindingSet,
  OutputCandidate,
  WorkflowDefinition,
  WorkflowDeploymentDto,
  WorkflowEditorSnapshot,
  WorkflowAttestation,
  WorkflowManagerClient,
  WorkflowRun,
} from './workflowManagerClient';
import { WORKFLOW_CANVAS_INSERTED_EVENT } from './workflowCanvasNodes';
import { createStableElement as element } from '../design/dom';
import { observeStableEnhancement } from '../lifecycle/enhancementLifecycle';
import {
  createRunningHubQuickAdd,
  createRunningHubWebAppManager,
  RUNNINGHUB_WEBAPP_TEST_EVENT,
} from './runningHubWebAppManager';
import {
  RUNNINGHUB_PAID_CONFIRMATION_KEY,
  requestAnchoredConfirmation,
} from '../design/designSystem';

const HOST_ATTRIBUTE = 'data-fisherai-workflow-manager';
const STYLE_ID = 'fisherai-workflow-manager-styles';
const RUN_SESSION_KEY = 'fisherai.workflow-manager.active-run.v1';
export const WORKFLOW_PARAMETER_EDITOR_EVENT = 'fisherai:edit-workflow-parameters';
export const WORKFLOW_LIBRARY_EVENT = 'fisherai:open-workflow-library';
const STAGES = ['选择工作流', '运行环境', '输入参数', '试运行', '输出结果'] as const;

function incompleteExportNotice(definition: WorkflowDefinition) {
  const ids = (definition.analysis?.warnings || [])
    .filter(warning => warning.code === 'UNREFERENCED_INCOMPLETE_API_NODE')
    .map(warning => warning.nodeId);
  return ids.length ? `已忽略 ${ids.length} 个缺少类型且未被有效节点引用的节点（${ids.slice(0, 10).join('、')}${ids.length > 10 ? '…' : ''}）；原始 JSON 已保留。` : '';
}

declare global {
  interface Window {
    __FISHERAI_FOCUS_NODES__?: (nodeIds: readonly string[]) => void;
  }
}

function focusInsertedWorkflow(nodeIds: readonly string[] | undefined) {
  if (nodeIds?.length) window.__FISHERAI_FOCUS_NODES__?.(nodeIds);
}

type StageIndex = 0 | 1 | 2 | 3 | 4;

interface WorkflowManagerOptions {
  definitionId?: string;
  nodeId?: string;
  initialNodeTitle?: string;
  initialStage?: StageIndex;
  initialView?: 'library' | 'manager';
  mode?: 'settings' | 'dialog';
  scope?: 'local' | 'cloud' | 'all';
  compactCloud?: boolean;
}

interface DeployedWorkflowRecord {
  definition: WorkflowDefinition;
  attestation?: WorkflowAttestation;
  deployment?: WorkflowDeploymentDto;
  bindingSet?: BindingSet;
  automaticCover?: {
    url: string;
    mediaKind: 'image' | 'video';
  };
  verifiedRun?: WorkflowRun;
  verifiedProjectId?: string;
  verifiedValues?: Record<string, unknown>;
}

interface ManagerState {
  definitions: WorkflowDefinition[];
  deployedRecords: DeployedWorkflowRecord[];
  selected?: WorkflowDefinition;
  deployment?: WorkflowDeploymentDto;
  candidates: BindingCandidate[];
  bindingSet?: BindingSet;
  projects: Array<{ id: string; title: string; updatedAt: string }>;
  projectId?: string;
  nodeTitle: string;
  values: Record<string, unknown>;
  run?: WorkflowRun;
  outputCandidates: OutputCandidate[];
  outputBindingSetId?: string;
  attestation?: WorkflowAttestation;
  verifiedRun?: WorkflowRun;
  verifiedOutputCandidates: OutputCandidate[];
  activeStage: StageIndex;
  cleanupGrantId?: string;
  deploymentRunner: 'local-comfyui' | 'runninghub-workflow' | 'runninghub-webapp';
  pollingPaused?: boolean;
  discovered?: {
    label: string;
    candidates: Array<{ relativePath: string; byteLength: number; file: File }>;
  };
}

function button(label: string, variant: 'primary' | 'quiet' | 'ghost' = 'quiet') {
  const control = element('button', `fwm-button is-${variant}`, label);
  control.type = 'button';
  return control;
}

function field(label: string | HTMLElement, control: HTMLElement, source = '') {
  const compound = control.getAttribute('data-fisherai-compound-control') === 'true';
  const wrapper = element(compound ? 'div' : 'label', 'fwm-field');
  if (compound) {
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute(
      'aria-label',
      typeof label === 'string'
        ? label
        : label.getAttribute('aria-label') || label.textContent || '参数',
    );
  }
  const copy = element('span', 'fwm-field-copy');
  if (typeof label === 'string') {
    copy.append(element('span', 'fwm-field-label', label));
  } else {
    label.classList.add('fwm-field-label');
    copy.append(label);
  }
  if (source) copy.append(element('span', 'fwm-field-source', source));
  wrapper.append(copy, control);
  return wrapper;
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请检查配置后重试。';
}

function isRunningHubRunner(runner: unknown) {
  return runner === 'runninghub-workflow' || runner === 'runninghub-webapp';
}

function isCloudDefinition(definition: WorkflowDefinition) {
  return definition.sourceArtifacts.some((artifact) => artifact.origin === 'runninghub-webapp');
}

function automaticWorkflowCover(run?: WorkflowRun) {
  const outputs = Array.isArray(run?.receipt?.outputs) ? run.receipt.outputs : [];
  const candidates = outputs.flatMap((output) => {
    const mediaKind = output.mediaKind;
    const url = output.url;
    if (
      (mediaKind !== 'image' && mediaKind !== 'video') ||
      typeof url !== 'string' ||
      !url.startsWith('/library/media/')
    )
      return [];
    return [{ url, mediaKind } as const];
  });
  return candidates.find((item) => item.mediaKind === 'video') || candidates[0];
}

async function enrichVerifiedAssetValues(
  client: WorkflowManagerClient,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const assetLists = new Map<string, Awaited<ReturnType<WorkflowManagerClient['listAssets']>>>();
  const enrich = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(enrich));
    if (!value || typeof value !== 'object') return value;
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.assetId !== 'string' ||
      typeof candidate.projectId !== 'string' ||
      typeof candidate.type !== 'string'
    )
      return structuredClone(value);
    const cacheKey = `${candidate.projectId}:${candidate.type}`;
    let assets = assetLists.get(cacheKey);
    if (!assets) {
      assets = await client.listAssets(candidate.projectId, candidate.type).catch(() => []);
      assetLists.set(cacheKey, assets);
    }
    const asset = assets.find((item) => item.id === candidate.assetId);
    return {
      ...structuredClone(candidate),
      ...(asset?.url ? { url: asset.url } : {}),
      ...(asset?.filename ? { filename: asset.filename } : {}),
    };
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(values).map(async ([key, value]) => [key, await enrich(value)]),
    ),
  );
}

export function terminalRunNotice(run: WorkflowRun) {
  if (run.phase === 'observation-paused') {
    const windowMinutes = Math.max(1, Math.round(Number(run.observationWindowMs || 0) / 60_000));
    const elapsedMinutes = Math.max(
      windowMinutes,
      Math.round(Number(run.observationElapsedMs || run.observationWindowMs || 0) / 60_000),
    );
    const node = run.currentNodeId ? `当前停留在节点 ${run.currentNodeId}，` : '';
    const outputs = run.availableOutputs?.length
      ? `已识别 ${run.availableOutputs.length} 个输出`
      : '暂未识别已完成输出';
    return `已观察约 ${elapsedMinutes} 分钟，到达当前 ${windowMinutes} 分钟观察上限。ComfyUI 任务未取消，${node}${outputs}；可继续观察同一任务。`;
  }
  if (run.remoteMayContinue) {
    return isRunningHubRunner(run.runner)
      ? '画布已停止接收结果，但 RunningHub 任务可能仍在运行；请到 RunningHub 任务列表确认。'
      : '画布已停止接收结果，但 ComfyUI 任务可能仍在运行；请到 ComfyUI 队列手动停止。';
  }
  const [nodeError] = run.nodeErrors || [];
  if (nodeError) {
    return `ComfyUI 节点 ${nodeError.nodeId}（${nodeError.errorType}）拒绝参数：${nodeError.message}`;
  }
  return run.error || `测试结束：${run.code || run.status}`;
}

export function workflowRunProgressLabel(run: WorkflowRun) {
  const nodeId = run.progress?.currentNodeId || run.currentNodeId;
  const value = Number(run.progress?.value);
  const maximum = Number(run.progress?.maximum);
  if (Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0) {
    const boundedValue = Math.min(maximum, Math.max(0, value));
    const percent = Math.round((boundedValue / maximum) * 100);
    return `${nodeId ? `节点 ${nodeId} · ` : ''}当前步骤 ${boundedValue}/${maximum} · ${percent}%`;
  }
  if (run.realtimeChannel === 'history-fallback') {
    return `实时通道已断开，正在轮询 ComfyUI${nodeId ? ` · 节点 ${nodeId}` : ''}`;
  }
  if (nodeId) return `正在执行节点 ${nodeId}`;
  return run.phase || `${isRunningHubRunner(run.runner) ? 'RunningHub' : 'ComfyUI'} 正在执行`;
}

function retryablePollError(error: unknown) {
  const status = (error as { status?: unknown })?.status;
  return status === undefined || status === 404 || (typeof status === 'number' && status >= 500);
}

function cleanupObservationPending(run: WorkflowRun) {
  return run.status !== 'loading' && run.inputCleanup?.state === 'pending';
}

export async function observeWorkflowRun(
  client: Pick<WorkflowManagerClient, 'getRun'>,
  runId: string,
  {
    shouldContinue = () => true,
    onRun = () => undefined,
    onRetry = () => undefined,
    wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    maxConsecutiveErrors = 6,
  }: {
    shouldContinue?: () => boolean;
    onRun?: (run: WorkflowRun) => void | Promise<void>;
    onRetry?: (error: unknown, attempt: number) => void;
    wait?: (milliseconds: number) => Promise<unknown>;
    maxConsecutiveErrors?: number;
  } = {},
): Promise<{ run?: WorkflowRun; paused: boolean; error?: unknown }> {
  let consecutiveErrors = 0;
  while (shouldContinue()) {
    try {
      const run = await client.getRun(runId);
      await onRun(run);
      consecutiveErrors = 0;
      if (
        run.phase === 'observation-paused' ||
        (run.status !== 'loading' && !cleanupObservationPending(run))
      ) {
        return { run, paused: false };
      }
      await wait(1_000);
    } catch (error) {
      consecutiveErrors += 1;
      if (!retryablePollError(error) || consecutiveErrors > maxConsecutiveErrors) {
        return { paused: true, error };
      }
      onRetry(error, consecutiveErrors);
      await wait(Math.min(5_000, 500 * 2 ** (consecutiveErrors - 1)));
    }
  }
  return { paused: true };
}

function persistRunReference(definitionId: string, runId: string) {
  try {
    sessionStorage.setItem(RUN_SESSION_KEY, JSON.stringify({ definitionId, runId }));
  } catch {
    // Session recovery is best-effort and must never block a local run.
  }
}

function readRunReference(): { definitionId: string; runId: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(RUN_SESSION_KEY) || 'null');
    if (
      typeof value?.definitionId === 'string' &&
      value.definitionId.length <= 200 &&
      typeof value?.runId === 'string' &&
      value.runId.length <= 200
    )
      return value;
  } catch {
    // Ignore stale or externally modified session state.
  }
  return null;
}

function clearRunReference() {
  try {
    sessionStorage.removeItem(RUN_SESSION_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = element('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${HOST_ATTRIBUTE}] [hidden]{display:none}
    [${HOST_ATTRIBUTE}]{margin:24px 0;padding-bottom:28px;border-bottom:1px solid var(--af-border);color:var(--af-text);font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif}
    [${HOST_ATTRIBUTE}] *{box-sizing:border-box}
    [data-fisherai-local-workspace-tabs]{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:24px;margin:0 0 24px;padding:0 2px;border-bottom:1px solid var(--af-border);background:var(--af-surface);backdrop-filter:blur(12px)}
    [data-fisherai-local-workspace-tab]{position:relative;min-height:46px;padding:0 2px;border:0;background:transparent;color:var(--af-text-muted);font:680 13px/1 Inter,"Microsoft YaHei UI",system-ui,sans-serif;cursor:pointer;transition:color 120ms ease}
    [data-fisherai-local-workspace-tab]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:transparent}
    [data-fisherai-local-workspace-tab][aria-selected="true"]{color:var(--af-text)}
    [data-fisherai-local-workspace-tab][aria-selected="true"]::after{background:var(--af-primary)}
    [data-fisherai-local-workspace-tab]:hover{color:var(--af-text)}
    [data-fisherai-local-workspace-tab]:focus-visible{outline:2px solid var(--af-info);outline-offset:3px;border-radius:3px}
    .fwm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
    .fwm-head-actions{display:flex;align-items:center;gap:8px;flex:none}
    .fwm-kicker{margin:0 0 5px;color:var(--af-text-muted);font:600 10px/1.2 "Cascadia Code",Consolas,monospace;letter-spacing:.16em}
    .fwm-title{margin:0;font-size:20px;line-height:1.25;font-weight:720;letter-spacing:-.02em}
    .fwm-subtitle{margin:6px 0 0;color:var(--af-text-secondary);font-size:13px;line-height:1.6}
    .fwm-status{display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid var(--af-border);border-radius:999px;color:var(--af-text-secondary);font-size:12px;white-space:nowrap}
    .fwm-status::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--af-hover)}.fwm-status.is-ready::before{background:var(--af-success);box-shadow:0 0 0 4px #34d39914}
    .fwm-rail{position:relative;display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-bottom:12px;padding:4px;border:1px solid var(--af-border);border-radius:11px;background:var(--af-input);overflow:hidden}
    .fwm-rail::before{content:"";position:absolute;left:10%;right:10%;top:20px;height:1px;background:var(--af-hover);z-index:0}
    .fwm-stage{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 4px;border:0;background:transparent;color:var(--af-text-muted);font-size:12px;cursor:pointer}
    .fwm-stage-dot{display:grid;place-items:center;width:18px;height:18px;border:1px solid var(--af-border);border-radius:50%;background:var(--af-input);font:600 9px/1 "Cascadia Code",monospace}
    .fwm-stage.is-current{color:var(--af-text)}.fwm-stage.is-current .fwm-stage-dot{border-color:var(--af-focus);background:var(--af-info-bg);color:var(--af-info);box-shadow:0 0 0 4px #60a5fa12}
    .fwm-stage.is-done{color:var(--af-text-secondary)}.fwm-stage.is-done .fwm-stage-dot{border-color:var(--af-success);color:var(--af-success)}
    .fwm-panel{min-height:218px;padding:18px;border:1px solid var(--af-border);border-radius:12px;background:linear-gradient(145deg,var(--af-surface) 0%,var(--af-surface) 72%);box-shadow:var(--af-shadow)}
    .fwm-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}.fwm-panel-title{margin:0;font-size:15px;font-weight:680}.fwm-panel-copy{margin:4px 0 0;color:var(--af-text-secondary);font-size:12px;line-height:1.55}
    .fwm-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.fwm-button{min-height:32px;padding:0 12px;border:1px solid var(--af-border-control);border-radius:8px;background:var(--af-surface-raised);color:var(--af-text);font:600 12px/1 inherit;cursor:pointer;transition:120ms ease}.fwm-button:hover{border-color:var(--af-border-control);background:var(--af-surface-raised)}.fwm-button:focus-visible{outline:2px solid var(--af-focus);outline-offset:2px}.fwm-button.is-primary{border-color:var(--af-border-control);background:var(--af-primary);color:var(--af-on-primary)}.fwm-button.is-primary:hover{background:var(--af-primary)}.fwm-button.is-ghost{border-color:transparent;background:transparent;color:var(--af-text-secondary)}.fwm-button:disabled{cursor:not-allowed;opacity:.42}
    .fwm-button.fwm-output-confirm{width:auto;min-width:0;min-height:38px;height:38px;padding:0 16px;border-color:var(--af-border-control);border-radius:8px;background:var(--af-primary);color:var(--af-on-primary);box-shadow:0 1px 0 #fff inset,0 5px 14px #0004;font:650 12px/1 Inter,"Microsoft YaHei UI",system-ui,sans-serif;letter-spacing:0;white-space:nowrap}.fwm-button.fwm-output-confirm:hover{border-color:var(--af-border-control);background:var(--af-primary);box-shadow:0 1px 0 #fff inset,0 7px 18px #0005}.fwm-button.fwm-output-confirm:active{transform:translateY(1px);box-shadow:0 1px 0 #fff inset,0 3px 9px #0004}
    .fwm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fwm-field{display:flex;flex-direction:column;gap:6px;min-width:0}.fwm-field-copy{display:flex;align-items:baseline;gap:7px;min-width:0}.fwm-field-label{overflow:hidden;color:var(--af-text-secondary);font-size:12px;font-weight:680;line-height:1.4;text-overflow:ellipsis;white-space:nowrap}.fwm-inline-binding-name{width:auto;max-width:240px;padding:0 1px 2px;border:0;border-bottom:1px solid transparent;background:transparent;color:var(--af-text);font:680 11px/1.4 Inter,"Microsoft YaHei UI",system-ui,sans-serif;outline:0;text-overflow:ellipsis}.fwm-inline-binding-name:hover{border-bottom-color:var(--af-text-muted);color:var(--af-text)}.fwm-inline-binding-name:focus{border-bottom-color:var(--af-info);color:var(--af-text)}.fwm-field-source{overflow:hidden;color:var(--af-text-muted);font:9px/1.4 "Cascadia Code",Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}.fwm-input,.fwm-select,.fwm-textarea{width:100%;border:1px solid var(--af-border-control);border-radius:8px;background:var(--af-input);color:var(--af-text);font:12px/1.4 inherit;outline:0}.fwm-input,.fwm-select{height:36px;padding:0 10px}.fwm-textarea{min-height:82px;padding:10px;resize:vertical}.fwm-input:focus,.fwm-select:focus,.fwm-textarea:focus{border-color:var(--af-focus);box-shadow:0 0 0 3px #60a5fa12}
    .fwm-test-meta{display:grid;grid-template-columns:minmax(240px,.9fr) minmax(280px,1.1fr);gap:10px;margin-top:14px}.fwm-test-meta.is-single{grid-template-columns:minmax(240px,680px)}.fwm-test-section{margin-top:18px;padding-top:16px;border-top:1px solid var(--af-border)}.fwm-test-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:10px}.fwm-test-section-title{color:var(--af-text);font-size:12px;font-weight:720}.fwm-test-section-copy{color:var(--af-text-muted);font-size:12px;line-height:1.5;text-align:right}.fwm-test-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fwm-test-grid .fwm-field.is-wide{grid-column:1 / -1}.fwm-asset-kind+.fwm-asset-kind{margin-top:14px}.fwm-asset-kind-title{margin-bottom:8px;color:var(--af-text-muted);font:650 10px/1.4 "Cascadia Code",Consolas,monospace;letter-spacing:.04em}
    .fwm-select-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.fwm-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding:11px 12px;border:1px solid var(--af-border);border-radius:9px;background:var(--af-surface)}.fwm-summary strong{font-size:12px}.fwm-summary span{color:var(--af-text-secondary);font-size:12px}
    .fwm-asset-control{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px}.fwm-asset-control>.fwm-button{min-height:62px}.fwm-asset-picker{min-width:0}.fwm-asset-trigger{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:62px;padding:6px 10px;border:1px solid var(--af-border-control);border-radius:9px;background:var(--af-input);color:var(--af-text);cursor:pointer;list-style:none}.fwm-asset-trigger::-webkit-details-marker{display:none}.fwm-asset-picker[open]>.fwm-asset-trigger{border-color:var(--af-info);box-shadow:0 0 0 3px #60a5fa12}.fwm-asset-thumb{display:grid;place-items:center;width:48px;height:48px;overflow:hidden;border-radius:7px;background:var(--af-input);color:var(--af-text-muted);font-size:18px}.fwm-asset-thumb img,.fwm-asset-thumb video{width:100%;height:100%;object-fit:cover}.fwm-asset-trigger-copy{min-width:0}.fwm-asset-trigger-copy strong,.fwm-asset-trigger-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fwm-asset-trigger-copy strong{color:var(--af-text);font-size:12px}.fwm-asset-trigger-copy span{margin-top:3px;color:var(--af-text-muted);font-size:12px}.fwm-asset-chevron{color:var(--af-text-muted);font-size:13px}.fwm-asset-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;max-height:352px;margin-top:8px;padding:6px;overflow:auto;border:1px solid var(--af-border);border-radius:10px;background:var(--af-input)}.fwm-asset-option{position:relative;min-width:0;border-radius:8px;background:var(--af-surface);overflow:hidden;transition:background 120ms ease,box-shadow 120ms ease}.fwm-asset-option:hover{background:var(--af-surface)}.fwm-asset-option.is-selected{background:var(--af-surface);box-shadow:inset 0 0 0 1px #4673a8}.fwm-asset-option-main{display:grid;grid-template-columns:56px minmax(0,1fr);align-items:center;gap:10px;width:100%;min-width:0;padding:7px 38px 7px 7px;border:0;background:transparent;color:var(--af-text);text-align:left;cursor:pointer}.fwm-asset-option-main .fwm-asset-thumb{width:56px;height:56px}.fwm-asset-option-main:focus-visible,.fwm-asset-delete:focus-visible{outline:2px solid var(--af-info);outline-offset:-2px}.fwm-asset-delete{position:absolute;top:7px;right:7px;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--af-text-muted);cursor:pointer;opacity:.58;transition:background 120ms ease,color 120ms ease,opacity 120ms ease}.fwm-asset-option:hover .fwm-asset-delete,.fwm-asset-delete:focus-visible{opacity:1}.fwm-asset-delete::before{content:"";position:absolute;left:9px;top:9px;width:9px;height:10px;border:1.5px solid currentColor;border-top:0;border-radius:0 0 2px 2px}.fwm-asset-delete::after{content:"";position:absolute;left:8px;top:7px;width:12px;height:1.5px;border-radius:2px;background:currentColor;box-shadow:var(--af-shadow)}.fwm-asset-delete:hover{background:var(--af-surface-raised);color:var(--af-danger)}.fwm-asset-delete:disabled{cursor:wait;opacity:.3}.fwm-asset-option-copy{min-width:0}.fwm-asset-option-copy strong,.fwm-asset-option-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fwm-asset-option-copy strong{padding-right:4px;color:var(--af-text);font-size:12px}.fwm-asset-option-copy span{margin-top:4px;color:var(--af-text-muted);font:8px/1.35 "Cascadia Code",Consolas,monospace}.fwm-asset-empty{grid-column:1 / -1;padding:14px;color:var(--af-text-muted);font-size:12px;text-align:center}
    .fwm-asset-control.is-multiple{grid-template-columns:minmax(0,1fr) auto}.fwm-asset-selection{grid-column:1 / -1;display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:6px}.fwm-asset-selection:empty{display:none}.fwm-asset-selected{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:9px;min-width:0;padding:5px;border-radius:8px;background:var(--af-surface)}.fwm-asset-selected .fwm-asset-thumb{width:42px;height:42px}.fwm-asset-selected-copy{overflow:hidden;color:var(--af-text);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.fwm-asset-unlink{width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--af-text-muted);font-size:16px;cursor:pointer}.fwm-asset-unlink:hover{background:var(--af-surface-raised);color:var(--af-text)}
    .fwm-asset-confirm{position:absolute;inset:0;z-index:3;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:6px;padding:8px;background:var(--af-surface-raised);box-shadow:inset 0 0 0 1px #3a262b}.fwm-asset-confirm-copy{min-width:0}.fwm-asset-confirm-copy strong,.fwm-asset-confirm-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fwm-asset-confirm-copy strong{color:var(--af-text);font-size:12px}.fwm-asset-confirm-copy span{margin-top:3px;color:var(--af-text-muted);font-size:12px}.fwm-asset-confirm button{height:28px;padding:0 8px;border:0;border-radius:6px;background:var(--af-surface-raised);color:var(--af-text-secondary);font:650 9px/1 inherit;cursor:pointer}.fwm-asset-confirm button:hover,.fwm-asset-confirm button:focus-visible{outline:0;background:var(--af-hover);color:var(--af-text)}.fwm-asset-confirm button.is-remove{background:var(--af-danger-bg);color:var(--af-danger)}.fwm-asset-confirm button.is-remove:hover,.fwm-asset-confirm button.is-remove:focus-visible{background:var(--af-danger-bg);color:var(--af-danger)}
    .fwm-list{display:flex;flex-direction:column;gap:7px;max-height:340px;overflow:auto;padding-right:3px}.fwm-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px;border:1px solid var(--af-border);border-radius:9px;background:var(--af-surface)}.fwm-row-title{display:block;color:var(--af-text);font-size:12px;font-weight:620}.fwm-row-meta{display:block;margin-top:3px;color:var(--af-text-muted);font:10px/1.4 "Cascadia Code",Consolas,monospace}.fwm-check{accent-color:var(--af-focus)}.fwm-binding-row{grid-template-columns:auto minmax(180px,1fr) minmax(180px,.85fr) auto;transition:border-color 120ms ease,background 120ms ease}.fwm-binding-row.is-selected{border-color:var(--af-info);background:var(--af-surface)}.fwm-binding-alias{display:grid;gap:4px;min-width:0}.fwm-binding-alias-label{color:var(--af-text-muted);font-size:12px;font-weight:650;letter-spacing:.08em}.fwm-binding-alias-input{height:32px}.fwm-binding-alias-input:disabled{cursor:not-allowed;opacity:.42}@media(max-width:860px){.fwm-binding-row{grid-template-columns:auto minmax(0,1fr) auto}.fwm-binding-alias{grid-column:2 / 4}}
    .fwm-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,360px));gap:14px;margin:0 0 24px}.fwm-workflow-card{position:relative;overflow:hidden;border:1px solid var(--af-border);border-radius:12px;background:var(--af-surface);box-shadow:var(--af-shadow);transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease}.fwm-workflow-card:hover{transform:translateY(-2px);border-color:var(--af-border-control);box-shadow:var(--af-shadow)}.fwm-card-cover{position:relative;isolation:isolate;aspect-ratio:16/9;overflow:hidden;background:var(--af-input)}.fwm-card-cover::after{content:"";position:absolute;inset:auto 0 0;height:48%;z-index:2;background:linear-gradient(to bottom,transparent,#0b0b0ddd);pointer-events:none}.fwm-card-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:var(--af-input);transition:transform .35s ease}.fwm-workflow-card:hover .fwm-card-media{transform:scale(1.025)}.fwm-card-fallback{position:absolute;inset:0;display:grid;place-items:center;background:var(--af-input);color:var(--af-text-muted)}.fwm-card-fallback-mark{display:grid;place-items:center;width:62px;height:62px;border:1px solid var(--af-border);border-radius:18px;color:var(--af-text);font:750 22px/1 "Cascadia Code",monospace;letter-spacing:-.08em;box-shadow:inset 0 0 0 1px #ffffff05}.fwm-card-badges{position:absolute;z-index:3;top:12px;left:12px;display:flex;gap:6px}.fwm-card-badge{display:inline-flex;align-items:center;gap:6px;min-height:25px;padding:0 9px;border:1px solid var(--af-border-control);border-radius:999px;background:var(--af-media-bg);color:var(--af-media-text);font:650 9px/1 "Cascadia Code",monospace;letter-spacing:.08em}.fwm-card-badge::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--af-success);box-shadow:0 0 0 3px #34d39918}.fwm-card-menu{position:absolute;z-index:4;top:10px;right:10px;display:grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid var(--af-border-control);border-radius:9px;background:var(--af-media-bg);color:var(--af-media-text);font-size:19px;line-height:1;cursor:pointer}.fwm-card-menu:hover{background:var(--af-media-bg);border-color:var(--af-border-control)}.fwm-card-body{padding:14px}.fwm-card-title{display:block;overflow:hidden;color:var(--af-text);font-size:14px;font-weight:720;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}.fwm-card-meta{display:flex;align-items:center;gap:7px;margin-top:5px;color:var(--af-text-muted);font:10px/1.4 "Cascadia Code",Consolas,monospace}.fwm-card-meta-separator{width:2px;height:2px;border-radius:50%;background:var(--af-hover)}.fwm-card-actions{display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:8px;margin-top:14px}.fwm-card-actions .fwm-button.is-primary{width:100%}.fwm-button.is-danger-quiet{border-color:transparent;background:transparent;color:var(--af-danger)}.fwm-button.is-danger-quiet:hover{border-color:var(--af-danger);background:var(--af-danger-bg);color:var(--af-danger)}
    .fwm-presentation-layer{position:fixed;inset:0;z-index:100010;display:grid;place-items:center;padding:24px;background:var(--af-overlay)}.fwm-presentation-editor{width:min(580px,calc(100vw - 32px));overflow:hidden;border:1px solid var(--af-border);border-radius:14px;background:var(--af-surface);box-shadow:var(--af-shadow)}.fwm-presentation-preview{position:relative;aspect-ratio:16/9;overflow:hidden;background:var(--af-input)}.fwm-presentation-preview .fwm-card-fallback{display:grid}.fwm-presentation-preview-copy{position:absolute;z-index:3;left:18px;right:18px;bottom:16px}.fwm-presentation-preview-copy span{display:block;color:var(--af-media-text);font:600 9px/1.3 "Cascadia Code",monospace;letter-spacing:.12em}.fwm-presentation-preview-copy strong{display:block;margin-top:5px;color:var(--af-media-text);font-size:18px;line-height:1.25}.fwm-presentation-form{padding:18px}.fwm-presentation-form-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}.fwm-presentation-form-head strong{font-size:15px}.fwm-presentation-form-head span{display:block;margin-top:4px;color:var(--af-text-muted);font-size:12px;line-height:1.5}.fwm-presentation-choice{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding:11px 12px;border:1px solid var(--af-border);border-radius:9px;background:var(--af-input)}.fwm-presentation-choice span{color:var(--af-text-secondary);font-size:12px}.fwm-presentation-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:18px;padding-top:16px;border-top:1px solid var(--af-border)}
    .fwm-card-menu:hover,.fwm-card-menu[aria-expanded="true"]{background:var(--af-media-bg);border-color:var(--af-border-control)}.fwm-card-menu:focus-visible{outline:2px solid var(--af-focus);outline-offset:2px}.fwm-card-menu-popover{position:absolute;z-index:6;top:48px;right:10px;width:190px;padding:5px;border:1px solid var(--af-border);border-radius:10px;background:var(--af-surface-raised);box-shadow:var(--af-shadow);backdrop-filter:blur(12px)}.fwm-card-menu-popover[hidden]{display:none}.fwm-card-menu-item{display:flex;align-items:center;width:100%;min-height:34px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--af-text);font:600 11px/1 inherit;text-align:left;cursor:pointer}.fwm-card-menu-item:hover,.fwm-card-menu-item:focus-visible{outline:0;background:var(--af-surface-raised);color:var(--af-text)}.fwm-card-menu-item.is-danger{color:var(--af-danger)}.fwm-card-menu-item.is-danger:hover,.fwm-card-menu-item.is-danger:focus-visible{background:var(--af-danger-bg);color:var(--af-danger)}
    .fwm-delete-dialog{width:min(440px,calc(100vw - 32px));padding:20px;border:1px solid var(--af-border);border-radius:14px;background:var(--af-surface);box-shadow:var(--af-shadow)}.fwm-delete-eyebrow{margin:0 0 9px;color:var(--af-danger);font:650 9px/1.3 "Cascadia Code",monospace;letter-spacing:.14em}.fwm-delete-title{margin:0;color:var(--af-text);font-size:18px;line-height:1.35}.fwm-delete-copy{margin:9px 0 0;color:var(--af-text-secondary);font-size:12px;line-height:1.7}.fwm-delete-copy strong{color:var(--af-text)}.fwm-delete-note{margin:14px 0 0;padding:10px 12px;border-left:2px solid var(--af-danger);background:var(--af-danger-bg);color:var(--af-danger);font-size:12px;line-height:1.55}.fwm-button.is-danger{border-color:var(--af-danger);background:var(--af-danger-bg);color:var(--af-danger)}.fwm-button.is-danger:hover{border-color:var(--af-danger);background:var(--af-danger-bg)}
    .fwm-chip{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;background:var(--af-surface-raised);color:var(--af-text-secondary);font-size:12px}.fwm-chip.is-ok{background:var(--af-success-bg);color:var(--af-success)}.fwm-chip.is-warn{background:var(--af-warning-bg);color:var(--af-warning)}
    .fwm-notice{min-height:18px;margin:9px 2px 0;color:var(--af-text-muted);font-size:12px;line-height:1.5}.fwm-notice.is-error{color:var(--af-danger)}.fwm-notice.is-success{color:var(--af-success)}
.fwm-empty{display:grid;place-items:center;min-height:132px;border:1px dashed var(--af-border);border-radius:10px;color:var(--af-text-muted);font-size:12px;text-align:center}.fwm-run{display:grid;grid-template-columns:minmax(180px,auto) minmax(140px,1fr);align-items:center;gap:12px}.fwm-run-copy{display:grid;gap:4px}.fwm-run-detail{color:var(--af-text-muted);font-size:12px}.fwm-run-line{height:3px;border-radius:99px;background:var(--af-hover);overflow:hidden}.fwm-run-line::after{content:"";display:block;width:34%;height:100%;border-radius:inherit;background:var(--af-focus);animation:fwm-run 1.2s ease-in-out infinite alternate}.fwm-run-line.is-determinate::after{width:var(--fwm-progress,0%);animation:none;transform:none;transition:width .22s ease}@keyframes fwm-run{to{transform:translateX(190%)}}
    .fwm-output{grid-template-columns:auto auto minmax(0,1fr) auto}.fwm-output-metadata{margin-top:12px;border:1px solid var(--af-border);border-radius:9px;background:var(--af-input)}.fwm-output-metadata>summary{padding:10px 12px;color:var(--af-text-secondary);font-size:12px;font-weight:650;cursor:pointer}.fwm-output-metadata-list{padding:0 8px 8px}.fwm-output-metadata-row{grid-template-columns:minmax(0,1fr) auto;opacity:.82}.fwm-output-source{white-space:normal}.fwm-proof{margin-top:12px;padding:12px;border-left:2px solid var(--af-success);background:var(--af-surface-raised);color:var(--af-success);font-size:12px;line-height:1.6}.fwm-proof code{font-family:"Cascadia Code",monospace;color:var(--af-success)}
    .fwm-modal-backdrop{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:24px;background:var(--af-overlay);backdrop-filter:blur(8px)}
    .fwm-modal{width:min(1120px,calc(100vw - 48px));max-height:calc(100dvh - 48px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--af-border);border-radius:14px;background:var(--af-input);box-shadow:var(--af-shadow)}
    .fwm-modal-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;border-bottom:1px solid var(--af-border);background:var(--af-surface)}
    .fwm-modal-bar strong{font-size:14px}.fwm-modal-bar span{display:block;margin-top:3px;color:var(--af-text-muted);font-size:12px}
    .fwm-modal>.fwm-modal-bar{position:static;flex-shrink:0}
    .fwm-modal>[data-fisherai-workflow-manager]{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
    .fwm-presentation-editor{max-height:calc(100dvh - 48px);overflow-y:auto;overscroll-behavior:contain}
    [data-fisherai-workflow-library-dialog] .fwm-modal{width:min(1120px,calc(100vw - 48px));max-height:min(820px,calc(100dvh - 64px));display:flex;flex-direction:column;overflow:hidden}
    [data-fisherai-workflow-library-dialog] .fwm-modal-bar{position:static;flex-shrink:0}
    [data-fisherai-workflow-library-dialog] .fwm-modal [data-fisherai-workflow-manager]{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:16px}
    @media(max-width:640px){[data-fisherai-workflow-library-dialog]{padding:12px}[data-fisherai-workflow-library-dialog] .fwm-modal{width:100%;max-height:calc(100dvh - 24px)}}
    .fwm-modal-close{width:34px;height:34px;border:1px solid var(--af-border-control);border-radius:8px;background:var(--af-surface-raised);color:var(--af-text);font-size:20px;cursor:pointer}
    .fwm-modal [${HOST_ATTRIBUTE}]{margin:0;padding:20px 20px 24px;border:0}
    .fwm-library-back{display:inline-flex;align-items:center;margin:0 0 14px;padding-left:0;color:var(--af-text-secondary)}.fwm-library-back:hover{color:var(--af-text);background:transparent;border-color:transparent}
    .fwm-library-panel{min-height:430px;padding:0;border:0;background:transparent;box-shadow:none}.fwm-library-toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:6px 2px 18px;border-bottom:1px solid var(--af-border)}.fwm-library-toolbar-copy{min-width:0}.fwm-library-toolbar-copy h4{margin:0;color:var(--af-text);font-size:18px;line-height:1.3;font-weight:720;letter-spacing:-.02em}.fwm-library-toolbar-copy p{max-width:620px;margin:6px 0 0;color:var(--af-text-muted);font-size:12px;line-height:1.6}.fwm-library-toolbar-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.fwm-library-scope{display:inline-flex;gap:3px;margin-top:12px;padding:3px;border-radius:8px;background:var(--af-surface)}.fwm-library-scope button{min-height:30px;padding:0 11px;border:0;border-radius:6px;background:transparent;color:var(--af-text-muted);font-size:12px;cursor:pointer}.fwm-library-scope button.is-active{background:var(--af-primary);color:var(--af-on-primary);font-weight:700}.fwm-library-search-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:18px 0 12px}.fwm-library-search{position:relative;flex:1;max-width:440px}.fwm-library-search::before{content:"";position:absolute;left:13px;top:50%;width:11px;height:11px;border:1.5px solid var(--af-border-control);border-radius:50%;transform:translateY(-58%);pointer-events:none}.fwm-library-search::after{content:"";position:absolute;left:23px;top:22px;width:6px;height:1.5px;background:var(--af-hover);transform:rotate(45deg);transform-origin:left center;pointer-events:none}.fwm-library-search .fwm-input{padding-left:34px}.fwm-library-count{color:var(--af-text-muted);font:10px/1.4 "Cascadia Code",Consolas,monospace;letter-spacing:.06em;white-space:nowrap}.fwm-library-empty{display:grid;place-items:center;min-height:300px;margin-top:18px;border:1px dashed var(--af-border);border-radius:12px;background:var(--af-input);text-align:center}.fwm-library-empty strong{display:block;color:var(--af-text);font-size:14px}.fwm-library-empty span{display:block;max-width:400px;margin:7px auto 16px;color:var(--af-text-muted);font-size:12px;line-height:1.6}.fwm-library-panel .fwm-card-grid{grid-template-columns:repeat(auto-fill,minmax(260px,1fr));margin-bottom:0}.fwm-library-panel .fwm-workflow-card{max-width:none}
    .fwm-import-strip{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:24px;margin-top:26px;padding:22px 2px 4px;border-top:1px solid var(--af-border)}.fwm-import-copy h4{margin:0;color:var(--af-text);font-size:15px;line-height:1.35;font-weight:720}.fwm-import-copy p{max-width:680px;margin:6px 0 0;color:var(--af-text-muted);font-size:12px;line-height:1.55}.fwm-import-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;white-space:nowrap}
    @media(max-width:720px){.fwm-grid,.fwm-test-meta,.fwm-test-grid,.fwm-import-strip{grid-template-columns:1fr}.fwm-stage span:last-child{display:none}.fwm-panel{padding:14px}.fwm-head{flex-direction:column}.fwm-head-actions{width:100%;justify-content:space-between}.fwm-status{align-self:flex-start}.fwm-card-grid{grid-template-columns:1fr}.fwm-card-actions{grid-template-columns:1fr}.fwm-library-toolbar,.fwm-library-search-row{align-items:stretch;flex-direction:column}.fwm-library-toolbar-actions,.fwm-import-actions{justify-content:flex-start}.fwm-library-search{max-width:none}.fwm-test-section-head{align-items:flex-start;flex-direction:column}.fwm-test-section-copy{text-align:left}}
    @media(max-width:720px){.fwm-asset-options{grid-template-columns:1fr}}
    @media(prefers-reduced-motion:reduce){.fwm-button,.fwm-workflow-card,.fwm-card-media{transition:none}.fwm-run-line::after{animation:none;width:100%}}
  `;
  document.head.append(style);
}

function currentStage(state: ManagerState): StageIndex {
  if (!state.selected?.executionPlan) return 0;
  if (!state.deployment) return 1;
  if (!state.bindingSet) return 2;
  if (!state.run || state.run.status !== 'success') return 3;
  return 4;
}

function stageReachable(state: ManagerState, stage: StageIndex) {
  if (stage === 0) return true;
  if (stage === 1) return Boolean(state.selected?.executionPlan);
  if (stage === 2) return Boolean(state.deployment);
  if (stage === 3) return Boolean(state.bindingSet);
  return state.run?.status === 'success';
}

function safeKey(candidate: BindingCandidate, index: number) {
  const raw = `${candidate.fieldName}_${candidate.nodeId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  return /^[a-zA-Z]/.test(raw) ? raw.slice(0, 64) : `input_${index + 1}`;
}

function bindingForCandidate(
  bindingSet: BindingSet | undefined,
  candidate: BindingCandidate,
  candidateIndex: number,
) {
  const key = safeKey(candidate, candidateIndex);
  return bindingSet?.bindings.find((binding) => binding.key === key);
}

function needsVariableAssetUpgrade(
  bindingSet: BindingSet | undefined,
  candidates: BindingCandidate[],
) {
  if (!bindingSet) return false;
  return candidates.some(
    (candidate) =>
      candidate.control === 'asset' &&
      Number(candidate.maximumItems || 1) > 1 &&
      !bindingForCandidate(bindingSet, candidate, candidates.indexOf(candidate)),
  );
}

function suggestedBindingLabel(candidate: BindingCandidate) {
  const field = candidate.fieldName.toLocaleLowerCase('en-US');
  const identity = `${candidate.nodeTitle} ${candidate.classType} ${field}`.toLocaleLowerCase(
    'en-US',
  );
  const exactFieldNames: Record<string, string> = {
    aspect_ratio: '画面比例',
    batch_size: '生成数量',
    cfg: '提示词引导强度',
    duration: '生成时长',
    fps: '帧率',
    guidance: '提示词引导强度',
    height: '画面高度',
    megapixels: '分辨率',
    multiple: '尺寸倍数',
    noise_seed: '随机种子',
    seed: '随机种子',
    steps: '采样步数',
    width: '画面宽度',
  };
  if (candidate.control === 'asset') {
    return assetControlPresentation(candidate.mediaKind || 'image').label;
  }
  if (exactFieldNames[field]) return exactFieldNames[field];
  if (/negative/.test(identity) && /text|string|prompt/.test(identity)) return '反向提示词';
  if (/duration|seconds?|length/.test(identity)) return '生成时长';
  if (/prompt|input[ _-]?text|clip[ _-]?text/.test(identity)) return '提示词';
  if (/int[ _-]?constant/.test(identity)) return `整数参数（节点 ${candidate.nodeId}）`;
  if (/float[ _-]?constant/.test(identity)) return `小数参数（节点 ${candidate.nodeId}）`;
  if (/boolean|bool/.test(identity)) return `开关参数（节点 ${candidate.nodeId}）`;
  if (/select|combo/.test(identity)) return `选项参数（节点 ${candidate.nodeId}）`;
  if (/[㐀-鿿]/.test(candidate.nodeTitle)) return candidate.nodeTitle.trim();
  return `${candidate.nodeTitle} · ${candidate.fieldName}`;
}

function quickBindingCandidates(candidates: BindingCandidate[]) {
  const promptFields = new Set(['prompt', 'positive_prompt', 'text']);
  return candidates.filter(
    (candidate) =>
      candidate.control === 'asset' ||
      promptFields.has(candidate.fieldName.trim().toLocaleLowerCase('en-US')),
  );
}

function bindingSource(candidate?: BindingCandidate) {
  if (!candidate) return '';
  return `NODE ${candidate.nodeId} · ${candidate.classType}.${candidate.fieldName}`;
}

function latestBindingDescendant(bindingSets: BindingSet[], rootBindingSetId: string) {
  const byId = new Map(bindingSets.map((item) => [item.id, item]));
  const descendsFromRoot = (candidate: BindingSet) => {
    const visited = new Set<string>();
    let cursor: BindingSet | undefined = candidate;
    while (cursor && !visited.has(cursor.id)) {
      if (cursor.id === rootBindingSetId) return true;
      visited.add(cursor.id);
      cursor = cursor.previousBindingSetId ? byId.get(cursor.previousBindingSetId) : undefined;
    }
    return false;
  };
  return [...bindingSets]
    .filter(descendsFromRoot)
    .sort((left, right) => right.revision - left.revision)[0];
}

function assetControlPresentation(mediaKind: string) {
  if (mediaKind === 'audio') {
    return {
      label: '音频',
      accept: '.mp3,.wav,.m4a,.ogg,.aac,.flac,.webm,audio/*',
    };
  }
  if (mediaKind === 'video') {
    return {
      label: '视频',
      accept: '.mp4,.mov,.webm,.m4v,.mkv,video/*',
    };
  }
  return {
    label: mediaKind === 'mask' ? '遮罩' : '图片',
    accept: '.png,.jpg,.jpeg,.webp,.gif,.bmp,image/*',
  };
}

async function autoPair(client: WorkflowManagerClient, definition: WorkflowDefinition) {
  if (definition.executionPlan) return definition;
  const ui = definition.sourceArtifacts.find((artifact) => artifact.role === 'ui');
  const api = definition.sourceArtifacts.find((artifact) => artifact.role === 'api');
  if (!ui || !api) return definition;
  return (await client.pairArtifacts(definition.id, ui.id, api.id)).definition;
}

export function createWorkflowManager(
  client: WorkflowManagerClient,
  options: WorkflowManagerOptions = {},
) {
  injectStyles();
  const compactCloud = options.compactCloud === true;
  const host = element('section');
  host.setAttribute(HOST_ATTRIBUTE, 'true');
  host.setAttribute('data-fisherai-workflow-manager-mode', options.mode || 'settings');
  const state: ManagerState = {
    definitions: [],
    deployedRecords: [],
    candidates: [],
    projects: [],
    nodeTitle: '',
    values: {},
    outputCandidates: [],
    verifiedOutputCandidates: [],
    activeStage: 0,
    deploymentRunner: 'local-comfyui',
  };
  let uploadMode: 'quick' | 'new' | 'append' = 'new';
  let pollToken = 0;
  const libraryContext = options.initialView === 'library';
  let managerView: 'library' | 'manager' = libraryContext ? 'library' : 'manager';
  let libraryRunnerScope: 'local' | 'cloud' = 'local';
  let librarySection: 'official' | 'mine' = 'official';
  let officialWorkflows: OfficialWorkflow[] = [];
  let officialError = '';
  let officialLoaded = false;
  let libraryCloudImport = false;
  let officialConnection: OfficialWorkflow | null = null;
  let projectsLoaded = false;
  let libraryReadFailures: WorkflowDefinition[] = [];
  const requestedDefinitionId = options.definitionId?.trim() || undefined;
  const canvasNodeEditContext = Boolean(requestedDefinitionId && options.nodeId);
  let requestedDefinitionState: 'loading' | 'ready' | 'error' = requestedDefinitionId
    ? 'loading'
    : 'ready';
  let requestedDefinitionError = '';

  const libraryBack = button('← 返回工作流库', 'ghost');
  libraryBack.classList.add('fwm-library-back');
  libraryBack.hidden = true;
  const head = element('div', 'fwm-head');
  const identity = element('div');
  identity.append(
    element(
      'p',
      'fwm-kicker',
      compactCloud ? 'RUNNINGHUB WEBAPP / 付费验证' : 'WORKFLOW RUNTIME / 本地编排',
    ),
    element('h3', 'fwm-title', compactCloud ? '云端工作流测试' : '本地工作流'),
    element(
      'p',
      'fwm-subtitle',
      compactCloud
        ? 'WebApp 字段已由 RunningHub 确定；填写参数、真实测试并确认输出即可加入画布。'
        : '配置运行目标和字段后即可加入画布；需要时再提前测试。',
    ),
  );
  const status = element('div', 'fwm-status', '尚未验证');
  const headActions = element('div', 'fwm-head-actions');
  const newWorkflow = button('＋ 新工作流');
  newWorkflow.setAttribute('aria-label', '导入新的工作流并保留当前记录');
  headActions.append(status, newWorkflow);
  newWorkflow.hidden = compactCloud || canvasNodeEditContext;
  head.append(identity, headActions);
  const rail = element('div', 'fwm-rail');
  const panel = element('div', 'fwm-panel');
  const notice = element('p', 'fwm-notice');
  const fileInput = element('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.multiple = true;
  fileInput.hidden = true;
  const directoryInput = element('input');
  directoryInput.type = 'file';
  directoryInput.accept = '.json,application/json';
  directoryInput.multiple = true;
  directoryInput.hidden = true;
  directoryInput.setAttribute('webkitdirectory', '');
  directoryInput.setAttribute('directory', '');
  host.append(libraryBack, head, rail, panel, notice, fileInput, directoryInput);

  const setNotice = (text: string, tone: '' | 'error' | 'success' = '') => {
    notice.textContent = text;
    notice.className = `fwm-notice${tone ? ` is-${tone}` : ''}`;
  };

  const loadDeployedRecords = async (definitions = state.definitions) => {
    libraryReadFailures = [];
    const loadRecord = async (definition: WorkflowDefinition) => {
      if (!definition.executionPlan) return undefined;
      try {
        const attestations = await client.listAttestations(definition.id);
        const attestation = [...attestations]
          .filter(
            (item) =>
              item.definitionRevision === definition.revision &&
              item.executionPlanHash === definition.executionPlan?.executionPlanHash,
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        if (!attestation && !libraryContext) return undefined;
        const [deployments, bindingSets] = await Promise.all([
          client.listDeployments(definition.id),
          client.listBindingSets(definition.id),
        ]);
        const deployment = attestation
          ? deployments.find((item) => item.id === attestation.deploymentId)
          : deployments[0];
        const bindingSet = attestation
          ? latestBindingDescendant(bindingSets, attestation.bindingSetId) ||
            bindingSets.find((item) => item.id === attestation.bindingSetId)
          : bindingSets.at(-1);
        if (!deployment || !bindingSet) return undefined;
        const run = attestation
          ? await client.getRun(attestation.runId).catch(() => undefined)
          : undefined;
        return {
          definition,
          attestation,
          deployment,
          bindingSet,
          automaticCover: automaticWorkflowCover(run),
        } satisfies DeployedWorkflowRecord;
      } catch {
        libraryReadFailures.push(definition);
        return undefined;
      }
    };
    const records: Array<DeployedWorkflowRecord | undefined> = new Array(definitions.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, definitions.length) }, async () => {
        while (next < definitions.length) {
          const index = next++;
          records[index] = await loadRecord(definitions[index]);
        }
      }),
    );
    state.deployedRecords = records.flatMap((item) => (item ? [item] : []));
  };

  const resetDraft = () => {
    state.selected = undefined;
    state.deployment = undefined;
    state.candidates = [];
    state.bindingSet = undefined;
    state.nodeTitle = '';
    state.values = {};
    state.run = undefined;
    state.outputCandidates = [];
    state.outputBindingSetId = undefined;
    state.attestation = undefined;
    state.verifiedRun = undefined;
    state.verifiedOutputCandidates = [];
    state.activeStage = 0;
  };

  libraryBack.addEventListener('click', () => {
    managerView = 'library';
    resetDraft();
    setNotice('');
    render();
  });

  const refreshStatus = () => {
    const ready = state.selected
      ? Boolean(state.attestation)
      : Boolean(state.deployedRecords.length);
    status.textContent = ready
      ? state.run?.status === 'loading'
        ? '已部署 · 本次运行中'
        : state.selected?.id
          ? '已部署'
          : `${state.deployedRecords.length} 个已部署`
      : state.run?.status === 'loading'
        ? '正在执行工作流'
        : '尚未验证';
    status.classList.toggle('is-ready', ready);
    const observing =
      state.run?.status === 'loading' || (state.run ? cleanupObservationPending(state.run) : false);
    newWorkflow.disabled = observing;
    newWorkflow.title = observing
      ? '当前测试或输入清理完成后可新建工作流'
      : '保留当前记录并导入新的工作流';
  };

  const applyHydratedState = (hydrated: WorkflowEditorSnapshot) => {
    const { definition } = hydrated;
    const sameDefinition = state.selected?.id === definition.id;
    state.selected = definition;
    if (!sameDefinition || !state.nodeTitle) {
      state.nodeTitle = options.initialNodeTitle?.trim() || definition.name;
    }
    state.deployment = hydrated.deployment || undefined;
    state.deploymentRunner = hydrated.deployment?.runner || 'local-comfyui';
    state.candidates = hydrated.candidates;
    state.bindingSet = hydrated.bindingSet || undefined;
    state.values = {};
    for (const binding of state.bindingSet?.bindings || []) {
      if (binding.control.hasDefault) state.values[binding.key] = binding.control.defaultValue;
    }
    state.attestation = hydrated.attestation || undefined;
    state.verifiedRun = hydrated.verifiedRun || undefined;
    state.verifiedOutputCandidates = [...hydrated.verifiedOutputCandidates];
    state.run = hydrated.verifiedRun || undefined;
    state.outputCandidates = [...hydrated.verifiedOutputCandidates];
    state.outputBindingSetId = hydrated.verifiedRun ? hydrated.outputBindingSet?.id : undefined;

    const usesMetadataOutput = hydrated.outputBindingSet?.outputs.some((output) =>
      hydrated.verifiedOutputCandidates.some(
        (candidate) =>
          (candidate.selectable === false || candidate.category === 'metadata') &&
          String(candidate.nodeId) === String(output.selector.nodeId) &&
          candidate.outputKey === output.selector.outputKey &&
          candidate.outputIndex === output.selector.outputIndex,
      ),
    );
    if (usesMetadataOutput) {
      state.attestation = undefined;
      state.outputBindingSetId = undefined;
      setNotice(
        '当前输出是动画状态标记，不是视频文件。请选择“视频文件”并重新确认；无需重新运行生成任务。',
        'error',
      );
    }

    if (needsVariableAssetUpgrade(state.bindingSet, state.candidates)) {
      state.attestation = undefined;
      state.verifiedRun = undefined;
      state.verifiedOutputCandidates = [];
      state.run = undefined;
      state.outputCandidates = [];
      state.activeStage = 2;
      setNotice('检测到可安全合并的动态素材口。请保存新配置并重新真实测试一次。');
    } else {
      state.activeStage = currentStage(state);
    }
  };

  const hydrate = async (definition: WorkflowDefinition, restoredRun?: WorkflowRun) => {
    const hydrated: WorkflowEditorSnapshot = {
      definition,
      deployment: null,
      candidates: [],
      bindingSet: null,
      attestation: null,
      verifiedRun: null,
      verifiedOutputCandidates: [],
      outputBindingSet: null,
    };
    if (definition.executionPlan) {
      const deployments = await client.listDeployments(definition.id);
      hydrated.deployment =
        deployments.find((item) => item.id === restoredRun?.deploymentId) || deployments[0] || null;
      if (hydrated.deployment) {
        [hydrated.candidates] = await Promise.all([
          client.listBindingCandidates(definition.id, hydrated.deployment.id),
        ]);
        const bindingSets = await client.listBindingSets(definition.id);
        hydrated.bindingSet =
          bindingSets.find((item) => item.id === restoredRun?.bindingSetId) ||
          bindingSets.at(-1) ||
          null;
        if (!restoredRun && hydrated.bindingSet) {
          const attestations = await client.listAttestations(definition.id);
          const matching = attestations.find(
            (item) =>
              item.definitionRevision === definition.revision &&
              item.executionPlanHash === definition.executionPlan?.executionPlanHash &&
              item.deploymentId === hydrated.deployment?.id,
          );
          if (matching) {
            hydrated.attestation = matching;
            hydrated.bindingSet =
              latestBindingDescendant(bindingSets, matching.bindingSetId) ||
              bindingSets.find((item) => item.id === matching.bindingSetId) ||
              hydrated.bindingSet;
            try {
              const [verifiedRun, outputBindingSets] = await Promise.all([
                client.getRun(matching.runId),
                client.listOutputBindingSets(definition.id),
              ]);
              if (verifiedRun.status === 'success') {
                hydrated.verifiedRun = verifiedRun;
                hydrated.verifiedOutputCandidates = await client.listOutputCandidates(
                  definition.id,
                  matching.runId,
                );
                hydrated.outputBindingSet =
                  outputBindingSets.find((item) => item.id === matching.outputBindingSetId) || null;
              }
            } catch {
              // A historical proof may outlive the bounded run journal. Keep the editor usable.
            }
          }
        }
      }
    }
    applyHydratedState(hydrated);
  };

  const syncCurrentCanvasNode = async () => {
    if (
      !options.nodeId ||
      !state.selected ||
      !state.bindingSet ||
      (!state.attestation && !state.deployment)
    )
      return false;
    const blueprint = await client.createCanvasNode(state.selected.id, {
      ...(state.attestation
        ? { attestationId: state.attestation.id }
        : { deploymentId: state.deployment!.id }),
      bindingSetId: state.bindingSet.id,
      title: state.nodeTitle.trim() || state.selected.name,
    });
    window.dispatchEvent(
      new CustomEvent('fisherai:update-workflow-node', {
        detail: { nodeId: options.nodeId, blueprint },
      }),
    );
    return true;
  };

  const runBusy = async (label: string, action: () => Promise<void>) => {
    host.dataset.busy = 'true';
    setNotice(label);
    for (const control of host.querySelectorAll<HTMLButtonElement>('button'))
      control.disabled = true;
    try {
      await action();
    } catch (error) {
      setNotice(messageFor(error), 'error');
    } finally {
      delete host.dataset.busy;
      render();
    }
  };

  const renderRail = () => {
    rail.replaceChildren();
    const achieved = currentStage(state);
    const visibleStages = compactCloud ? [3, 4] : STAGES.map((_, index) => index);
    visibleStages.forEach((index, visibleIndex) => {
      const label = STAGES[index];
      const stage = button('', 'ghost');
      stage.className = 'fwm-stage';
      const stageIndex = index as StageIndex;
      if (stageIndex === state.activeStage) stage.classList.add('is-current');
      else if (stageIndex < achieved) stage.classList.add('is-done');
      stage.disabled = !stageReachable(state, stageIndex);
      stage.append(
        element('span', 'fwm-stage-dot', stageIndex < achieved ? '✓' : String(visibleIndex + 1)),
        element('span', '', label),
      );
      stage.addEventListener('click', () => {
        if (stageIndex === 3 && !projectsLoaded) {
          void runBusy('正在读取测试项目…', async () => {
            state.projects = await client.listProjects();
            state.projectId = state.projects[0]?.id;
            projectsLoaded = true;
            state.activeStage = stageIndex;
          });
          return;
        }
        state.activeStage = stageIndex;
        render();
      });
      rail.append(stage);
    });
  };

  const panelHeading = (title: string, copy: string, actions?: HTMLElement) => {
    const row = element('div', 'fwm-panel-head');
    const text = element('div');
    text.append(element('h4', 'fwm-panel-title', title), element('p', 'fwm-panel-copy', copy));
    row.append(text);
    if (actions) row.append(actions);
    return row;
  };

  function appendPollingResume(actions: HTMLElement) {
    if (!state.run || !state.pollingPaused) return;
    const resume = button('继续查询');
    resume.addEventListener('click', () => {
      state.pollingPaused = false;
      pollToken += 1;
      void pollRun(state.run!.runId, pollToken);
      render();
    });
    actions.append(resume);
  }

  const appendWorkflowCover = (
    container: HTMLElement,
    record: DeployedWorkflowRecord,
    preview?: { url: string; mediaKind: 'image' | 'video' },
  ) => {
    const customCoverUrl = record.definition.presentation?.customCoverUrl;
    const cover =
      preview ||
      (customCoverUrl
        ? { url: customCoverUrl, mediaKind: 'image' as const }
        : record.automaticCover);
    if (!cover) {
      const fallback = element('div', 'fwm-card-fallback');
      fallback.append(element('span', 'fwm-card-fallback-mark', 'FA'));
      container.append(fallback);
      return;
    }
    if (cover.mediaKind === 'video') {
      const media = element('video', 'fwm-card-media');
      media.src = cover.url;
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
      media.addEventListener(
        'loadedmetadata',
        () => {
          if (media.duration > 0) media.currentTime = Math.min(0.05, media.duration / 2);
        },
        { once: true },
      );
      container.append(media);
      return;
    }
    const media = element('img', 'fwm-card-media');
    media.src = cover.url;
    media.alt = `${record.definition.name} 封面`;
    container.append(media);
  };

  const openPresentationEditor = (record: DeployedWorkflowRecord) => {
    const layer = element('div', 'fwm-presentation-layer');
    const dialog = element('section', 'fwm-presentation-editor');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `编辑 ${record.definition.name} 的名称和封面`);
    const preview = element('div', 'fwm-presentation-preview');
    const previewCopy = element('div', 'fwm-presentation-preview-copy');
    const previewTitle = element('strong', '', record.definition.name);
    previewCopy.append(
      element(
        'span',
        '',
        record.definition.presentation?.customCoverUrl ? 'CUSTOM COVER' : 'LATEST OUTPUT',
      ),
      previewTitle,
    );
    const drawPreview = (temporary?: { url: string; mediaKind: 'image' | 'video' }) => {
      preview.replaceChildren();
      appendWorkflowCover(preview, record, temporary);
      preview.append(previewCopy);
    };
    drawPreview();

    const form = element('div', 'fwm-presentation-form');
    const formHead = element('div', 'fwm-presentation-form-head');
    const formCopy = element('div');
    formCopy.append(
      element('strong', '', '卡片信息'),
      element('span', '', '修改展示名称和封面不会改变工作流版本，也不需要重新测试。'),
    );
    const closeButton = button('关闭', 'ghost');
    formHead.append(formCopy, closeButton);
    const nameInput = element('input', 'fwm-input');
    nameInput.value = record.definition.name;
    nameInput.maxLength = 120;
    nameInput.placeholder = '工作流名称';

    const coverInput = element('input');
    coverInput.type = 'file';
    coverInput.accept = '.png,.jpg,.jpeg,.webp,.gif,.avif,image/*';
    coverInput.hidden = true;
    const coverChoice = element('div', 'fwm-presentation-choice');
    const coverState = element(
      'span',
      '',
      record.definition.presentation?.customCoverUrl
        ? '正在使用自定义封面'
        : record.automaticCover
          ? '正在使用最近一次成功输出'
          : '暂无输出画面，将显示 AIFISHER 占位图',
    );
    const coverActions = element('div', 'fwm-actions');
    const uploadCover = button('上传自定义封面');
    const useAutomatic = button('使用自动封面', 'ghost');
    coverActions.append(uploadCover, useAutomatic);
    coverChoice.append(coverState, coverActions);

    let selectedCover: File | undefined;
    let coverMode: 'automatic' | 'custom' = record.definition.presentation?.customCoverUrl
      ? 'custom'
      : 'automatic';
    let objectUrl: string | undefined;
    const releaseObjectUrl = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    };
    coverInput.addEventListener('change', () => {
      const [file] = Array.from(coverInput.files || []);
      if (!file) return;
      releaseObjectUrl();
      objectUrl = URL.createObjectURL(file);
      selectedCover = file;
      coverMode = 'custom';
      coverState.textContent = `已选择 ${file.name}，保存后替换封面`;
      previewCopy.firstElementChild!.textContent = 'CUSTOM COVER';
      drawPreview({ url: objectUrl, mediaKind: 'image' });
    });
    uploadCover.addEventListener('click', () => coverInput.click());
    useAutomatic.addEventListener('click', () => {
      releaseObjectUrl();
      selectedCover = undefined;
      coverMode = 'automatic';
      coverInput.value = '';
      coverState.textContent = record.automaticCover
        ? '保存后使用最近一次成功输出'
        : '保存后使用 AIFISHER 占位图';
      previewCopy.firstElementChild!.textContent = 'LATEST OUTPUT';
      drawPreview(record.automaticCover);
    });

    const footer = element('div', 'fwm-presentation-footer');
    const cancel = button('取消', 'ghost');
    const save = button('保存卡片', 'primary');
    footer.append(cancel, save);
    form.append(formHead, field('工作流名称', nameInput), coverChoice, footer, coverInput);
    dialog.append(preview, form);
    layer.append(dialog);
    document.body.append(layer);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      releaseObjectUrl();
      releaseModal();
      layer.remove();
    };
    const releaseModal = activateModal(dialog, close, { initialFocus: nameInput });
    closeButton.addEventListener('click', close);
    cancel.addEventListener('click', close);
    layer.addEventListener('click', (event) => {
      if (event.target === layer) close();
    });
    save.addEventListener('click', () => {
      void (async () => {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          setNotice('工作流名称不能为空。', 'error');
          return;
        }
        save.disabled = true;
        save.textContent = selectedCover ? '上传并保存…' : '正在保存…';
        try {
          let customCoverUrl = record.definition.presentation?.customCoverUrl || null;
          if (coverMode === 'automatic') customCoverUrl = null;
          else if (selectedCover) {
            const uploaded = await client.uploadAsset('workflow-covers', 'image', selectedCover);
            if (!uploaded.url) throw new Error('封面已上传，但没有返回可用地址。');
            customCoverUrl = uploaded.url;
          }
          const updated = await client.updateDefinitionPresentation(record.definition.id, {
            name,
            customCoverUrl,
          });
          state.definitions = state.definitions.map((definition) =>
            definition.id === updated.id ? updated : definition,
          );
          if (state.selected?.id === updated.id) state.selected = updated;
          await loadDeployedRecords(state.definitions);
          close();
          setNotice('工作流卡片已更新，无需重新测试。', 'success');
          render();
        } catch (error) {
          save.disabled = false;
          save.textContent = '保存卡片';
          setNotice(messageFor(error), 'error');
        }
      })();
    });
    nameInput.addEventListener('input', () => {
      previewTitle.textContent = nameInput.value.trim() || '未命名工作流';
    });
    nameInput.focus();
    nameInput.select();
  };

  const openDeleteDefinitionDialog = (record: DeployedWorkflowRecord, returnFocus: HTMLElement) => {
    const layer = element('div', 'fwm-presentation-layer');
    const dialog = element('section', 'fwm-delete-dialog');
    const titleId = `fwm-delete-title-${record.definition.id}`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', titleId);
    const title = element('h3', 'fwm-delete-title', '删除这个工作流？');
    title.id = titleId;
    const copy = element('p', 'fwm-delete-copy');
    copy.append(
      document.createTextNode('“'),
      element('strong', '', record.definition.name),
      document.createTextNode('”将从工作流节点库中移除。'),
    );
    const note = element(
      'p',
      'fwm-delete-note',
      '原始 JSON 文件不会被删除；已经添加到画布的节点也会保留。',
    );
    const footer = element('div', 'fwm-presentation-footer');
    const cancel = button('取消', 'ghost');
    const confirm = button('删除工作流');
    confirm.classList.add('is-danger');
    footer.append(cancel, confirm);
    dialog.append(
      element('p', 'fwm-delete-eyebrow', 'REMOVE FROM LIBRARY'),
      title,
      copy,
      note,
      footer,
    );
    layer.append(dialog);
    document.body.append(layer);

    let closed = false;
    const close = (restoreFocus = true) => {
      if (closed) return;
      closed = true;
      releaseModal();
      layer.remove();
      if (restoreFocus && returnFocus.isConnected) returnFocus.focus();
    };
    const releaseModal = activateModal(dialog, () => close(), { initialFocus: cancel });
    cancel.addEventListener('click', () => close());
    layer.addEventListener('click', (event) => {
      if (event.target === layer) close();
    });
    confirm.addEventListener('click', () => {
      void (async () => {
        confirm.disabled = true;
        cancel.disabled = true;
        confirm.textContent = '正在删除…';
        try {
          await client.deleteDefinition(record.definition.id);
          state.definitions = state.definitions.filter(
            (definition) => definition.id !== record.definition.id,
          );
          state.deployedRecords = state.deployedRecords.filter(
            (item) => item.definition.id !== record.definition.id,
          );
          if (state.selected?.id === record.definition.id) resetDraft();
          close(false);
          setNotice(`“${record.definition.name}”已从工作流节点库删除。`, 'success');
          render();
        } catch (error) {
          confirm.disabled = false;
          cancel.disabled = false;
          confirm.textContent = '删除工作流';
          setNotice(messageFor(error), 'error');
        }
      })();
    });
    cancel.focus();
  };

  const createDeployedCard = (record: DeployedWorkflowRecord) => {
    const card = element('article', 'fwm-workflow-card');
    card.dataset.searchValue = `${record.definition.name} ${
      isRunningHubRunner(record.deployment?.runner) ? 'runninghub 云端' : 'local comfyui 本地'
    }`.toLocaleLowerCase('zh-CN');
    const cover = element('div', 'fwm-card-cover');
    appendWorkflowCover(cover, record);
    const badges = element('div', 'fwm-card-badges');
    badges.append(element('span', 'fwm-card-badge', record.attestation ? '已跑通' : '待首次运行'));
    const menu = element('button', 'fwm-card-menu', '⋯');
    const menuId = `fwm-card-menu-${record.definition.id}`;
    menu.type = 'button';
    menu.setAttribute('aria-label', `打开 ${record.definition.name} 的更多操作`);
    menu.setAttribute('aria-haspopup', 'menu');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-controls', menuId);
    menu.title = '更多操作';
    const menuPopover = element('div', 'fwm-card-menu-popover');
    menuPopover.id = menuId;
    menuPopover.setAttribute('role', 'menu');
    menuPopover.hidden = true;
    const editPresentation = element('button', 'fwm-card-menu-item', '编辑名称和封面');
    editPresentation.type = 'button';
    editPresentation.setAttribute('role', 'menuitem');
    const deleteDefinition = element('button', 'fwm-card-menu-item is-danger', '删除工作流');
    deleteDefinition.type = 'button';
    deleteDefinition.setAttribute('role', 'menuitem');
    if (record.deployment?.runner !== 'runninghub-webapp') menuPopover.append(editPresentation);
    menuPopover.append(deleteDefinition);

    const closeMenu = (restoreFocus = true) => {
      if (menuPopover.hidden) return;
      menuPopover.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutsidePointerDown);
      document.removeEventListener('keydown', onMenuKeyDown);
      if (restoreFocus && menu.isConnected) menu.focus();
    };
    const onOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !cover.contains(event.target)) closeMenu(false);
    };
    const onMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!menuPopover.hidden) {
        closeMenu();
        return;
      }
      menuPopover.hidden = false;
      menu.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onOutsidePointerDown);
      document.addEventListener('keydown', onMenuKeyDown);
      editPresentation.focus();
    });
    editPresentation.addEventListener('click', () => {
      closeMenu(false);
      openPresentationEditor(record);
    });
    deleteDefinition.addEventListener('click', () => {
      closeMenu(false);
      openDeleteDefinitionDialog(record, menu);
    });
    cover.append(badges, menu, menuPopover);

    const body = element('div', 'fwm-card-body');
    body.append(element('span', 'fwm-card-title', record.definition.name));
    const meta = element('div', 'fwm-card-meta');
    meta.append(
      element(
        'span',
        '',
        isRunningHubRunner(record.deployment?.runner) ? 'RunningHub 云端' : 'ComfyUI 本地',
      ),
      element('span', 'fwm-card-meta-separator'),
      element('span', '', `${record.bindingSet?.bindings.length || 0} 个参数`),
      element('span', 'fwm-card-meta-separator'),
      element(
        'span',
        '',
        record.attestation
          ? new Date(record.attestation.succeededAt).toLocaleDateString('zh-CN')
          : '未运行',
      ),
    );
    body.append(meta);
    const recordActions = element('div', 'fwm-card-actions');
    const add = button('添加到画布', 'primary');
    add.addEventListener('click', () => {
      void runBusy('正在创建工作流节点…', async () => {
        const blueprint = await client.createCanvasNode(record.definition.id, {
          ...(record.attestation
            ? { attestationId: record.attestation.id }
            : { deploymentId: record.deployment!.id }),
          ...(record.bindingSet ? { bindingSetId: record.bindingSet.id } : {}),
          title: record.definition.name,
        });
        const adapter = window.__FISHERAI_WORKFLOW_NODES__;
        if (!adapter) throw new Error('画布节点适配器尚未加载，请刷新后重试。');
        let insertion;
        if (record.verifiedRun && record.verifiedProjectId && record.verifiedValues) {
          insertion = await adapter.addToCanvas(blueprint, {
            run: record.verifiedRun,
            projectId: record.verifiedProjectId,
            values: record.verifiedValues,
          });
        } else {
          insertion = await adapter.addToCanvas(blueprint);
        }
        focusInsertedWorkflow(insertion?.nodeIds);
        setNotice(
          record.attestation
            ? `${record.definition.name} 已添加到画布；已有示例连接会一并复原。`
            : `${record.definition.name} 已作为未验证节点加入画布；首次运行时会检查配置。`,
          'success',
        );
      });
    });
    const edit = button('编辑字段');
    edit.addEventListener('click', () => {
      if (libraryContext) managerView = 'manager';
      void runBusy('正在读取可外置字段…', async () => {
        await hydrate(record.definition);
        state.activeStage = 2;
        setNotice('字段可以自由增删；保存后直接用于后续添加的节点。');
      });
    });
    const remove = button('删除', 'ghost');
    remove.classList.add('is-danger-quiet');
    remove.addEventListener('click', () => openDeleteDefinitionDialog(record, remove));
    if (record.deployment?.runner !== 'runninghub-webapp') recordActions.append(edit);
    recordActions.append(remove, add);
    body.append(recordActions);
    card.append(cover, body);
    return card;
  };

  const appendDeployedCards = (deployedRecords = state.deployedRecords) => {
    const records = element('div', 'fwm-card-grid');
    for (const record of deployedRecords) records.append(createDeployedCard(record));
    panel.append(records);
    return records;
  };

  const enterAdvancedManager = (action?: 'import' | 'directory') => {
    managerView = 'manager';
    resetDraft();
    setNotice('');
    render();
    if (action === 'import') {
      uploadMode = 'new';
      fileInput.click();
    } else if (action === 'directory') {
      directoryInput.click();
    }
  };

  const startQuickImport = () => {
    uploadMode = 'quick';
    fileInput.click();
  };

  newWorkflow.addEventListener('click', () => {
    if (newWorkflow.disabled) return;
    const previousName = state.selected?.name;
    const wasVerified = Boolean(state.attestation);
    clearRunReference();
    enterAdvancedManager('import');
    setNotice(
      previousName
        ? wasVerified
          ? `“${previousName}”当前记录已保留，可在已部署工作流中继续改名和编辑字段。`
          : `“${previousName}”草稿已保留；普通列表只显示测试通过的工作流。`
        : '请选择新的工作流 JSON。',
      'success',
    );
  });

  const loadOfficial = async () => {
    try {
      officialWorkflows = await client.listOfficialWorkflows();
      officialError = '';
    } catch {
      officialError = '官方工作流暂时无法读取，请重试。';
    }
    officialLoaded = true;
  };
  const renderLibraryHome = () => {
    if (!document.getElementById('fisherai-official-workflow-styles')) {
      const style = document.createElement('style');
      style.id = 'fisherai-official-workflow-styles';
      style.textContent = officialWorkflowStyles;
      document.head.append(style);
    }
    const navigation = element('nav', 'fwm-library-navigation');
    navigation.setAttribute('aria-label', '工作流来源');
    for (const [id, label] of [
      ['official', '官方推荐'],
      ['local', '我的本地工作流'],
      ['cloud', '我的云端工作流'],
    ] as const) {
      const tab = button(label, 'ghost');
      tab.setAttribute('data-fisherai-workflow-library-scope', id);
      tab.setAttribute(
        'aria-pressed',
        String(
          id === 'official'
            ? librarySection === 'official'
            : librarySection === 'mine' && libraryRunnerScope === id,
        ),
      );
      tab.onclick = () => {
        libraryCloudImport = false;
        officialConnection = null;
        librarySection = id === 'official' ? 'official' : 'mine';
        if (id !== 'official') libraryRunnerScope = id;
        render();
      };
      navigation.append(tab);
    }
    panel.append(navigation);
    if (librarySection === 'official') {
      if (officialConnection) {
        const heading = element('div', 'fwm-library-toolbar-copy');
        heading.append(
          element('h3', '', `连接后使用：${officialConnection.name}`),
          element('p', '', '保存国内站连接后，返回官方推荐直接添加，无需查找工作流链接。'),
        );
        const back = button('返回官方推荐', 'ghost');
        back.onclick = () => {
          officialConnection = null;
          render();
        };
        panel.append(
          heading,
          back,
          createRunningHubQuickAdd(client, {
            connectDomesticOnly: {
              onConnected: async () => {
                await loadOfficial();
                if (!host.isConnected) return;
                officialConnection = null;
                render();
              },
            },
          }),
        );
        return;
      }
      if (!officialLoaded || officialError) {
        const notice = element('div', 'fwm-library-empty', officialError || '正在读取官方工作流…');
        if (officialError) {
          const retry = button('重新读取');
          retry.onclick = () => {
            retry.disabled = true;
            void loadOfficial().then(render);
          };
          notice.append(retry);
        }
        panel.append(notice);
        return;
      }
      panel.append(
        createOfficialWorkflowGallery(officialWorkflows, async (item) => {
          if (!item.configured) {
            officialConnection = item;
            render();
            return;
          }
          const adapter = window.__FISHERAI_WORKFLOW_NODES__;
          if (!adapter) throw new Error('请先打开画布项目，再添加工作流。');
          const app = await client.addOfficialWorkflow(item.id);
          if (!host.isConnected || window.__FISHERAI_WORKFLOW_NODES__ !== adapter) return;
          const snapshot = await client.getEditorSnapshot(app.definitionId);
          if (!host.isConnected || window.__FISHERAI_WORKFLOW_NODES__ !== adapter) return;
          if (!snapshot.deployment || !snapshot.bindingSet)
            throw new Error('工作流配置尚未就绪，请重新加载。');
          const blueprint = await client.createCanvasNode(app.definitionId, {
            deploymentId: snapshot.deployment.id,
            bindingSetId: snapshot.bindingSet.id,
            title: item.name,
          });
          if (!host.isConnected || window.__FISHERAI_WORKFLOW_NODES__ !== adapter) return;
          const insertion = await adapter.addToCanvas(blueprint);
          focusInsertedWorkflow(insertion?.nodeIds);
          setNotice(`${item.name} 已添加到画布。连接素材后即可运行。`, 'success');
          state.definitions = await client.listDefinitions();
          await loadDeployedRecords();
        }),
      );
      return;
    }
    if (libraryCloudImport) {
      const importHead = element('div', 'fwm-library-toolbar');
      const importCopy = element('div', 'fwm-library-toolbar-copy');
      importCopy.append(
        element('h4', '', '加载云端工作流'),
        element('p', '', '输入链接或应用 ID；站点可由链接识别，分类会从工作流属性自动读取。'),
      );
      const back = button('返回工作流库', 'ghost');
      back.addEventListener('click', () => {
        libraryCloudImport = false;
        render();
      });
      importHead.append(importCopy, back);
      panel.append(
        importHead,
        createRunningHubQuickAdd(client, {
          showCredentials: true,
          onCreated: async () => {
            state.definitions = await client.listDefinitions();
            await loadDeployedRecords();
            libraryCloudImport = false;
            libraryRunnerScope = 'cloud';
            setNotice('云端工作流已加载，可直接添加到画布。', 'success');
            render();
          },
        }),
      );
      return;
    }
    const visibleRecords = state.deployedRecords.filter((record) =>
      libraryRunnerScope === 'cloud'
        ? isRunningHubRunner(record.deployment?.runner)
        : !isRunningHubRunner(record.deployment?.runner),
    );
    const toolbar = element('div', 'fwm-library-toolbar');
    const copy = element('div', 'fwm-library-toolbar-copy');
    copy.append(
      element('h4', '', '我的工作流'),
      element(
        'p',
        '',
        libraryRunnerScope === 'cloud'
          ? '选择云端工作流添加到画布；未运行的节点会在首次运行时检查。'
          : '选择本地工作流添加到画布；未运行的节点会在首次运行时检查。',
      ),
    );
    const actions = element('div', 'fwm-library-toolbar-actions');
    const importWorkflow = button('导入并添加', 'primary');
    importWorkflow.addEventListener('click', startQuickImport);
    const scanDirectory = button('从目录添加');
    scanDirectory.addEventListener('click', () => enterAdvancedManager('directory'));
    const advanced = button('高级管理', 'ghost');
    advanced.addEventListener('click', () => enterAdvancedManager());
    if (libraryRunnerScope === 'local') {
      actions.append(importWorkflow, scanDirectory, advanced);
    } else {
      const loadCloud = button('加载云端工作流', 'primary');
      loadCloud.setAttribute('data-fisherai-load-cloud-workflow', 'true');
      loadCloud.addEventListener('click', () => {
        libraryCloudImport = true;
        render();
      });
      actions.append(loadCloud);
    }
    toolbar.append(copy, actions);
    panel.append(toolbar);

    if (libraryReadFailures.length) {
      const failed = element('div', 'fwm-notice is-error');
      failed.setAttribute('role', 'status');
      failed.append(
        element(
          'p',
          '',
          `以下工作流暂时无法读取：${libraryReadFailures.map((item) => item.name).join('、')}。原有记录仍保留。`,
        ),
      );
      const retry = button('重新读取');
      retry.onclick = () => {
        retry.disabled = true;
        void loadDeployedRecords()
          .then(render)
          .catch(() => {
            retry.disabled = false;
          });
      };
      failed.append(retry);
      panel.append(failed);
    }

    if (!visibleRecords.length && !libraryReadFailures.length) {
      const empty = element('div', 'fwm-library-empty');
      const emptyCopy = element('div');
      emptyCopy.append(
        element(
          'strong',
          '',
          libraryRunnerScope === 'cloud' ? '还没有云端工作流' : '还没有可用的本地工作流',
        ),
        element(
          'span',
          '',
          libraryRunnerScope === 'cloud'
            ? '直接输入 RunningHub 链接或应用 ID 即可加载。'
            : '点击导入或将 ComfyUI API JSON 直接拖到这里，即可导入并添加。',
        ),
      );
      if (libraryRunnerScope === 'local') {
        const firstImport = button('导入并添加第一个工作流', 'primary');
        firstImport.addEventListener('click', startQuickImport);
        emptyCopy.append(firstImport);
      }
      empty.append(emptyCopy);
      panel.append(empty);
      return;
    }

    const searchRow = element('div', 'fwm-library-search-row');
    const searchShell = element('label', 'fwm-library-search');
    const search = element('input', 'fwm-input');
    search.type = 'search';
    search.placeholder = '搜索工作流';
    search.setAttribute('aria-label', '搜索工作流');
    searchShell.append(search);
    const count = element('span', 'fwm-library-count', `${visibleRecords.length} 个工作流`);
    searchRow.append(searchShell, count);
    panel.append(searchRow);
    const records = appendDeployedCards(visibleRecords);
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase('zh-CN');
      let visible = 0;
      for (const card of records.querySelectorAll<HTMLElement>('.fwm-workflow-card')) {
        const matches = !query || (card.dataset.searchValue || '').includes(query);
        card.hidden = !matches;
        if (matches) visible += 1;
      }
      count.textContent = query
        ? `${visible} / ${visibleRecords.length}`
        : `${visibleRecords.length} 个工作流`;
    });
  };

  const renderSource = () => {
    if (!libraryContext && state.deployedRecords.length) {
      panel.append(
        panelHeading(
          '已部署工作流',
          '已验证记录可直接复用；未验证配置也能先加入画布，在首次运行时检查。',
        ),
      );
      appendDeployedCards();
    }

    const upload = button('导入 API JSON', 'primary');
    upload.addEventListener('click', () => {
      uploadMode = 'new';
      fileInput.click();
    });
    const append = button('补充 UI / API 文件');
    append.addEventListener('click', () => {
      uploadMode = 'append';
      fileInput.click();
    });
    const discover = button('扫描工作流目录');
    discover.addEventListener('click', () => {
      directoryInput.click();
    });
    const importStrip = element('section', 'fwm-import-strip');
    importStrip.setAttribute('data-fisherai-workflow-import-strip', 'true');
    const importCopy = element('div', 'fwm-import-copy');
    importCopy.append(
      element('h4', '', '添加工作流'),
      element('p', '', '导入 ComfyUI API JSON，或从目录批量读取已有工作流。'),
    );
    const importActions = element('div', 'fwm-import-actions');
    importActions.append(upload, discover);
    appendPollingResume(importActions);
    importStrip.append(importCopy, importActions);
    panel.append(importStrip);

    if (!state.definitions.length && !state.deployedRecords.length) {
      panel.append(
        element(
          'div',
          'fwm-empty',
          '还没有工作流。导入 API JSON，或扫描你已有的 ComfyUI 工作流目录。',
        ),
      );
    }

    if (state.selected) {
      const summary = element('div', 'fwm-summary');
      const left = element('div');
      left.append(
        element('strong', '', state.selected.name),
        element('span', '', ` · ${state.selected.sourceArtifacts.length} 份源文件`),
      );
      const badge = element(
        'span',
        `fwm-chip ${state.selected.executionPlan ? 'is-ok' : 'is-warn'}`,
        state.selected.executionPlan ? '执行计划已就绪' : '缺少可执行 API 文件',
      );
      if (!state.selected.executionPlan) {
        badge.title =
          '当前只有 UI Format（节点布局文件）；请从 ComfyUI 开发者模式导出 API Format 后，用“补充 UI / API 文件”导入。';
      }
      const summaryActions = element('div', 'fwm-actions');
      summaryActions.append(badge, append);
      summary.append(left, summaryActions);
      panel.append(summary);
      const warning = incompleteExportNotice(state.selected);
      if (warning) panel.append(element('p', 'fwm-panel-copy', warning));
    }

    if (state.discovered) {
      panel.append(element('p', 'fwm-panel-copy', `目录：${state.discovered.label}`));
      const list = element('div', 'fwm-list');
      for (const candidate of state.discovered.candidates) {
        const row = element('div', 'fwm-row');
        const icon = element('span', 'fwm-chip', 'JSON');
        const info = element('div');
        info.append(
          element('span', 'fwm-row-title', candidate.relativePath),
          element('span', 'fwm-row-meta', `${(candidate.byteLength / 1024).toFixed(1)} KiB`),
        );
        const importButton = button('导入');
        importButton.addEventListener('click', () => {
          void runBusy('正在导入目录中的工作流…', async () => {
            const definition = await client.importArtifact({ file: candidate.file });
            state.definitions = await client.listDefinitions();
            await hydrate(definition);
            setNotice('工作流已导入。', 'success');
          });
        });
        row.append(icon, info, importButton);
        list.append(row);
      }
      panel.append(list);
    }
  };

  const renderDeployment = () => {
    const remote = state.deploymentRunner === 'runninghub-workflow';
    const verify = button(
      state.deployment ? '重新验证' : remote ? '验证 RunningHub' : '验证本机 ComfyUI',
      'primary',
    );
    const runner = element('select', 'fwm-select');
    runner.append(
      new Option('本地 ComfyUI', 'local-comfyui'),
      new Option('RunningHub Workflow API', 'runninghub-workflow'),
    );
    runner.value = state.deploymentRunner;
    runner.addEventListener('change', () => {
      state.deploymentRunner = runner.value as ManagerState['deploymentRunner'];
      render();
    });
    const server = element('input', 'fwm-input');
    server.value =
      state.deployment?.runner === 'local-comfyui'
        ? state.deployment.serverUrl || '127.0.0.1:8188'
        : '127.0.0.1:8188';
    const site = element('select', 'fwm-select');
    site.append(
      new Option('RunningHub CN 站', 'runninghub-cn'),
      new Option('RunningHub AI 站', 'runninghub-global'),
    );
    site.value =
      state.deployment?.runner === 'runninghub-workflow'
        ? state.deployment.credentialRef || 'runninghub-cn'
        : 'runninghub-cn';
    const remoteWorkflowId = element('input', 'fwm-input');
    remoteWorkflowId.placeholder = 'RunningHub workflowId';
    remoteWorkflowId.value =
      state.deployment?.runner === 'runninghub-workflow'
        ? state.deployment.remoteWorkflowId || ''
        : '';
    const override = element('input', 'fwm-check');
    override.type = 'checkbox';
    override.checked =
      state.deployment?.runner === 'runninghub-workflow' &&
      Boolean(state.deployment.includeWorkflowJson);
    const timeout = element('select', 'fwm-select');
    const configuredTimeoutMs = state.deployment?.timeoutMs ?? 60 * 60_000;
    const timeoutOptions = [
      ['10 分钟', '600000'],
      ['30 分钟', '1800000'],
      ['60 分钟（推荐）', '3600000'],
      ['2 小时', '7200000'],
    ];
    if (!timeoutOptions.some(([, value]) => Number(value) === configuredTimeoutMs)) {
      timeoutOptions.push([
        `${Math.max(1, Math.round(configuredTimeoutMs / 60_000))} 分钟（当前）`,
        String(configuredTimeoutMs),
      ]);
    }
    for (const [label, value] of timeoutOptions) {
      const option = element('option');
      option.value = value;
      option.textContent = label;
      timeout.append(option);
    }
    timeout.value = String(configuredTimeoutMs);
    const cleanup = button(state.cleanupGrantId ? '已授权输入清理' : '授权输入目录清理');
    cleanup.addEventListener('click', () => {
      void runBusy('请选择 ComfyUI 的 input 目录…', async () => {
        const grant = await client.chooseDirectory('comfy-input-cleanup');
        state.cleanupGrantId = grant.id;
        setNotice('已创建独立清理授权；只会删除 AIFISHER 本次上传的文件。', 'success');
      });
    });
    verify.addEventListener('click', () => {
      void runBusy('正在连接运行目标并读取参数提示…', async () => {
        const result = await client.createDeployment(state.selected!.id, {
          runner: state.deploymentRunner,
          ...(remote
            ? {
                baseUrl:
                  site.value === 'runninghub-global'
                    ? 'https://www.runninghub.ai'
                    : 'https://www.runninghub.cn',
                credentialRef: site.value as 'runninghub-cn' | 'runninghub-global',
                remoteWorkflowId: remoteWorkflowId.value,
                includeWorkflowJson: override.checked,
              }
            : { serverUrl: server.value }),
          timeoutMs: Number(timeout.value),
          ...(!remote && state.cleanupGrantId ? { inputCleanupGrantId: state.cleanupGrantId } : {}),
        });
        state.deployment = { ...result.deployment, createdAt: new Date().toISOString() };
        state.candidates = result.candidates;
        state.bindingSet = undefined;
        state.run = undefined;
        state.activeStage = 2;
        setNotice(
          remote
            ? `RunningHub 验证通过：识别到 ${result.deployment.nodeTypeCount} 类相关节点。`
            : `ComfyUI 已连接，找到 ${state.candidates.length} 个可外置参数；自定义节点由运行测试最终确认。`,
          'success',
        );
      });
    });
    const actions = element('div', 'fwm-actions');
    actions.append(verify);
    appendPollingResume(actions);
    panel.append(
      panelHeading(
        '验证运行环境',
        remote
          ? '只读取 RunningHub 远程工作流快照，不提交付费任务。'
          : '只连接 127.0.0.1 / localhost；这里只验证，不会提交生成任务。',
        actions,
      ),
      element('div', 'fwm-grid'),
    );
    const grid = panel.lastElementChild!;
    grid.append(field('运行器', runner));
    if (remote) {
      const overrideLabel = element('label', 'fwm-row');
      overrideLabel.append(override, element('span', '', '提交完整 API Format 覆盖远程模板'));
      grid.append(
        field('RunningHub 站点', site),
        field('远程 workflowId', remoteWorkflowId),
        field('单次观察时长', timeout),
        overrideLabel,
      );
    } else {
      grid.append(field('ComfyUI 地址', server), field('单次观察时长', timeout));
    }
    const summary = element('div', 'fwm-summary');
    summary.append(
      element(
        'span',
        '',
        state.deployment
          ? isRunningHubRunner(state.deployment.runner)
            ? `RunningHub · ${state.deployment.remoteWorkflowId} · ${state.candidates.length} 个可外置参数`
            : `ComfyUI ${state.deployment.comfyuiVersion} · ${state.candidates.length} 个可外置参数`
          : '等待连接运行目标',
      ),
      ...(remote ? [] : [cleanup]),
    );
    panel.append(summary);
  };

  const renderBindings = () => {
    const selections = new Set(
      state.candidates.flatMap((candidate, index) =>
        bindingForCandidate(state.bindingSet, candidate, index) ||
        (candidate.control === 'asset' && Number(candidate.maximumItems || 1) > 1)
          ? [candidate.id]
          : [],
      ),
    );
    const save = button(state.attestation ? '保存字段' : '保存参数配置', 'primary');
    const addWithoutTest = button('直接添加到画布');
    addWithoutTest.disabled = !state.bindingSet;
    const headingActions = element('div', 'fwm-actions');
    headingActions.append(save, addWithoutTest);
    panel.append(
      panelHeading(
        '选择画布上可调整的参数',
        '只保存你自己勾选的参数；可以先加入画布，首次运行时再检查环境和输出。',
        headingActions,
      ),
    );
    const nodeMeta = element('div', 'fwm-test-meta is-single');
    nodeMeta.append(field('画布节点名称', createNodeTitleControl()));
    panel.append(nodeMeta);
    const filterRow = element('div', 'fwm-summary');
    const search = element('input', 'fwm-input');
    search.placeholder = '搜索节点、字段或参数';
    const selectedCount = element(
      'span',
      '',
      `已选 ${selections.size} / ${state.candidates.length}`,
    );
    const selectAll = button('全选', 'ghost');
    const clearSelection = button('取消全选', 'ghost');
    const selectionActions = element('div', 'fwm-actions');
    selectionActions.append(selectAll, clearSelection);
    filterRow.append(search, selectionActions, selectedCount);
    panel.append(filterRow);
    const list = element('div', 'fwm-list');
    const checkboxes = new Map<string, HTMLInputElement>();
    const aliasInputs = new Map<string, HTMLInputElement>();
    const rows = new Map<string, HTMLElement>();
    const refreshSelectedCount = () => {
      const count = [...checkboxes.values()].filter((control) => control.checked).length;
      selectedCount.textContent = `已选 ${count} / ${state.candidates.length}`;
    };
    state.candidates.forEach((candidate, candidateIndex) => {
      const check = element('input', 'fwm-check');
      check.type = 'checkbox';
      check.checked = selections.has(candidate.id);
      check.setAttribute('aria-label', `外置参数：${candidate.nodeTitle} ${candidate.fieldName}`);
      checkboxes.set(candidate.id, check);
      const info = element('div');
      info.append(
        element('span', 'fwm-row-title', `${candidate.nodeTitle} · ${candidate.fieldName}`),
        element(
          'span',
          'fwm-row-meta',
          candidate.maximumItems && candidate.maximumItems > 1
            ? `动态素材口 / ${candidate.minimumItems || 0}–${candidate.maximumItems} 个 / ${candidate.mediaKind}`
            : `NODE ${candidate.nodeId} / ${candidate.classType} / ${candidate.valueType}`,
        ),
      );
      const alias = element('input', 'fwm-input fwm-binding-alias-input');
      alias.type = 'text';
      alias.maxLength = 40;
      alias.value =
        bindingForCandidate(state.bindingSet, candidate, candidateIndex)?.label ||
        suggestedBindingLabel(candidate);
      alias.placeholder = '输入画布显示名称';
      alias.setAttribute(
        'aria-label',
        `${candidate.nodeTitle} ${candidate.fieldName} 的画布显示名称`,
      );
      alias.setAttribute('data-fisherai-binding-label', candidate.id);
      const aliasEditor = element('div', 'fwm-binding-alias');
      aliasEditor.append(element('span', 'fwm-binding-alias-label', '画布显示名称'), alias);
      aliasInputs.set(candidate.id, alias);
      const kind = element(
        'span',
        'fwm-chip',
        candidate.control === 'asset' ? `${candidate.mediaKind || '媒体'}素材` : candidate.control,
      );
      const row = element('div', 'fwm-row fwm-binding-row');
      const refreshRow = () => {
        row.classList.toggle('is-selected', check.checked);
        aliasEditor.setAttribute('data-selected', String(check.checked));
        refreshSelectedCount();
      };
      check.addEventListener('change', refreshRow);
      alias.addEventListener('focus', () => {
        if (check.checked) return;
        check.checked = true;
        refreshRow();
      });
      row.append(check, info, aliasEditor, kind);
      refreshRow();
      rows.set(candidate.id, row);
      list.append(row);
    });
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase('zh-CN');
      selectAll.textContent = query ? '全选筛选结果' : '全选';
      clearSelection.textContent = query ? '取消筛选结果' : '取消全选';
      state.candidates.forEach((candidate) => {
        const haystack =
          `${candidate.nodeTitle} ${candidate.fieldName} ${candidate.nodeId} ${candidate.classType} ${aliasInputs.get(candidate.id)?.value || ''}`.toLocaleLowerCase(
            'zh-CN',
          );
        rows.get(candidate.id)!.hidden = Boolean(query && !haystack.includes(query));
      });
    });
    const setVisibleSelection = (checked: boolean) => {
      for (const [id, control] of checkboxes) {
        if (rows.get(id)?.hidden || control.disabled || control.checked === checked) continue;
        control.checked = checked;
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }
      refreshSelectedCount();
    };
    selectAll.addEventListener('click', () => setVisibleSelection(true));
    clearSelection.addEventListener('click', () => setVisibleSelection(false));
    panel.append(list);
    addWithoutTest.addEventListener('click', () => {
      void runBusy('正在创建工作流草稿节点…', async () => {
        if (!state.selected || !state.deployment || !state.bindingSet) {
          throw new Error('请先保存运行目标和参数配置。');
        }
        const blueprint = await client.createCanvasNode(state.selected.id, {
          ...(state.attestation
            ? { attestationId: state.attestation.id }
            : { deploymentId: state.deployment.id }),
          bindingSetId: state.bindingSet.id,
          title: state.nodeTitle.trim() || state.selected.name,
        });
        const adapter = window.__FISHERAI_WORKFLOW_NODES__;
        if (!adapter) throw new Error('画布节点适配器尚未加载，请刷新后重试。');
        const insertion = await adapter.addToCanvas(blueprint);
        focusInsertedWorkflow(insertion.nodeIds);
        setNotice(
          state.attestation
            ? '工作流已添加到画布。'
            : '工作流已作为未验证节点加入画布；首次运行时会检查配置。',
          'success',
        );
      });
    });
    save.addEventListener('click', () => {
      void runBusy('正在保存不可变参数版本…', async () => {
        const selected = state.candidates.filter(
          (candidate) => checkboxes.get(candidate.id)?.checked,
        );
        const previousBindingSetId = state.bindingSet?.id;
        state.bindingSet = await client.createBindingSet(state.selected!.id, {
          deploymentId: state.deployment!.id,
          ...(previousBindingSetId ? { previousBindingSetId } : {}),
          name: `画布参数 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
          bindings: selected.map((candidate) => ({
            candidateId: candidate.id,
            key: safeKey(candidate, state.candidates.indexOf(candidate)),
            label: aliasInputs.get(candidate.id)?.value.trim() || suggestedBindingLabel(candidate),
          })),
        });
        state.values = {};
        for (const binding of state.bindingSet.bindings) {
          if (binding.control.hasDefault) state.values[binding.key] = binding.control.defaultValue;
        }
        const syncedCanvasNode = await syncCurrentCanvasNode();
        if (state.attestation) {
          if (!syncedCanvasNode) {
            await client.createCanvasNode(state.selected!.id, {
              attestationId: state.attestation.id,
              bindingSetId: state.bindingSet.id,
              title: state.nodeTitle.trim() || state.selected!.name,
            });
          }
          await loadDeployedRecords();
          if (state.verifiedRun) {
            state.run = state.verifiedRun;
            state.outputCandidates = [...state.verifiedOutputCandidates];
            state.activeStage = 4;
            setNotice(
              `参数配置 r${state.bindingSet.revision} 已保存，无需重新测试；已返回部署结果。`,
              'success',
            );
          } else {
            state.activeStage = 2;
            setNotice(`参数配置 r${state.bindingSet.revision} 已保存，无需重新测试。`, 'success');
          }
          return;
        }
        state.verifiedRun = undefined;
        state.verifiedOutputCandidates = [];
        await loadDeployedRecords();
        state.activeStage = 2;
        setNotice(
          `参数配置 r${state.bindingSet.revision} 已保存；${syncedCanvasNode ? '当前画布节点已同步更新。' : '现在可直接加入画布。'}`,
          'success',
        );
      });
    });
  };

  const valueControl = (binding: BindingSet['bindings'][number]) => {
    const { control } = binding;
    if (control.kind === 'toggle') {
      const input = element('input', 'fwm-check');
      input.type = 'checkbox';
      input.checked = Boolean(state.values[binding.key]);
      input.addEventListener('change', () => {
        state.values[binding.key] = input.checked;
      });
      return input;
    }
    if (control.kind === 'select') {
      const select = element('select', 'fwm-select');
      for (const optionValue of control.options) {
        const option = element('option');
        option.value = optionValue.id;
        option.textContent = optionValue.label;
        option.selected = state.values[binding.key] === optionValue.id;
        select.append(option);
      }
      if (state.values[binding.key] === undefined && select.value)
        state.values[binding.key] = select.value;
      select.addEventListener('change', () => {
        state.values[binding.key] = select.value;
      });
      return select;
    }
    if (control.kind === 'asset') {
      const mediaKind = control.mediaKind || 'image';
      const presentation = assetControlPresentation(mediaKind);
      const wrapper = element('div', 'fwm-asset-control');
      const multiple = Boolean(control.multiple);
      const maximumItems = Math.max(1, Math.min(20, Number(control.maximumItems || 1)));
      wrapper.classList.toggle('is-multiple', multiple);
      wrapper.setAttribute('data-fisherai-compound-control', 'true');
      const selection = element('div', 'fwm-asset-selection');
      const picker = element('details', 'fwm-asset-picker');
      picker.setAttribute('data-fisherai-workflow-asset-picker', mediaKind);
      const trigger = element('summary', 'fwm-asset-trigger');
      trigger.setAttribute('aria-label', binding.label);
      let triggerThumb = element('span', 'fwm-asset-thumb', '◇');
      const triggerCopy = element('span', 'fwm-asset-trigger-copy');
      const triggerTitle = element('strong', '', '选择项目素材');
      const triggerMeta = element('span', '', presentation.label);
      triggerCopy.append(triggerTitle, triggerMeta);
      trigger.append(triggerThumb, triggerCopy, element('span', 'fwm-asset-chevron', '⌄'));
      const options = element('div', 'fwm-asset-options');
      options.setAttribute('role', 'listbox');
      options.append(element('div', 'fwm-asset-empty', '正在读取项目素材…'));
      picker.append(trigger, options);
      const assetValue = element('input');
      assetValue.type = 'hidden';
      assetValue.setAttribute('data-fisherai-workflow-asset-value', mediaKind);
      type Asset = Awaited<ReturnType<WorkflowManagerClient['listAssets']>>[number];
      type AssetReference = { assetId: string; projectId: string; type: string };
      const assetReference = (asset: Asset): AssetReference => ({
        assetId: asset.id,
        projectId: state.projectId!,
        type: mediaKind,
      });
      const selectedReferences = (): AssetReference[] => {
        const value = state.values[binding.key];
        const candidates = multiple ? (Array.isArray(value) ? value : []) : [value];
        return candidates.filter((candidate): candidate is AssetReference =>
          Boolean(
            candidate &&
            typeof candidate === 'object' &&
            typeof (candidate as AssetReference).assetId === 'string',
          ),
        );
      };
      const storeSelectedReferences = (references: AssetReference[]) => {
        if (multiple) {
          state.values[binding.key] = references;
          assetValue.value = references.map((reference) => reference.assetId).join(',');
        } else if (references[0]) {
          state.values[binding.key] = references[0];
          assetValue.value = references[0].assetId;
        } else {
          delete state.values[binding.key];
          assetValue.value = '';
        }
      };
      storeSelectedReferences(selectedReferences());
      const visual = (asset?: Asset) => {
        const frame = element('span', 'fwm-asset-thumb', asset ? '' : '◇');
        if (asset?.url && (mediaKind === 'image' || mediaKind === 'mask')) {
          const image = element('img');
          image.src = asset.url;
          image.alt = '';
          image.loading = 'lazy';
          frame.append(image);
        } else if (asset?.url && mediaKind === 'video') {
          const video = element('video');
          video.src = asset.url;
          video.muted = true;
          video.preload = 'metadata';
          frame.append(video);
        } else if (mediaKind === 'audio') {
          frame.textContent = '♫';
        }
        return frame;
      };
      const friendlyName = (asset: Asset, index: number) => {
        const filename = asset.filename || asset.id;
        return /^[0-9a-f-]{24,}\.[a-z0-9]+$/i.test(filename)
          ? `${presentation.label} ${index + 1}`
          : filename;
      };
      let loadedAssets: Asset[] = [];
      const syncOptionSelection = () => {
        const selectedIds = new Set(selectedReferences().map((reference) => reference.assetId));
        for (const option of options.querySelectorAll<HTMLElement>(
          '[data-fisherai-workflow-asset-id]',
        )) {
          const selected = selectedIds.has(option.dataset.fisheraiWorkflowAssetId || '');
          option.setAttribute('aria-selected', String(selected));
          option.closest('.fwm-asset-option')?.classList.toggle('is-selected', selected);
        }
      };
      const refreshSelection = () => {
        const references = selectedReferences();
        selection.replaceChildren();
        if (multiple) {
          const first = loadedAssets.find((asset) => asset.id === references[0]?.assetId);
          const nextThumb = visual(first);
          triggerThumb.replaceWith(nextThumb);
          triggerThumb = nextThumb;
          triggerTitle.textContent = `添加${presentation.label}`;
          triggerMeta.textContent = `已选 ${references.length} / 最多 ${maximumItems}`;
          references.forEach((reference, referenceIndex) => {
            const asset = loadedAssets.find((candidate) => candidate.id === reference.assetId);
            const item = element('div', 'fwm-asset-selected');
            const unlink = element('button', 'fwm-asset-unlink', '×');
            unlink.type = 'button';
            unlink.setAttribute(
              'aria-label',
              `移除${asset ? friendlyName(asset, referenceIndex) : `${presentation.label} ${referenceIndex + 1}`}`,
            );
            unlink.addEventListener('click', () => {
              storeSelectedReferences(
                selectedReferences().filter((candidate) => candidate.assetId !== reference.assetId),
              );
              refreshSelection();
              syncOptionSelection();
            });
            item.append(
              visual(asset),
              element(
                'span',
                'fwm-asset-selected-copy',
                asset
                  ? friendlyName(asset, referenceIndex)
                  : `${presentation.label} ${referenceIndex + 1}`,
              ),
              unlink,
            );
            selection.append(item);
          });
          return;
        }
        const reference = references[0];
        const asset = loadedAssets.find((candidate) => candidate.id === reference?.assetId);
        const nextThumb = visual(asset);
        triggerThumb.replaceWith(nextThumb);
        triggerThumb = nextThumb;
        triggerTitle.textContent = asset
          ? friendlyName(asset, loadedAssets.indexOf(asset))
          : '选择项目素材';
        triggerMeta.textContent = asset?.filename || presentation.label;
      };
      const selectAsset = (asset: Asset, _index: number, closePicker = true) => {
        const references = selectedReferences();
        if (multiple) {
          if (references.some((reference) => reference.assetId === asset.id)) {
            picker.open = false;
            return;
          }
          if (references.length >= maximumItems) {
            setNotice(`${binding.label}最多添加 ${maximumItems} 个素材。`, 'error');
            return;
          }
          storeSelectedReferences([...references, assetReference(asset)]);
        } else {
          storeSelectedReferences([assetReference(asset)]);
        }
        refreshSelection();
        syncOptionSelection();
        if (closePicker) picker.open = false;
      };
      const clearSelectedAsset = (assetId?: string) => {
        storeSelectedReferences(
          assetId ? selectedReferences().filter((reference) => reference.assetId !== assetId) : [],
        );
        refreshSelection();
        syncOptionSelection();
      };
      const renderAssetOptions = () => {
        options.replaceChildren();
        if (!loadedAssets.length) {
          options.append(element('div', 'fwm-asset-empty', '项目里还没有此类素材'));
          return;
        }
        loadedAssets.forEach((asset, index) => {
          const item = element('div', 'fwm-asset-option');
          const option = element('button', 'fwm-asset-option-main');
          option.type = 'button';
          option.setAttribute('role', 'option');
          option.setAttribute('data-fisherai-workflow-asset-id', asset.id);
          const selected = selectedReferences().some((reference) => reference.assetId === asset.id);
          option.setAttribute('aria-selected', String(selected));
          item.classList.toggle('is-selected', selected);
          const copy = element('span', 'fwm-asset-option-copy');
          copy.append(
            element('strong', '', friendlyName(asset, index)),
            element('span', '', asset.filename || asset.id),
          );
          option.append(visual(asset), copy);
          option.addEventListener('click', (event) => {
            event.preventDefault();
            selectAsset(asset, index);
          });
          const remove = element('button', 'fwm-asset-delete');
          remove.type = 'button';
          remove.setAttribute('aria-label', `删除 ${friendlyName(asset, index)}`);
          remove.title = '删除素材记录';
          remove.setAttribute('data-fisherai-workflow-asset-delete', asset.id);
          remove.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const name = friendlyName(asset, index);
            void (async () => {
              const confirmed = await requestAnchoredConfirmation({
                anchor: remove,
                intent: 'destructive',
                title: '移除素材记录？',
                description: `“${name}”将移入可恢复记录；画布中的节点不受影响。`,
                confirmLabel: '移除',
              });
              if (!confirmed) return;
              remove.disabled = true;
              remove.textContent = '移除中…';
              try {
                await client.trashAsset(state.projectId!, mediaKind, asset.id);
                loadedAssets = loadedAssets.filter((candidate) => candidate.id !== asset.id);
                clearSelectedAsset(asset.id);
                renderAssetOptions();
                setNotice(`“${name}”已移入可恢复记录。`, 'success');
              } catch (error) {
                remove.disabled = false;
                remove.textContent = '';
                setNotice(messageFor(error), 'error');
              }
            })();
          });
          item.append(option, remove);
          options.append(item);
        });
      };
      void client
        .listAssets(state.projectId!, mediaKind)
        .then((assets) => {
          loadedAssets = assets;
          renderAssetOptions();
          refreshSelection();
          syncOptionSelection();
        })
        .catch(() =>
          options.replaceChildren(element('div', 'fwm-asset-empty', '读取素材失败，请稍后重试')),
        );
      const uploadInput = element('input');
      uploadInput.type = 'file';
      uploadInput.accept = presentation.accept;
      uploadInput.hidden = true;
      uploadInput.setAttribute('aria-label', `上传${presentation.label}`);
      uploadInput.setAttribute('data-fisherai-workflow-asset-upload', mediaKind);
      const upload = button(`上传${presentation.label}`, 'quiet');
      upload.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        uploadInput.click();
      });
      uploadInput.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        uploadInput.value = '';
        if (!file) return;
        void runBusy(`正在上传${presentation.label}“${file.name}”…`, async () => {
          const asset = await client.uploadAsset(state.projectId!, mediaKind, file);
          const references = selectedReferences();
          storeSelectedReferences(
            multiple
              ? [
                  ...references.filter((reference) => reference.assetId !== asset.id),
                  assetReference(asset),
                ].slice(0, maximumItems)
              : [assetReference(asset)],
          );
          setNotice(`${presentation.label}“${file.name}”已上传并选中。`, 'success');
        });
      });
      wrapper.append(selection, picker, upload, uploadInput, assetValue);
      return wrapper;
    }
    if (control.kind === 'seed') {
      const wrapper = element('div', 'fwm-select-row');
      const mode = element('select', 'fwm-select');
      mode.append(new Option('固定', 'fixed'), new Option('每次随机', 'random'));
      const number = element('input', 'fwm-input');
      number.type = 'number';
      const current = state.values[binding.key] as { mode?: string; value?: number } | undefined;
      const defaultSeed = control.defaultValue as { value?: unknown } | undefined;
      const currentSeedValue = current?.value;
      const declaredSeedValue = defaultSeed?.value;
      let lastValidValue =
        currentSeedValue !== undefined &&
        currentSeedValue !== null &&
        String(currentSeedValue).trim() !== '' &&
        Number.isFinite(Number(currentSeedValue))
          ? Number(currentSeedValue)
          : declaredSeedValue !== undefined &&
              declaredSeedValue !== null &&
              String(declaredSeedValue).trim() !== '' &&
              Number.isFinite(Number(declaredSeedValue))
            ? Number(declaredSeedValue)
            : 1;
      mode.value = current?.mode || 'fixed';
      number.value = String(lastValidValue);
      const commitNumber = () => {
        const rawValue = number.value.trim();
        if (rawValue === '') return;
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) return;
        lastValidValue = numericValue;
        state.values[binding.key] = { mode: 'fixed', value: numericValue };
      };
      const updateMode = () => {
        number.disabled = mode.value === 'random';
        if (mode.value === 'random') {
          state.values[binding.key] = { mode: 'random' };
          return;
        }
        if (number.value.trim() === '' || !Number.isFinite(Number(number.value))) {
          number.value = String(lastValidValue);
        }
        commitNumber();
      };
      mode.addEventListener('change', updateMode);
      number.addEventListener('input', commitNumber);
      number.addEventListener('blur', () => {
        if (number.value.trim() === '' || !Number.isFinite(Number(number.value))) {
          number.value = String(lastValidValue);
        } else {
          number.value = String(Number(number.value));
          commitNumber();
        }
      });
      updateMode();
      wrapper.append(mode, number);
      return wrapper;
    }
    if (['number', 'slider'].includes(control.kind)) {
      const input = element('input', 'fwm-input');
      input.type = 'number';
      if (control.minimum !== undefined) input.min = String(control.minimum);
      if (control.maximum !== undefined) input.max = String(control.maximum);
      if (control.step !== undefined) input.step = String(control.step);
      const persistedValue = state.values[binding.key];
      const initialValue =
        persistedValue !== undefined &&
        persistedValue !== null &&
        String(persistedValue).trim() !== ''
          ? persistedValue
          : control.defaultValue;
      let lastValidValue =
        initialValue !== undefined &&
        initialValue !== null &&
        String(initialValue).trim() !== '' &&
        Number.isFinite(Number(initialValue))
          ? Number(initialValue)
          : 0;
      input.value = String(lastValidValue);
      input.addEventListener('input', () => {
        const rawValue = input.value.trim();
        if (rawValue === '') return;
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) return;
        lastValidValue = numericValue;
        state.values[binding.key] = numericValue;
      });
      input.addEventListener('blur', () => {
        if (input.value.trim() === '' || !Number.isFinite(Number(input.value))) {
          input.value = String(lastValidValue);
          return;
        }
        input.value = String(Number(input.value));
      });
      return input;
    }
    const input = element(
      control.kind === 'textarea' ? 'textarea' : 'input',
      control.kind === 'textarea' ? 'fwm-textarea' : 'fwm-input',
    );
    input.value = String(state.values[binding.key] ?? '');
    input.addEventListener('input', () => {
      state.values[binding.key] = input.value;
    });
    return input;
  };

  const pollRun = async (runId: string, token: number) => {
    state.pollingPaused = false;
    const observation = await observeWorkflowRun(client, runId, {
      shouldContinue: () => token === pollToken,
      onRun: async (run) => {
        const definition =
          state.definitions.find((item) => item.id === run.definitionId) || state.selected;
        if (
          definition &&
          (state.selected?.id !== definition.id ||
            (run.deploymentId && state.deployment?.id !== run.deploymentId) ||
            (run.bindingSetId && state.bindingSet?.id !== run.bindingSetId))
        ) {
          await hydrate(definition, run);
        }
        state.run = run;
        state.projectId = run.projectId || state.projectId;
        persistRunReference(state.selected!.id, runId);
        refreshStatus();
        if (cleanupObservationPending(run)) {
          setNotice('任务已结束，正在核对 ComfyUI 暂存输入。');
        } else if (run.status === 'loading') {
          setNotice(
            `${isRunningHubRunner(run.runner) ? 'RunningHub' : 'ComfyUI'} 正在执行：${run.phase || '运行中'}`,
          );
        }
        render();
      },
      onRetry: (_error, attempt) => {
        setNotice(`与本机服务的查询暂时中断，正在第 ${attempt} 次自动重连…`);
      },
    });
    if (token !== pollToken) return;
    if (observation.paused || !observation.run) {
      state.pollingPaused = true;
      setNotice(
        observation.error
          ? `查询已暂停：${messageFor(observation.error)}。可点击“继续查询”，不会重复运行。`
          : '查询已暂停，可点击“继续查询”。',
        'error',
      );
      render();
      return;
    }
    const run = observation.run;
    state.run = run;
    state.pollingPaused = false;
    if (run.status === 'success') {
      try {
        state.outputCandidates = await client.listOutputCandidates(state.selected!.id, runId);
        state.activeStage = 4;
        setNotice(`测试完成，找到 ${state.outputCandidates.length} 个输出。`, 'success');
      } catch (error) {
        state.pollingPaused = true;
        setNotice(`输出读取暂时失败：${messageFor(error)}。可点击“继续查询”恢复。`, 'error');
      }
    } else if (run.phase === 'observation-paused') {
      setNotice(terminalRunNotice(run));
    } else {
      setNotice(terminalRunNotice(run), 'error');
    }
    render();
  };

  const renderCleanupSummary = () => {
    if (!state.run?.inputCleanup) return;
    const cleanup = element('div', 'fwm-summary');
    const label =
      state.run.inputCleanup.state === 'retained-cache'
        ? '输入副本保留在 ComfyUI 缓存'
        : state.run.inputCleanup.state === 'cleaned'
          ? 'ComfyUI 暂存输入已清理'
          : state.run.inputCleanup.state === 'orphaned'
            ? 'ComfyUI 暂存输入尚未清理'
            : '正在核对 ComfyUI 暂存输入';
    cleanup.append(
      element('strong', '', label),
      element('span', '', `${(state.run.inputCleanup.totalBytes / 1024 / 1024).toFixed(1)} MiB`),
    );
    if (state.run.inputCleanup.retryable) {
      const retry = button('重试清理');
      retry.addEventListener('click', () => {
        void runBusy('正在重新核对并清理暂存输入…', async () => {
          let confirmRemoteStopped = false;
          if (state.run!.remoteMayContinue) {
            confirmRemoteStopped = await requestAnchoredConfirmation({
              anchor: retry,
              intent: 'remote-risk',
              title: '确认远端任务已停止？',
              description: '请先在 ComfyUI 队列中确认任务已停止。继续后才会删除本次暂存输入。',
              confirmLabel: '已停止，清理',
            });
            if (!confirmRemoteStopped) return;
          }
          const result = await client.retryInputCleanup(state.run!.runId, {
            confirmRemoteStopped,
          });
          state.run!.inputCleanup = {
            state: result.state,
            totalBytes: result.totalBytes,
            retryable: false,
            updatedAt: result.updatedAt,
          };
          setNotice('ComfyUI 暂存输入已经核对并清理。', 'success');
        });
      });
      cleanup.append(retry);
    }
    panel.append(cleanup);
  };

  const createNodeTitleControl = () => {
    const control = element('input', 'fwm-input');
    control.value = state.nodeTitle || state.selected?.name || '工作流';
    control.maxLength = 120;
    control.setAttribute('aria-label', '画布节点名称');
    control.addEventListener('input', () => {
      state.nodeTitle = control.value;
    });
    return control;
  };

  const renderTest = () => {
    const preflight = button('只检查', 'quiet');
    const run = button('运行真实测试', 'primary');
    const actions = element('div', 'fwm-actions');
    actions.append(preflight, run);
    if (state.run?.status === 'loading') {
      if (state.run.phase === 'observation-paused') {
        const continueObservation = button('继续观察', 'primary');
        continueObservation.addEventListener('click', () => {
          void runBusy('正在继续观察同一 ComfyUI 任务…', async () => {
            state.run = await client.continueObservation(state.run!.runId);
            pollToken += 1;
            const token = pollToken;
            setNotice('已继续观察同一 ComfyUI 任务；不会重复提交工作流。');
            void pollRun(state.run.runId, token).catch((error) => {
              setNotice(messageFor(error), 'error');
            });
          });
        });
        actions.append(continueObservation);
      }
      const cancel = button('取消');
      cancel.addEventListener('click', () => {
        void runBusy('正在安全取消任务…', async () => {
          state.run = await client.cancelRun(state.run!.runId);
          setNotice(
            isRunningHubRunner(state.run.runner)
              ? '画布已停止等待；请到 RunningHub 任务列表确认远程状态。'
              : '取消请求已发送，正在确认 ComfyUI 端状态。',
          );
        });
      });
      actions.append(cancel);
    }
    appendPollingResume(actions);
    panel.append(
      panelHeading(
        '填写参数并测试',
        isRunningHubRunner(state.deployment?.runner)
          ? '“只检查”不会上传素材或计费；真实测试会提交一次 RunningHub 付费任务。'
          : '“只检查”不会上传素材或运行；真实测试会在本机 ComfyUI 产生一次任务。',
        actions,
      ),
    );
    if (state.attestation) {
      const record = element('div', 'fwm-summary fwm-verification-record');
      const recordCopy = element('div');
      recordCopy.append(
        element('strong', '', '已验证记录'),
        element(
          'span',
          '',
          `${new Date(state.attestation.succeededAt || state.attestation.createdAt).toLocaleString('zh-CN', { hour12: false })} · RUN ${state.attestation.runId.slice(0, 12)}`,
        ),
      );
      if (state.verifiedRun) {
        const view = button('返回已部署结果', 'quiet');
        view.addEventListener('click', () => {
          state.run = state.verifiedRun;
          state.outputCandidates = [...state.verifiedOutputCandidates];
          state.activeStage = 4;
          render();
        });
        record.append(recordCopy, view);
      } else {
        record.append(recordCopy, element('span', 'fwm-chip is-ok', '验证凭证已归档'));
      }
      panel.append(record);
    }
    const project = element('select', 'fwm-select');
    for (const item of state.projects) {
      const option = new Option(item.title, item.id);
      option.selected = item.id === state.projectId;
      project.append(option);
    }
    if (!state.projectId && project.value) state.projectId = project.value;
    project.addEventListener('change', () => {
      state.projectId = project.value;
      for (const binding of state.bindingSet!.bindings) {
        if (binding.control.kind === 'asset') delete state.values[binding.key];
      }
      render();
    });
    const meta = element('div', 'fwm-test-meta');
    meta.append(field('画布节点名称', createNodeTitleControl()), field('测试结果保存到', project));
    const metaSection = element('section', 'fwm-test-section');
    const metaHead = element('div', 'fwm-test-section-head');
    metaHead.append(
      element('strong', 'fwm-test-section-title', '运行信息'),
      element('span', 'fwm-test-section-copy', '名称用于画布节点；测试结果保存到所选项目。'),
    );
    metaSection.append(metaHead, meta);
    panel.append(metaSection);

    const bindings = state.bindingSet!.bindings;
    const candidateFor = (binding: BindingSet['bindings'][number]) =>
      state.candidates.find((item, index) => binding.key === safeKey(item, index));
    const textKinds = new Set(['text', 'textarea', 'string', 'prompt', 'multiline']);
    const textBindings = bindings.filter(
      (binding) =>
        binding.control.kind !== 'asset' &&
        textKinds.has(String(binding.control.kind || '').toLowerCase()),
    );
    const parameterBindings = bindings.filter(
      (binding) => binding.control.kind !== 'asset' && !textBindings.includes(binding),
    );
    const assetBindings = bindings.filter((binding) => binding.control.kind === 'asset');
    const bindingLabelInputs = new Map<string, HTMLInputElement>();
    const initialBindingLabels = new Map<string, string>();

    const persistBindingLabels = async () => {
      const selections = state.candidates.flatMap((candidate, candidateIndex) => {
        const binding = bindingForCandidate(state.bindingSet, candidate, candidateIndex);
        if (!binding) return [];
        const control = bindingLabelInputs.get(binding.id);
        const initial = initialBindingLabels.get(binding.id) || binding.label;
        const edited = control?.value.trim() || '';
        const label = edited && edited !== initial ? edited : binding.label;
        return [
          {
            candidateId: candidate.id,
            key: binding.key,
            label,
          },
        ];
      });
      if (selections.length !== bindings.length) {
        throw new Error('参数候选已经变化，请返回外置参数页面重新保存。');
      }
      const labelsByKey = new Map(bindings.map((binding) => [binding.key, binding.label]));
      if (!selections.some((selection) => selection.label !== labelsByKey.get(selection.key))) {
        return false;
      }
      state.bindingSet = await client.createBindingSet(state.selected!.id, {
        deploymentId: state.deployment!.id,
        previousBindingSetId: state.bindingSet!.id,
        name: `参数名称 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        bindings: selections,
      });
      await syncCurrentCanvasNode();
      return true;
    };

    const bindingNameEditor = (
      binding: BindingSet['bindings'][number],
      displayLabel = binding.label,
    ) => {
      const control = element('input', 'fwm-inline-binding-name');
      control.value = displayLabel;
      control.maxLength = 120;
      control.size = Math.max(4, Math.min(24, displayLabel.length + 1));
      control.title = '点击修改参数名称';
      control.setAttribute('aria-label', `修改${displayLabel}名称`);
      control.setAttribute('data-fisherai-test-binding-label', binding.id);
      control.addEventListener('input', () => {
        control.size = Math.max(4, Math.min(24, control.value.length + 1));
      });
      control.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') control.blur();
        if (event.key === 'Escape') {
          control.value = initialBindingLabels.get(binding.id) || binding.label;
          control.blur();
        }
      });
      control.addEventListener('change', () => {
        void runBusy('正在保存参数名称…', async () => {
          if (await persistBindingLabels()) {
            setNotice('参数名称已保存并同步到画布；运行配置保持不变。', 'success');
          }
        });
      });
      bindingLabelInputs.set(binding.id, control);
      initialBindingLabels.set(binding.id, displayLabel);
      return control;
    };

    const appendBindingSection = (
      title: string,
      copy: string,
      sectionBindings: BindingSet['bindings'],
      wide = false,
    ) => {
      if (!sectionBindings.length) return;
      const section = element('section', 'fwm-test-section');
      const sectionHead = element('div', 'fwm-test-section-head');
      sectionHead.append(
        element('strong', 'fwm-test-section-title', title),
        element('span', 'fwm-test-section-copy', copy),
      );
      const sectionGrid = element('div', 'fwm-test-grid');
      for (const binding of sectionBindings) {
        const wrapper = field(
          bindingNameEditor(binding),
          valueControl(binding),
          bindingSource(candidateFor(binding)),
        );
        if (wide) wrapper.classList.add('is-wide');
        sectionGrid.append(wrapper);
      }
      section.append(sectionHead, sectionGrid);
      panel.append(section);
    };

    appendBindingSection(
      '提示内容',
      '长文本独占整行，避免和数值控件互相挤压。',
      textBindings,
      true,
    );
    appendBindingSection('生成参数', '尺寸、时长、步数和选项集中排列。', parameterBindings);

    if (assetBindings.length) {
      const section = element('section', 'fwm-test-section');
      const sectionHead = element('div', 'fwm-test-section-head');
      const requiredCount = assetBindings.filter((binding) => binding.control.required).length;
      const dynamicCount = assetBindings.filter((binding) => binding.control.multiple).length;
      sectionHead.append(
        element('strong', 'fwm-test-section-title', '参考素材'),
        element(
          'span',
          'fwm-test-section-copy',
          dynamicCount
            ? `${dynamicCount} 个动态素材口；添加几个就接入几个，未使用分支不会提交。`
            : `${requiredCount} 个必填槽位；每个槽位对应 ComfyUI 中一个独立输入。`,
        ),
      );
      section.append(sectionHead);
      const groups = new Map<string, BindingSet['bindings']>();
      for (const binding of assetBindings) {
        const mediaKind = binding.control.mediaKind || 'image';
        groups.set(mediaKind, [...(groups.get(mediaKind) || []), binding]);
      }
      for (const [mediaKind, groupBindings] of groups) {
        const presentation = assetControlPresentation(mediaKind);
        const group = element('div', 'fwm-asset-kind');
        group.append(
          element(
            'div',
            'fwm-asset-kind-title',
            groupBindings.length === 1 && groupBindings[0].control.multiple
              ? `${presentation.label}素材 · ${groupBindings[0].control.minimumItems || 0}–${groupBindings[0].control.maximumItems || 1} 个`
              : `${presentation.label}素材 · ${groupBindings.length} 个槽位`,
          ),
        );
        const assetGrid = element('div', 'fwm-test-grid');
        groupBindings.forEach((binding, index) => {
          const displayLabel =
            groupBindings.length > 1 ? `${presentation.label} ${index + 1}` : binding.label;
          assetGrid.append(
            field(
              bindingNameEditor(binding, displayLabel),
              valueControl(binding),
              bindingSource(candidateFor(binding)),
            ),
          );
        });
        group.append(assetGrid);
        section.append(group);
      }
      panel.append(section);
    }
    if (state.run?.status === 'loading') {
      const progress = element('div', 'fwm-summary fwm-run');
      const progressLine = element('div', 'fwm-run-line');
      const value = Number(state.run.progress?.value);
      const maximum = Number(state.run.progress?.maximum);
      if (Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0) {
        progressLine.classList.add('is-determinate');
        progressLine.style.setProperty(
          '--fwm-progress',
          `${Math.min(100, Math.max(0, (value / maximum) * 100))}%`,
        );
      }
      const progressCopy = element('div', 'fwm-run-copy');
      progressCopy.append(
        element(
          'strong',
          '',
          state.run.phase === 'observation-paused'
            ? '观察已暂停，生成未取消'
            : state.run.phase ||
                `${isRunningHubRunner(state.run.runner) ? 'RunningHub' : 'ComfyUI'} 正在执行`,
        ),
        element(
          'span',
          'fwm-run-detail',
          state.run.phase === 'observation-paused'
            ? terminalRunNotice(state.run)
            : workflowRunProgressLabel(state.run),
        ),
      );
      progress.append(progressCopy, progressLine);
      panel.append(progress);
    }
    renderCleanupSummary();
    const request = () => ({
      deploymentId: state.deployment!.id,
      bindingSetId: state.bindingSet!.id,
      projectId: state.projectId,
      values: state.values,
    });
    preflight.disabled = state.run?.status === 'loading';
    run.disabled = state.run?.status === 'loading';
    preflight.addEventListener('click', () => {
      void runBusy('正在执行无副作用检查…', async () => {
        const result = await client.preflight(state.selected!.id, request());
        setNotice(`检查通过：${result.checks.map((check) => check.message).join('；')}`, 'success');
      });
    });
    run.addEventListener('click', () => {
      void runBusy('正在创建测试任务…', async () => {
        const paid = isRunningHubRunner(state.deployment?.runner);
        if (
          paid &&
          !(await requestAnchoredConfirmation({
            anchor: run,
            intent: 'paid',
            title: '提交 RunningHub 付费测试？',
            description: '本次真实测试会产生费用；取消后远端任务仍可能继续。',
            confirmLabel: '确认并测试',
            rememberKey: RUNNINGHUB_PAID_CONFIRMATION_KEY,
          }))
        )
          return;
        state.run = await client.startRun(state.selected!.id, {
          ...request(),
          confirmExecution: true,
          ...(paid ? { confirmPaidExecution: true } : {}),
        });
        persistRunReference(state.selected!.id, state.run.runId);
        pollToken += 1;
        const token = pollToken;
        setNotice('测试任务已创建；关闭设置不会中断任务。');
        void pollRun(state.run.runId, token).catch((error) => {
          setNotice(messageFor(error), 'error');
        });
      });
    });
  };

  const renderOutputs = () => {
    const complete = button(
      state.attestation ? '生成画布节点' : '确认输出并生成画布节点',
      'primary',
    );
    complete.classList.add('fwm-output-confirm');
    panel.append(
      panelHeading(
        '确定画布节点输出',
        '可以保留多个输出，但必须指定一个主输出。这里只引用已保存到当前项目的结果。',
        complete,
      ),
    );
    const nodeMeta = element('div', 'fwm-test-meta is-single');
    nodeMeta.append(field('画布节点名称', createNodeTitleControl()));
    panel.append(nodeMeta);
    renderCleanupSummary();
    const list = element('div', 'fwm-list');
    const selected = new Map<string, HTMLInputElement>();
    const primary = new Map<string, HTMLInputElement>();
    const outputDisplayName = (candidate: OutputCandidate) => {
      if (candidate.displayName) return candidate.displayName;
      if (candidate.kind === 'file' && candidate.mediaKind === 'video') return '视频文件';
      if (candidate.kind === 'file' && candidate.mediaKind === 'audio') return '音频文件';
      if (candidate.kind === 'file' && ['image', 'mask'].includes(candidate.mediaKind)) {
        return '图片文件';
      }
      return `${candidate.classType} · ${candidate.outputKey}`;
    };
    const resultCandidates = state.outputCandidates.filter(
      (candidate) => candidate.selectable !== false && candidate.category !== 'metadata',
    );
    const metadataCandidates = state.outputCandidates.filter(
      (candidate) => candidate.selectable === false || candidate.category === 'metadata',
    );
    resultCandidates.forEach((candidate, index) => {
      const keep = element('input', 'fwm-check');
      keep.type = 'checkbox';
      keep.checked = true;
      const main = element('input', 'fwm-check');
      main.type = 'radio';
      main.name = `fwm-primary-${state.run!.runId}`;
      main.checked = index === 0;
      selected.set(candidate.id, keep);
      primary.set(candidate.id, main);
      const info = element('div');
      info.append(
        element('span', 'fwm-row-title', outputDisplayName(candidate)),
        element(
          'span',
          'fwm-row-meta fwm-output-source',
          `类型：${candidate.mediaKind} · 来源：${candidate.classType} · NODE ${candidate.nodeId} / INDEX ${candidate.outputIndex}`,
        ),
      );
      const kind = element('span', 'fwm-chip', candidate.mediaKind);
      const row = element('div', 'fwm-row fwm-output');
      row.append(keep, main, info, kind);
      list.append(row);
    });
    if (!resultCandidates.length) {
      list.append(element('div', 'fwm-empty', '没有可绑定的文件、文本或结构化结果。'));
      if (!state.attestation) complete.disabled = true;
    }
    panel.append(list);
    if (metadataCandidates.length) {
      const advanced = element('details', 'fwm-output-metadata');
      const summary = element('summary', '', `高级元数据（${metadataCandidates.length}）`);
      const metadataList = element('div', 'fwm-output-metadata-list');
      metadataCandidates.forEach((candidate) => {
        const info = element('div');
        info.append(
          element('span', 'fwm-row-title', outputDisplayName(candidate)),
          element(
            'span',
            'fwm-row-meta fwm-output-source',
            `${candidate.outputKey}${candidate.valuePreview == null ? '' : `：${candidate.valuePreview}`} · ${candidate.description || '内部元数据，不作为画布输出'}`,
          ),
        );
        const kind = element('span', 'fwm-chip', '元数据');
        const row = element('div', 'fwm-row fwm-output-metadata-row');
        row.append(info, kind);
        metadataList.append(row);
      });
      advanced.append(summary, metadataList);
      panel.append(advanced);
    }
    complete.addEventListener('click', () => {
      void runBusy('正在确认输出并生成画布节点…', async () => {
        if (!state.attestation) {
          const outputs = resultCandidates.filter(
            (candidate) => selected.get(candidate.id)?.checked,
          );
          const primaryCandidate = outputs.find((candidate) => primary.get(candidate.id)?.checked);
          if (!outputs.length || !primaryCandidate) {
            throw new Error('请保留至少一个输出，并指定主输出。');
          }
          const outputSet = await client.createOutputBindingSet(state.selected!.id, {
            sourceRunId: state.run!.runId,
            name: '画布输出',
            outputs: outputs.map((candidate, index) => ({
              candidateId: candidate.id,
              key: `output_${index + 1}`,
              label: outputDisplayName(candidate),
              primary: candidate.id === primaryCandidate.id,
            })),
          });
          state.outputBindingSetId = outputSet.id;
          state.attestation = await client.createAttestation(state.selected!.id, {
            runId: state.run!.runId,
            deploymentId: state.deployment!.id,
            bindingSetId: state.bindingSet!.id,
            outputBindingSetId: outputSet.id,
          });
          state.verifiedRun = state.run;
          state.verifiedOutputCandidates = [...state.outputCandidates];
          const completedRecord: DeployedWorkflowRecord = {
            definition: state.selected!,
            attestation: state.attestation,
            deployment: state.deployment,
            bindingSet: state.bindingSet,
            automaticCover: automaticWorkflowCover(state.run),
            verifiedRun: state.run,
            verifiedProjectId: state.projectId,
            verifiedValues: structuredClone(state.values),
          };
          await loadDeployedRecords();
          const completedIndex = state.deployedRecords.findIndex(
            (record) => record.attestation?.id === completedRecord.attestation?.id,
          );
          if (completedIndex >= 0) {
            state.deployedRecords[completedIndex] = {
              ...state.deployedRecords[completedIndex],
              ...completedRecord,
            };
          } else {
            state.deployedRecords.unshift(completedRecord);
          }
        }

        const blueprint = await client.createCanvasNode(state.selected!.id, {
          attestationId: state.attestation!.id,
          bindingSetId: state.bindingSet!.id,
          title: state.nodeTitle.trim() || state.selected!.name,
        });
        const adapter = window.__FISHERAI_WORKFLOW_NODES__;
        if (!adapter) throw new Error('画布节点适配器尚未加载，请刷新后重试。');
        const verifiedRun = state.verifiedRun || state.run;
        if (verifiedRun?.status !== 'success' || !state.projectId) {
          throw new Error('找不到本次成功测试的输入和输出，请重新打开已验证记录。');
        }
        const verifiedValues = await enrichVerifiedAssetValues(client, state.values);
        const insertion = await adapter.addToCanvas(blueprint, {
          run: verifiedRun,
          projectId: state.projectId,
          values: verifiedValues,
        });
        focusInsertedWorkflow(insertion.nodeIds);
        setNotice('本次输入、工作流和实际输出已加入画布，并已定位到节点组。', 'success');
      });
    });
    if (state.attestation) {
      const proof = element('div', 'fwm-proof');
      proof.append(
        document.createTextNode('验证通过 · 凭证 '),
        element('code', '', state.attestation.attestationHash.slice(0, 16)),
        document.createTextNode('…  配置和输出已锁定。'),
      );
      panel.append(proof);
    }
  };

  const renderRequestedDefinitionState = () => {
    const loading = requestedDefinitionState === 'loading';
    const card = element('section', 'fwm-empty');
    card.setAttribute('data-fisherai-state', loading ? 'loading' : 'error');
    card.setAttribute('role', loading ? 'status' : 'alert');
    const copy = element('div');
    copy.append(
      element('strong', '', loading ? '正在读取当前工作流' : '无法读取当前工作流'),
      element(
        'p',
        'fwm-panel-copy',
        loading
          ? '正在加载这个画布节点已经绑定的外置参数和部署记录。请稍候，无需重新导入工作流。'
          : '当前节点和工作流仍保留在画布中，不需要重新导入。',
      ),
    );
    if (loading) {
      const progress = element('div', 'fwm-run-line');
      progress.setAttribute('role', 'progressbar');
      progress.setAttribute('aria-label', '正在读取当前工作流');
      copy.append(progress);
    } else {
      if (requestedDefinitionError) {
        copy.append(element('p', 'fwm-notice is-error', requestedDefinitionError));
      }
      const retry = button('重试读取', 'primary');
      retry.addEventListener('click', () => void loadRequestedDefinition());
      copy.append(retry);
    }
    card.replaceChildren(copy);
    panel.append(card);
  };

  function render() {
    panel.replaceChildren();
    if (requestedDefinitionId && requestedDefinitionState !== 'ready') {
      status.textContent = requestedDefinitionState === 'loading' ? '正在读取' : '读取失败';
      status.classList.remove('is-ready');
      libraryBack.hidden = true;
      head.hidden = false;
      rail.hidden = true;
      panel.className = 'fwm-panel';
      renderRequestedDefinitionState();
      return;
    }
    refreshStatus();
    const libraryHome = libraryContext && managerView === 'library';
    libraryBack.disabled = false;
    libraryBack.hidden = !libraryContext || libraryHome;
    head.hidden = libraryHome;
    rail.hidden = libraryHome;
    panel.className = libraryHome ? 'fwm-panel fwm-library-panel' : 'fwm-panel';
    if (libraryHome) {
      renderLibraryHome();
      return;
    }
    renderRail();
    const reachable = stageReachable(state, state.activeStage);
    if (!reachable) state.activeStage = currentStage(state);
    if (state.activeStage === 0) renderSource();
    else if (state.activeStage === 1) renderDeployment();
    else if (state.activeStage === 2) renderBindings();
    else if (state.activeStage === 3) renderTest();
    else renderOutputs();
  }

  async function loadRequestedDefinition() {
    if (!requestedDefinitionId) return;
    requestedDefinitionState = 'loading';
    requestedDefinitionError = '';
    resetDraft();
    render();
    try {
      if (canvasNodeEditContext) {
        const snapshot = await client.getEditorSnapshot(requestedDefinitionId);
        state.definitions = [snapshot.definition];
        state.projects = [];
        state.projectId = undefined;
        projectsLoaded = false;
        applyHydratedState(snapshot);
      } else {
        const [definition, projects] = await Promise.all([
          client.getDefinition(requestedDefinitionId),
          client.listProjects(),
        ]);
        state.definitions = [definition];
        state.projects = projects;
        state.projectId = projects[0]?.id;
        projectsLoaded = true;
        await hydrate(definition);
      }
      requestedDefinitionState = 'ready';
      if (options.initialStage !== undefined && stageReachable(state, options.initialStage))
        state.activeStage = options.initialStage;
    } catch (error) {
      requestedDefinitionState = 'error';
      requestedDefinitionError = messageFor(error);
    }
    render();
  }

  const importFiles = (files: File[]) => {
    if (!files.length || host.dataset.busy === 'true') return;
    void runBusy('正在校验并保存原始工作流字节…', async () => {
      const quickImport = uploadMode === 'quick';
      let definitionId = uploadMode === 'append' ? state.selected?.id : undefined;
      let definition: WorkflowDefinition | undefined;
      for (const file of files) {
        definition = await client.importArtifact({ file, definitionId });
        definitionId = definition.id;
      }
      definition = await autoPair(client, definition!);
      state.definitions = await client.listDefinitions();
      await hydrate(definition);
      if (quickImport) {
        if (!definition.executionPlan) {
          managerView = 'manager';
          state.activeStage = 0;
          setNotice('已保存 UI Format；还需要对应的 API Format。请在高级管理中补充文件。', 'error');
          return;
        }
        try {
          const deployed = await client.createDeployment(definition.id, {
            runner: 'local-comfyui',
            serverUrl: '127.0.0.1:8188',
            timeoutMs: 60 * 60_000,
          });
          state.deployment = { ...deployed.deployment, createdAt: new Date().toISOString() };
          state.candidates = deployed.candidates;
          const selected = quickBindingCandidates(state.candidates);
          state.bindingSet = await client.createBindingSet(definition.id, {
            deploymentId: state.deployment.id,
            name: '自动识别参数',
            bindings: selected.map((candidate) => ({
              candidateId: candidate.id,
              key: safeKey(candidate, state.candidates.indexOf(candidate)),
              label: suggestedBindingLabel(candidate),
            })),
          });
          const blueprint = await client.createCanvasNode(definition.id, {
            deploymentId: state.deployment.id,
            bindingSetId: state.bindingSet.id,
            title: definition.name,
          });
          const adapter = window.__FISHERAI_WORKFLOW_NODES__;
          if (!adapter) throw new Error('画布节点适配器尚未加载，请刷新后重试。');
          const insertion = await adapter.addToCanvas(blueprint);
          focusInsertedWorkflow(insertion.nodeIds);
          await loadDeployedRecords();
          setNotice(
            `${definition.name} 已作为未验证节点加入画布；首次运行时会检查配置。${incompleteExportNotice(definition)}`,
            'success',
          );
          return;
        } catch (error) {
          managerView = 'manager';
          state.activeStage = 1;
          setNotice(
            `工作流已导入，但自动连接本机 ComfyUI 未完成：${messageFor(error)} 请在高级管理中继续。`,
            'error',
          );
          return;
        }
      }
      setNotice(
        definition.executionPlan
          ? `工作流已导入，执行计划可以验证。${incompleteExportNotice(definition)}`
          : '已保存 UI Format（节点布局文件）；请从 ComfyUI 开发者模式导出对应的 API Format，再点“补充 UI / API 文件”。',
        definition.executionPlan ? 'success' : '',
      );
    });
  };

  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    importFiles(files);
  });
  const canDropWorkflow = () =>
    managerView === 'library' &&
    librarySection === 'mine' &&
    libraryRunnerScope === 'local' &&
    host.dataset.busy !== 'true';
  panel.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = canDropWorkflow() ? 'copy' : 'none';
    if (canDropWorkflow()) panel.style.outline = '1px dashed var(--af-focus)';
  });
  panel.addEventListener('dragleave', (event) => {
    if (!(event.relatedTarget instanceof Node) || !panel.contains(event.relatedTarget)) {
      panel.style.outline = '';
    }
  });
  panel.addEventListener('drop', (event) => {
    panel.style.outline = '';
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (!canDropWorkflow()) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.some((file) => !file.name.toLowerCase().endsWith('.json'))) {
      setNotice('请拖入 ComfyUI 工作流 JSON 文件。', 'error');
      return;
    }
    uploadMode = 'quick';
    importFiles(files);
  });

  directoryInput.addEventListener('change', () => {
    const selectedFiles = [...(directoryInput.files || [])];
    directoryInput.value = '';
    if (!selectedFiles.length) return;
    const maximumFiles = 500;
    const maximumFileBytes = 20 * 1024 * 1024;
    const candidates = selectedFiles
      .filter((file) => file.name.toLowerCase().endsWith('.json'))
      .filter((file) => file.size > 0 && file.size <= maximumFileBytes)
      .slice(0, maximumFiles)
      .map((file) => ({
        file,
        relativePath: file.webkitRelativePath || file.name,
        byteLength: file.size,
      }));
    if (!candidates.length) {
      state.discovered = undefined;
      setNotice('所选目录中没有可导入的 JSON 工作流，或文件超过 20 MiB。', 'error');
      render();
      return;
    }
    const rootLabel = candidates[0].relativePath.split('/')[0] || '所选目录';
    state.discovered = { label: rootLabel, candidates };
    const omitted = selectedFiles.length - candidates.length;
    setNotice(
      `已读取“${rootLabel}”，找到 ${candidates.length} 个 JSON 工作流${omitted > 0 ? `，忽略 ${omitted} 个非 JSON、空文件、超限文件或超出数量上限的文件` : ''}。`,
      'success',
    );
    render();
  });

  if (requestedDefinitionId) {
    void loadRequestedDefinition();
    render();
    return host;
  }

  if (libraryContext)
    void loadOfficial().then(() => {
      if (!officialWorkflows.length && !officialError) librarySection = 'mine';
      render();
    });
  void Promise.all([client.listDefinitions(), client.listProjects()])
    .then(async ([definitions, projects]) => {
      const scopedDefinitions =
        options.scope === 'cloud'
          ? definitions.filter(isCloudDefinition)
          : options.scope === 'local'
            ? definitions.filter((definition) => !isCloudDefinition(definition))
            : definitions;
      state.definitions = scopedDefinitions;
      state.projects = projects;
      state.projectId = projects[0]?.id;
      projectsLoaded = true;
      await loadDeployedRecords(scopedDefinitions);
      const saved = readRunReference();
      const savedDefinition = saved
        ? scopedDefinitions.find((definition) => definition.id === saved.definitionId)
        : undefined;
      const unfinishedDefinition = !libraryContext
        ? scopedDefinitions.find(
            (definition) =>
              !state.deployedRecords.some((record) => record.definition.id === definition.id),
          )
        : undefined;
      if (saved && savedDefinition) {
        state.selected = savedDefinition;
        state.run = {
          runId: saved.runId,
          status: 'loading',
          phase: 'restoring-run',
          definitionId: savedDefinition.id,
        };
        state.activeStage = currentStage(state);
        pollToken += 1;
        void pollRun(saved.runId, pollToken);
      } else if (unfinishedDefinition) {
        if (saved) clearRunReference();
        await hydrate(unfinishedDefinition);
      } else if (scopedDefinitions[0] && state.deployedRecords.length === 0) {
        if (saved) clearRunReference();
        await hydrate(scopedDefinitions[0]);
      } else if (saved) {
        clearRunReference();
      }
      render();
    })
    .catch((error) => {
      render();
      setNotice(messageFor(error), 'error');
    });
  render();
  return host;
}

export function installWorkflowManager(client: WorkflowManagerClient, root: ParentNode = document) {
  let workspaceTabs: HTMLElement | undefined;
  let mountedManager: HTMLElement | undefined;
  let mountedCloudManager: HTMLElement | undefined;
  let mountedLocalPanel: HTMLElement | undefined;
  let dialogBackdrop: HTMLElement | undefined;
  let releaseDialog: (() => void) | undefined;
  const closeDialog = () => {
    releaseDialog?.();
    releaseDialog = undefined;
    dialogBackdrop?.remove();
    dialogBackdrop = undefined;
  };
  const openDialog = (options: {
    marker: string;
    ariaLabel: string;
    title: string;
    description: string;
    closeLabel: string;
    manager: HTMLElement;
  }) => {
    closeDialog();
    const backdrop = element('div', 'fwm-modal-backdrop');
    backdrop.setAttribute(options.marker, 'true');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', options.ariaLabel);
    const dialog = element('div', 'fwm-modal');
    const bar = element('div', 'fwm-modal-bar');
    const copy = element('div');
    copy.append(element('strong', '', options.title), element('span', '', options.description));
    const close = element('button', 'fwm-modal-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', options.closeLabel);
    close.addEventListener('click', closeDialog);
    bar.append(copy, close);
    dialog.append(bar, options.manager);
    backdrop.append(dialog);
    backdrop.addEventListener('pointerdown', (pointerEvent) => {
      if (pointerEvent.target === backdrop) closeDialog();
    });
    dialogBackdrop = backdrop;
    document.body.append(backdrop);
    releaseDialog = activateModal(backdrop, closeDialog, { initialFocus: close });
  };
  const openParameterEditor = (event: Event) => {
    const detail = (
      event as CustomEvent<{
        definitionId?: unknown;
        nodeId?: unknown;
        title?: unknown;
      }>
    ).detail;
    const definitionId = detail?.definitionId;
    const nodeId =
      typeof detail?.nodeId === 'string' && detail.nodeId.length <= 200 ? detail.nodeId : undefined;
    const initialNodeTitle =
      typeof detail?.title === 'string' && detail.title.trim() && detail.title.length <= 120
        ? detail.title.trim()
        : undefined;
    if (typeof definitionId !== 'string' || !definitionId || definitionId.length > 200) return;
    openDialog({
      marker: 'data-fisherai-workflow-editor-dialog',
      ariaLabel: '编辑外置参数',
      title: '编辑外置参数',
      description: '自由增删字段并保存为新版本；已部署工作流无需重新真实测试。',
      closeLabel: '关闭外置参数编辑器',
      manager: createWorkflowManager(client, {
        definitionId,
        nodeId,
        initialNodeTitle,
        initialStage: 2,
        mode: 'dialog',
      }),
    });
  };
  const openWorkflowLibrary = () => {
    openDialog({
      marker: 'data-fisherai-workflow-library-dialog',
      ariaLabel: '工作流节点库',
      title: '工作流节点库',
      description: '选择工作流添加到画布；未运行的节点会在首次运行时检查。',
      closeLabel: '关闭工作流节点库',
      manager: createWorkflowManager(client, { mode: 'dialog', initialView: 'library' }),
    });
  };
  const openRunningHubWebAppTest = (event: Event) => {
    const detail = (event as CustomEvent<{ definitionId?: unknown; title?: unknown }>).detail;
    if (typeof detail?.definitionId !== 'string' || !detail.definitionId) return;
    openDialog({
      marker: 'data-fisherai-runninghub-webapp-test-dialog',
      ariaLabel: 'RunningHub 云端工作流测试',
      title: typeof detail.title === 'string' && detail.title ? detail.title : '云端工作流',
      description: '设置需要外置的字段，也可以不测试直接加入画布。',
      closeLabel: '关闭云端工作流测试',
      manager: createWorkflowManager(client, {
        definitionId: detail.definitionId,
        initialStage: 2,
        mode: 'dialog',
        scope: 'cloud',
        compactCloud: true,
      }),
    });
  };
  window.addEventListener(WORKFLOW_PARAMETER_EDITOR_EVENT, openParameterEditor);
  window.addEventListener(WORKFLOW_LIBRARY_EVENT, openWorkflowLibrary);
  window.addEventListener(RUNNINGHUB_WEBAPP_TEST_EVENT, openRunningHubWebAppTest);
  const closeAfterCanvasInsertion = () => closeDialog();
  window.addEventListener(WORKFLOW_CANVAS_INSERTED_EVENT, closeAfterCanvasInsertion);
  const mount = () => {
    const localPanel = root.querySelector<HTMLElement>('[data-fisherai-local-runtime-panel]');
    const parent = localPanel?.parentElement;
    if (!localPanel || !parent || parent.querySelector(`[${HOST_ATTRIBUTE}]`)) return;
    const manager = createWorkflowManager(client, { scope: 'local' });
    const cloudManager = createRunningHubWebAppManager(client);
    const views = [
      { id: 'local', label: 'ComfyUI 服务', panel: localPanel },
      { id: 'workflow', label: '本地工作流', panel: manager },
      { id: 'cloud', label: '云端工作流', panel: cloudManager },
    ];
    const tabs = element('div');
    tabs.setAttribute('data-fisherai-local-workspace-tabs', 'true');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '本地能力');
    const buttons = new Map<string, HTMLButtonElement>();
    const activate = (activeId: string, focus = false) => {
      for (const view of views) {
        const active = view.id === activeId;
        view.panel.hidden = !active;
        const tab = buttons.get(view.id)!;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        if (active && focus) tab.focus();
      }
      tabs.scrollIntoView?.({ block: 'nearest' });
    };
    views.forEach((view, index) => {
      view.panel.id ||= `fisherai-local-workspace-${view.id}`;
      view.panel.setAttribute('role', 'tabpanel');
      const tab = element('button', '', view.label);
      tab.type = 'button';
      tab.id = `fisherai-local-workspace-tab-${view.id}`;
      tab.setAttribute('data-fisherai-local-workspace-tab', view.id);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', view.panel.id);
      view.panel.setAttribute('aria-labelledby', tab.id);
      tab.addEventListener('click', () => activate(view.id));
      tab.addEventListener('keydown', (event) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? views.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
        activate(views[nextIndex].id, true);
      });
      buttons.set(view.id, tab);
      tabs.append(tab);
    });
    parent.insertBefore(tabs, localPanel);
    parent.insertBefore(manager, localPanel.nextSibling);
    parent.insertBefore(cloudManager, manager.nextSibling);
    activate('local');
    workspaceTabs = tabs;
    mountedManager = manager;
    mountedCloudManager = cloudManager;
    mountedLocalPanel = localPanel;
  };
  const stopObserving = observeStableEnhancement(mount);
  return () => {
    stopObserving();
    window.removeEventListener(WORKFLOW_PARAMETER_EDITOR_EVENT, openParameterEditor);
    window.removeEventListener(WORKFLOW_LIBRARY_EVENT, openWorkflowLibrary);
    window.removeEventListener(RUNNINGHUB_WEBAPP_TEST_EVENT, openRunningHubWebAppTest);
    window.removeEventListener(WORKFLOW_CANVAS_INSERTED_EVENT, closeAfterCanvasInsertion);
    workspaceTabs?.remove();
    mountedManager?.remove();
    mountedCloudManager?.remove();
    if (mountedLocalPanel) mountedLocalPanel.hidden = false;
    closeDialog();
  };
}
