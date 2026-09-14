import { openSettings } from '../navigation/openSettings';
import { observeStableEnhancement } from '../lifecycle/enhancementLifecycle';
import type { SourceSettingsClient } from '../generation/sourceSettingsClient';
import type { LocalRuntimeClient, LocalRuntimeStatus } from './localRuntimeClient';
import { createComfyDirectoryGuide } from './comfyDirectoryGuide';
import { preferenceStorage } from '../persistence/preferenceStore';

const PANEL_ATTRIBUTE = 'data-fisherai-first-run-check';
const DISMISS_KEY = 'fisherai.firstRunCheck.dismissed';

function button(label: string, variant: 'primary' | 'ghost' = 'ghost') {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.className =
    variant === 'primary'
      ? 'px-3 py-1.5 rounded-md bg-[var(--af-primary)] text-[var(--af-on-primary)] text-xs font-semibold hover:opacity-90 disabled:opacity-50'
      : 'px-3 py-1.5 rounded-md border border-[var(--af-border-control)] text-xs text-[var(--af-text)] hover:bg-[var(--af-hover)] disabled:opacity-50';
  return node;
}

function checkRow(label: string, value: string, tone: 'ready' | 'warn') {
  const row = document.createElement('div');
  row.className = 'flex items-baseline gap-2 whitespace-nowrap';
  row.setAttribute('data-fisherai-state', tone === 'ready' ? 'ready' : 'empty');
  row.append(element('span', label, 'text-xs text-[var(--af-text-secondary)]'));
  const summary = element('span', value, 'text-xs text-right');
  summary.style.color = tone === 'ready' ? 'var(--af-success)' : 'var(--af-text-secondary)';
  row.append(summary);
  return row;
}

function gibibytes(value?: number) {
  return value ? `${(value / 1024 ** 3).toFixed(1)} GB` : '--';
}

/**
 * 首次运行的开箱检查。只在「还没配置本机 ComfyUI 目录」且用户没关掉时出现。
 * 目的不是替代设置页，而是让新用户第一眼就知道：哪些能用、哪些还差什么。
 */
export function createFirstRunPanel(client: LocalRuntimeClient, onDismiss: () => void) {
  const panel = document.createElement('section');
  panel.setAttribute(PANEL_ATTRIBUTE, 'true');
  panel.className =
    'mb-6 rounded-lg border border-[var(--af-border-control)] bg-[var(--af-surface-raised)] p-4';

  const header = document.createElement('div');
  header.className = 'flex items-start justify-between gap-4';
  const heading = document.createElement('div');
  heading.append(element('h3', '开始你的第一次创作', 'text-sm font-bold text-[var(--af-text)]'));
  heading.append(
    element(
      'p',
      '画布、项目和素材已经可以直接用。连接模型服务即可生成；也可以使用自己的本机 ComfyUI。',
      'mt-1 text-xs text-[var(--af-text-secondary)]',
    ),
  );
  const dismiss = button('稍后再说');
  dismiss.setAttribute('data-fisherai-first-run-dismiss', 'true');
  dismiss.addEventListener('click', onDismiss);
  header.append(heading, dismiss);

  const checks = document.createElement('div');
  checks.setAttribute('data-fisherai-first-run-checks', 'true');
  checks.className =
    'mt-3 flex flex-wrap items-baseline border-t border-[var(--af-border-control)] pt-2';
  checks.style.columnGap = '2rem';
  checks.style.rowGap = '0.25rem';
  const notice = element('p', '', 'mt-2 text-xs text-[var(--af-text-secondary)]');

  const actions = document.createElement('div');
  actions.className = 'mt-3 flex items-center gap-2';
  const selectDirectory = button('选择 ComfyUI 目录');
  selectDirectory.setAttribute('data-fisherai-first-run-select-directory', 'true');
  actions.append(selectDirectory);

  const connect = button('连接模型服务', 'primary');
  connect.dataset.fisheraiFirstRunConnect = 'true';
  connect.addEventListener('click', () => openSettings('models'));
  const primary = document.createElement('div');
  Object.assign(primary.style, { marginTop: '20px', marginBottom: '20px' });
  primary.append(connect);
  const local = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '使用本机 ComfyUI（可选）';
  Object.assign(summary.style, {
    color: 'var(--af-text-secondary)',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '12px 0',
    borderTop: '1px solid var(--af-border)',
  });
  local.append(summary, checks, createComfyDirectoryGuide(), actions, notice);
  panel.append(header, primary, local);
  Object.assign(panel.style, {
    background: 'var(--af-surface)',
    color: 'var(--af-text)',
    border: '1px solid var(--af-border)',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '28px',
  });
  local.addEventListener('toggle', () => {
    if (local.open && !checks.children.length)
      void client
        .getStatus()
        .then(renderChecks)
        .catch(() => {
          notice.textContent = '暂时无法读取本机环境，可在设置中重新检查。';
        });
  });

  const renderChecks = (status: LocalRuntimeStatus) => {
    checks.replaceChildren();
    checks.append(
      checkRow(
        'GPU',
        status.gpu.available
          ? `${status.gpu.name || 'GPU'} · ${gibibytes(status.gpu.vramFreeBytes)} 可用`
          : '未检测到',
        status.gpu.available ? 'ready' : 'warn',
      ),
    );
    checks.append(
      checkRow(
        '本机 ComfyUI',
        status.comfyui.status === 'ready' || status.comfyui.status === 'partial'
          ? '已连接'
          : '未连接',
        status.comfyui.status === 'ready' || status.comfyui.status === 'partial' ? 'ready' : 'warn',
      ),
    );
    checks.append(
      checkRow(
        '可用本机工作流',
        // 兼容数量取决于用户装了哪些模型与自定义节点，不能显得是产品坏了。
        `${status.comfyui.compatibleWorkflowCount ?? 0}/${status.comfyui.workflowCount} · 取决于你已安装的模型`,
        (status.comfyui.compatibleWorkflowCount ?? 0) > 0 ? 'ready' : 'warn',
      ),
    );
  };

  selectDirectory.addEventListener('click', () => {
    void (async () => {
      selectDirectory.setAttribute('disabled', 'true');
      notice.textContent = '正在打开文件夹选择器…';
      try {
        const result = await client.selectComfyDirectory();
        if (result.status === 'cancelled') {
          notice.textContent = '';
          return;
        }
        if (result.status === 'invalid') {
          notice.textContent = result.message || '所选目录不是有效的 ComfyUI 安装目录。';
          return;
        }
        await client.adoptComfy(result.root);
        notice.textContent = '已保存。本机生成会在需要时自动启动 ComfyUI。';
      } catch (error) {
        notice.textContent = error instanceof Error ? error.message : '选择失败。';
      } finally {
        selectDirectory.removeAttribute('disabled');
      }
    })();
  });

  return { panel, renderChecks };
}

export function installFirstRunCheck(
  client: LocalRuntimeClient,
  {
    storage = preferenceStorage(),
    root = document,
    sourcesClient,
  }: {
    storage?: Pick<Storage, 'getItem' | 'setItem'>;
    root?: ParentNode;
    sourcesClient?: SourceSettingsClient;
  } = {},
): () => void {
  let disposed = false;
  let mounted = false;
  let pending = false;
  let checked = false;
  let needsSetup = false;
  let generation = 0;

  const isDismissed = () => {
    try {
      return storage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  };

  const mount = async () => {
    if (mounted && !root.querySelector(`[${PANEL_ATTRIBUTE}]`)) mounted = false;
    if (disposed || mounted || pending || isDismissed()) return;
    if (!checked) {
      pending = true;
      const requestedGeneration = generation;
      try {
        const [processState, models] = await Promise.all([
          client.getComfyProcess(),
          sourcesClient ? sourcesClient.getModelGroups(null) : Promise.resolve([]),
        ]);
        needsSetup =
          processState.diagnosticCode === 'COMFYUI_ROOT_NOT_CONFIGURED' &&
          !models.some((group) => group.variants.some((variant) => variant.configured));
        checked = true;
      } catch {
        checked = true;
        needsSetup = true;
      } finally {
        pending = false;
      }
      if (requestedGeneration !== generation) {
        checked = false;
        void mount();
        return;
      }
    }
    if (disposed || !needsSetup) return;
    const host = root.querySelector('main');
    if (!host || host.querySelector(`[${PANEL_ATTRIBUTE}]`)) return;

    const { panel } = createFirstRunPanel(client, () => {
      try {
        storage.setItem(DISMISS_KEY, 'true');
      } catch {
        /* 隐私模式下忽略 */
      }
      panel.remove();
    });
    host.prepend(panel);
    mounted = true;
  };

  const stop = observeStableEnhancement(() => {
    void mount();
  });
  const invalidate = () => {
    generation += 1;
    checked = false;
    mounted = false;
    root.querySelector(`[${PANEL_ATTRIBUTE}]`)?.remove();
    void mount();
  };
  window.addEventListener('fisherai:model-sources-changed', invalidate);
  return () => {
    disposed = true;
    stop();
    window.removeEventListener('fisherai:model-sources-changed', invalidate);
  };
}
import { createStableTextElement as element } from '../design/dom';
