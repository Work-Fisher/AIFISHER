import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
import {
  MINIMAX_H3_DURATION,
  MINIMAX_H3_MODE_OPTIONS,
  describeMiniMaxH3Duration,
  getMiniMaxH3ModeLabel,
  getMiniMaxH3VisualPorts,
  migrateLegacyMiniMaxH3Node,
  remapMiniMaxH3ParentIds,
  type MiniMaxH3CanvasNode,
  type MiniMaxH3Mode,
} from '../media/minimaxH3';
type Runtime = Pick<
  typeof ReactTypes,
  'createElement' | 'Fragment' | 'useState' | 'useRef' | 'useEffect' | 'useLayoutEffect'
>;
interface NodeData extends MiniMaxH3CanvasNode {
  status?: string;
  errorMessage?: string;
  isMiniMaxSettingsOpen?: boolean;
}
interface Props {
  data: NodeData;
  selected?: boolean;
  projectId?: string;
  onUpdate(id: string, patch: Partial<NodeData>): void;
  onNodePointerDown?: ReactTypes.PointerEventHandler;
  onContextMenu?: ReactTypes.MouseEventHandler;
  onConnectorDown(
    event: ReactTypes.PointerEvent,
    id: string,
    side: 'left' | 'right',
    port: number,
  ): void;
  zoom: number;
  isHoveredForConnection?: boolean;
  isInvalidHover?: boolean;
  onMouseEnter?: ReactTypes.MouseEventHandler;
  onMouseLeave?: ReactTypes.MouseEventHandler;
  onMiniMaxH3T2VAGenerate?: (id: string) => unknown;
  connectedImageNodes?: MiniMaxH3CanvasNode[];
}
interface Components {
  Frame: CanvasComponent;
  PromptEditor: ReactTypes.ComponentType<{
    value: string;
    onChange(value: string): void;
    connectedAssets: MiniMaxH3CanvasNode[];
    placeholder: string;
    type: string;
    isDark: boolean;
  }>;
}
type Menu = 'mode' | 'ratio' | 'resolution' | 'audio' | 'duration' | null;
const ratios: Record<string, [number, number]> = {
  '1:1': [1, 1],
  '2:3': [2, 3],
  '3:2': [3, 2],
  '3:4': [3, 4],
  '4:3': [4, 3],
  '9:16': [9, 16],
  '16:9': [16, 9],
  '21:9': [21, 9],
};
const triggerStyle: ReactTypes.CSSProperties = {
  border: 0,
  background: 'transparent',
  color: 'var(--af-text-secondary)',
  fontSize: '12px',
  lineHeight: 1,
  whiteSpace: 'nowrap',
  padding: '7px 4px',
  borderRadius: '6px',
  cursor: 'pointer',
};
const inputStyle: ReactTypes.CSSProperties = {
  background: 'var(--af-surface)',
  border: '1px solid var(--af-border)',
  color: 'var(--af-text)',
  borderRadius: '8px',
  outline: 'none',
};
export function CanvasMiniMaxNode(
  React: Runtime,
  props: Props,
  { Frame, PromptEditor }: Components,
) {
  const {
    data: node,
    selected,
    onNodePointerDown,
    onContextMenu,
    onConnectorDown,
    zoom,
    isHoveredForConnection,
    isInvalidHover,
    onMouseEnter,
    onMouseLeave,
    onMiniMaxH3T2VAGenerate: onGenerate,
    connectedImageNodes: connectedNodes = [],
    projectId,
  } = props;
  const busy = node.status === 'loading',
    settingsOpen = !!node.isMiniMaxSettingsOpen,
    prompt = String(node.inlinePrompt || '');
  const live = React.useRef(props);
  live.current = props;
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  const update = (patch: Partial<NodeData>) => live.current.onUpdate(live.current.data.id, patch);
  const connectInput = (event: ReactTypes.PointerEvent, port = 0) => {
    event.stopPropagation();
    onConnectorDown(event, node.id, 'left', port);
  };
  const connectOutput = (event: ReactTypes.PointerEvent) => {
    event.stopPropagation();
    onConnectorDown(event, node.id, 'right', 0);
  };
  const legacyPatch = migrateLegacyMiniMaxH3Node(node, connectedNodes);
  const mode = node.minimaxH3Mode || legacyPatch?.minimaxH3Mode || 't2va';
  const modeLabel = getMiniMaxH3ModeLabel(mode),
    ports = getMiniMaxH3VisualPorts(legacyPatch ? { ...node, ...legacyPatch } : node);
  const dimensions = (value: number) => {
    const ratio = ratios[node.aspectRatio || '16:9'] || [16, 9],
      scale = Math.sqrt((value * 1024 * 1024) / (ratio[0] * ratio[1]));
    return `${value === 1 ? '1.0' : String(value)} MP（${Math.round((ratio[0] * scale) / 32) * 32}×${Math.round((ratio[1] * scale) / 32) * 32}）`;
  };
  const [menu, setMenu] = React.useState<Menu>(null),
    menuRoot = React.useRef<HTMLDivElement>(null),
    trigger = React.useRef<HTMLButtonElement | null>(null);
  const focusFrame = React.useRef<number | null>(null),
    lifetime = React.useRef(0);
  const closeMenu = (focus = false) => {
    setMenu(null);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    const owner = lifetime.current;
    focusFrame.current = focus
      ? requestAnimationFrame(() => {
          focusFrame.current = null;
          if (owner === lifetime.current && trigger.current?.isConnected) trigger.current.focus();
        })
      : null;
  };
  const openMenu = (event: ReactTypes.MouseEvent<HTMLButtonElement>, key: Menu) => {
    event.stopPropagation();
    trigger.current = event.currentTarget;
    setMenu((current) => (current === key ? null : key));
  };
  const choose = (value: string | number) => {
    const current = live.current.data;
    if (menu === 'mode' && MINIMAX_H3_MODE_OPTIONS.some((option) => option.value === value)) {
      const next = value as MiniMaxH3Mode;
      update({
        minimaxH3Mode: next,
        parentIds: remapMiniMaxH3ParentIds(current.parentIds || [], mode, next),
      });
    } else if (menu === 'ratio') update({ aspectRatio: String(value) });
    else if (menu === 'resolution') update({ megapixels: Number(value) });
    else if (menu === 'duration') update({ duration: Number(value) });
    closeMenu(true);
  };
  const focusPrompt = (event: ReactTypes.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (
      event.target instanceof Element &&
      event.target.closest('[contenteditable=true],button,a,input,select')
    )
      return;
    const editor = event.currentTarget.querySelector<HTMLElement>('[contenteditable=true]');
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };
  const menuOptions: Array<readonly [string | number, string, string?]> =
    menu === 'mode'
      ? MINIMAX_H3_MODE_OPTIONS.map((option) => [option.value, option.label, option.description])
      : menu === 'ratio'
        ? [
            ['16:9', '横屏 16:9'],
            ['9:16', '竖屏 9:16'],
            ['1:1', '方形 1:1'],
            ['4:3', '标准 4:3'],
            ['3:4', '竖幅 3:4'],
            ['21:9', '超宽 21:9'],
          ]
        : menu === 'resolution'
          ? [0.1, 0.2, 0.4, 0.6, 1].map((value) => [value, dimensions(value)])
          : [];
  const currentValue =
    menu === 'mode'
      ? mode
      : menu === 'ratio'
        ? node.aspectRatio || '16:9'
        : menu === 'resolution'
          ? Number(node.megapixels ?? 0.2)
          : menu === 'duration'
            ? Number(node.duration ?? 5)
            : 'native';
  const menuKeyDown = (event: ReactTypes.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next >= 0) {
      event.preventDefault();
      buttons[next].focus();
    }
  };
  React.useLayoutEffect(() => {
    const owner = ++lifetime.current;
    setMenu(null);
    return () => {
      lifetime.current = owner + 1;
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, [node.id, projectId]);
  React.useEffect(() => {
    const current = live.current,
      patch = migrateLegacyMiniMaxH3Node(current.data, current.connectedImageNodes || []);
    if (patch) current.onUpdate(current.data.id, patch);
  }, [node.id, node.minimaxH3Mode, projectId]);
  React.useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRoot.current?.contains(event.target)) setMenu(null);
    };
    document.addEventListener('pointerdown', outside);
    const frame = requestAnimationFrame(() =>
      menuRoot.current
        ?.querySelector<HTMLElement>(
          '[role="menuitemradio"][aria-checked="true"],input[type="range"]',
        )
        ?.focus(),
    );
    return () => {
      document.removeEventListener('pointerdown', outside);
      cancelAnimationFrame(frame);
    };
  }, [menu, projectId, node.id]);

  const durationSlider = (node: NodeData, update: (patch: Partial<NodeData>) => void) => {
    const durationConfig = MINIMAX_H3_DURATION,
      seconds = Number(node.duration ?? durationConfig.defaultSeconds),
      durationInfo = describeMiniMaxH3Duration(seconds);
    return (
      <div style={{ padding: '2px 4px 4px' }}>
        <input
          type={'range'}
          min={durationConfig.minSeconds}
          max={durationConfig.maxSeconds}
          step={1}
          value={seconds}
          aria-label={'视频时长（秒）'}
          data-fisherai-minimax-duration={'true'}
          onChange={(event) => update({ duration: Number(event.target.value) })}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              closeMenu(true);
              return;
            }
            const currentSeconds = Number(event.currentTarget.value);
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              update({ duration: Math.min(durationConfig.maxSeconds, currentSeconds + 1) });
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              update({ duration: Math.max(durationConfig.minSeconds, currentSeconds - 1) });
            }
          }}
          style={{ width: '100%', accentColor: 'var(--af-focus)', cursor: 'pointer' }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '8px',
            marginTop: '8px',
          }}
        >
          <span
            style={{
              color: 'var(--af-text)',
              fontSize: '13px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {seconds + ' 秒'}
          </span>
          <span
            style={{
              color: 'var(--af-text-secondary)',
              fontSize: '11px',
              textAlign: 'right',
            }}
          >
            {durationInfo.summary}
          </span>
        </div>
        {durationInfo.warning ? (
          <div
            style={{
              marginTop: '6px',
              fontSize: '11px',
              lineHeight: 1.5,
              color: 'var(--af-warning)',
            }}
          >
            {durationInfo.warning}
          </div>
        ) : null}
      </div>
    );
  };
  const menuPanel = menu && (
    <div
      id={'minimax-quick-menu-' + node.id}
      role={'menu'}
      aria-label={
        menu === 'mode'
          ? '生成模式菜单'
          : menu === 'ratio'
            ? '画面比例菜单'
            : menu === 'resolution'
              ? '像素规模菜单'
              : menu === 'audio'
                ? '音频模式菜单'
                : '时长菜单'
      }
      onPointerDown={stop}
      onKeyDown={menuKeyDown}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          closeMenu();
      }}
      style={{
        position: 'absolute',
        right: '58px',
        bottom: '58px',
        zIndex: 30,
        width: menu === 'audio' || menu === 'mode' ? '304px' : '252px',
        padding: '10px',
        background: 'var(--af-surface)',
        border: '1px solid var(--af-border-control)',
        borderRadius: '10px',
        boxShadow: 'var(--af-shadow)',
      }}
    >
      <div
        style={{
          padding: '2px 4px 9px',
          color: 'var(--af-text-muted)',
          fontSize: '11px',
          fontWeight: 600,
        }}
      >
        {menu === 'mode'
          ? '生成方式'
          : menu === 'ratio'
            ? '画面比例'
            : menu === 'resolution'
              ? '像素规模'
              : menu === 'audio'
                ? '音频模式'
                : '视频时长'}
      </div>
      {menu === 'duration' ? (
        durationSlider(node, update)
      ) : menu === 'audio' ? (
        <button
          type={'button'}
          role={'menuitemradio'}
          aria-checked={!0}
          onClick={() => closeMenu(!0)}
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '5px',
            padding: '10px',
            border: '1px solid var(--af-border)',
            borderRadius: '8px',
            background: 'var(--af-surface-raised)',
            color: 'var(--af-text)',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <strong style={{ fontSize: '13px', fontWeight: 600 }}>{'原生音频'}</strong>
          <span
            style={{
              fontSize: '11px',
              lineHeight: 1.5,
              color: 'var(--af-text-secondary)',
            }}
          >
            {'声音随画面同步生成，无需额外连接音频素材。'}
          </span>
        </button>
      ) : (
        <div style={{ display: 'grid', gap: '4px' }}>
          {menuOptions.map((value) => (
            <button
              type={'button'}
              role={'menuitemradio'}
              aria-checked={String(currentValue) === String(value[0])}
              onClick={() => choose(value[0])}
              style={{
                width: '100%',
                minHeight: '34px',
                display: 'flex',
                alignItems: value[2] ? 'flex-start' : 'center',
                gap: '9px',
                padding: value[2] ? '9px 10px' : '0 10px',
                border: 0,
                borderRadius: '7px',
                background:
                  String(currentValue) === String(value[0])
                    ? 'var(--af-surface-raised)'
                    : 'transparent',
                color:
                  String(currentValue) === String(value[0])
                    ? 'var(--af-text)'
                    : 'var(--af-text-secondary)',
                fontSize: '12px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
              key={String(value[0])}
            >
              <span
                style={{
                  flex: 'none',
                  marginTop: value[2] ? '5px' : '0',
                  width: '6px',
                  height: '6px',
                  borderRadius: '9999px',
                  background:
                    String(currentValue) === String(value[0]) ? 'var(--af-focus)' : 'transparent',
                  boxShadow:
                    String(currentValue) === String(value[0])
                      ? '0 0 0 3px rgba(96,165,250,.14)'
                      : 'none',
                }}
              />
              {value[2] ? (
                <span
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color:
                        String(currentValue) === String(value[0])
                          ? 'var(--af-text)'
                          : 'var(--af-text-secondary)',
                    }}
                  >
                    {value[1]}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      lineHeight: 1.5,
                      color: 'var(--af-text-muted)',
                    }}
                  >
                    {value[2]}
                  </span>
                </span>
              ) : (
                <span>{value[1]}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Frame
      data={node}
      selected={selected}
      isBareCard={!0}
      onNodePointerDown={onNodePointerDown}
      onContextMenu={onContextMenu}
      onConnectorDown={onConnectorDown}
      zoom={zoom}
      isHoveredForConnection={isHoveredForConnection}
      isInvalidHover={isInvalidHover}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        data-fisherai-minimax-generator={'true'}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: 'transparent',
          borderRadius: '8px',
          color: 'var(--af-text)',
          fontFamily: "Inter, 'Microsoft YaHei UI', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '8px',
            bottom: 'calc(100% + 10px)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '16px',
            fontWeight: 700,
            letterSpacing: '-.01em',
            whiteSpace: 'nowrap',
          }}
        >
          <svg width={18} height={18} viewBox={'0 0 24 24'} fill={'none'} aria-hidden={'true'}>
            <path
              d={
                'M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z'
              }
              stroke={'currentColor'}
              strokeWidth={2}
              strokeLinecap={'round'}
              strokeLinejoin={'round'}
            />
          </svg>
          <span>{'视频生成'}</span>
        </div>
        <div
          data-fisherai-minimax-preview={'true'}
          style={{
            position: 'relative',
            height: '402px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 32px 16px',
          }}
        >
          {ports.map((value) => (
            <div
              style={{
                position: 'absolute',
                left: 'calc(50% - 262px)',
                top: value.y + 'px',
                transform: 'translateY(-50%)',
                zIndex: 12,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              key={value.id}
            >
              <button
                type={'button'}
                aria-label={'连接' + value.label}
                data-fisherai-connector-node-id={node.id}
                data-fisherai-connector-side={'left'}
                data-fisherai-connector-port-index={value.portIndex}
                onPointerDown={(event) => connectInput(event, value.portIndex)}
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '9999px',
                  border:
                    '1px solid ' + (value.connected > 0 ? 'var(--af-focus)' : 'var(--af-border)'),
                  background: 'var(--af-input)',
                  color: value.connected > 0 ? 'var(--af-info)' : 'var(--af-text-secondary)',
                  fontSize: '30px',
                  fontWeight: 300,
                  lineHeight: '38px',
                  cursor: 'crosshair',
                }}
              >
                {'+'}
              </button>
              <span
                style={{
                  position: 'absolute',
                  right: '50px',
                  color: value.connected > 0 ? 'var(--af-text-secondary)' : 'var(--af-text-muted)',
                  fontSize: '11px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {value.label +
                  (value.maximum > 1 && value.connected > 0
                    ? ` ${value.connected}/${value.maximum}`
                    : '')}
              </span>
            </div>
          ))}
          <div
            style={{
              width: '438px',
              height: '352px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--af-surface)',
              border: '1px solid var(--af-border)',
              borderRadius: '12px',
              boxShadow: selected ? '0 0 0 2px var(--af-focus)' : 'none',
            }}
          >
            <svg
              width={58}
              height={58}
              viewBox={'0 0 24 24'}
              fill={'none'}
              aria-hidden={'true'}
              style={{ color: 'var(--af-text-muted)' }}
            >
              <React.Fragment>
                <rect
                  x={3}
                  y={5}
                  width={18}
                  height={14}
                  rx={2}
                  stroke={'currentColor'}
                  strokeWidth={2}
                />
                <path
                  d={'M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4'}
                  stroke={'currentColor'}
                  strokeWidth={2}
                />
              </React.Fragment>
            </svg>
          </div>
          <button
            type={'button'}
            aria-label={'连接输出视频'}
            data-fisherai-connector-node-id={node.id}
            data-fisherai-connector-side={'right'}
            onPointerDown={connectOutput}
            style={{
              position: 'absolute',
              right: 'calc(50% - 262px)',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '42px',
              height: '42px',
              borderRadius: '9999px',
              border: '1px solid var(--af-border)',
              background: 'var(--af-input)',
              color: 'var(--af-text-secondary)',
              fontSize: '30px',
              fontWeight: 300,
              lineHeight: '38px',
              cursor: 'crosshair',
            }}
          >
            {'+'}
          </button>
        </div>
        <div
          data-fisherai-minimax-deck={'true'}
          style={{
            height: '278px',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--af-surface-raised)',
            borderTop: '1px solid var(--af-border)',
            borderRadius: '12px 12px 8px 8px',
            padding: '18px 20px 14px',
            boxShadow: '0 -14px 40px rgba(0,0,0,.18)',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 auto',
              minHeight: 0,
            }}
          >
            <label
              htmlFor={'minimax-prompt-' + node.id}
              style={{
                position: 'absolute',
                width: '1px',
                height: '1px',
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
              }}
            >
              {'提示词'}
            </label>
            <div
              id={'minimax-prompt-' + node.id}
              aria-label={'提示词'}
              data-fisherai-minimax-prompt-surface={'true'}
              style={{
                position: 'relative',
                width: '100%',
                flex: '1 1 auto',
                minHeight: 0,
                padding: '10px 12px',
                cursor: 'text',
              }}
              onPointerDown={stop}
              onClick={focusPrompt}
            >
              <PromptEditor
                value={prompt}
                onChange={(value) => update({ inlinePrompt: value })}
                connectedAssets={(connectedNodes || []).filter(
                  (value) =>
                    value.type === 'Text' ||
                    value.type === 'Image' ||
                    value.type === 'Upload Image' ||
                    value.type === 'Video' ||
                    value.type === 'Upload Video' ||
                    value.type === 'Audio' ||
                    value.type === 'Upload Audio',
                )}
                placeholder={'输入提示词，按 @ 引用已连接素材'}
                type={'video'}
                isDark={!0}
              />
            </div>
            <div
              style={{
                order: -1,
                flex: 'none',
                fontSize: '11px',
                lineHeight: '16px',
                color: 'var(--af-text-muted)',
                textAlign: 'right',
                paddingRight: '2px',
                marginBottom: (connectedNodes || []).filter(Boolean).length ? '6px' : '0',
              }}
            >
              {(connectedNodes || []).filter(Boolean).length
                ? `已连接 ${(connectedNodes || []).filter(Boolean).length} 个素材`
                : ''}
            </div>
          </div>
          {settingsOpen && (
            <div
              style={{
                height: '58px',
                display: 'grid',
                gridTemplateColumns: '1.25fr 1.25fr 1fr 1fr',
                gap: '8px',
                padding: '8px 0',
                borderTop: '1px solid var(--af-border)',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  fontSize: '10px',
                  color: 'var(--af-text-muted)',
                }}
              >
                {'画面比例'}
                <select
                  aria-label={'画面比例'}
                  value={node.aspectRatio || '16:9'}
                  onChange={(value) => update({ aspectRatio: value.target.value })}
                  onPointerDown={stop}
                  style={{
                    ...inputStyle,
                    height: '32px',
                    padding: '0 8px',
                    fontSize: '12px',
                  }}
                >
                  <option value={'16:9'}>{'横屏 16:9'}</option>
                  <option value={'9:16'}>{'竖屏 9:16'}</option>
                  <option value={'1:1'}>{'方形 1:1'}</option>
                  <option value={'4:3'}>{'4:3'}</option>
                  <option value={'3:4'}>{'3:4'}</option>
                  <option value={'21:9'}>{'21:9'}</option>
                </select>
              </label>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  fontSize: '10px',
                  color: 'var(--af-text-muted)',
                }}
              >
                {'像素规模'}
                <select
                  aria-label={'像素规模'}
                  value={String(node.megapixels ?? 0.2)}
                  onChange={(value) => update({ megapixels: Number(value.target.value) })}
                  onPointerDown={stop}
                  style={{
                    ...inputStyle,
                    height: '32px',
                    padding: '0 8px',
                    fontSize: '12px',
                  }}
                >
                  <option value={'0.1'}>{dimensions(0.1)}</option>
                  <option value={'0.2'}>{dimensions(0.2)}</option>
                  <option value={'0.4'}>{dimensions(0.4)}</option>
                  <option value={'0.6'}>{dimensions(0.6)}</option>
                  <option value={'1'}>{dimensions(1)}</option>
                </select>
              </label>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  fontSize: '10px',
                  color: 'var(--af-text-muted)',
                }}
              >
                {'时长'}
                <input
                  aria-label={'时长（秒）'}
                  type={'number'}
                  min={MINIMAX_H3_DURATION.minSeconds}
                  max={MINIMAX_H3_DURATION.maxSeconds}
                  value={node.duration ?? 5}
                  onChange={(value) =>
                    update({
                      duration: Math.min(
                        MINIMAX_H3_DURATION.maxSeconds,
                        Math.max(
                          MINIMAX_H3_DURATION.minSeconds,
                          Number(value.target.value) || MINIMAX_H3_DURATION.defaultSeconds,
                        ),
                      ),
                    })
                  }
                  onPointerDown={stop}
                  style={{
                    ...inputStyle,
                    width: '100%',
                    height: '32px',
                    padding: '0 8px',
                    fontSize: '12px',
                  }}
                />
              </label>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  fontSize: '10px',
                  color: 'var(--af-text-muted)',
                }}
              >
                {'种子'}
                <input
                  aria-label={'随机种子'}
                  type={'number'}
                  min={0}
                  value={node.seed ?? 1}
                  onChange={(value) => update({ seed: Number(value.target.value) })}
                  onPointerDown={stop}
                  style={{
                    ...inputStyle,
                    width: '100%',
                    height: '32px',
                    padding: '0 8px',
                    fontSize: '12px',
                  }}
                />
              </label>
            </div>
          )}
          <div
            ref={menuRoot}
            onKeyDown={(event) => {
              if (menu) menuKeyDown(event);
            }}
            style={{
              position: 'relative',
              height: '56px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              borderTop: '1px solid var(--af-border)',
              paddingTop: '12px',
            }}
          >
            {menuPanel}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                minWidth: '142px',
              }}
            >
              <img
                src={'/AIFISHER-mark-white.svg'}
                alt={''}
                width={22}
                height={22}
                style={{ objectFit: 'contain' }}
              />
              <strong style={{ fontSize: '14px', fontWeight: 600 }}>{'MiniMax H3'}</strong>
            </div>
            <div
              style={{
                width: '1px',
                height: '22px',
                background: 'var(--af-border)',
              }}
            />
            <button
              type={'button'}
              data-fisherai-minimax-parameter={'mode'}
              aria-label={'生成模式，当前 ' + modeLabel}
              aria-expanded={menu === 'mode'}
              aria-controls={'minimax-quick-menu-' + node.id}
              onClick={(value) => openMenu(value, 'mode')}
              onPointerDown={stop}
              style={{
                ...triggerStyle,
                color: menu === 'mode' ? 'var(--af-info)' : 'var(--af-focus)',
                fontSize: '14px',
                fontWeight: 600,
              }}
            >
              {modeLabel}
            </button>
            <button
              type={'button'}
              data-fisherai-minimax-parameter={'ratio'}
              aria-label={'画面比例，当前 ' + (node.aspectRatio || '16:9')}
              aria-expanded={menu === 'ratio'}
              aria-controls={'minimax-quick-menu-' + node.id}
              onClick={(value) => openMenu(value, 'ratio')}
              onPointerDown={stop}
              style={{
                ...triggerStyle,
                marginLeft: 'auto',
                color: menu === 'ratio' ? 'var(--af-text)' : 'var(--af-text-secondary)',
              }}
            >
              {node.aspectRatio || '16:9'}
            </button>
            <button
              type={'button'}
              data-fisherai-minimax-parameter={'resolution'}
              aria-label={'像素规模，当前 ' + dimensions(node.megapixels ?? 0.2)}
              aria-expanded={menu === 'resolution'}
              aria-controls={'minimax-quick-menu-' + node.id}
              onClick={(value) => openMenu(value, 'resolution')}
              onPointerDown={stop}
              style={{
                ...triggerStyle,
                color: menu === 'resolution' ? 'var(--af-text)' : 'var(--af-text-secondary)',
              }}
            >
              {dimensions(node.megapixels ?? 0.2)}
            </button>
            <button
              type={'button'}
              data-fisherai-minimax-parameter={'audio'}
              aria-label={'音频模式，当前原生音频'}
              aria-expanded={menu === 'audio'}
              aria-controls={'minimax-quick-menu-' + node.id}
              onClick={(value) => openMenu(value, 'audio')}
              onPointerDown={stop}
              title={'声音由提示词原生生成，无需连接音频素材'}
              style={{
                ...triggerStyle,
                color: menu === 'audio' ? 'var(--af-text)' : 'var(--af-text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <svg width={17} height={17} viewBox={'0 0 24 24'} fill={'none'} aria-hidden={'true'}>
                <React.Fragment>
                  <path
                    d={'M11 5L6 9H3v6h3l5 4V5z'}
                    stroke={'currentColor'}
                    strokeWidth={2}
                    strokeLinejoin={'round'}
                  />
                  <path
                    d={'M15 9a4 4 0 010 6M18 6a8 8 0 010 12'}
                    stroke={'currentColor'}
                    strokeWidth={2}
                    strokeLinecap={'round'}
                  />
                </React.Fragment>
              </svg>
              {'原生音频'}
            </button>
            <button
              type={'button'}
              aria-label={'生成设置'}
              aria-expanded={settingsOpen}
              onClick={() => update({ isMiniMaxSettingsOpen: !settingsOpen })}
              onPointerDown={stop}
              style={{
                width: '36px',
                height: '36px',
                display: 'grid',
                placeItems: 'center',
                ...inputStyle,
                cursor: 'pointer',
                color: settingsOpen ? 'var(--af-text)' : 'var(--af-text-secondary)',
              }}
            >
              <svg width={18} height={18} viewBox={'0 0 24 24'} fill={'none'} aria-hidden={'true'}>
                <path
                  d={'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6'}
                  stroke={'currentColor'}
                  strokeWidth={2}
                  strokeLinecap={'round'}
                />
              </svg>
            </button>
            <button
              type={'button'}
              data-fisherai-minimax-parameter={'duration'}
              aria-label={'时长，当前 ' + String(node.duration ?? 5) + ' 秒'}
              aria-expanded={menu === 'duration'}
              aria-controls={'minimax-quick-menu-' + node.id}
              onClick={(value) => openMenu(value, 'duration')}
              onPointerDown={stop}
              style={{
                ...triggerStyle,
                color: menu === 'duration' ? 'var(--af-text)' : 'var(--af-text-muted)',
                minWidth: '32px',
                textAlign: 'right',
              }}
            >
              {String(node.duration ?? 5) + 's'}
            </button>
            <button
              type={'button'}
              aria-label={'生成视频'}
              disabled={busy}
              onClick={() => onGenerate && onGenerate(node.id)}
              onPointerDown={stop}
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '9999px',
                border: '1px solid ' + (busy ? 'var(--af-border)' : 'var(--af-text-secondary)'),
                background: busy ? 'var(--af-surface-raised)' : 'var(--af-primary)',
                color: busy ? 'var(--af-text-muted)' : 'var(--af-on-primary)',
                display: 'grid',
                placeItems: 'center',
                cursor: busy ? 'not-allowed' : 'pointer',
                fontSize: '22px',
                fontWeight: 700,
              }}
            >
              {busy ? '…' : '↑'}
            </button>
          </div>
          {node.status === 'error' && node.errorMessage ? (
            <div
              role={'alert'}
              style={{
                position: 'absolute',
                left: '20px',
                right: '76px',
                bottom: '70px',
                padding: '7px 10px',
                border: '1px solid var(--af-danger)',
                background: 'var(--af-danger-bg)',
                color: 'var(--af-danger)',
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              {node.errorMessage}
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
