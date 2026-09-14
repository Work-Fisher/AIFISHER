import type { CanvasComponent } from '../app/canvasComponentType';
import { useWorkflowNodeSession } from './workflowNodeSession';
import type * as ReactTypes from 'react';
import type { WorkflowCanvasNodeRecord, WorkflowCanvasInputSlot } from './workflowCanvasNodes';
import type { WorkflowCanvasBlueprint } from './workflowManagerClient';
type Runtime = Pick<
  typeof ReactTypes,
  | 'createElement'
  | 'Fragment'
  | 'useState'
  | 'useEffect'
  | 'useRef'
  | 'useCallback'
  | 'useLayoutEffect'
>;
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
type Parameter = WorkflowCanvasBlueprint['parameterSchema'][number];
interface ConnectedNode extends Record<string, unknown> {
  id: string;
  type: string;
  url?: string;
  resultUrl?: string;
  lastFrame?: string;
  textContent?: string;
  resultText?: string;
  prompt?: string;
  text?: string;
}
interface Props {
  data: WorkflowCanvasNodeRecord;
  selected: boolean;
  onUpdate(id: string, patch: Partial<WorkflowCanvasNodeRecord>): void;
  onNodePointerDown: unknown;
  onContextMenu: unknown;
  onConnectorDown(
    event: ReactTypes.PointerEvent,
    id: string,
    side: 'left' | 'right',
    index: number,
  ): void;
  zoom: number;
  isHoveredForConnection: boolean;
  isInvalidHover: boolean;
  onMouseEnter: unknown;
  onMouseLeave: unknown;
  connectedImageNodes?: ConnectedNode[];
  projectId: string;
}
export function CanvasWorkflowGenerator(React: Runtime, props: Props, Frame: CanvasComponent) {
  const {
    data: node,
    selected: selected,
    onUpdate: onUpdate,
    onNodePointerDown: onNodePointerDown,
    onContextMenu: onContextMenu,
    onConnectorDown: onConnectorDown,
    zoom: zoom,
    isHoveredForConnection: isHoveredForConnection,
    isInvalidHover: isInvalidHover,
    onMouseEnter: onMouseEnter,
    onMouseLeave: onMouseLeave,
    connectedImageNodes: connectedNodes = [],
    projectId: projectId,
  } = props;
  const adapter = window.__FISHERAI_WORKFLOW_NODES__,
    slots = adapter?.getInputSlots(node) || [],
    outputs = Array.isArray(node.outputPorts) ? node.outputPorts : [],
    parameters = Array.isArray(node.parameterSchema) ? node.parameterSchema : [],
    values = node.parameterValues || {},
    cloud =
      node.executionTarget === 'cloud' ||
      (!node.executionTarget &&
        String(node.subtitle || '')
          .toLowerCase()
          .includes('runninghub')),
    isText = (parameter: Parameter) =>
      ['text', 'textarea', 'string', 'prompt', 'multiline'].includes(
        String(parameter.control?.kind || '').toLowerCase(),
      ),
    textParameters = parameters.filter(isText),
    primaryTextParameter =
      textParameters.find((parameter) => /^prompt$/i.test(String(parameter.key || ''))) ||
      textParameters.find((parameter) => /提示词/.test(String(parameter.label || ''))) ||
      textParameters.find(
        (parameter) =>
          /^(text|description)$/i.test(String(parameter.key || '')) ||
          /描述/.test(String(parameter.label || '')),
      ) ||
      textParameters[0],
    creativeTextParameters = primaryTextParameter ? [primaryTextParameter] : [],
    settingsParameters = cloud
      ? parameters.filter((parameter) => parameter !== primaryTextParameter)
      : parameters,
    settings = !!node.isWorkflowParametersOpen,
    instanceType =
      String(node.runningHubInstanceType || '').toLowerCase() === 'default' ? 'default' : 'plus',
    errorDetails = !!node.isWorkflowErrorDetailsOpen,
    errorSummary = node.errorSummary || adapter?.getErrorSummary(node) || '工作流运行失败',
    errorDetailsId = 'fisherai-workflow-error-details-' + node.id,
    [hover, setHover] = React.useState(!1),
    [uploadingSlot, setUploadingSlot] = React.useState<number | null>(null),
    [numberDrafts, setNumberDrafts] = React.useState<Record<string, string>>({}),
    paused = node.executionState?.status === 'observing-paused',
    loading = node.status === 'loading',
    realtime = node.executionState?.realtimeChannel,
    progress = asRecord(node.executionState?.progress),
    progressValue = Number(progress?.value),
    progressMaximum = Number(progress?.maximum),
    nodeId = progress?.currentNodeId || node.executionState?.currentNodeId,
    hasProgress =
      Number.isFinite(progressValue) && Number.isFinite(progressMaximum) && progressMaximum > 0,
    progressPercent = hasProgress
      ? Math.min(100, Math.max(0, Math.round((progressValue / progressMaximum) * 100)))
      : null,
    progressLabel = hasProgress
      ? (nodeId ? '节点 ' + nodeId + ' · ' : '') +
        '当前步骤 ' +
        progressValue +
        '/' +
        progressMaximum +
        ' · ' +
        progressPercent +
        '%'
      : nodeId
        ? '正在执行节点 ' + nodeId
        : cloud
          ? '任务已提交，正在等待 RunningHub 返回进度'
          : realtime === 'history-fallback'
            ? '实时通道已断开，正在轮询 ComfyUI'
            : '等待 ComfyUI 返回节点进度',
    patch = React.useCallback(
      (next: Partial<WorkflowCanvasNodeRecord>) => onUpdate(node.id, next),
      [node.id, onUpdate],
    ),
    stop = (event: ReactTypes.SyntheticEvent) => event.stopPropagation(),
    input = (event: ReactTypes.PointerEvent, index: number) => {
      event.stopPropagation();
      onConnectorDown(event, node.id, 'left', index);
    },
    output = (event: ReactTypes.PointerEvent, index: number) => {
      event.stopPropagation();
      onConnectorDown(event, node.id, 'right', index);
    },
    set = (key: string, value: unknown) => patch({ parameterValues: { ...values, [key]: value } }),
    controlStyle = {
      width: '100%',
      height: '38px',
      padding: '0 11px',
      border: '1px solid var(--af-border-control)',
      borderRadius: '8px',
      background: 'var(--af-input)',
      color: 'var(--af-text)',
      outline: 'none',
      fontSize: '12px',
    },
    connectedSlots = slots.filter((slot) => (node.parentIds || [])[slot.slotIndex]),
    connectedCount = connectedSlots.length,
    requiredConnectionsReady = slots
      .filter((slot) => slot.required)
      .every((slot) => (node.parentIds || [])[slot.slotIndex]),
    limitNotice = adapter?.getInputLimitNotice(node),
    invalidConnection = isHoveredForConnection && isInvalidHover,
    connectionSignature = [...(node.parentIds || []), '::', ...(node.sourcePortIndices || [])].join(
      '|',
    ),
    previousConnectionSignature = React.useRef(connectionSignature),
    linkedNode = (slot: WorkflowCanvasInputSlot) => {
      const parentId = (node.parentIds || [])[slot.slotIndex];
      return connectedNodes.find((node) => node.id === parentId);
    },
    cardSlots = connectedSlots.filter((slot) => linkedNode(slot)),
    openSlots = slots.filter((slot) => !(node.parentIds || [])[slot.slotIndex]),
    openAssetSlots = openSlots.filter((slot) => slot.source === 'input-port'),
    nodeText = (node: ConnectedNode | null | undefined) => {
      const candidate = [node?.textContent, node?.resultText, node?.prompt, node?.text].find(
        (item) => typeof item === 'string',
      );
      return candidate ?? '';
    },
    parameterSlot = (parameter: Parameter) =>
      slots.find((slot) => slot.source === 'parameter' && slot.bindingKey === parameter.key),
    parameterNode = (parameter: Parameter) => {
      const slot = parameterSlot(parameter);
      return slot ? linkedNode(slot) : null;
    },
    field = (parameter: Parameter, hero = false) => {
      const FieldContainer = parameter.control?.kind === 'seed' ? 'div' : 'label';
      const kind = parameter.control?.kind || 'text',
        linked = isText(parameter) ? parameterNode(parameter) : null,
        connected = !!linked,
        linkedEditable = connected && String(linked.type || '').toLowerCase() === 'text',
        readOnly = connected && !linkedEditable,
        value = connected
          ? nodeText(linked)
          : (values[parameter.key] ?? parameter.control?.defaultValue ?? ''),
        numeric = kind === 'number' || kind === 'slider' || kind === 'seed',
        seedPolicy =
          kind === 'seed' &&
          value &&
          typeof value === 'object' &&
          ['fixed', 'random', 'increment', 'decrement'].includes(String(asRecord(value).mode))
            ? String(asRecord(value).mode)
            : 'fixed',
        seedStep =
          Number.isSafeInteger(Number(parameter.control?.step)) &&
          Number(parameter.control?.step) > 0
            ? Number(parameter.control.step)
            : 1,
        number =
          kind === 'seed' && value && typeof value === 'object' ? asRecord(value).value : value,
        defaultNumber =
          kind === 'seed' &&
          parameter.control?.defaultValue &&
          typeof parameter.control.defaultValue === 'object'
            ? asRecord(parameter.control.defaultValue).value
            : parameter.control?.defaultValue,
        confirmedNumber =
          number !== '' && number !== null && number !== void 0 && Number.isFinite(Number(number))
            ? Number(number)
            : defaultNumber !== '' &&
                defaultNumber !== null &&
                defaultNumber !== void 0 &&
                Number.isFinite(Number(defaultNumber))
              ? Number(defaultNumber)
              : void 0,
        hasNumberDraft = Object.prototype.hasOwnProperty.call(numberDrafts, parameter.key),
        numberDisplay =
          kind === 'seed' && seedPolicy === 'random'
            ? ''
            : hasNumberDraft
              ? numberDrafts[parameter.key]
              : confirmedNumber === void 0
                ? ''
                : String(confirmedNumber),
        setNumberDraft = (next: string) =>
          setNumberDrafts((current) => ({ ...current, [parameter.key]: next })),
        clearNumberDraft = () =>
          setNumberDrafts((current) => {
            const next = { ...current };
            delete next[parameter.key];
            return next;
          }),
        changeNumber = (raw: string) => {
          setNumberDraft(raw);
          if (raw === '') return;
          const numericValue = Number(raw);
          if (!Number.isFinite(numericValue)) return;
          if (kind === 'seed')
            set(
              parameter.key,
              seedPolicy === 'increment' || seedPolicy === 'decrement'
                ? { mode: seedPolicy, value: numericValue, step: seedStep }
                : { mode: 'fixed', value: numericValue },
            );
          else set(parameter.key, numericValue);
        },
        changeSeedMode = (event: ReactTypes.ChangeEvent<HTMLSelectElement>) => {
          const mode = event.target.value;
          clearNumberDraft();
          if (mode === 'random') set(parameter.key, { mode: 'random' });
          else {
            const nextValue = confirmedNumber === void 0 ? 0 : confirmedNumber;
            set(
              parameter.key,
              mode === 'increment' || mode === 'decrement'
                ? { mode: mode, value: nextValue, step: seedStep }
                : { mode: 'fixed', value: nextValue },
            );
          }
        },
        setText = (next: string) => {
          if (linkedEditable) onUpdate(linked.id, { textContent: next });
          else if (!connected) set(parameter.key, next);
        },
        change = (
          event: ReactTypes.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
        ) => {
          if (readOnly) return;
          if (kind === 'toggle') set(parameter.key, (event.target as HTMLInputElement).checked);
          else if (numeric) changeNumber(event.target.value);
          else setText(event.target.value);
        };
      let control;
      if (kind === 'select')
        control = (
          <select
            aria-label={parameter.label}
            value={String(value)}
            onChange={change}
            onPointerDown={stop}
            onWheel={stop}
            style={controlStyle}
          >
            {(parameter.control?.options || []).map((option) => (
              <option value={option.id} key={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        );
      else if (kind === 'toggle')
        control = (
          <input
            aria-label={parameter.label}
            type={'checkbox'}
            checked={!!value}
            onChange={change}
            onPointerDown={stop}
            onWheel={stop}
            style={{ width: '20px', height: '20px', accentColor: 'var(--af-focus)' }}
          />
        );
      else if (kind === 'seed') {
        control = (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) 104px',
              gap: '8px',
            }}
          >
            <input
              aria-label={parameter.label}
              type={'number'}
              value={numberDisplay}
              placeholder={seedPolicy === 'random' ? '每次运行自动生成' : ''}
              disabled={seedPolicy === 'random'}
              min={parameter.control?.minimum}
              max={parameter.control?.maximum}
              step={parameter.control?.step || 1}
              onChange={change}
              onBlur={clearNumberDraft}
              onPointerDown={stop}
              onWheel={stop}
              style={{
                ...controlStyle,
                color: seedPolicy === 'random' ? 'var(--af-text-muted)' : 'var(--af-text)',
                cursor: seedPolicy === 'random' ? 'not-allowed' : 'text',
              }}
            />
            <select
              aria-label={parameter.label + '生成策略'}
              value={seedPolicy}
              onChange={changeSeedMode}
              onPointerDown={stop}
              onWheel={stop}
              style={{ ...controlStyle, padding: '0 8px', cursor: 'pointer' }}
            >
              <option value={'fixed'}>{'固定'}</option>
              <option value={'random'}>{'随机'}</option>
              <option value={'increment'}>{'递增'}</option>
              <option value={'decrement'}>{'递减'}</option>
            </select>
          </div>
        );
      } else if (kind === 'number' || kind === 'slider') {
        control = (
          <input
            aria-label={parameter.label}
            type={'number'}
            value={numberDisplay}
            min={parameter.control?.minimum}
            max={parameter.control?.maximum}
            step={parameter.control?.step || 1}
            onChange={change}
            onBlur={clearNumberDraft}
            onPointerDown={stop}
            onWheel={stop}
            style={controlStyle}
          />
        );
      } else if (hero)
        control = (
          <textarea
            data-fisherai-workflow-prompt-editor={'true'}
            data-fisherai-workflow-connected-text={connected ? 'true' : 'false'}
            aria-label={parameter.label}
            value={String(value ?? '')}
            placeholder={parameter.description || '描述你想生成的内容…'}
            readOnly={readOnly}
            onChange={(event) => setText(event.target.value)}
            onPointerDown={stop}
            onWheel={stop}
            style={{
              width: '100%',
              height: '112px',
              minHeight: 0,
              padding: '10px 12px',
              border: '1px solid var(--af-border-control)',
              borderRadius: '8px',
              background: 'var(--af-input)',
              color: 'var(--af-text)',
              fontSize: '13px',
              lineHeight: 1.65,
              outline: 'none',
              resize: 'none',
              overflow: 'auto',
              cursor: readOnly ? 'default' : 'text',
            }}
          />
        );
      else
        control = (
          <textarea
            aria-label={parameter.label}
            value={String(value ?? '')}
            placeholder={parameter.description || '描述你想生成的内容…'}
            readOnly={readOnly}
            onChange={change}
            onPointerDown={stop}
            onWheel={stop}
            rows={2}
            style={{
              ...controlStyle,
              height: '62px',
              resize: 'none',
              padding: '9px 11px',
              border: '1px solid var(--af-border-control)',
              background: 'var(--af-input)',
              fontSize: '12px',
              lineHeight: 1.6,
            }}
          />
        );
      return (
        <FieldContainer
          data-fisherai-workflow-field={parameter.key}
          data-fisherai-workflow-field-location={hero ? 'prompt' : 'settings'}
          data-fisherai-workflow-field-connected={connected ? 'true' : 'false'}
          style={
            hero
              ? { display: 'grid', gap: '5px', minWidth: 0 }
              : {
                  display: 'grid',
                  gridTemplateColumns: 'minmax(104px,138px) minmax(0,1fr)',
                  alignItems: isText(parameter) ? 'start' : 'center',
                  gap: '14px',
                  minHeight: '44px',
                }
          }
          title={parameter.description || ''}
          key={parameter.key}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              color: hero ? 'var(--af-text-muted)' : 'var(--af-text-secondary)',
              fontSize: hero ? '10px' : '11px',
              fontWeight: 600,
              letterSpacing: hero ? '.08em' : '0',
              textTransform: hero ? 'uppercase' : 'none',
            }}
          >
            {hero ? 'PROMPT · ' + parameter.label : parameter.label}
            {connected ? (
              <span
                style={{
                  marginLeft: 'auto',
                  color: 'var(--af-info)',
                  fontSize: '9px',
                  letterSpacing: '.04em',
                }}
              >
                {linkedEditable ? '已接入文本 · 双向同步' : '已接入文本'}
              </span>
            ) : parameter.control?.required ? (
              <span style={{ color: 'var(--af-info)' }}>{'·'}</span>
            ) : null}
          </span>
          {control}
        </FieldContainer>
      );
    },
    slotCard = (slot: WorkflowCanvasInputSlot) => {
      const node = linkedNode(slot),
        url = node?.url || node?.resultUrl || node?.lastFrame,
        textValue = nodeText(node),
        connected = !!node;
      return (
        <div
          data-fisherai-workflow-input={slot.mediaKind}
          style={{
            position: 'relative',
            height: '52px',
            display: 'grid',
            gridTemplateColumns: '42px minmax(0,1fr)',
            alignItems: 'center',
            gap: '10px',
            padding: '5px 9px 5px 5px',
            border: '1px solid ' + (connected ? 'var(--af-info)' : 'var(--af-border)'),
            borderRadius: '8px',
            background: connected ? 'var(--af-info-bg)' : 'var(--af-surface)',
            overflow: 'hidden',
          }}
          key={slot.id}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
              borderRadius: '6px',
              background: 'var(--af-input)',
              color: connected ? 'var(--af-text)' : 'var(--af-text-muted)',
              fontSize: '16px',
            }}
          >
            {url && (slot.mediaKind === 'image' || slot.mediaKind === 'mask') ? (
              <img
                src={url}
                alt={''}
                draggable={!1}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : url && slot.mediaKind === 'video' ? (
              <video
                src={url}
                muted={!0}
                preload={'metadata'}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span>
                {slot.mediaKind === 'audio'
                  ? '♫'
                  : slot.mediaKind === 'video'
                    ? '▶'
                    : slot.mediaKind === 'text'
                      ? 'T'
                      : '◇'}
              </span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: connected ? 'var(--af-text)' : 'var(--af-text-secondary)',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              {slot.label}
            </div>
            <div
              style={{
                marginTop: '3px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: connected ? 'var(--af-info)' : 'var(--af-text-muted)',
                fontSize: '9px',
                letterSpacing: slot.mediaKind === 'text' ? '0' : '.06em',
                textTransform: slot.mediaKind === 'text' ? 'none' : 'uppercase',
              }}
            >
              {connected
                ? slot.mediaKind === 'text' && textValue
                  ? String(textValue)
                  : '已连接'
                : slot.mediaKind === 'text'
                  ? '可连接文本节点'
                  : '等待素材'}
            </div>
          </div>
        </div>
      );
    },
    outputHint = loading
      ? progressLabel
      : node.status === 'success'
        ? '结果已生成到画布右侧，并与当前工作流连接'
        : '运行后会自动创建外部结果节点并连线';
  const { run, resume, cancel, upload } = useWorkflowNodeSession(
    React,
    adapter,
    {
      node,
      connectedNodes,
      projectId: projectId || String(node.projectId || ''),
    },
    onUpdate,
    setUploadingSlot,
  );
  const openSlotRow = (slot: WorkflowCanvasInputSlot) => {
    const uploading = uploadingSlot === slot.slotIndex,
      mediaLabel = adapter?.getMediaKindLabel(slot.mediaKind) || '素材',
      accept =
        slot.mediaKind === 'video'
          ? '.m4v,.mov,.mp4,.webm,.mkv,video/*'
          : slot.mediaKind === 'audio'
            ? '.mp3,.m4a,.wav,.ogg,.aac,.flac,audio/*'
            : '.jpeg,.jpg,.png,.webp,.bmp,image/*';
    return (
      <div
        data-fisherai-workflow-open-input={slot.mediaKind}
        data-fisherai-workflow-input-required={slot.required ? 'true' : 'false'}
        style={{
          minHeight: '62px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) auto',
          alignItems: 'center',
          gap: '10px',
          padding: '9px 10px',
          border: '1px dashed ' + (slot.required ? 'var(--af-info)' : 'var(--af-info)'),
          borderRadius: '8px',
          background: slot.required ? 'var(--af-info-bg)' : 'var(--af-surface)',
        }}
        key={slot.id}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: 0,
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--af-text)',
                fontSize: '11px',
                fontWeight: 650,
              }}
            >
              {slot.label}
            </span>
            <span
              style={{
                flex: 'none',
                padding: '2px 5px',
                borderRadius: '999px',
                background: slot.required ? 'var(--af-info-bg)' : 'var(--af-surface-raised)',
                color: slot.required ? 'var(--af-info)' : 'var(--af-info)',
                fontSize: '8px',
                fontWeight: 700,
              }}
            >
              {slot.required ? '必填' : '可选'}
            </span>
          </div>
          <div style={{ marginTop: '4px', color: 'var(--af-info)', fontSize: '9px' }}>
            {mediaLabel + ' · 尚未连接'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type={'button'}
            onPointerDown={(event) => input(event, slot.slotIndex)}
            style={{
              height: '30px',
              padding: '0 9px',
              border: '1px solid var(--af-info)',
              borderRadius: '7px',
              background: 'var(--af-info-bg)',
              color: 'var(--af-info)',
              fontSize: '9px',
              fontWeight: 650,
              cursor: 'crosshair',
              whiteSpace: 'nowrap',
            }}
          >
            {'连接已有素材'}
          </button>
          <label
            style={{
              height: '30px',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 9px',
              border: '1px solid ' + (uploading ? 'var(--af-info)' : 'var(--af-info)'),
              borderRadius: '7px',
              background: uploading ? 'var(--af-surface-raised)' : 'var(--af-info-bg)',
              color: uploading ? 'var(--af-info)' : 'var(--af-info)',
              fontSize: '9px',
              fontWeight: 700,
              cursor: uploading ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {uploading ? '上传中…' : '上传文件'}
            <input
              type={'file'}
              accept={accept}
              disabled={uploading}
              onClick={stop}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) upload(slot, file);
              }}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>
    );
  };
  React.useEffect(() => {
    if (
      node.executionState?.status === 'validation-error' &&
      requiredConnectionsReady &&
      node.executionState?.status === 'validation-error' &&
      /尚未连接素材/.test(String(node.errorMessage || ''))
    )
      patch({
        status: 'idle',
        executionState: { status: 'idle' },
        errorMessage: void 0,
        errorSummary: void 0,
        isWorkflowErrorDetailsOpen: !1,
      });
  }, [requiredConnectionsReady, node.errorMessage, node.executionState?.status, patch]);
  React.useEffect(() => {
    if (previousConnectionSignature.current === connectionSignature) return;
    previousConnectionSignature.current = connectionSignature;
    if (node.executionState?.status === 'validation-error')
      patch({
        status: 'idle',
        executionState: { status: 'idle' },
        errorMessage: void 0,
        errorSummary: void 0,
        isWorkflowErrorDetailsOpen: !1,
      });
  }, [connectionSignature, node.executionState?.status, patch]);
  const editBindings = (event: ReactTypes.SyntheticEvent) => {
    event.stopPropagation();
    const definitionId = node.workflowRef?.definitionId;
    if (definitionId)
      window.dispatchEvent(
        new CustomEvent('fisherai:edit-workflow-parameters', {
          detail: {
            definitionId: definitionId,
            nodeId: node.id,
            title: node.title,
          },
        }),
      );
  };
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
        data-fisherai-workflow-node={'true'}
        data-fisherai-workflow-surface={cloud ? 'cloud' : 'local'}
        onMouseEnter={() => setHover(!0)}
        onMouseLeave={() => setHover(!1)}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          overflow: 'visible',
          background: cloud ? 'var(--af-info-bg)' : 'var(--af-input)',
          border:
            '1px solid ' +
            (selected ? 'var(--af-info)' : cloud ? 'var(--af-border)' : 'var(--af-border)'),
          boxShadow: selected ? '0 0 0 2px rgba(96,165,250,.18)' : '0 22px 70px rgba(0,0,0,.34)',
          borderRadius: '12px',
          color: 'var(--af-text)',
          fontFamily: "Inter, 'Microsoft YaHei UI', system-ui, sans-serif",
        }}
      >
        <div
          data-fisherai-workflow-parameters="true"
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            minHeight: 0,
            flexDirection: 'column',
            background: 'var(--af-surface)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <header
            style={{
              height: '64px',
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '11px',
              padding: '0 16px',
              borderBottom: '1px solid var(--af-border)',
              background: cloud ? 'var(--af-info-bg)' : 'var(--af-surface)',
            }}
          >
            <img src={'/aifisher-mark-white.svg'} alt={''} width={26} height={26} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {node.title || 'ComfyUI 工作流'}
              </div>
              <div
                style={{
                  marginTop: '3px',
                  fontSize: '9px',
                  letterSpacing: '.11em',
                  color: cloud ? 'var(--af-info)' : 'var(--af-text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                {(node.subtitle || '本地 ComfyUI') +
                  (node.workflowRef?.verificationStatus === 'draft' ? ' · 草稿' : ' · VERIFIED') +
                  (loading && nodeId ? ' · NODE ' + nodeId : '')}
              </div>
            </div>
            <span
              style={{
                marginLeft: 'auto',
                padding: '5px 8px',
                borderRadius: '999px',
                background: loading
                  ? 'var(--af-info-bg)'
                  : node.status === 'success'
                    ? 'var(--af-success-bg)'
                    : 'var(--af-surface-raised)',
                color: loading
                  ? 'var(--af-info)'
                  : node.status === 'success'
                    ? 'var(--af-success)'
                    : 'var(--af-text-muted)',
                fontSize: '9px',
                fontWeight: 700,
              }}
            >
              {paused
                ? '查询暂停'
                : loading && hasProgress
                  ? progressPercent + '%'
                  : loading
                    ? '运行中'
                    : node.status === 'success'
                      ? '已完成'
                      : '就绪'}
            </span>
          </header>
          {!settings || cloud ? (
            <section
              data-fisherai-workflow-prompt={'true'}
              style={{
                height: cloud ? '166px' : 'auto',
                flex: cloud ? 'none' : '1 1 auto',
                minHeight: 0,
                overflow: 'auto',
                padding: '12px 16px 10px',
                borderBottom: '1px solid var(--af-border)',
                background: cloud ? 'var(--af-surface)' : 'var(--af-input)',
              }}
            >
              {creativeTextParameters.length ? (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {creativeTextParameters.map((parameter) => field(parameter, !0))}
                </div>
              ) : (
                <div
                  style={{
                    height: '100%',
                    display: 'grid',
                    placeItems: 'center',
                    gap: '4px',
                    color: 'var(--af-text-muted)',
                    fontSize: '11px',
                  }}
                >
                  <span style={{ fontSize: '10px', letterSpacing: '.1em' }}>{'PROMPT'}</span>
                  <span>{'请在工作流配置中外置一个文字参数'}</span>
                </div>
              )}
            </section>
          ) : null}
          {settings ? (
            <section
              id={'fisherai-workflow-settings-' + node.id}
              data-fisherai-workflow-parameters={'true'}
              style={{
                flex: '1 0 auto',
                minHeight: 0,
                overflow: 'visible',
                padding: '16px',
                background: cloud ? 'var(--af-info-bg)' : 'var(--af-surface)',
              }}
            >
              <div style={{ display: 'grid', gap: '16px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    paddingBottom: '12px',
                    borderBottom: '1px solid var(--af-border)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 650,
                        color: 'var(--af-text)',
                      }}
                    >
                      {'参数配置'}
                    </div>
                    <div
                      style={{
                        marginTop: '3px',
                        fontSize: '9px',
                        color: 'var(--af-text-muted)',
                      }}
                    >
                      {'输入、生成参数与执行信息集中在这里。'}
                    </div>
                  </div>
                  {cloud ? null : (
                    <button
                      type={'button'}
                      aria-label={'编辑外置参数'}
                      onClick={editBindings}
                      onPointerDown={stop}
                      style={{
                        height: '32px',
                        padding: '0 11px',
                        border: '1px solid var(--af-border)',
                        borderRadius: '8px',
                        background: 'var(--af-surface-raised)',
                        color: 'var(--af-text)',
                        fontSize: '10px',
                        fontWeight: 650,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {'编辑字段'}
                    </button>
                  )}
                </div>
                <div>
                  <div
                    style={{
                      marginBottom: '8px',
                      color: 'var(--af-text-muted)',
                      fontSize: '10px',
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {'INPUTS · ' + connectedCount + ' / ' + slots.length + ' 已连接'}
                  </div>
                  {cardSlots.length || openAssetSlots.length ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
                        gap: '8px',
                      }}
                    >
                      {...cardSlots.map(slotCard)}
                      {...openAssetSlots.map(openSlotRow)}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--af-border)',
                        borderRadius: '8px',
                        background: 'var(--af-input)',
                        color: 'var(--af-text-muted)',
                        fontSize: '10px',
                      }}
                    >
                      {'当前工作流没有需要连接的素材。'}
                    </div>
                  )}
                  {limitNotice ? (
                    <div
                      data-fisherai-workflow-input-limit={'true'}
                      style={{
                        marginTop: '8px',
                        color: 'var(--af-warning)',
                        fontSize: '9px',
                      }}
                    >
                      {limitNotice}
                    </div>
                  ) : null}
                </div>
                {settingsParameters.length ? (
                  <div>
                    <div
                      style={{
                        marginBottom: '8px',
                        color: 'var(--af-text-muted)',
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {'PARAMETERS · 生成参数'}
                    </div>
                    <div style={{ display: 'grid', gap: '9px' }}>
                      {settingsParameters.map((parameter) => field(parameter, !1))}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '24px 0',
                      color: 'var(--af-text-muted)',
                      fontSize: '12px',
                      textAlign: 'center',
                    }}
                  >
                    {'没有其他需要配置的参数。'}
                  </div>
                )}
                <div
                  data-fisherai-workflow-execution={'true'}
                  style={{
                    display: 'grid',
                    gap: '9px',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--af-border)',
                  }}
                >
                  <div
                    style={{
                      color: 'var(--af-text-muted)',
                      fontSize: '10px',
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {'EXECUTION · 执行与输出'}
                  </div>
                  {loading ? (
                    <div
                      data-fisherai-workflow-progress={'true'}
                      style={{
                        display: 'grid',
                        gap: '8px',
                        padding: '10px 12px',
                        border: '1px solid var(--af-info)',
                        borderRadius: '8px',
                        background: 'var(--af-surface)',
                      }}
                    >
                      <span style={{ color: 'var(--af-info)', fontSize: '10px' }}>
                        {progressLabel}
                      </span>
                      <div
                        style={{
                          height: '3px',
                          overflow: 'hidden',
                          borderRadius: '999px',
                          background: 'var(--af-hover)',
                        }}
                      >
                        <div
                          style={{
                            width: hasProgress ? progressPercent + '%' : '34%',
                            height: '100%',
                            borderRadius: 'inherit',
                            background: 'var(--af-info)',
                            transition: 'width .22s ease',
                            animation: hasProgress
                              ? 'none'
                              : 'fisherai-workflow-pulse 1.2s ease-in-out infinite alternate',
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div
                    data-fisherai-workflow-external-output={'true'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '9px',
                      padding: '10px 12px',
                      border: '1px solid var(--af-border)',
                      borderRadius: '8px',
                      background: 'var(--af-input)',
                      color:
                        node.status === 'success' ? 'var(--af-success)' : 'var(--af-text-muted)',
                      fontSize: '10px',
                    }}
                  >
                    <span style={{ fontSize: '15px' }}>
                      {node.status === 'success' ? '✓' : '↗'}
                    </span>
                    <span style={{ minWidth: 0 }}>{outputHint}</span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        color: 'var(--af-text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {outputs.length + ' 个输出'}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
          {!settings && loading ? (
            <div
              data-fisherai-workflow-primary-progress={'true'}
              role={'status'}
              aria-live={'polite'}
              style={{
                height: '44px',
                flex: 'none',
                display: 'grid',
                alignContent: 'center',
                gap: '6px',
                padding: '7px 16px 8px',
                borderBottom: '1px solid var(--af-border)',
                background: cloud ? 'var(--af-surface)' : 'var(--af-input)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  minWidth: 0,
                  color: 'var(--af-info)',
                  fontSize: '10px',
                }}
              >
                <span
                  aria-hidden={'true'}
                  style={{
                    width: '6px',
                    height: '6px',
                    flex: 'none',
                    borderRadius: '999px',
                    background: 'var(--af-info)',
                  }}
                />
                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {progressLabel}
                </span>
              </div>
              <div
                aria-hidden={'true'}
                style={{
                  height: '3px',
                  overflow: 'hidden',
                  borderRadius: '999px',
                  background: 'var(--af-hover)',
                }}
              >
                <div
                  style={{
                    width: hasProgress ? progressPercent + '%' : '34%',
                    height: '100%',
                    borderRadius: 'inherit',
                    background: 'var(--af-info)',
                    transition: 'width .22s ease',
                    animation: hasProgress
                      ? 'none'
                      : 'fisherai-workflow-pulse 1.2s ease-in-out infinite alternate',
                  }}
                />
              </div>
            </div>
          ) : null}
          {node.errorMessage ? (
            <div
              data-fisherai-workflow-error={'true'}
              role={'alert'}
              style={{
                flex: 'none',
                margin: '0 16px 10px',
                padding: '0 10px',
                border: '1px solid var(--af-danger)',
                borderRadius: '7px',
                background: 'var(--af-danger-bg)',
                color: 'var(--af-danger)',
                fontSize: '11px',
                lineHeight: 1.45,
                overflow: 'hidden',
              }}
            >
              <button
                type={'button'}
                data-fisherai-workflow-error-summary={'true'}
                aria-controls={errorDetailsId}
                aria-expanded={errorDetails}
                onClick={() => patch({ isWorkflowErrorDetailsOpen: !errorDetails })}
                onPointerDown={stop}
                style={{
                  width: '100%',
                  height: '43px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: 0,
                  border: 0,
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {errorSummary}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    flex: 'none',
                    color: 'var(--af-danger)',
                    fontSize: '9px',
                    fontWeight: 650,
                  }}
                >
                  {errorDetails ? '收起详情' : '查看详情'}
                </span>
              </button>
              {errorDetails ? (
                <div
                  id={errorDetailsId}
                  data-fisherai-workflow-error-details={'true'}
                  tabIndex={0}
                  style={{
                    height: '132px',
                    overflow: 'auto',
                    padding: '9px 0 10px',
                    borderTop: '1px solid var(--af-danger)',
                    color: 'var(--af-danger)',
                    fontSize: '10px',
                    fontWeight: 400,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {node.errorMessage}
                </div>
              ) : null}
            </div>
          ) : null}
          <footer
            style={{
              height: '66px',
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '0 14px 0 16px',
              borderTop: '1px solid var(--af-border)',
              background: cloud ? 'var(--af-info-bg)' : 'var(--af-surface)',
            }}
          >
            {cloud ? (
              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {node.title || '工作流'}
                </div>
                <div style={{ marginTop: '3px', fontSize: '9px', color: 'var(--af-info)' }}>
                  {'素材可在参数配置中上传或连接'}
                </div>
              </div>
            ) : null}
            <div
              data-fisherai-workflow-actions={'true'}
              style={{
                marginLeft: 'auto',
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {cloud ? (
                <label
                  data-fisherai-runninghub-instance-type={'true'}
                  title={'运行机器'}
                  style={{ width: '132px', height: '38px', display: 'block' }}
                >
                  <select
                    aria-label={'RunningHub 运行机器'}
                    value={instanceType}
                    disabled={loading}
                    onChange={(event) =>
                      patch({
                        runningHubInstanceType:
                          event.target.value === 'default' ? 'default' : 'plus',
                      })
                    }
                    onPointerDown={stop}
                    onWheel={stop}
                    style={{
                      width: '100%',
                      height: '38px',
                      padding: '0 10px',
                      border: '1px solid var(--af-border-control)',
                      borderRadius: '9px',
                      background: 'var(--af-surface)',
                      color: loading ? 'var(--af-info)' : 'var(--af-text)',
                      fontSize: '10px',
                      fontWeight: 700,
                      cursor: loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <option value={'plus'}>{'PLUS · 48GB'}</option>
                    <option value={'default'}>{'STANDARD · 24GB'}</option>
                  </select>
                </label>
              ) : null}
              <button
                type={'button'}
                aria-label={'参数配置'}
                aria-controls={'fisherai-workflow-settings-' + node.id}
                aria-expanded={settings}
                onClick={() => patch({ isWorkflowParametersOpen: !settings })}
                onPointerDown={stop}
                style={{
                  height: '38px',
                  minWidth: '88px',
                  padding: '0 13px',
                  border: '1px solid ' + (settings ? 'var(--af-info)' : 'var(--af-border)'),
                  borderRadius: '9px',
                  background: settings ? 'var(--af-hover)' : 'var(--af-surface-raised)',
                  color: 'var(--af-text)',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'background 120ms ease,border-color 120ms ease,color 120ms ease',
                }}
              >
                {settings ? '返回创作' : '参数配置'}
              </button>
              <button
                type={'button'}
                aria-label={paused ? '继续查询' : loading ? '取消工作流' : '运行工作流'}
                onClick={paused ? resume : loading ? cancel : run}
                onPointerDown={stop}
                style={{
                  height: '38px',
                  minWidth: '58px',
                  padding: '0 13px',
                  borderRadius: '9px',
                  border: '1px solid ' + (loading ? 'var(--af-border)' : 'var(--af-info)'),
                  background: loading ? 'var(--af-hover)' : 'var(--af-primary)',
                  color: loading ? 'var(--af-text-secondary)' : 'var(--af-on-primary)',
                  fontSize: '10px',
                  fontWeight: 750,
                  cursor: 'pointer',
                  transition: 'background 120ms ease,border-color 120ms ease,color 120ms ease',
                }}
              >
                {paused ? '继续' : loading ? '取消' : '运行'}
              </button>
            </div>
          </footer>
        </div>
        {invalidConnection ? (
          <div
            data-fisherai-workflow-invalid-connection={'true'}
            role={'status'}
            title={'当前类型的输入已满或不受支持'}
            style={{
              position: 'absolute',
              left: '-16px',
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 24,
              width: '30px',
              height: '30px',
              display: 'grid',
              placeItems: 'center',
              border: '1px solid var(--af-danger)',
              borderRadius: '999px',
              background: 'var(--af-danger-bg)',
              boxShadow: '0 0 0 4px rgba(251,113,133,.14)',
              color: 'var(--af-danger)',
              fontSize: '19px',
              fontWeight: 800,
              pointerEvents: 'none',
            }}
          >
            {'×'}
          </div>
        ) : null}
        {openSlots.map((slot) => (
          <div
            style={{
              position: 'absolute',
              left: '-12px',
              top: (adapter?.getInputPortY(node, slot.slotIndex) || 228) + 'px',
              transform: 'translateY(-50%) scale(' + (isHoveredForConnection ? 1 : 0.72) + ')',
              transformOrigin: 'center',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              opacity: isHoveredForConnection ? 1 : 0,
              pointerEvents: isHoveredForConnection ? 'auto' : 'none',
              transition: 'opacity 120ms ease, transform 120ms ease',
            }}
            key={slot.id}
          >
            <button
              type={'button'}
              title={slot.label}
              aria-label={'连接' + slot.label}
              aria-hidden={isHoveredForConnection ? 'false' : 'true'}
              tabIndex={isHoveredForConnection ? 0 : -1}
              data-fisherai-connector-node-id={node.id}
              data-fisherai-connector-side={'left'}
              data-fisherai-connector-port-index={slot.slotIndex}
              onPointerDown={(event) => input(event, slot.slotIndex)}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '999px',
                border: '1px solid ' + (isInvalidHover ? 'var(--af-danger)' : 'var(--af-info)'),
                background: isInvalidHover ? 'var(--af-danger-bg)' : 'var(--af-surface)',
                color: isInvalidHover ? 'var(--af-danger)' : 'var(--af-info)',
                boxShadow: isInvalidHover
                  ? '0 0 0 3px rgba(251,113,133,.1)'
                  : '0 0 0 3px rgba(96,165,250,.1)',
                fontSize: '16px',
                lineHeight: '20px',
                cursor: 'crosshair',
              }}
            >
              {isInvalidHover ? '×' : '+'}
            </button>
            <span
              data-fisherai-workflow-port-label={slot.id}
              style={{
                position: 'absolute',
                right: '32px',
                minHeight: '24px',
                display: 'flex',
                alignItems: 'center',
                padding: '0 7px',
                border: '1px solid ' + (isInvalidHover ? 'var(--af-danger)' : 'var(--af-border)'),
                borderRadius: '6px',
                background: isInvalidHover ? 'var(--af-danger-bg)' : 'var(--af-surface)',
                boxShadow: '0 8px 24px rgba(0,0,0,.34)',
                color: isInvalidHover ? 'var(--af-danger)' : 'var(--af-info)',
                fontSize: '10px',
                fontWeight: 650,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              {(adapter?.getMediaKindLabel(slot.mediaKind) || '数据') + ' · ' + slot.label}
            </span>
          </div>
        ))}
        {outputs.map((port, index) => (
          <div
            data-fisherai-workflow-output-port={port.id}
            style={{
              position: 'absolute',
              right: '-14px',
              top: (adapter?.getOutputPortY(node, index) || 454) + 'px',
              transform: 'translateY(-50%) scale(' + (hover ? 1 : 0.72) + ')',
              transformOrigin: 'center',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              opacity: hover ? 1 : 0,
              pointerEvents: hover ? 'auto' : 'none',
              transition: 'opacity 120ms ease, transform 120ms ease',
            }}
            key={port.id}
          >
            <button
              type={'button'}
              title={port.label}
              aria-label={'连接输出' + port.label}
              aria-hidden={hover ? 'false' : 'true'}
              tabIndex={hover ? 0 : -1}
              data-fisherai-connector-node-id={node.id}
              data-fisherai-connector-side={'right'}
              data-fisherai-connector-port-index={index}
              onPointerDown={(event) => output(event, index)}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '999px',
                border: '1px solid var(--af-info)',
                background: 'var(--af-surface)',
                color: port.primary ? 'var(--af-info)' : 'var(--af-info)',
                boxShadow: '0 0 0 3px rgba(96,165,250,.1)',
                fontSize: '16px',
                lineHeight: '20px',
                cursor: 'crosshair',
              }}
            >
              {'+'}
            </button>
            <span
              data-fisherai-workflow-port-label={port.id}
              style={{
                position: 'absolute',
                left: '32px',
                minHeight: '24px',
                display: 'flex',
                alignItems: 'center',
                padding: '0 7px',
                border: '1px solid var(--af-border)',
                borderRadius: '6px',
                background: 'var(--af-surface)',
                boxShadow: '0 8px 24px rgba(0,0,0,.34)',
                color: 'var(--af-info)',
                fontSize: '10px',
                fontWeight: 650,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              {(adapter?.getMediaKindLabel(port.mediaKind) || '数据') + ' · ' + port.label}
            </span>
          </div>
        ))}
      </div>
    </Frame>
  );
}
