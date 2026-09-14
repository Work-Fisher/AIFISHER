import { agentVisionLabels, agentVisionHints, type AgentVision } from './agentVision';
import { useEffect, useId, useState } from 'react';
import type { CodexStatus } from './codexClient';

interface Model {
  id: string;
  label: string;
  vision?: AgentVision;
}
interface Props {
  initialGuide?: boolean;
  hideConnectionEntry?: boolean;
  models: Model[];
  selected: string;
  status: CodexStatus | null;
  error: string;
  connecting: boolean;
  pending: boolean;
  onSetup(): Promise<string>;
  onSelect(id: string): void;
  onServices(): void;
  onLogin(): Promise<void>;
  onRefresh(): Promise<void>;
  onDisconnect(): Promise<void>;
}
const row =
  'w-full px-3 py-2 text-left text-xs text-[var(--af-text-secondary)] hover:bg-[var(--af-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--af-focus)] disabled:opacity-50';

export function AgentModelMenu(props: Props) {
  const { models, selected, status, error, connecting, pending } = props;
  const [guide, setGuide] = useState(props.initialGuide ?? false);
  const [expanded, setExpanded] = useState(
    selected.startsWith('codex/') ? 'codex' : models.length ? 'api' : 'codex',
  );
  const [showAll, setShowAll] = useState(false);
  const [checking, setChecking] = useState(false);
  const [setupPrompt, setSetupPrompt] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [setupCopied, setSetupCopied] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const id = useId();
  const refreshConnection = props.onRefresh;
  useEffect(() => {
    if (!setupPrompt || !guide) return;
    const timer = setInterval(() => void refreshConnection(), 4000);
    return () => clearInterval(timer);
  }, [setupPrompt, guide, refreshConnection]);
  const copySetup = async () => {
    if (preparing) return;
    setPreparing(true);
    setSetupError('');
    setSetupCopied(false);
    try {
      const prompt = await props.onSetup();
      setSetupPrompt(prompt);
      try {
        await navigator.clipboard.writeText(prompt);
        setSetupCopied(true);
      } catch {
        setSetupError('无法自动复制，请选中下方连接指令复制。');
      }
    } catch {
      setSetupError('连接指令生成失败，请检查连接后重试。');
    } finally {
      setPreparing(false);
    }
  };
  const refresh = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await props.onRefresh();
    } finally {
      setChecking(false);
    }
  };
  const groups: Array<{ id: string; label: string; models: Model[] }> = [
    { id: 'api', label: '模型服务', models },
    {
      id: 'codex',
      label: 'Codex',
      models: status?.connected
        ? status.models.map((m) => ({ id: `codex/${m.id}`, label: m.label }))
        : [],
    },
  ];
  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 max-w-[calc(100vw-64px)] max-h-[min(480px,65vh)] overflow-y-auto overscroll-contain bg-[var(--af-surface)] border border-[var(--af-border-control)] rounded-lg shadow-2xl z-50">
      {guide ? (
        <section aria-label="Codex 连接引导">
          <div className="flex items-center justify-between border-b border-[var(--af-border-control)] px-3 py-2">
            <span className="text-xs font-medium text-[var(--af-text)]">连接 Codex</span>
            <button
              type="button"
              className="text-xs text-[var(--af-text-secondary)] hover:text-[var(--af-text)]"
              onClick={() => setGuide(false)}
            >
              返回模型
            </button>
          </div>
          <div className="px-3 py-3 text-xs leading-relaxed">
            <p className="font-medium text-[var(--af-text)]">复制一句话，交给 Codex 帮你连接</p>
            <p className="mt-2 text-[var(--af-text-secondary)]">
              粘贴到这台电脑的 Codex
              桌面端对话，安装、检测和配置会按指引完成。首次需要授权时，按提示在官方页面登录。
            </p>
            <button
              type="button"
              disabled={preparing || connecting || pending}
              onClick={() => void copySetup()}
              className="mt-3 w-full rounded-md bg-[var(--af-primary)] py-2 font-medium text-[var(--af-on-primary)] hover:opacity-90 disabled:opacity-40"
            >
              {preparing ? '正在生成连接指令…' : setupCopied ? '已复制，再次复制' : '复制连接指令'}
            </button>
            {setupCopied && (
              <p role="status" className="mt-2 text-[var(--af-text-secondary)]">
                已复制。发给 Codex 后保持画布打开，这里会自动检测连接结果。
              </p>
            )}
            {setupError && (
              <p role="alert" className="mt-2 text-[var(--af-warning)]">
                {setupError}
              </p>
            )}
            {setupPrompt && (
              <details className="mt-2 text-[var(--af-text-secondary)]" open={!!setupError}>
                <summary className="cursor-pointer">查看连接指令</summary>
                <textarea
                  aria-label="连接指令"
                  readOnly
                  value={setupPrompt}
                  onFocus={(event) => event.target.select()}
                  className="mt-2 w-full h-28 resize-none rounded bg-[var(--af-surface)] p-2 text-xs text-[var(--af-text-secondary)]"
                />
              </details>
            )}
            <p className="mt-3 text-[var(--af-text-secondary)]">
              {status?.connected
                ? `已连接 · ${status.models.length} 个模型`
                : pending
                  ? '等待浏览器授权完成…'
                  : '等待连接'}
            </p>
            <p className="mt-1 text-[var(--af-text-muted)]">
              连接后仍在原模型菜单选择，思考强度在旁边调整。
            </p>
          </div>
          <details className="border-t border-[var(--af-border-control)]">
            <summary className="cursor-pointer px-3 py-2 text-xs text-[var(--af-text-secondary)]">
              手动连接（备用）
            </summary>
            <ol className="px-3 py-3 space-y-4 text-xs leading-relaxed text-[var(--af-text-secondary)]">
              <li>
                <p className="font-medium text-[var(--af-text)]">1. 准备连接工具</p>
                <p className="mt-1 text-[var(--af-text-secondary)]">
                  {status?.installed || status?.connected
                    ? `已检测到 Codex${status?.version ? ` ${status.version}` : ''}。`
                    : status?.installed === false
                      ? '尚未安装 Codex CLI（命令行工具）。'
                      : '尚未确认连接状态，请点击下方重新检测。'}
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[var(--af-text-secondary)]">
                    安装或更新方法
                  </summary>
                  <p className="mt-2 text-[var(--af-text-secondary)]">
                    先安装 Node.js LTS，打开 Windows PowerShell，粘贴并执行：
                  </p>
                  <code className="block mt-2 break-all rounded bg-[var(--af-surface)] p-2 select-text">
                    npm install -g @openai/codex@latest
                  </code>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            'npm install -g @openai/codex@latest',
                          );
                          setCopied(true);
                          setCopyError(false);
                        } catch {
                          setCopyError(true);
                        }
                      }}
                      className="underline underline-offset-2"
                    >
                      {copied ? '已复制' : '复制命令'}
                    </button>
                    <a
                      href="https://nodejs.org/en/download"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      下载 Node.js
                    </a>
                    <a
                      href="https://developers.openai.com/codex/cli"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      官方安装教程
                    </a>
                  </div>
                  {copyError && (
                    <p role="alert" className="mt-1 text-[var(--af-warning)]">
                      复制失败，请选中上方命令手动复制。
                    </p>
                  )}
                  <p className="mt-2 text-[var(--af-text-secondary)]">
                    缺少新模型时也请更新。安装或更新后重启 AIFISHER，再回到这里检测。
                  </p>
                </details>
                <button
                  type="button"
                  disabled={checking || connecting}
                  onClick={() => void refresh()}
                  className="mt-2 text-[var(--af-text)] underline underline-offset-2 disabled:opacity-50"
                >
                  {checking ? '正在检测…' : '重新检测 / 刷新模型'}
                </button>
              </li>
              <li>
                <p className="font-medium text-[var(--af-text)]">2. 登录 ChatGPT 账号</p>
                <p className="mt-1 text-[var(--af-text-secondary)]">
                  {status?.connected
                    ? '账号已连接。'
                    : pending
                      ? '请在已打开的浏览器完成登录，返回后会自动检测。'
                      : '点击下方按钮，在官方浏览器页面登录拥有 Codex 使用权限的账号。'}
                </p>
                {!status?.connected && (
                  <button
                    type="button"
                    disabled={connecting || checking || !status?.installed}
                    onClick={() => void props.onLogin()}
                    className="mt-2 w-full rounded-md bg-[var(--af-primary)] py-2 font-medium text-[var(--af-on-primary)] hover:opacity-90 disabled:opacity-40"
                  >
                    {connecting ? '正在打开登录…' : pending ? '重新打开登录页' : '在浏览器登录'}
                  </button>
                )}
              </li>
              <li>
                <p className="font-medium text-[var(--af-text)]">3. 选择模型，开始对话</p>
                <p className="mt-1 text-[var(--af-text-secondary)]">
                  {status?.connected
                    ? `已读取 ${status.models.length} 个模型。返回模型菜单，展开 Codex 后选择；思考强度在输入框下方调整。`
                    : '连接成功后，模型会出现在原模型菜单的 Codex 分组中。'}
                </p>
                <p className="mt-1 text-[var(--af-text-secondary)]">
                  对话使用该账号的 Codex 额度。
                </p>
              </li>
            </ol>
          </details>
          {error && (
            <p role="alert" className="px-3 pb-3 text-xs text-[var(--af-warning)]">
              {error}
            </p>
          )}
          {status?.connected && (
            <div className="border-t border-[var(--af-border-control)] p-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setGuide(false);
                  setExpanded('codex');
                }}
                className="flex-1 rounded-md bg-[var(--af-primary)] py-2 text-xs text-[var(--af-on-primary)]"
              >
                完成，选择模型
              </button>
              <button
                type="button"
                disabled={connecting || checking}
                onClick={() => void props.onDisconnect()}
                className="px-2 text-xs text-[var(--af-text-secondary)] disabled:opacity-50"
              >
                断开连接
              </button>
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="px-3 py-2 text-xs text-[var(--af-text-secondary)] border-b border-[var(--af-border-control)]">
            选择模型
          </div>
          {groups
            .filter((group) => group.models.length)
            .map((group) => {
              const open = expanded === group.id;
              const ordered = [...group.models].sort(
                (a, b) => Number(b.id === selected) - Number(a.id === selected),
              );
              const visible = showAll ? ordered : ordered.slice(0, 3);
              return (
                <section key={group.id}>
                  <button
                    type="button"
                    aria-label={group.label}
                    aria-expanded={open}
                    aria-controls={`${id}-${group.id}`}
                    onClick={() => {
                      setExpanded(open ? '' : group.id);
                      setShowAll(false);
                    }}
                    className={`${row} flex items-center gap-2 font-medium`}
                  >
                    <span aria-hidden="true">{open ? '⌄' : '›'}</span>
                    <span>{group.label}</span>
                    <span className="ml-auto text-[var(--af-text-muted)]">
                      {group.models.length}
                    </span>
                  </button>
                  {open && (
                    <div id={`${id}-${group.id}`} className="pb-1">
                      {visible.map((model) => (
                        <button
                          type="button"
                          key={model.id}
                          aria-label={model.label}
                          aria-pressed={model.id === selected}
                          onClick={() => props.onSelect(model.id)}
                          className={`${row} pl-7 flex items-center gap-2 ${model.id === selected ? 'bg-[var(--af-surface-raised)] text-[var(--af-text)]' : ''}`}
                        >
                          <span className="min-w-0 flex-1"><span className="block truncate">{model.label}</span><span className="block text-[10px] text-neutral-400" title={agentVisionHints[model.vision ?? 'unknown']}>{agentVisionLabels[model.vision ?? 'unknown']}{model.vision === 'supported' ? ' · 推荐用于画布' : ''}</span></span>
                          {model.id === selected && (
                            <span className="ml-auto" aria-hidden="true">
                              ✓
                            </span>
                          )}
                        </button>
                      ))}
                      {ordered.length > 3 && (
                        <button
                          type="button"
                          aria-expanded={showAll}
                          onClick={() => setShowAll(!showAll)}
                          className={`${row} pl-7 text-[var(--af-text-secondary)]`}
                        >
                          {showAll ? '收起更多模型' : `更多模型（${ordered.length - 3}）`}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          {!models.length && !status?.models.length && (
            <p className="px-3 py-3 text-xs text-[var(--af-text-muted)]">
              连接模型服务或 Codex 账号后，即可选择模型。
            </p>
          )}
          <div className="border-t border-[var(--af-border-control)] py-1">
            <button type="button" className={row} onClick={props.onServices}>
              连接模型服务
            </button>
            {!props.hideConnectionEntry && <button
              type="button"
              className={row}
              onClick={() => {
                setGuide(true);
                void refresh();
              }}
            >
              {status?.connected ? 'Codex 连接与使用指南' : '连接 Codex 账号'}
            </button>}
          </div>
        </>
      )}
    </div>
  );
}
