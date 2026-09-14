/** @jsxRuntime classic */
/** @jsx React.createElement */
import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
type Runtime = Pick<typeof ReactTypes, 'createElement'>;
interface Props {
  onAddClick: ReactTypes.MouseEventHandler;
  onWorkflowsClick: ReactTypes.MouseEventHandler;
  onWorkflowPresetsClick: ReactTypes.MouseEventHandler;
  onHistoryClick: ReactTypes.MouseEventHandler;
  onAssetsClick: ReactTypes.MouseEventHandler;
  onSettingsClick?(): void;
  onToolsOpen?(): void;
  currentUserName?: string;
  currentUserColor?: string;
}
interface Components {
  Tooltip: CanvasComponent;
  Add: CanvasComponent;
  Image: CanvasComponent;
  Workflow: CanvasComponent;
  History: CanvasComponent;
  Settings: CanvasComponent;
  avatarClass(name: string, size: number): string;
  avatarText(name: string): string;
}
export function CanvasSidebar(React: Runtime, props: Props, components: Components) {
  const { Tooltip, Add, Image, Workflow, History, Settings } = components;
  const name = props.currentUserName ?? '协作者';
  const actions = [
    { label: '资产', action: props.onAssetsClick, icon: <Image size={20} /> },
    { label: '工作流节点', action: props.onWorkflowsClick, icon: <Workflow size={20} /> },
    {
      label: 'SKILL 社区',
      action: props.onWorkflowPresetsClick,
      community: true,
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x={3} y={3} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={14} y={3} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={8.5} y={14} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <path
            d="M10 6.5h4M7.5 10v2l4.5 2 4.5-2v-2"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    { label: '历史', action: props.onHistoryClick, icon: <History size={20} /> },
    {
      label: '设置',
      action: () => {
        props.onToolsOpen?.();
        props.onSettingsClick?.();
      },
      icon: <Settings size={20} />,
    },
  ];
  return (
    <div
      role="toolbar"
      aria-label="画布工具"
      className="fixed left-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 p-1 rounded-full shadow-2xl z-50 transition-colors duration-300 bg-[var(--af-surface-raised)] border border-[var(--af-border)]"
    >
      <button
        type="button"
        aria-label="添加节点"
        className="w-10 h-10 rounded-full flex items-center justify-center hover:scale-110 transition-all duration-200 mb-2 bg-[var(--af-primary)] text-[var(--af-on-primary)] hover:bg-[var(--af-selected)] hover:text-[var(--af-on-selected)]"
        onClick={props.onAddClick}
      >
        <Add size={20} />
      </button>
      <div className="flex flex-col gap-6 py-2 px-1">
        {actions.map((item) => (
          <Tooltip key={item.label} text={item.label} position="right">
            <button
              type="button"
              aria-label={item.label}
              data-fisherai-skill-community-trigger={item.community ? 'true' : undefined}
              className="hover:scale-125 transition-all duration-200 text-[var(--af-text-secondary)] hover:text-[var(--af-text)]"
              onClick={item.action}
            >
              {item.icon}
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="w-8 h-[1px] mt-1 bg-[var(--af-border)]" />
      <div className="pt-3 pb-2">
        <Tooltip text={`当前用户 ${name}`} position="right">
          <div
            data-fisherai-profile-avatar="local"
            className={`w-10 h-10 rounded-full flex items-center justify-center border border-[var(--af-border-control)] shadow-lg shadow-blue-500/10 text-[var(--af-media-text)] [text-shadow:0_1px_2px_var(--af-media-bg),0_0_2px_var(--af-media-bg)] data-[has-custom-avatar=true]:[text-shadow:none] font-bold ${components.avatarClass(name, 40)}`}
            style={{ background: props.currentUserColor ?? '#60a5fa' }}
          >
            {components.avatarText(name)}
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
