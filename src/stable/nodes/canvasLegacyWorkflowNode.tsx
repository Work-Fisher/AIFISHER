import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';

interface Props extends Record<string, unknown> {
  data: { id: string; title?: string; comfyMode?: string };
  selected?: boolean;
}
interface Components {
  Frame: CanvasComponent;
  Header: CanvasComponent;
}

/** Persisted retired nodes stay editable as document objects. They must never
 * inherit MiniMax's form or fall through to another generation implementation. */
export function CanvasLegacyWorkflowNode(
  React: Pick<typeof ReactTypes, 'createElement'>,
  props: Props,
  { Frame, Header }: Components,
) {
  return React.createElement(
    Frame,
    {
      data: props.data,
      selected: props.selected,
      onNodePointerDown: props.onNodePointerDown,
      onContextMenu: props.onContextMenu,
      onConnectorDown: props.onConnectorDown,
      zoom: props.zoom,
      isHoveredForConnection: props.isHoveredForConnection,
      isInvalidHover: props.isInvalidHover,
      onMouseEnter: props.onMouseEnter,
      onMouseLeave: props.onMouseLeave,
    },
    <Header data={props.data} selected={props.selected} onUpdate={props.onUpdate} />,
    <div className="relative w-full h-full rounded-lg overflow-hidden bg-[var(--af-surface)] flex flex-col p-4 gap-3">
      <div className="text-sm font-bold text-[var(--af-text)]">
        {props.data.title || '旧版内置工作流'}
      </div>
      <div className="text-xs leading-relaxed text-[var(--af-text-secondary)]" role="status">
        此内置工作流已停用。原节点参数、连接与已有结果仍保留在项目中。请导入对应的 ComfyUI API JSON
        后运行。
      </div>
      <button
        type="button"
        className="self-start rounded-lg border border-[var(--af-border-control)] bg-[var(--af-surface-raised)] px-3 py-2 text-xs text-[var(--af-text)] hover:bg-[var(--af-selected)]"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          window.dispatchEvent(new CustomEvent('fisherai:open-workflow-library'));
        }}
      >
        打开工作流
      </button>
    </div>,
  );
}
