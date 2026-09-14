import type { ComfyLogs, LocalRuntimeClient } from './localRuntimeClient';

const HOST_ATTRIBUTE = 'data-fisherai-comfyui-log-host';
const REFRESH_INTERVAL_MS = 2_000;

type Stream = 'stderr' | 'stdout';

interface WorkflowRunProgressDetail {
  runId: string;
  title?: string;
  status: string;
  phase?: string;
  currentNodeId?: string;
  progress?: { value: number; maximum: number; currentNodeId?: string };
  realtimeChannel?: 'websocket' | 'history-fallback';
}

export type ComfyPanelPhase =
  'running' | 'external' | 'starting' | 'idle' | 'unavailable' | 'failed' | 'error';

export function readComfyPhase(logs: ComfyLogs): ComfyPanelPhase {
  if (logs.state.phase) return logs.state.phase;
  const { running, owned, startable } = logs.state;
  if (running) return owned ? 'running' : 'external';
  if (owned) return 'starting';
  return startable ? 'idle' : 'unavailable';
}

const PHASE_LABEL: Record<ComfyPanelPhase, { text: string; color: string }> = {
  running: { text: 'ComfyUI 运行中', color: 'var(--af-success)' },
  external: { text: '已检测到外部 ComfyUI 服务', color: 'var(--af-success)' },
  starting: { text: 'ComfyUI 启动中…', color: 'var(--af-warning)' },
  // 「未运行」会被读成「找不到 / 坏了」。这里已经配置好、随时能起，要说清楚。
  idle: { text: 'ComfyUI 待启动', color: 'var(--af-text-secondary)' },
  unavailable: { text: 'ComfyUI 未配置', color: 'var(--af-text-secondary)' },
  failed: { text: 'ComfyUI 启动失败', color: 'var(--af-danger)' },
  error: { text: 'ComfyUI 状态读取失败', color: 'var(--af-danger)' },
};

export function createComfyLogPanel(client: LocalRuntimeClient) {
  const host = document.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, 'true');
  host.style.cssText =
    'position:fixed;left:16px;bottom:16px;z-index:60;font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif;';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('data-fisherai-comfyui-log-toggle', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-live', 'polite');
  toggle.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:9999px;border:1px solid var(--af-border);background:var(--af-surface);color:var(--af-text);font-size:12px;cursor:pointer;';

  const dot = document.createElement('span');
  dot.style.cssText =
    'width:8px;height:8px;border-radius:9999px;background:var(--af-hover);flex:none;';
  const toggleText = document.createElement('span');
  toggleText.textContent = 'ComfyUI 待启动';
  // 没有这个箭头，用户看不出这个胶囊是可以点开的。
  const caret = document.createElement('span');
  caret.textContent = '⌃';
  caret.setAttribute('aria-hidden', 'true');
  caret.style.cssText =
    'color:var(--af-text-muted);font-size:10px;line-height:1;transform:translateY(1px);';
  toggle.title = '查看本机 ComfyUI 状态与日志';
  toggle.append(dot, toggleText, caret);

  const panel = document.createElement('div');
  panel.setAttribute('data-fisherai-comfyui-log-panel', 'true');
  panel.hidden = true;
  panel.style.cssText =
    'position:absolute;left:0;bottom:calc(100% + 8px);width:min(560px,calc(100vw - 48px));border:1px solid var(--af-border);border-radius:12px;background:var(--af-surface);box-shadow:var(--af-shadow);overflow:hidden;';

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid var(--af-border);';
  const title = document.createElement('span');
  title.textContent = '本机 ComfyUI 日志';
  title.style.cssText = 'font-size:12px;font-weight:600;color:var(--af-text);';

  const streamToggle = document.createElement('button');
  streamToggle.type = 'button';
  streamToggle.setAttribute('data-fisherai-comfyui-log-stream', 'true');
  streamToggle.style.cssText =
    'padding:2px 8px;border-radius:6px;border:1px solid var(--af-border);background:transparent;color:var(--af-text-secondary);font-size:11px;cursor:pointer;';

  const power = document.createElement('button');
  power.type = 'button';
  power.setAttribute('data-fisherai-comfyui-log-power', 'true');
  power.style.cssText =
    'padding:2px 8px;border-radius:6px;border:1px solid var(--af-border);background:transparent;color:var(--af-text);font-size:11px;cursor:pointer;';

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '收起';
  close.setAttribute('data-fisherai-comfyui-log-close', 'true');
  close.style.cssText =
    'padding:2px 8px;border-radius:6px;border:1px solid var(--af-border);background:transparent;color:var(--af-text-secondary);font-size:11px;cursor:pointer;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;align-items:center;gap:6px;';
  actions.append(power, streamToggle, close);
  header.append(title, actions);

  const hint = document.createElement('p');
  hint.setAttribute('data-fisherai-comfyui-log-hint', 'true');
  hint.style.cssText =
    'margin:0;padding:8px 12px 0;font-size:11px;line-height:1.6;color:var(--af-text-secondary);';

  const output = document.createElement('pre');
  output.setAttribute('data-fisherai-comfyui-log-output', 'true');
  output.style.cssText =
    'margin:0;padding:10px 12px;max-height:280px;overflow:auto;font-family:"Cascadia Code",Consolas,monospace;font-size:11px;line-height:1.6;color:var(--af-text-secondary);white-space:pre-wrap;word-break:break-all;';
  output.textContent = '正在读取日志…';

  const taskProgress = document.createElement('section');
  taskProgress.setAttribute('data-fisherai-comfyui-task-progress', 'true');
  taskProgress.setAttribute('aria-live', 'polite');
  taskProgress.hidden = true;
  taskProgress.style.cssText =
    'margin:10px 12px 0;padding:10px 11px;border:1px solid var(--af-info);border-radius:9px;background:var(--af-info-bg);color:var(--af-text);';

  panel.append(header, hint, taskProgress, output);
  host.append(toggle, panel);

  let stream: Stream = 'stderr';
  let open = false;
  let busy = false;
  let phase: ComfyPanelPhase = 'idle';
  let activity: WorkflowRunProgressDetail | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const progressLabel = (detail: WorkflowRunProgressDetail): string => {
    const value = Number(detail.progress?.value);
    const maximum = Number(detail.progress?.maximum);
    const nodeId = detail.progress?.currentNodeId || detail.currentNodeId;
    const hasProgress = Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0;
    const percent = hasProgress
      ? Math.max(0, Math.min(100, Math.round((value / maximum) * 100)))
      : null;
    return (
      [
        nodeId ? `节点 ${nodeId}` : null,
        hasProgress ? `当前步骤 ${value}/${maximum}` : null,
        percent === null ? null : `${percent}%`,
      ]
        .filter(Boolean)
        .join(' · ') ||
      (detail.realtimeChannel === 'history-fallback'
        ? '正在查询 ComfyUI 状态'
        : '正在等待 ComfyUI 进度')
    );
  };

  const renderActivity = () => {
    if (phase === 'error' || !activity || activity.status !== 'loading') {
      taskProgress.hidden = true;
      return;
    }
    const label = progressLabel(activity);
    const value = Number(activity.progress?.value);
    const maximum = Number(activity.progress?.maximum);
    const percent =
      Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0
        ? Math.max(0, Math.min(100, Math.round((value / maximum) * 100)))
        : null;
    toggleText.textContent =
      percent === null
        ? 'ComfyUI · 任务运行中'
        : `ComfyUI · ${percent}%${activity.currentNodeId ? ` · 节点 ${activity.currentNodeId}` : ''}`;
    taskProgress.hidden = false;
    taskProgress.replaceChildren();
    const heading = document.createElement('div');
    heading.style.cssText =
      'display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:650;';
    const taskTitle = document.createElement('span');
    taskTitle.textContent = activity.title || 'ComfyUI 工作流';
    const channel = document.createElement('span');
    channel.style.cssText = 'color:var(--af-info);font-weight:500;white-space:nowrap;';
    channel.textContent = activity.realtimeChannel === 'history-fallback' ? '轮询同步' : '实时同步';
    heading.append(taskTitle, channel);
    const copy = document.createElement('div');
    copy.style.cssText = 'margin-top:6px;color:var(--af-info);font-size:11px;';
    copy.textContent = label;
    const track = document.createElement('div');
    track.style.cssText =
      'height:3px;margin-top:8px;overflow:hidden;border-radius:999px;background:var(--af-info-bg);';
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;width:${percent ?? 18}%;border-radius:inherit;background:linear-gradient(90deg,var(--af-info),var(--af-info));transition:width 240ms ease;`;
    track.append(fill);
    taskProgress.append(heading, copy, track);
  };

  const renderStreamToggle = () => {
    streamToggle.textContent = stream === 'stderr' ? '运行日志' : '启动输出';
  };

  const renderPhase = (nextPhase: ComfyPanelPhase, message?: string) => {
    phase = nextPhase;
    host.setAttribute('data-fisherai-state', phase);
    const label = PHASE_LABEL[nextPhase];
    toggleText.textContent = label.text;
    dot.style.background = label.color;

    if (!busy) {
      // 用户自己开的实例不给停止入口，避免误杀。
      power.hidden = ['external', 'unavailable', 'error'].includes(nextPhase);
      power.textContent = ['running', 'failed'].includes(nextPhase) ? '停止' : '启动';
      power.disabled = nextPhase === 'starting' || nextPhase === 'error';
      hint.textContent =
        nextPhase === 'idle'
          ? '已配置好本机 ComfyUI。开始生成时会自动启动，也可以现在手动启动（首次约 1-2 分钟）。'
          : nextPhase === 'external'
            ? '这个 ComfyUI 由你自己启动，AIFISHER 不会停止它。'
            : nextPhase === 'failed'
              ? message || '本机 ComfyUI 启动失败，请查看日志后停止并重试。'
              : nextPhase === 'error'
                ? '暂时无法读取本机 ComfyUI 状态，正在自动重试。'
                : '';
      hint.style.color = ['failed', 'error'].includes(nextPhase)
        ? 'var(--af-danger)'
        : 'var(--af-text-secondary)';
      hint.hidden = !hint.textContent;
    }
  };

  const render = (logs: ComfyLogs) => {
    renderPhase(readComfyPhase(logs), logs.state.message);

    const selected = logs.logs[stream];
    if (!selected.available) {
      output.textContent = '还没有日志。启动本机 ComfyUI 后这里会显示它的输出。';
      renderActivity();
      return;
    }
    // 贴着底部时保持跟随最新，用户往上翻看历史时不打断。
    const atBottom = output.scrollTop + output.clientHeight >= output.scrollHeight - 24;
    output.textContent = selected.lines.length ? selected.lines.join('\n') : '（暂无输出）';
    if (atBottom) output.scrollTop = output.scrollHeight;
    renderActivity();
  };

  const renderStatusError = () => {
    renderPhase('error');
    output.textContent = '读取日志失败，请确认控制中心和本机服务仍在运行。';
    renderActivity();
  };

  const refresh = async () => {
    try {
      render(await client.getComfyLogs(open ? 200 : 1));
    } catch {
      renderStatusError();
    }
  };

  const setOpen = (next: boolean) => {
    open = next;
    panel.hidden = !next;
    toggle.setAttribute('aria-expanded', String(next));
    caret.style.transform = next ? 'translateY(-1px) rotate(180deg)' : 'translateY(1px)';
    if (next) void refresh();
  };

  const onWorkflowProgress = (event: Event) => {
    const detail = (event as CustomEvent<WorkflowRunProgressDetail>).detail;
    if (!detail || typeof detail.runId !== 'string') return;
    activity = detail.status === 'loading' ? detail : null;
    renderActivity();
  };
  window.addEventListener('fisherai:workflow-run-progress', onWorkflowProgress);

  power.addEventListener('click', () => {
    void (async () => {
      busy = true;
      const stopping = phase === 'running' || phase === 'failed';
      if (!stopping) renderPhase('starting');
      power.disabled = true;
      power.textContent = stopping ? '停止中…' : '启动中…';
      hint.hidden = false;
      hint.textContent = stopping
        ? '正在停止本机 ComfyUI…'
        : '正在启动本机 ComfyUI，首次约 1-2 分钟，下方会实时显示它的输出。';
      try {
        const result = stopping ? await client.stopComfy() : await client.startComfy();
        if (result.status === 'failed') {
          hint.textContent = result.message || '操作失败。';
          hint.style.color = 'var(--af-danger)';
        } else {
          hint.style.color = 'var(--af-text-secondary)';
        }
      } catch (error) {
        hint.textContent = error instanceof Error ? error.message : '操作失败。';
        hint.style.color = 'var(--af-danger)';
      } finally {
        busy = false;
        power.disabled = false;
        void refresh();
      }
    })();
  });

  toggle.addEventListener('click', () => {
    setOpen(!open);
  });
  close.addEventListener('click', () => {
    setOpen(false);
  });
  streamToggle.addEventListener('click', () => {
    stream = stream === 'stderr' ? 'stdout' : 'stderr';
    renderStreamToggle();
    void refresh();
  });
  renderStreamToggle();

  const start = () => {
    void refresh();
    timer = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    window.removeEventListener('fisherai:workflow-run-progress', onWorkflowProgress);
  };

  return { host, start, stop, refresh, renderStatusError, setOpen };
}

function dockComfyPanel(host: HTMLElement, root: ParentNode): void {
  // 画布顶栏始终保留账户中心插槽；ComfyUI 状态固定停靠在它左侧。
  const account = root.querySelector<HTMLElement>('[data-fisherai-account-center-slot="true"]');
  const toolbar = account?.parentElement;
  const panel = host.querySelector<HTMLElement>('[data-fisherai-comfyui-log-panel]');
  if (account && toolbar && panel) {
    if (host.parentElement !== toolbar || host.nextElementSibling !== account) {
      toolbar.insertBefore(host, account);
    }
    host.dataset.dock = 'topbar';
    host.style.cssText =
      'position:relative;left:auto;bottom:auto;z-index:70;flex:none;font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif;';
    panel.style.left = 'auto';
    panel.style.right = '0px';
    panel.style.top = 'calc(100% + 8px)';
    panel.style.bottom = '';
    return;
  }
  if (host.dataset.dock !== 'topbar') return;
  document.body.append(host);
  delete host.dataset.dock;
  host.style.cssText =
    'position:fixed;left:16px;bottom:16px;z-index:60;font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif;';
  if (panel) {
    panel.style.left = '0px';
    panel.style.right = 'auto';
    panel.style.top = '';
    panel.style.bottom = 'calc(100% + 8px)';
  }
}

export function installComfyLogPanel(
  client: LocalRuntimeClient,
  { root = document }: { root?: ParentNode } = {},
): () => void {
  let disposed = false;
  let installed: ReturnType<typeof createComfyLogPanel> | null = null;
  let observer: MutationObserver | null = null;

  const attach = () => {
    if (disposed || installed || root.querySelector(`[${HOST_ATTRIBUTE}]`)) return null;
    installed = createComfyLogPanel(client);
    document.body.append(installed.host);
    dockComfyPanel(installed.host, root);
    observer = new MutationObserver(() => {
      if (installed) dockComfyPanel(installed.host, root);
    });
    observer.observe(root === document ? document.body : root, { childList: true, subtree: true });
    return installed;
  };

  const mount = async () => {
    if (disposed || installed) return;
    let state;
    try {
      state = await client.getComfyProcess();
    } catch {
      const panel = attach();
      panel?.renderStatusError();
      panel?.start();
      return;
    }
    // 没配置本机 ComfyUI 的用户不该看到这个按钮。
    if (!state.startable && !state.running && state.phase !== 'error') return;
    const panel = attach();
    if (state.phase === 'error') panel?.renderStatusError();
    panel?.start();
  };

  void mount();
  return () => {
    disposed = true;
    observer?.disconnect();
    observer = null;
    installed?.stop();
    installed?.host.remove();
    installed = null;
  };
}
