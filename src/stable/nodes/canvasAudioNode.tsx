import type { CanvasComponent } from '../app/canvasComponentType';
import { useGenerationAvailability } from './useGenerationAvailability';
import {
  useComposerBusy,
  type ComposerRuntime,
  type ComposerNode,
  type ComposerModel,
  type MediaComposerProps,
  type MediaComposerComponents,
} from './mediaComposer';
interface AudioModel extends ComposerModel {
  audioModes?: { value: string; label: string }[];
}
interface AudioData extends ComposerNode {
  audioModel?: string;
  audioMode?: string;
  lyrics?: string;
  status?: string;
}
interface Props extends Omit<MediaComposerProps, 'data'>, Record<string, unknown> {
  data: AudioData;
  selected?: boolean;
  showControls?: boolean;
  isDragging?: boolean;
  isVisible?: boolean;
  onUpload?(id: string, file: File): void;
}
interface Components extends Omit<
  MediaComposerComponents,
  'models' | 'ratios' | 'resolutions' | 'Dimensions'
> {
  models: AudioModel[];
  Frame: CanvasComponent;
  Header: CanvasComponent;
  Toolbar: CanvasComponent;
  Player: CanvasComponent;
}
export function CanvasAudioNode(
  React: ComposerRuntime,
  props: Props,
  {
    models,
    Frame,
    Header,
    Toolbar,
    Player,
    ConnectedAssets,
    PromptEditor,
    ModelSelector,
    AdvancedSettings,
    Tooltip,
    CollapseIcon,
    SettingsIcon,
    GenerateIcon,
  }: Components,
) {
  const {
    data: node,
    selected,
    onUpdate,
    onGenerate,
    onSelect,
    onUpload,
    onNodePointerDown,
    onContextMenu,
    onConnectorDown,
    isHoveredForConnection,
    isInvalidHover,
    onExpand,
    onDragStart,
    onDragEnd,
    zoom,
    showControls = true,
    isDragging = false,
    isVisible = true,
    onMouseEnter,
    onMouseLeave,
    isResizing = false,
    onResizeStart,
    onAudioTrim,
    connectedImageNodes: assets = [],
  } = props;
  const fileInput = React.useRef<HTMLInputElement>(null),
    modeRoot = React.useRef<HTMLDivElement>(null);
  const isUpload = node.type === 'Upload Audio';
  const [modeOpen, setModeOpen] = React.useState(false),
    [advancedOpen, setAdvancedOpen] = React.useState(false),
    [editing, setEditing] = React.useState(false);
  const busy = useComposerBusy(React, node.id, node.status === 'loading');
  const model: AudioModel = models.find((candidate) => candidate.name === node.audioModel) ||
    models[0] || { name: '' };
  const mode = node.audioMode || model.audioModes?.[0]?.value || '';
  const modeLabel =
    model.audioModes?.find((candidate) => candidate.value === mode)?.label ||
    model.audioModes?.[0]?.label;
  const { checking, blocked, warning } = useGenerationAvailability(
    React,
    isUpload ? '' : model.name,
    mode,
  );
  const rawPrice =
    typeof model.cost === 'object'
      ? (model.cost[mode] ?? Object.values(model.cost)[0])
      : model.cost;
  const unitPrice = typeof rawPrice === 'number' && Number.isFinite(rawPrice) ? rawPrice : 0.2;
  const count = Math.max(1, Math.trunc(Number(node.generateCount) || 1)),
    price = (unitPrice * count).toFixed(2);
  const lyricsMode = mode === 'lyrics-to-music';
  const hasInput =
    mode === 'stems'
      ? !!String(node.task_id || '').trim()
      : lyricsMode
        ? !!node.lyrics?.trim()
        : !!node.prompt?.trim() ||
          assets.some(
            (asset) =>
              asset.type === 'Text' && !!String(asset.textContent || asset.prompt || '').trim(),
          );
  const disabled = busy || !hasInput || checking || blocked;
  React.useEffect(() => {
    if (!modeOpen) return;
    const outside = (event: MouseEvent) => {
      if (!modeRoot.current?.contains(event.target as Node)) setModeOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setModeOpen(false);
        modeRoot.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [modeOpen]);
  const changeModel = (name: string) => {
    const next = models.find((candidate) => candidate.name === name) || models[0];
    const patch: Partial<AudioData> = { audioModel: name };
    if (next?.audioModes?.length && !next.audioModes.some((candidate) => candidate.value === mode))
      patch.audioMode = next.audioModes[0].value;
    const defaultCount = next?.advancedParams?.find(
      (parameter) => parameter.key === 'generateCount',
    )?.default;
    if (typeof defaultCount === 'number') patch.generateCount = defaultCount;
    onUpdate(node.id, patch);
  };

  return (
    <Frame
      data={node}
      selected={selected}
      onNodePointerDown={onNodePointerDown}
      onContextMenu={onContextMenu}
      onConnectorDown={onConnectorDown}
      isHoveredForConnection={isHoveredForConnection}
      isInvalidHover={isInvalidHover}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      isResizing={isResizing}
      onResizeStart={onResizeStart}
      width={'365px'}
      zoom={zoom}
      controls={
        selected && !isDragging && !isUpload && showControls ? (
          <div
            className={'flex flex-col items-center w-full'}
            onPointerDown={(re) => re.stopPropagation()}
          >
            <div
              className={
                'p-2.5 rounded-lg shadow-2xl cursor-default w-full transition-colors duration-300 bg-[var(--af-surface-raised)] border border-[var(--af-border)]'
              }
              onContextMenu={(re) => re.stopPropagation()}
              onDoubleClick={(re) => re.stopPropagation()}
              onClick={() => onSelect(node.id)}
            >
              <ConnectedAssets
                node={node}
                disabled={busy}
                connectedImageNodes={assets}
                onUpdate={onUpdate}
              />
              <div
                className={`mb-1 relative group/prompt overflow-hidden prompt-editor-container custom-scrollbar ${editing ? 'is-prompt-editing cursor-text' : 'cursor-pointer'}`}
                onClick={(re) => {
                  re.stopPropagation();
                  setEditing(true);
                }}
              >
                <PromptEditor
                  type={'audio'}
                  value={node.prompt || ''}
                  onChange={(re) => onUpdate(node.id, { prompt: re })}
                  connectedAssets={assets || []}
                  isDark={!0}
                  disableDirectEdit={!editing}
                  onBlur={() => setEditing(!1)}
                  key={`mention-editor-${node.id}`}
                />
              </div>
              {node.errorMessage && (
                <div
                  className={
                    'text-[var(--af-danger)] text-xs mb-2 p-1 bg-red-900/20 rounded border border-red-900/50'
                  }
                >
                  {node.errorMessage}
                </div>
              )}
              {!node.errorMessage && warning && (
                <div
                  className={
                    'text-[var(--af-warning)] text-xs mb-2 p-1 bg-amber-900/20 rounded border border-amber-900/40'
                  }
                >
                  {warning}
                </div>
              )}
              <div className={'flex items-center justify-between w-full p-0 h-9'}>
                <div className={'flex items-center gap-0.5 min-w-0 h-full'}>
                  <ModelSelector
                    isVideoNode={!1}
                    currentModel={model}
                    availableModels={models}
                    disabled={busy}
                    onModelChange={changeModel}
                  />
                  <div className={'w-px h-3.5 bg-[var(--af-surface-raised)]'} />
                </div>
                <div className={'relative flex items-center gap-1 h-full'}>
                  {modeLabel && (
                    <div className={'relative flex items-center h-full'} ref={modeRoot}>
                      <Tooltip text={'生成模式'}>
                        <button
                          aria-label="音频生成模式"
                          aria-expanded={modeOpen}
                          onClick={() => !busy && setModeOpen(!modeOpen)}
                          disabled={busy}
                          className={`flex items-center justify-center h-8 px-2 py-1 text-sm select-none rounded-lg transition-colors ${busy ? 'opacity-50 text-[var(--af-text-muted)]' : 'hover:bg-[var(--af-surface-raised)] active:bg-[var(--af-hover)] text-[var(--af-info)]'} ${modeOpen ? 'bg-[var(--af-hover)] text-[var(--af-text)]' : ''}`}
                        >
                          {modeLabel}
                        </button>
                      </Tooltip>
                      {modeOpen && (
                        <div
                          className={
                            'absolute bottom-full mb-2 left-1/2 -translate-x-1/2 min-w-[140px] bg-[var(--af-surface-raised)] border border-[var(--af-border)] rounded-lg shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 py-1.5'
                          }
                          onWheel={(re) => re.stopPropagation()}
                        >
                          {model.audioModes?.map((re) => {
                            const ve = mode === re.value;
                            return (
                              <button
                                disabled={busy}
                                onClick={() => {
                                  if (busy) return;
                                  onUpdate(node.id, { audioMode: re.value });
                                  setModeOpen(false);
                                }}
                                className={`w-full flex items-center px-5 py-2.5 text-[16px] font-bold whitespace-nowrap transition-all duration-200 ${ve ? 'bg-[var(--af-selected)] text-[var(--af-on-selected)]' : 'text-[var(--af-text-secondary)] hover:bg-[var(--af-hover)] hover:text-[var(--af-text)]'}`}
                                key={re.value}
                              >
                                <span>{re.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <Tooltip text={'高级设置'}>
                    <button
                      aria-label="音频高级设置"
                      onClick={() => !busy && setAdvancedOpen(!advancedOpen)}
                      disabled={busy}
                      className={`flex items-center justify-center rounded-lg h-8 px-2 transition-all ${busy ? 'opacity-50 text-[var(--af-text-muted)]' : 'hover:bg-[var(--af-surface-raised)] text-[var(--af-text-secondary)]'} ${advancedOpen ? 'bg-blue-500/20 text-[var(--af-info)] shadow-inner scale-95' : ''}`}
                    >
                      {advancedOpen ? <CollapseIcon size={15} /> : <SettingsIcon size={15} />}
                    </button>
                  </Tooltip>
                  <div className={'w-px h-3.5 bg-[var(--af-surface-raised)] shrink-0'} />
                  <div className={'flex items-center gap-1 h-full'}>
                    <span className={'text-[11px] text-[var(--af-text-muted)] opacity-50 px-1'}>
                      {'x'}
                      {count}
                    </span>
                    <Tooltip
                      text={
                        node.generationDurationMs
                          ? `最近调用: ${(node.generationDurationMs / 1e3).toFixed(1)}s · 预估 ¥${price}`
                          : `生成单价: ${unitPrice}`
                      }
                    >
                      <div
                        className={
                          'flex items-center h-full text-xs text-[var(--af-text)] font-medium px-1 gap-0.5'
                        }
                      >
                        <span
                          data-fisherai-price-stack={'true'}
                          style={{
                            display: 'inline-flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            lineHeight: 1,
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '2px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <span
                              className={'text-[10px] text-[var(--af-warning)] font-bold'}
                              style={{ flexShrink: 0 }}
                            >
                              {'¥'}
                            </span>
                            <span className={'tabular-nums'}>{price}</span>
                          </span>
                          <span
                            data-fisherai-price-disclaimer={'true'}
                            style={{
                              fontSize: '8px',
                              lineHeight: '9px',
                              width: '68px',
                              color: 'var(--af-text-muted)',
                              whiteSpace: 'normal',
                              wordBreak: 'break-all',
                              textAlign: 'right',
                            }}
                          >
                            {'（最低，以实际消耗为主）'}
                          </span>
                        </span>
                      </div>
                    </Tooltip>
                    <button
                      aria-label="生成音频"
                      onClick={(re) => {
                        re.stopPropagation();
                        if (!disabled) onGenerate(node.id);
                      }}
                      disabled={disabled}
                      className={`aspect-square w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md active:scale-95 ${busy ? 'bg-[var(--af-hover)] text-[var(--af-text-muted)] cursor-wait' : !hasInput || checking || blocked ? 'bg-[var(--af-selected)] text-[var(--af-text-muted)] cursor-not-allowed' : 'bg-[var(--af-primary)] text-[var(--af-on-primary)] hover:opacity-90'}`}
                    >
                      {busy ? (
                        <div
                          className={
                            'w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin'
                          }
                        />
                      ) : (
                        <GenerateIcon size={16} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              {advancedOpen && (
                <React.Fragment>
                  {lyricsMode && (
                    <div className={'mt-2 pt-2 border-t border-[var(--af-border)] px-1'}>
                      <label
                        className={
                          'text-[10px] text-[var(--af-text-muted)] font-medium uppercase tracking-wider'
                        }
                      >
                        {'歌词'}
                      </label>
                      <textarea
                        aria-label="歌词"
                        disabled={busy}
                        value={String(node.lyrics || '')}
                        onChange={(re) => onUpdate(node.id, { lyrics: re.target.value })}
                        placeholder={'请输入歌词内容'}
                        className={
                          'mt-1 w-full min-h-[92px] resize-y rounded-lg bg-[var(--af-input)] border border-[var(--af-border)] text-[var(--af-text)] text-xs px-2 py-1.5 focus:outline-none focus:border-blue-500'
                        }
                        onPointerDown={(re) => re.stopPropagation()}
                      />
                    </div>
                  )}
                  <AdvancedSettings
                    data={node}
                    isVideoNode={!1}
                    currentModel={model}
                    videoGenerationMode={''}
                    connectedImageNodes={assets.map((re) => ({ id: re.id, url: re.url }))}
                    onUpdate={onUpdate}
                    handleFrameReorder={() => {}}
                    draggedIndex={null}
                    setDraggedIndex={() => {}}
                  />
                </React.Fragment>
              )}
            </div>
          </div>
        ) : null
      }
    >
      <Header data={node} selected={selected} onUpdate={onUpdate} />
      <Toolbar
        projectId={props.projectId}
        data={node}
        selected={selected}
        showControls={showControls}
        isDragging={isDragging}
        zoom={zoom}
        onExpand={onExpand}
        onSaveAsset={props.onSaveAsset}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onUpdate={onUpdate}
        fileInputRef={fileInput}
      />
      {isUpload && (
        <input
          ref={fileInput}
          type={'file'}
          accept={'audio/*'}
          className={'hidden'}
          onChange={(re) => {
            const file = re.target.files?.[0];
            if (file) onUpload?.(node.id, file);
            re.target.value = '';
          }}
        />
      )}
      {isVisible && <Player data={node} selected={selected} onAudioTrim={onAudioTrim} />}
    </Frame>
  );
}
