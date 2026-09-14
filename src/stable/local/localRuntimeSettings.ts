import type {
  LocalRuntimeClient,
  LocalRuntimeStatus,
  RuntimeDiagnostic,
} from './localRuntimeClient';
import { createComfyDirectoryGuide } from './comfyDirectoryGuide';
import { createStableTextElement as textElement } from '../design/dom';
import { createSettingsScope, type SettingsScope } from '../generation/sourceSettingsScope';
import { settingsOperation } from '../settings/settingsOperation';

const PANEL_ATTRIBUTE = 'data-fisherai-local-runtime-panel';

function statusTone(status: string) {
  if (status === 'ready') return 'var(--af-success)';
  if (
    status === 'partial' ||
    status === 'insufficient' ||
    status === 'empty' ||
    status === 'optional-empty'
  )
    return 'var(--af-warning)';
  return 'var(--af-danger)';
}

function diagnosticDetails(item: RuntimeDiagnostic) {
  if (!item.message && !item.actions?.length) return null;
  const details = document.createElement('div');
  details.className = 'mt-2 text-xs text-[var(--af-text-secondary)] space-y-1';
  if (item.message) details.append(textElement('p', item.message));
  for (const action of item.actions || []) details.append(textElement('p', `· ${action}`));
  return details;
}

function runtimeItem(label: string, summary: string, diagnostic: RuntimeDiagnostic) {
  const item = document.createElement('div');
  item.className =
    'rounded-lg border border-[var(--af-border-control)] bg-[var(--af-surface)] px-4 py-3';
  const row = document.createElement('div');
  row.className = 'flex items-center justify-between gap-4';
  row.append(textElement('span', label, 'text-sm text-[var(--af-text-secondary)]'));
  const value = textElement(
    'span',
    summary,
    'text-sm font-medium text-[var(--af-text)] text-right',
  );
  value.style.color = statusTone(diagnostic.status);
  row.append(value);
  item.append(row);
  const details = diagnosticDetails(diagnostic);
  if (details) item.append(details);
  return item;
}

function gibibytes(value?: number) {
  return value ? `${(value / 1024 ** 3).toFixed(1)} GB` : '--';
}

function controlButton(label: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className =
    'px-3 py-1.5 rounded-md border border-[var(--af-border-control)] text-xs text-[var(--af-text)] hover:bg-[var(--af-hover)] disabled:opacity-50';
  return button;
}

function localComfyWebUrl(address: string | undefined): string | null {
  if (!address) return null;
  try {
    const url = new URL(`http://${address}`);
    const hostname = url.hostname.toLowerCase();
    const loopback =
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname === '::1';
    if (url.protocol !== 'http:' || !loopback || !url.port) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function comfyModelSummary(models: NonNullable<LocalRuntimeStatus['comfyui']['models']>) {
  return [
    models.checkpoints?.length ? `Checkpoint ${models.checkpoints.length}` : null,
    models.diffusionModels?.length ? `扩散模型 ${models.diffusionModels.length}` : null,
    models.textEncoders?.length ? `文本编码器 ${models.textEncoders.length}` : null,
    models.vaes?.length ? `VAE ${models.vaes.length}` : null,
    models.loras?.length ? `LoRA ${models.loras.length}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function comfyNodeIdExtensionControls(client: LocalRuntimeClient, scope: SettingsScope) {
  const block = document.createElement('div');
  block.className =
    'mt-3 w-full rounded-md border border-[var(--af-border-control)] bg-[var(--af-input)] px-3 py-3';
  block.setAttribute('data-fisherai-comfyui-node-id-extension', 'true');

  const row = document.createElement('div');
  row.className = 'flex flex-wrap items-center justify-between gap-3';
  const info = document.createElement('div');
  info.className = 'min-w-0';
  info.append(textElement('p', 'ComfyUI 节点编号', 'text-xs font-medium text-[var(--af-text)]'));
  const summary = textElement('p', '正在检测扩展…', 'mt-1 text-[11px] text-[var(--af-text-muted)]');
  info.append(summary);
  const action = controlButton('安装节点编号扩展');
  action.setAttribute('data-fisherai-comfyui-node-id-install', 'true');
  action.hidden = true;
  row.append(info, action);
  const message = textElement('p', '', 'mt-2 text-[11px] text-[var(--af-text-secondary)]');
  const manual = textElement(
    'p',
    '无法自动安装时，也可把 AIFISHER 随包的 fisherai_node_ids 文件夹复制到 ComfyUI/custom_nodes。',
    'mt-2 text-[11px] text-[var(--af-text-muted)]',
  );
  block.append(row, message, manual);

  const load = async () => {
    try {
      const state = await settingsOperation(scope, () => client.getComfyNodeIdExtension());
      action.hidden = !state.installable || state.status === 'up-to-date';
      action.textContent =
        state.status === 'update-available' ? '更新节点编号扩展' : '安装节点编号扩展';
      if (state.status === 'up-to-date') {
        summary.textContent = `已安装最新版 v${state.bundledVersion}`;
        summary.style.color = 'var(--af-success)';
      } else if (state.status === 'update-available') {
        summary.textContent = `可更新：v${state.installedVersion || '旧版'} → v${state.bundledVersion}`;
        summary.style.color = 'var(--af-warning)';
      } else if (state.status === 'missing') {
        summary.textContent = `未安装 · 随包版本 v${state.bundledVersion}`;
        summary.style.color = 'var(--af-warning)';
      } else {
        summary.textContent = state.message || '请先选择 ComfyUI 安装目录。';
        summary.style.color = 'var(--af-text-secondary)';
      }
    } catch (error) {
      if (!scope.active()) return;
      summary.textContent = error instanceof Error ? error.message : '扩展状态检测失败。';
      summary.style.color = 'var(--af-danger)';
      action.hidden = true;
    }
  };

  action.addEventListener('click', () => {
    if (action.disabled || !scope.active()) return;
    void (async () => {
      action.setAttribute('disabled', 'true');
      message.textContent = '正在安装并校验扩展…';
      try {
        const result = await settingsOperation(
          scope,
          () => client.installComfyNodeIdExtension(),
          120_000,
        );
        message.textContent = result.restartRequired
          ? '安装完成。请在当前任务结束后重启 ComfyUI；AIFISHER 不会自动中断队列。'
          : result.changed
            ? '安装完成，下次启动 ComfyUI 时自动生效。'
            : '已经是最新版。';
        await load();
      } catch (error) {
        if (!scope.active()) return;
        message.textContent = error instanceof Error ? error.message : '扩展安装失败。';
      } finally {
        action.removeAttribute('disabled');
      }
    })();
  });
  void load();
  return block;
}

type ComfyLaunchStage = 'checking' | 'process' | 'loading' | 'endpoint' | 'ready' | 'failed';

const COMFY_LAUNCH_STAGES: Record<
  ComfyLaunchStage,
  { label: string; detail: string; step: number; width: number; color: string }
> = {
  checking: {
    label: '检查安装目录和端口',
    detail: '确认 Python、main.py 与本机端口可以使用。',
    step: 1,
    width: 16,
    color: 'var(--af-info)',
  },
  process: {
    label: '启动 Python 进程',
    detail: '进程已经拉起，正在读取 ComfyUI 启动日志。',
    step: 2,
    width: 38,
    color: 'var(--af-info)',
  },
  loading: {
    label: '加载自定义节点和模型目录',
    detail: '首次启动或节点较多时，这一步通常用时最长。',
    step: 3,
    width: 68,
    color: 'var(--af-info)',
  },
  endpoint: {
    label: '等待本机网页端就绪',
    detail: '组件已经加载，正在等待 127.0.0.1 的服务响应。',
    step: 4,
    width: 90,
    color: 'var(--af-info)',
  },
  ready: {
    label: 'ComfyUI 已就绪',
    detail: '本机网页端已经可以使用。',
    step: 4,
    width: 100,
    color: 'var(--af-success)',
  },
  failed: {
    label: '启动未完成',
    detail: '查看下方明确错误后可以重试。',
    step: 1,
    width: 100,
    color: 'var(--af-danger)',
  },
};

function createComfyLaunchProgress(client: LocalRuntimeClient, scope: SettingsScope) {
  const block = document.createElement('div');
  block.hidden = true;
  block.className =
    'mt-3 w-full rounded-lg border border-[var(--af-border-control)] bg-[var(--af-input)] px-4 py-3';
  block.setAttribute('data-fisherai-comfyui-launch-progress', 'true');

  const heading = document.createElement('div');
  heading.className = 'flex items-center justify-between gap-4';
  const label = textElement('p', '', 'text-xs font-medium text-[var(--af-text)]');
  const step = textElement('span', '', 'text-[11px] tabular-nums text-[var(--af-text-muted)]');
  heading.append(label, step);

  const track = document.createElement('div');
  track.className = 'mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--af-surface)]';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '4');
  const bar = document.createElement('div');
  bar.className = 'h-full rounded-full';
  bar.style.width = '0%';
  bar.style.transition = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'none'
    : 'width 240ms ease, background-color 160ms ease';
  track.append(bar);

  const detail = textElement('p', '', 'mt-2 text-[11px] leading-5 text-[var(--af-text-muted)]');
  block.append(heading, track, detail);

  let polling = false;
  let timer: number | null = null;
  scope.onDispose(() => {
    polling = false;
    if (timer !== null) clearTimeout(timer);
  });

  const update = (stage: ComfyLaunchStage, overrideDetail?: string) => {
    if (!scope.active()) return;
    const state = COMFY_LAUNCH_STAGES[stage];
    block.hidden = false;
    block.setAttribute('data-fisherai-stage', stage);
    label.textContent = state.label;
    step.textContent =
      stage === 'ready' ? '完成' : stage === 'failed' ? '需要处理' : `第 ${state.step}/4 步`;
    detail.textContent = overrideDetail || state.detail;
    track.setAttribute('aria-valuenow', String(stage === 'ready' ? 4 : state.step));
    track.setAttribute('aria-valuetext', state.label);
    bar.style.width = `${state.width}%`;
    bar.style.backgroundColor = state.color;
  };

  const inferStage = (logs: Awaited<ReturnType<LocalRuntimeClient['getComfyLogs']>>) => {
    if (logs.state.running) return 'ready' as const;
    const text = [...logs.logs.stdout.lines, ...logs.logs.stderr.lines].join('\n').toLowerCase();
    if (/to see the gui|starting server|prompt server|server started|listening on/.test(text)) {
      return 'endpoint' as const;
    }
    if (
      /custom[ _-]?nodes?|model director|loading model|checkpoint|diffusion model|text encoder|vae|lora|import times/.test(
        text,
      )
    ) {
      return 'loading' as const;
    }
    if (logs.state.owned) return 'process' as const;
    return 'checking' as const;
  };

  const poll = async () => {
    if (!scope.active() || !polling || !block.isConnected) {
      polling = false;
      return;
    }
    try {
      const stage = inferStage(await settingsOperation(scope, () => client.getComfyLogs(80)));
      update(stage);
      if (stage === 'ready') {
        polling = false;
        return;
      }
    } catch {
      // 启动 POST 仍是权威结果；日志暂时不可读时保留最近的真实阶段。
    }
    if (!scope.active() || !polling || !block.isConnected) return;
    timer = window.setTimeout(() => {
      void poll();
    }, 1_200);
  };

  return {
    element: block,
    start() {
      if (timer !== null) window.clearTimeout(timer);
      update('checking');
      polling = true;
      // The initial status controls are attached after construction.
      queueMicrotask(() => {
        void poll();
      });
    },
    ready() {
      polling = false;
      if (timer !== null) window.clearTimeout(timer);
      update('ready');
    },
    fail(message?: string) {
      polling = false;
      if (timer !== null) window.clearTimeout(timer);
      update('failed', message || undefined);
    },
  };
}

// 本机 ComfyUI 进程控制：只对 AIFISHER 自己启动的实例提供停止入口。
function comfyProcessControls(
  client: LocalRuntimeClient,
  state: NonNullable<LocalRuntimeStatus['comfyui']['process']>,
  reload: () => void,
  address: string | undefined,
  scope: SettingsScope,
) {
  const block = document.createElement('div');
  block.className =
    'mt-3 border-t border-[var(--af-border-control)] pt-3 flex flex-wrap items-center justify-between gap-2';
  block.setAttribute('data-fisherai-comfyui-process', 'true');

  const running = state.running;
  const starting = !running && state.owned;
  const label = running
    ? state.owned
      ? '运行中 · 由 AIFISHER 画布启动'
      : '已检测到外部 ComfyUI 服务 · 非 AIFISHER 启动'
    : starting
      ? '启动中 · 正在等待本机网页端'
      : '未运行';
  const summary = textElement('span', label, 'text-xs');
  summary.style.color = running
    ? 'var(--af-success)'
    : starting
      ? 'var(--af-focus)'
      : 'var(--af-text-secondary)';
  block.setAttribute('data-fisherai-state', running ? 'ready' : starting ? 'starting' : 'empty');

  const buttons = document.createElement('div');
  buttons.className = 'flex items-center gap-2';

  const message = textElement('p', '', 'mt-2 w-full text-xs text-[var(--af-text-secondary)]');
  const launchProgress = createComfyLaunchProgress(client, scope);
  let operationRunning = false;
  const run = async (
    action: () => Promise<{ status: string; message?: string }>,
    busyText: string,
  ) => {
    if (!scope.active() || operationRunning) return;
    operationRunning = true;
    const buttonStates = [...buttons.querySelectorAll('button')].map(
      (button) => [button, button.hasAttribute('disabled')] as const,
    );
    for (const [button] of buttonStates) button.setAttribute('disabled', 'true');
    message.textContent = busyText;
    try {
      const result = await settingsOperation(scope, action, 120_000);
      if (result.status === 'failed' || result.status === 'invalid') {
        message.textContent = result.message || '操作失败。';
      } else if (result.status === 'cancelled') {
        message.textContent = '';
      } else {
        reload();
      }
    } catch (error) {
      if (!scope.active()) return;
      message.textContent = error instanceof Error ? error.message : '操作失败。';
    } finally {
      operationRunning = false;
      for (const [button, wasDisabled] of buttonStates) {
        if (!wasDisabled) button.removeAttribute('disabled');
      }
    }
  };

  const webUrl = running ? localComfyWebUrl(address) : null;
  if (webUrl) {
    const openWeb = controlButton('打开网页端');
    openWeb.setAttribute('data-fisherai-comfyui-open-web', 'true');
    openWeb.setAttribute('aria-label', '在新标签页打开本机 ComfyUI 网页端');
    openWeb.addEventListener('click', () => {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    });
    buttons.append(openWeb);
  }

  if (!running && !starting) {
    const start = controlButton('启动 ComfyUI');
    start.setAttribute('data-fisherai-comfyui-start', 'true');
    if (!state.startable) start.setAttribute('disabled', 'true');
    start.addEventListener('click', () => {
      if (start.disabled || operationRunning || !scope.active()) return;
      operationRunning = true;
      void (async () => {
        for (const button of buttons.querySelectorAll('button'))
          button.setAttribute('disabled', 'true');
        message.textContent = '';
        launchProgress.start();
        try {
          const result = await settingsOperation(scope, () => client.startComfy(), 180_000);
          if (result.status === 'failed') {
            const failureMessage = result.message || '启动本机 ComfyUI 失败。';
            message.textContent = failureMessage;
            launchProgress.fail(failureMessage);
            for (const button of buttons.querySelectorAll('button'))
              button.removeAttribute('disabled');
            return;
          }
          if (result.status === 'ready') launchProgress.ready();
          const timer = window.setTimeout(
            () => {
              if (scope.active()) reload();
            },
            result.status === 'ready' ? 320 : 1_200,
          );
          scope.onDispose(() => clearTimeout(timer));
        } catch (error) {
          if (!scope.active()) return;
          const failureMessage = error instanceof Error ? error.message : '启动本机 ComfyUI 失败。';
          message.textContent = failureMessage;
          launchProgress.fail(failureMessage);
          for (const button of buttons.querySelectorAll('button'))
            button.removeAttribute('disabled');
        } finally {
          operationRunning = false;
        }
      })();
    });
    buttons.append(start);
  } else if (state.owned) {
    const stop = controlButton('停止 ComfyUI');
    stop.setAttribute('data-fisherai-comfyui-stop', 'true');
    stop.addEventListener('click', () => {
      void run(() => client.stopComfy(), '正在停止本机 ComfyUI…');
    });
    buttons.append(stop);
  }

  const selectDirectory = controlButton('选择 ComfyUI 目录');
  selectDirectory.setAttribute('data-fisherai-comfyui-select-directory', 'true');
  selectDirectory.addEventListener('click', () => {
    void run(async () => {
      const result = await settingsOperation(scope, () => client.selectComfyDirectory(), 120_000);
      if (result.status !== 'selected') return result;
      await settingsOperation(scope, () => client.adoptComfy(result.root));
      return { status: 'ok' };
    }, '正在打开文件夹选择器…');
  });
  buttons.append(selectDirectory);

  const discovery = document.createElement('div');
  discovery.className = 'mt-3 w-full space-y-2';
  const scan = controlButton('自动查找 ComfyUI');
  const pathInput = document.createElement('input');
  pathInput.placeholder = '粘贴 ComfyUI 安装目录';
  pathInput.setAttribute('aria-label', 'ComfyUI 安装目录');
  pathInput.className =
    'w-full rounded border border-[var(--af-border-control)] bg-[var(--af-surface)] p-2 text-xs';
  const add = controlButton('验证并添加');
  const results = document.createElement('div');
  results.className = 'space-y-2 text-xs text-[var(--af-text-secondary)]';
  add.addEventListener('click', () => {
    void run(async () => {
      const selected = await settingsOperation(scope, () =>
        client.validateComfyDirectory(pathInput.value),
      );
      await settingsOperation(scope, () => client.adoptComfy(selected.root));
      return { status: 'ok' };
    }, '正在验证安装目录…');
  });
  scan.addEventListener('click', () => {
    if (scan.disabled) return;
    scan.disabled = true;
    results.textContent = '正在查找常见安装位置…';
    void settingsOperation(scope, () => client.discoverComfy())
      .then((found) => {
        if (!scope.active()) return;
        results.replaceChildren(textElement('p', found.scope));
        if (found.configuredRoot) {
          pathInput.value = found.configuredRoot;
          results.append(textElement('p', `已配置目录：${found.configuredRoot}`));
        }
        if (!found.candidates.length)
          results.append(
            textElement('p', '未找到可启动安装。可以点击“选择 ComfyUI 目录”，或粘贴目录后验证。'),
          );
        for (const candidate of found.candidates) {
          const choose = controlButton(`使用 ${candidate.root}`);
          choose.addEventListener('click', () => {
            pathInput.value = candidate.root;
            add.click();
          });
          results.append(choose);
        }
      })
      .catch((error) => {
        if (scope.active())
          results.textContent = error instanceof Error ? error.message : '查找失败，请手动添加。';
      })
      .finally(() => {
        scan.disabled = false;
      });
  });
  discovery.append(scan, results, pathInput, add);
  block.append(summary, createComfyDirectoryGuide(), buttons, discovery);
  block.append(launchProgress.element);
  if (starting) launchProgress.start();
  if (state.startable && (state.pythonName || state.entryName)) {
    const current = textElement(
      'p',
      `当前使用：${state.pythonName || 'python'} · ${state.entryName || 'main.py'}`,
      'mt-2 w-full text-xs text-[var(--af-text-muted)]',
    );
    block.append(current);
  }
  if (!state.startable && state.message) message.textContent = state.message;
  block.append(message);
  block.append(comfyNodeIdExtensionControls(client, scope));
  return block;
}

function renderStatus(
  container: HTMLElement,
  status: LocalRuntimeStatus,
  client: LocalRuntimeClient,
  reload: () => void,
  scope: SettingsScope,
) {
  const list = document.createElement('div');
  list.className = 'grid grid-cols-1 gap-3';
  const gpuSummary = status.gpu.available
    ? `${status.gpu.name || 'GPU'} · ${gibibytes(status.gpu.vramFreeBytes)} 可用`
    : '未检测到';
  list.append(runtimeItem('GPU', gpuSummary, status.gpu));
  const comfyConnected = Boolean(
    status.comfyui.address && ['ready', 'partial', 'incompatible'].includes(status.comfyui.status),
  );
  if (comfyConnected && status.comfyui.models) {
    const modelDetails = comfyModelSummary(status.comfyui.models);
    list.append(
      runtimeItem('ComfyUI 已安装模型', `${status.comfyui.models.total} 个模型`, {
        status: status.comfyui.models.total > 0 ? 'ready' : 'empty',
        message: [
          modelDetails,
          '已从当前 ComfyUI 自动读取；工作流目录用于识别 JSON 及其模型依赖，权重文件仍由 ComfyUI 管理。',
        ]
          .filter(Boolean)
          .join('。'),
      }),
    );
  }
  if (status.models.total > 0) {
    list.append(runtimeItem('AIFISHER 内置模型', `${status.models.total} 个模型`, status.models));
  } else if (!comfyConnected) {
    list.append(runtimeItem('本地模型', '未检测到', status.models));
  }
  const compatibleWorkflowCount =
    status.comfyui.compatibleWorkflowCount ??
    (status.comfyui.status === 'ready' ? status.comfyui.workflowCount : 0);
  const comfyItem = runtimeItem(
    'ComfyUI',
    comfyConnected
      ? `${compatibleWorkflowCount}/${status.comfyui.workflowCount} 个工作流可用`
      : '未连接',
    status.comfyui,
  );
  if (comfyConnected && status.comfyui.address) {
    const details = document.createElement('div');
    details.className =
      'mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--af-text-muted)]';
    const summary = [
      status.comfyui.version ? `ComfyUI ${status.comfyui.version}` : null,
      `${status.comfyui.models?.total || 0} 个 ComfyUI 模型`,
      `${status.comfyui.nodeTypeCount || 0} 个节点`,
      status.comfyui.address,
    ]
      .filter(Boolean)
      .join(' · ');
    details.append(textElement('span', summary));
    comfyItem.append(details);
  }
  const incompatibleWorkflows = (status.comfyui.workflows || []).filter(
    (workflow) => workflow.status === 'incompatible',
  );
  if (incompatibleWorkflows.length) {
    const dependencyDetails = document.createElement('details');
    dependencyDetails.className =
      'mt-3 border-t border-[var(--af-border-control)] pt-3 text-xs text-[var(--af-text-secondary)]';
    dependencyDetails.setAttribute('data-fisherai-comfyui-dependencies', 'true');
    const dependencySummary = document.createElement('summary');
    dependencySummary.textContent = `查看 ${status.comfyui.incompatibleWorkflowCount || incompatibleWorkflows.length} 个不可用工作流`;
    dependencySummary.className =
      'cursor-pointer text-[var(--af-text-secondary)] hover:text-[var(--af-text)]';
    dependencyDetails.append(dependencySummary);
    const dependencyList = document.createElement('div');
    dependencyList.className = 'mt-2 space-y-2';
    for (const workflow of incompatibleWorkflows) {
      const missing = [
        workflow.missingNodeTypes.length
          ? `缺少节点：${workflow.missingNodeTypes.join('、')}`
          : null,
        workflow.missingModels.length
          ? `缺少模型：${workflow.missingModels.map(({ name }) => name).join('、')}`
          : null,
      ]
        .filter(Boolean)
        .join('；');
      dependencyList.append(textElement('p', `${workflow.title} · ${missing}`));
    }
    dependencyDetails.append(dependencyList);
    comfyItem.append(dependencyDetails);
  }
  if (status.comfyui.process) {
    comfyItem.append(
      comfyProcessControls(
        client,
        status.comfyui.process,
        reload,
        comfyConnected ? status.comfyui.address || undefined : undefined,
        scope,
      ),
    );
  }
  list.append(comfyItem);
  container.replaceChildren(list);
}

export function mountLocalRuntimeSettings(host: HTMLElement, client: LocalRuntimeClient) {
  const panel = document.createElement('section');
  panel.setAttribute(PANEL_ATTRIBUTE, 'true');
  host.append(panel);
  const scope = createSettingsScope(panel);
  let contentScope: SettingsScope | undefined,
    busy = false;
  panel.className = 'space-y-5 pb-8 border-b border-[var(--af-border-control)]';

  const headingRow = document.createElement('div');
  headingRow.className = 'flex items-start justify-between gap-4';
  const heading = document.createElement('div');
  heading.append(textElement('h3', 'ComfyUI 服务', 'text-[var(--af-text)] text-xl font-bold'));
  heading.append(
    textElement(
      'p',
      '仅本机访问，不提供局域网访问',
      'mt-1 text-sm text-[var(--af-text-secondary)]',
    ),
  );
  const refresh = document.createElement('button');
  refresh.textContent = '刷新状态';
  refresh.className =
    'px-3 py-2 rounded-lg border border-[var(--af-border-control)] text-sm text-[var(--af-text)] hover:bg-[var(--af-hover)]';
  refresh.type = 'button';
  const diagnostics = document.createElement('a');
  diagnostics.textContent = '系统诊断';
  diagnostics.href = '/diagnostics';
  diagnostics.target = '_blank';
  diagnostics.rel = 'noopener';
  diagnostics.setAttribute('data-fisherai-diagnostics-link', 'true');
  diagnostics.className =
    'px-3 py-2 rounded-lg border border-[var(--af-border-control)] text-sm text-[var(--af-text)] hover:bg-[var(--af-hover)]';
  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2';
  actions.append(refresh, diagnostics);
  headingRow.append(heading, actions);

  const content = document.createElement('div');
  content.setAttribute('aria-live', 'polite');
  content.append(textElement('p', '正在检测本机环境…', 'text-sm text-[var(--af-text-secondary)]'));
  panel.append(headingRow, content);

  const load = async (force: boolean) => {
    if (busy || !scope.active()) return;
    busy = true;
    refresh.disabled = true;
    refresh.textContent = '检测中…';
    try {
      const status = await settingsOperation(
        scope,
        () => (force ? client.refresh() : client.getStatus()),
        60_000,
      );
      contentScope?.dispose();
      contentScope = createSettingsScope(content, scope.signal);
      renderStatus(
        content,
        status,
        client,
        () => {
          void load(true);
        },
        contentScope,
      );
    } catch (error) {
      if (scope.active()) {
        contentScope?.dispose();
        contentScope = undefined;
        content.replaceChildren(
          textElement(
            'p',
            error instanceof Error ? error.message : '本机环境检测失败。',
            'text-sm text-[var(--af-danger)]',
          ),
        );
      }
    } finally {
      busy = false;
      if (scope.active()) {
        refresh.disabled = false;
        refresh.textContent = '刷新状态';
      }
    }
  };
  refresh.addEventListener('click', () => {
    void load(true);
  });
  void load(false);
  return () => {
    scope.dispose();
    panel.remove();
  };
}
