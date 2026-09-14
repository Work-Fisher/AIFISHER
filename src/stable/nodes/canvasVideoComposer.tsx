import { useGenerationAvailability } from './useGenerationAvailability';
import { CreativeLibraryTools, CreativePromptTokens } from '../prompt/CreativeLibrary';
import { rememberNodeDimensions } from './nodeCreationDimensions';
import {
  useComposerBusy,
  useComposerPricing,
  changeComposerModel,
  type ComposerRuntime,
  type MediaComposerProps,
  type MediaComposerComponents,
} from './mediaComposer';
import { installVideoModeAdapter } from '../generation/videoMode';
import { resolveConnectedText } from '../generation/generationScheduler';
import { videoUnitPrice } from '../generation/canvasGenerationRequests';
export function CanvasVideoComposer(
  React: ComposerRuntime,
  {
    data: node,
    isLoading = false,
    connectedImageNodes: assets = [],
    onUpdate,
    onGenerate,
    onSelect,
  }: MediaComposerProps,
  {
    models,
    ratios,
    resolutions,
    PromptEditor,
    ConnectedAssets,
    ModelSelector,
    Dimensions,
    AdvancedSettings,
    Tooltip,
    CollapseIcon,
    SettingsIcon,
    GenerateIcon,
  }: MediaComposerComponents,
) {
  const [advancedOpen, setAdvancedOpen] = React.useState(false),
    [editing, setEditing] = React.useState(false);
  const model = models.find((candidate) => candidate.name === node.videoModel) ||
    models[0] || { name: '' };
  const inputs = {
    images: assets.filter((asset) => ['Image', 'Upload Image'].includes(asset.type)).length,
    videos: assets.filter((asset) => ['Video', 'Upload Video'].includes(asset.type)).length,
    audios: assets.filter((asset) => ['Audio', 'Upload Audio'].includes(asset.type)).length,
  };
  const videoModes = installVideoModeAdapter(),
    selectableModes = model.videoModes || [];
  const effectiveMode = videoModes.resolve(node.videoMode, inputs, selectableModes),
    modeKnown = videoModes.supports(selectableModes, effectiveMode),
    modeAllowed = videoModes.allowed(effectiveMode, inputs, selectableModes),
    modeSupported = modeKnown && modeAllowed;
  const modeWarning = !modeKnown
    ? inputs.images === 0
      ? '当前模型不支持文生视频'
      : '当前模型不支持选定的生成模式'
    : !modeAllowed
      ? '当前模式需要先连接相应素材'
      : '';
  const fixedDuration =
    model.fixedDuration != null &&
    Number.isFinite(Number(model.fixedDuration)) &&
    Number(model.fixedDuration) > 0
      ? Number(model.fixedDuration)
      : null;
  const durationParam = model.advancedParams?.find((parameter) => parameter.key === 'duration');
  const remainingParams =
    model.advancedParams?.filter(
      (parameter) => !['duration', 'generate_audio'].includes(parameter.key),
    ) || [];
  const minimum = Number.isFinite(Number(durationParam?.min))
      ? Number(durationParam?.min)
      : -Infinity,
    maximum = Number.isFinite(Number(durationParam?.max)) ? Number(durationParam?.max) : Infinity;
  const requested = node.duration ?? durationParam?.default ?? 4;
  const duration =
    fixedDuration ??
    Math.min(
      maximum,
      Math.max(
        minimum,
        Number.isFinite(Number(requested))
          ? Number(requested)
          : Number(durationParam?.default ?? 4),
      ),
    );
  React.useEffect(() => {
    if (node.duration !== duration) onUpdate(node.id, { duration });
  }, [node.id, node.duration, duration, onUpdate]);
  const busy = useComposerBusy(React, node.id, isLoading),
    pricing = useComposerPricing(React),
    deferredPrice = ['dreamina_cli', 'libtv_cli'].includes(model.source || ''),
    creditProvider = model.source === 'libtv_cli' ? 'LibTV' : '即梦';
  const resolution = node.resolution || '720p';
  React.useEffect(() => {
    pricing?.ensure(resolution, effectiveMode, {
      aspectRatio: node.aspectRatio || '16:9',
      duration,
      generateAudio: node.generate_audio,
    });
  }, [
    pricing,
    model.name,
    resolution,
    effectiveMode,
    node.aspectRatio,
    duration,
    node.generate_audio,
  ]);
  const unitPrice = deferredPrice
      ? 0
      : videoUnitPrice(pricing?.priceFor(
          model.name,
          effectiveMode,
          resolution,
          node.aspectRatio || '16:9',
          duration,
          null,
          node.generate_audio,
        ), model, effectiveMode, resolution);
  const count = node.generateCount || 1,
    priceLabel = deferredPrice
      ? `${creditProvider}积分`
      : unitPrice === null ? '暂无可靠报价'
      : `${(unitPrice * count * duration).toFixed(2)}–¥${(unitPrice * 1.2 * count * duration).toFixed(2)}`;
  const boundText = resolveConnectedText(assets);
  const boundTextId = boundText?.nodeId;
  React.useEffect(() => {
    if (boundTextId && node.prompt) onUpdate(node.id, { prompt: '' });
  }, [node.id, node.prompt, boundTextId, onUpdate]);
  const hasInput = !!(boundText ? boundText.value : node.prompt || '').trim();
  const { checking, blocked, warning } = useGenerationAvailability(
    React,
    model.name,
    effectiveMode,
  );
  const disabled = busy || !hasInput || checking || blocked || !modeSupported;
  const changeModel = (name: string) => {
    const next = models.find((candidate) => candidate.name === name);
    if (next && !busy)
      onUpdate(node.id, changeComposerModel('video', node, next, ratios, resolutions));
  };

  return (
    <div
      data-fisherai-generation-composer={'video'}
      data-fisherai-effective-video-mode={effectiveMode}
      data-fisherai-video-mode-supported={modeSupported ? 'true' : 'false'}
      className={
        'p-2.5 rounded-lg shadow-2xl cursor-default w-full transition-colors duration-300 bg-[var(--af-surface-raised)] border border-[var(--af-border)]'
      }
      onPointerDown={(J) => {
        if (J.button !== 1) J.stopPropagation();
      }}
      onContextMenu={(J) => J.stopPropagation()}
      onDoubleClick={(J) => J.stopPropagation()}
      onClick={() => onSelect(node.id)}
    >
      {selectableModes.length > 0 && (
        <div
          data-fisherai-video-mode-tabs={'true'}
          role={'tablist'}
          aria-label={'生成模式'}
          style={{
            display: 'inline-flex',
            alignSelf: 'flex-start',
            alignItems: 'center',
            gap: '2px',
            marginBottom: '8px',
            padding: '2px',
            border: '1px solid var(--af-border)',
            borderRadius: '8px',
            background: 'var(--af-input)',
          }}
          onKeyDown={(J) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(J.key)) return;
            const ee = [
              ...J.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
            ];
            if (ee.length === 0) return;
            const te = ee.findIndex((button) => button === document.activeElement);
            let W = te < 0 ? 0 : te;
            W =
              J.key === 'Home'
                ? 0
                : J.key === 'End'
                  ? ee.length - 1
                  : J.key === 'ArrowRight'
                    ? (W + 1) % ee.length
                    : (W - 1 + ee.length) % ee.length;
            J.preventDefault();
            J.stopPropagation();
            ee[W]?.focus();
            ee[W]?.click();
          }}
        >
          {selectableModes.map((J) => {
            const ee = videoModes?.allowed(J.value, inputs, selectableModes) ?? !0,
              te = effectiveMode === J.value;
            return (
              <button
                type={'button'}
                role={'tab'}
                aria-selected={te}
                tabIndex={te ? 0 : -1}
                disabled={busy || !ee}
                title={ee ? J.label : '连接相应素材后可用'}
                onClick={() => {
                  if (!busy && ee) onUpdate(node.id, { videoMode: J.value });
                }}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  border: 0,
                  borderRadius: '6px',
                  background: te ? 'var(--af-primary)' : 'transparent',
                  color: te ? 'var(--af-on-primary)' : 'var(--af-text-secondary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  opacity: busy || !ee ? 0.35 : 1,
                  cursor: busy || !ee ? 'not-allowed' : 'pointer',
                  transition: 'background-color 140ms ease,color 140ms ease,opacity 140ms ease',
                }}
                key={J.value}
              >
                {J.label || videoModes?.label(J.value) || J.value}
              </button>
            );
          })}
        </div>
      )}
      <ConnectedAssets
        node={node}
        disabled={busy}
        connectedImageNodes={assets}
        onUpdate={onUpdate}
      />
      <div
        className={`mb-1 relative group/prompt overflow-hidden prompt-editor-container custom-scrollbar ${editing ? 'is-prompt-editing cursor-text' : 'cursor-pointer'}`}
        data-fisherai-bound-text-node-id={boundText?.nodeId}
        onClick={(J) => {
          J.stopPropagation();
          setEditing(true);
        }}
      >
        <CreativePromptTokens data={node} onUpdate={onUpdate} disabled={busy} />
        <PromptEditor
          type={'video'}
          value={boundText ? boundText.value : node.prompt || ''}
          onChange={(J) =>
            boundText
              ? onUpdate(boundText.nodeId, { textContent: J })
              : onUpdate(node.id, { prompt: J })
          }
          connectedAssets={assets || []}
          isDark={!0}
          disableDirectEdit={!editing}
          onBlur={() => setEditing(!1)}
          key={`mention-editor-${node.id}`}
        />
      </div>
      <CreativeLibraryTools data={node} onUpdate={onUpdate} disabled={busy} />
      {node.errorMessage && (
        <div
          className={
            'text-[var(--af-danger)] text-xs mb-2 p-1 bg-red-900/20 rounded border border-red-900/50'
          }
        >
          {node.errorMessage}
        </div>
      )}
      {!node.errorMessage && !modeSupported && (
        <div
          role={'status'}
          className={
            'text-[var(--af-warning)] text-xs mb-2 p-1 bg-amber-900/20 rounded border border-amber-900/40'
          }
        >
          {modeWarning}
        </div>
      )}
      {!node.errorMessage && modeSupported && warning && (
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
            isVideoNode={!0}
            currentModel={model}
            availableModels={models}
            disabled={busy}
            onModelChange={changeModel}
          />
          <div className={'w-px h-3.5 bg-[var(--af-surface-raised)]'} />
        </div>
        <div className={'relative flex items-center gap-1 h-full'}>
          <Dimensions
            videoSettings={{
              duration,
              parameter: durationParam,
              fixed: fixedDuration !== null || !durationParam,
              // Preserve the existing composer audio toggle and its default.
              audio: node.generate_audio !== false,
            }}
            data={node}
            onUpdate={(patch) => {
              if (busy) return;
              onUpdate(node.id, patch);
              rememberNodeDimensions('Video', node.projectId, { ...node, ...patch });
            }}
            disabled={busy}
            allRatios={model.aspectRatios || ratios}
            supportedRatios={model.aspectRatios || ratios}
            allResolutions={model.resolutions || resolutions}
            supportedResolutions={model.resolutions || resolutions}
            isDark={!0}
          />
          {remainingParams.length > 0 && (
            <Tooltip text={'高级设置'}>
              <button
                onClick={() => !busy && setAdvancedOpen(!advancedOpen)}
                disabled={busy}
                className={`flex items-center justify-center rounded-lg h-8 px-2 transition-all ${busy ? 'opacity-50 text-[var(--af-text-muted)]' : 'hover:bg-[var(--af-surface-raised)] text-[var(--af-text-secondary)]'} ${advancedOpen ? 'bg-blue-500/20 text-[var(--af-info)] shadow-inner scale-95' : ''}`}
              >
                {advancedOpen ? <CollapseIcon size={15} /> : <SettingsIcon size={15} />}
              </button>
            </Tooltip>
          )}
          <div className={'w-px h-3.5 bg-[var(--af-surface-raised)] shrink-0'} />
          <div className={'flex items-center gap-1 h-full'}>
            <Tooltip
              text={
                deferredPrice
                  ? `按${creditProvider}积分账单结算`
                  : node.generationDurationMs
                    ? `最近调用: ${(node.generationDurationMs / 1e3).toFixed(1)}s · ${unitPrice === null ? priceLabel : `预估 ¥${priceLabel}`}`
                    : unitPrice === null ? '当前模式与分辨率暂无可靠报价' : `生成单价: ${unitPrice}`
              }
            >
              <div
                className={
                  'flex items-center h-full text-xs text-[var(--af-text)] font-medium px-1 gap-0.5'
                }
              >
                <span
                  data-fisherai-price-stack={'true'}
                  data-fisherai-price-unit={
                    deferredPrice
                      ? model.source === 'libtv_cli'
                        ? 'libtv-credit'
                        : 'dreamina-credit'
                      : 'cny'
                  }
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
                    {deferredPrice || unitPrice === null ? '' : '¥'}
                    </span>
                    <span className={'tabular-nums'}>{priceLabel}</span>
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
                    {deferredPrice ? `（以${creditProvider}账单为准）` : unitPrice === null ? '（当前参数，以服务商账单为准）' : '（最低，以实际消耗为主）'}
                  </span>
                </span>
              </div>
            </Tooltip>
            <button
              onClick={(J) => {
                J.stopPropagation();
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
      {advancedOpen && remainingParams.length > 0 && (
        <AdvancedSettings
          data={node}
          isVideoNode={!0}
          currentModel={{ ...model, advancedParams: remainingParams }}
          connectedImageNodes={assets}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}
