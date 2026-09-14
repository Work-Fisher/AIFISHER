import type { VideoWorkflowRequest } from './videoWorkflows';

export type MiniMaxH3Mode = 't2va' | 'i2va' | 'fl2va' | 'l2va' | 'ref2va';

export interface MiniMaxH3CanvasNode {
  id: string;
  type: string;
  parentIds?: string[];
  minimaxH3Mode?: MiniMaxH3Mode;
  inlinePrompt?: string;
  textContent?: string;
  prompt?: string;
  resultUrl?: string;
  url?: string;
  dataUrl?: string;
  aspectRatio?: string;
  megapixels?: number;
  duration?: number;
  seed?: number;
  [key: string]: unknown;
}

export interface MiniMaxH3VisualPort {
  id: 'text' | 'firstFrame' | 'lastFrame' | 'referenceImage' | 'referenceVideo' | 'referenceAudio';
  label: string;
  portIndex: number;
  y: number;
  media: 'text' | 'image' | 'video' | 'audio';
  connected: number;
  maximum: number;
}

export const MINIMAX_H3_INPUT_COUNT = 18;

/** 文本端口的纵向位置，必须留在 402px 预览容器内，否则会压住提示词输入区。 */
export const TEXT_PORT_Y = 352;

export const MINIMAX_H3_DURATION = Object.freeze({
  minSeconds: 3,
  maxSeconds: 15,
  defaultSeconds: 5,
  fps: 24,
  // 官方节点标注的训练区间：124~362 帧。超出这个范围模型没训过，画质不保证。
  trainedMinFrames: 124,
  trainedMaxFrames: 362,
});

/** MiniMax H3 只接受满足 帧数 ≡ 5 (mod 17) 的长度，秒数会被向上吸附。 */
export function alignMiniMaxH3Frames(seconds: number): number {
  let frames = Math.max(5, Math.round(Number(seconds) * MINIMAX_H3_DURATION.fps));
  while (frames % 17 !== 5) frames += 1;
  return frames;
}

export interface MiniMaxH3DurationInfo {
  requestedSeconds: number;
  frames: number;
  actualSeconds: number;
  belowTrainedRange: boolean;
  aboveTrainedRange: boolean;
  summary: string;
  warning: string;
}

/**
 * 把用户选的秒数翻译成真实出片结果。
 * 除了 8 秒，其它秒数吸附后都不是整数，界面必须如实回显，不能让用户以为选几秒就出几秒。
 */
export function describeMiniMaxH3Duration(seconds: number): MiniMaxH3DurationInfo {
  const requestedSeconds = Number(seconds) || MINIMAX_H3_DURATION.defaultSeconds;
  const frames = alignMiniMaxH3Frames(requestedSeconds);
  const actualSeconds = frames / MINIMAX_H3_DURATION.fps;
  const belowTrainedRange = frames < MINIMAX_H3_DURATION.trainedMinFrames;
  const aboveTrainedRange = frames > MINIMAX_H3_DURATION.trainedMaxFrames;
  return {
    requestedSeconds,
    frames,
    actualSeconds,
    belowTrainedRange,
    aboveTrainedRange,
    summary: `实际生成 ${actualSeconds.toFixed(2)} 秒 · ${frames} 帧`,
    warning: belowTrainedRange
      ? '低于模型训练时长，画面可能不稳定。'
      : aboveTrainedRange
        ? '超出模型训练时长，结果未经验证。'
        : '',
  };
}

export const MINIMAX_H3_MODE_OPTIONS: ReadonlyArray<{
  value: MiniMaxH3Mode;
  label: string;
  description: string;
}> = Object.freeze([
  { value: 't2va', label: '文生音视频', description: '仅根据提示词生成画面与原生音频' },
  { value: 'i2va', label: '首帧生音视频', description: '以一张图片作为视频第一帧' },
  { value: 'fl2va', label: '首尾帧生音视频', description: '分别约束视频的第一帧和最后一帧' },
  { value: 'l2va', label: '尾帧生音视频', description: '以一张图片约束视频最后一帧' },
  { value: 'ref2va', label: '参考生音视频', description: '引用图片、视频或音频控制内容' },
]);

const SLOT_RANGES = Object.freeze({
  text: [0, 0] as const,
  firstFrame: [1, 1] as const,
  lastFrame: [2, 2] as const,
  referenceImage: [3, 11] as const,
  referenceVideo: [12, 14] as const,
  referenceAudio: [15, 17] as const,
});

const TYPE_MEDIA: Readonly<Record<string, 'text' | 'image' | 'video' | 'audio' | undefined>> = {
  Text: 'text',
  text: 'text',
  Image: 'image',
  image: 'image',
  'Upload Image': 'image',
  'upload-image': 'image',
  Video: 'video',
  video: 'video',
  'Upload Video': 'video',
  'upload-video': 'video',
  Audio: 'audio',
  audio: 'audio',
  'Upload Audio': 'audio',
  'upload-audio': 'audio',
};

function modeOf(node: MiniMaxH3CanvasNode): MiniMaxH3Mode {
  return MINIMAX_H3_MODE_OPTIONS.some((option) => option.value === node.minimaxH3Mode)
    ? (node.minimaxH3Mode as MiniMaxH3Mode)
    : 't2va';
}

function paddedParentIds(parentIds: readonly string[] = []): string[] {
  const padded = parentIds.slice(0, MINIMAX_H3_INPUT_COUNT);
  while (padded.length < MINIMAX_H3_INPUT_COUNT) padded.push('');
  return padded;
}

function occupied(parentIds: readonly string[], range: readonly [number, number]): number {
  let count = 0;
  for (let index = range[0]; index <= range[1]; index += 1) {
    if (parentIds[index]) count += 1;
  }
  return count;
}

function nextSlot(parentIds: readonly string[], range: readonly [number, number]): number {
  for (let index = range[0]; index <= range[1]; index += 1) {
    if (!parentIds[index]) return index;
  }
  return range[1];
}

function visualPort(
  parentIds: readonly string[],
  id: MiniMaxH3VisualPort['id'],
  label: string,
  y: number,
  media: MiniMaxH3VisualPort['media'],
): MiniMaxH3VisualPort {
  const range = SLOT_RANGES[id];
  return {
    id,
    label,
    y,
    media,
    portIndex: nextSlot(parentIds, range),
    connected: occupied(parentIds, range),
    maximum: range[1] - range[0] + 1,
  };
}

export function getMiniMaxH3VisualPorts(node: MiniMaxH3CanvasNode): MiniMaxH3VisualPort[] {
  const parentIds = paddedParentIds(node.parentIds);
  // 端口画在高 402px 的预览容器里。文本端口原本是 500，会溢出到下方提示词面板上，
  // 42px 的连接按钮压住输入区，点那里会开始拉线而不是聚焦输入框。
  const text = visualPort(parentIds, 'text', '文本', TEXT_PORT_Y, 'text');
  switch (modeOf(node)) {
    case 'i2va':
      return [visualPort(parentIds, 'firstFrame', '首帧', 201, 'image'), text];
    case 'fl2va':
      return [
        visualPort(parentIds, 'firstFrame', '首帧', 150, 'image'),
        visualPort(parentIds, 'lastFrame', '尾帧', 252, 'image'),
        text,
      ];
    case 'l2va':
      return [visualPort(parentIds, 'lastFrame', '尾帧', 201, 'image'), text];
    case 'ref2va':
      return [
        visualPort(parentIds, 'referenceImage', '图片', 150, 'image'),
        visualPort(parentIds, 'referenceVideo', '视频', 201, 'video'),
        visualPort(parentIds, 'referenceAudio', '音频', 252, 'audio'),
        text,
      ];
    default:
      return [text];
  }
}

export type MiniMaxH3Media = 'text' | 'image' | 'video' | 'audio';

/** 每种模式允许接入的素材类型；t2va 只接文本。 */
const MODE_MEDIA: Readonly<Record<MiniMaxH3Mode, ReadonlyArray<MiniMaxH3Media>>> = {
  t2va: ['text'],
  i2va: ['text', 'image'],
  fl2va: ['text', 'image'],
  l2va: ['text', 'image'],
  ref2va: ['text', 'image', 'video', 'audio'],
};

export function getMiniMaxH3Media(node?: MiniMaxH3CanvasNode | null): MiniMaxH3Media | undefined {
  return TYPE_MEDIA[node?.type || ''];
}

export function getMiniMaxH3ModeMedia(nodeOrMode: MiniMaxH3CanvasNode | MiniMaxH3Mode) {
  const mode = typeof nodeOrMode === 'string' ? nodeOrMode : modeOf(nodeOrMode);
  return MODE_MEDIA[mode] || MODE_MEDIA.t2va;
}

/**
 * 当前模式是否允许把这个素材接到这个槽位。
 * 压缩 UI 松手时会把 18 个端口挨个试兼容性，只靠端口解析拒绝会被那轮兜底扫描绕过，
 * 所以准入判定必须单独暴露出来。
 */
export function isMiniMaxH3ConnectionAllowed(
  node: MiniMaxH3CanvasNode,
  sourceNode?: MiniMaxH3CanvasNode | null,
  portIndex?: number,
): boolean {
  const media = getMiniMaxH3Media(sourceNode);
  if (!media) return true;
  if (!getMiniMaxH3ModeMedia(node).includes(media)) return false;
  if (typeof portIndex !== 'number') return true;
  return getMiniMaxH3VisualPorts(node).some((port) => {
    if (port.media !== media) return false;
    const range = SLOT_RANGES[port.id];
    return portIndex >= range[0] && portIndex <= range[1];
  });
}

export function getMiniMaxH3RejectionMessage(
  node: MiniMaxH3CanvasNode,
  sourceNode?: MiniMaxH3CanvasNode | null,
): string | null {
  const media = getMiniMaxH3Media(sourceNode);
  if (!media || getMiniMaxH3ModeMedia(node).includes(media)) return null;
  const label = { text: '文本', image: '图片', video: '视频', audio: '音频' }[media];
  return `${getMiniMaxH3ModeLabel(node)}不支持接入${label}素材，请先切换到首帧或参考模式。`;
}

export function getMiniMaxH3PortY(node: MiniMaxH3CanvasNode, portIndex = 0): number {
  const port = getMiniMaxH3VisualPorts(node).find((candidate) => {
    const range = SLOT_RANGES[candidate.id];
    return portIndex >= range[0] && portIndex <= range[1];
  });
  return port?.y ?? TEXT_PORT_Y;
}

export const MINIMAX_H3_REJECTED_PORT = -1;

/**
 * 解析落点端口。传入源节点时按素材类型选端口，而不是只按 Y 距离取最近的——
 * 否则参考模式下把音频拖到靠近图片端口的位置也会进错槽，
 * 而文生模式下唯一的端口是文本，任何素材都会被塞进文本槽。
 */
export function resolveMiniMaxH3PortIndex(
  node: MiniMaxH3CanvasNode,
  relativeY: number,
  sourceNode?: MiniMaxH3CanvasNode | null,
): number {
  const ports = getMiniMaxH3VisualPorts(node);
  const nearest = (candidates: MiniMaxH3VisualPort[]) =>
    candidates.reduce((closest, port) =>
      Math.abs(port.y - relativeY) < Math.abs(closest.y - relativeY) ? port : closest,
    ).portIndex;

  const media = getMiniMaxH3Media(sourceNode);
  if (!media) return nearest(ports);

  const matching = ports.filter((port) => port.media === media);
  if (!matching.length) return MINIMAX_H3_REJECTED_PORT;
  return nearest(matching);
}

export function getMiniMaxH3ModeLabel(nodeOrMode: MiniMaxH3CanvasNode | MiniMaxH3Mode): string {
  const mode = typeof nodeOrMode === 'string' ? nodeOrMode : modeOf(nodeOrMode);
  return (
    MINIMAX_H3_MODE_OPTIONS.find((option) => option.value === mode)?.label ??
    MINIMAX_H3_MODE_OPTIONS[0].label
  );
}

export function remapMiniMaxH3ParentIds(
  parentIds: readonly string[] = [],
  fromMode: MiniMaxH3Mode,
  toMode: MiniMaxH3Mode,
): string[] {
  const current = paddedParentIds(parentIds);
  const next = paddedParentIds();
  next[0] = current[0];

  const firstAvailableImage = current[1] || current[2] || current.slice(3, 12).find(Boolean) || '';
  if (toMode === 'i2va' || toMode === 'fl2va') next[1] = firstAvailableImage;
  if (toMode === 'l2va') next[2] = current[2] || firstAvailableImage;
  if (toMode === 'fl2va') next[2] = current[2] || '';
  if (toMode === 'ref2va') {
    const images = [
      ...(fromMode === 'i2va' || fromMode === 'fl2va' ? [current[1]] : []),
      ...(fromMode === 'l2va' || fromMode === 'fl2va' ? [current[2]] : []),
      ...current.slice(3, 12),
    ].filter(Boolean);
    images.slice(0, 9).forEach((id, index) => {
      next[3 + index] = id;
    });
    current.slice(12, 18).forEach((id, index) => {
      next[12 + index] = id;
    });
  }
  return next;
}

export function migrateLegacyMiniMaxH3Node(
  node: MiniMaxH3CanvasNode,
  connectedNodes: readonly MiniMaxH3CanvasNode[],
): Pick<MiniMaxH3CanvasNode, 'minimaxH3Mode' | 'parentIds'> | null {
  if (MINIMAX_H3_MODE_OPTIONS.some((option) => option.value === node.minimaxH3Mode)) return null;
  const byId = new Map(connectedNodes.map((candidate) => [candidate.id, candidate]));
  const grouped = {
    text: [] as string[],
    image: [] as string[],
    video: [] as string[],
    audio: [] as string[],
  };
  for (const id of node.parentIds || []) {
    const media = TYPE_MEDIA[byId.get(id)?.type || ''];
    if (media) grouped[media].push(id);
  }
  const hasReferenceMedia = grouped.image.length + grouped.video.length + grouped.audio.length > 0;
  const parentIds = paddedParentIds();
  parentIds[0] = grouped.text[0] || '';
  grouped.image.slice(0, 9).forEach((id, index) => {
    parentIds[3 + index] = id;
  });
  grouped.video.slice(0, 3).forEach((id, index) => {
    parentIds[12 + index] = id;
  });
  grouped.audio.slice(0, 3).forEach((id, index) => {
    parentIds[15 + index] = id;
  });
  return { minimaxH3Mode: hasReferenceMedia ? 'ref2va' : 't2va', parentIds };
}

function nodeUrl(node: MiniMaxH3CanvasNode | undefined): string | undefined {
  const value = node?.resultUrl || node?.url || node?.dataUrl;
  return typeof value === 'string' && value ? value : undefined;
}

function nodesForRange(
  parentIds: readonly string[],
  nodesById: ReadonlyMap<string, MiniMaxH3CanvasNode>,
  range: readonly [number, number],
): MiniMaxH3CanvasNode[] {
  return parentIds
    .slice(range[0], range[1] + 1)
    .map((id) => nodesById.get(id))
    .filter((node): node is MiniMaxH3CanvasNode => Boolean(node));
}

export function buildMiniMaxH3Request(
  nodes: readonly MiniMaxH3CanvasNode[],
  node: MiniMaxH3CanvasNode,
  projectId: string,
): VideoWorkflowRequest {
  const mode = modeOf(node);
  const parentIds = paddedParentIds(node.parentIds);
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const textNodes = nodesForRange(parentIds, nodesById, SLOT_RANGES.text);
  const fallbackText = (node.parentIds || [])
    .map((id) => nodesById.get(id))
    .find((candidate) => TYPE_MEDIA[candidate?.type || ''] === 'text');
  const connectedPrompt =
    textNodes[0]?.textContent ||
    textNodes[0]?.prompt ||
    fallbackText?.textContent ||
    fallbackText?.prompt ||
    '';
  const rawPrompt = String(node.inlinePrompt || '').trim() || String(connectedPrompt || '').trim();
  const allTextNodes = (node.parentIds || [])
    .map((id) => nodesById.get(id))
    .filter(
      (candidate): candidate is MiniMaxH3CanvasNode => TYPE_MEDIA[candidate?.type || ''] === 'text',
    );
  const text = rawPrompt.replace(/\{text(\d+)\}/g, (_match, ordinal) => {
    const source = allTextNodes[Number(ordinal) - 1];
    return String(source?.textContent || source?.prompt || '');
  });
  if (!text) throw new Error('请填写提示词，或连接一个有内容的文本节点。');

  const request: VideoWorkflowRequest = {
    projectId,
    nodeId: node.id,
    text,
    mode,
    aspectRatio: String(node.aspectRatio || '16:9'),
    megapixels: Number(node.megapixels ?? 0.4),
    duration: Number(node.duration ?? 8),
    seed: Number(node.seed ?? -1),
  };

  if (mode === 'i2va' || mode === 'fl2va') {
    request.firstFrameUrl = nodeUrl(nodesById.get(parentIds[1]));
    if (!request.firstFrameUrl) throw new Error('请连接首帧图片。');
  }
  if (mode === 'l2va' || mode === 'fl2va') {
    request.lastFrameUrl = nodeUrl(nodesById.get(parentIds[2]));
    if (!request.lastFrameUrl) throw new Error('请连接尾帧图片。');
  }
  if (mode === 'ref2va') {
    request.referenceImageUrls = nodesForRange(parentIds, nodesById, SLOT_RANGES.referenceImage)
      .map(nodeUrl)
      .filter((url): url is string => Boolean(url));
    request.referenceVideoUrls = nodesForRange(parentIds, nodesById, SLOT_RANGES.referenceVideo)
      .map(nodeUrl)
      .filter((url): url is string => Boolean(url));
    request.referenceAudioUrls = nodesForRange(parentIds, nodesById, SLOT_RANGES.referenceAudio)
      .map(nodeUrl)
      .filter((url): url is string => Boolean(url));
    if (
      request.referenceImageUrls.length +
        request.referenceVideoUrls.length +
        request.referenceAudioUrls.length ===
      0
    )
      throw new Error('参考模式至少需要连接一个图片、视频或音频素材。');
  }
  return request;
}

export interface MiniMaxH3CanvasAdapter {
  readonly modes: typeof MINIMAX_H3_MODE_OPTIONS;
  readonly inputCount: number;
  readonly duration: typeof MINIMAX_H3_DURATION;
  describeDuration(seconds: number): MiniMaxH3DurationInfo;
  getModeLabel(nodeOrMode: MiniMaxH3CanvasNode | MiniMaxH3Mode): string;
  getVisualPorts(node: MiniMaxH3CanvasNode): MiniMaxH3VisualPort[];
  getPortY(node: MiniMaxH3CanvasNode, portIndex?: number): number;
  isConnectionAllowed(
    node: MiniMaxH3CanvasNode,
    sourceNode?: MiniMaxH3CanvasNode | null,
    portIndex?: number,
  ): boolean;
  resolvePortIndex(
    node: MiniMaxH3CanvasNode,
    relativeY: number,
    sourceNode?: MiniMaxH3CanvasNode | null,
  ): number;
  remapParentIds(
    parentIds: readonly string[],
    fromMode: MiniMaxH3Mode,
    toMode: MiniMaxH3Mode,
  ): string[];
  migrateLegacyNode(
    node: MiniMaxH3CanvasNode,
    connectedNodes: readonly MiniMaxH3CanvasNode[],
  ): Pick<MiniMaxH3CanvasNode, 'minimaxH3Mode' | 'parentIds'> | null;
  buildRequest(
    nodes: readonly MiniMaxH3CanvasNode[],
    node: MiniMaxH3CanvasNode,
    projectId: string,
  ): VideoWorkflowRequest;
}

declare global {
  interface Window {
    __FISHERAI_MINIMAX_H3__?: MiniMaxH3CanvasAdapter;
  }
}

const HINT_ATTRIBUTE = 'data-fisherai-minimax-reject-hint';
const HINT_VISIBLE_MS = 2_600;

/** 拒绝连接时给一句话说明。拖拽期间会被反复调用，所以复用同一个元素而不是不断追加。 */
export function showMiniMaxH3RejectionHint(message: string) {
  if (typeof document === 'undefined') return;
  let hint = document.querySelector<HTMLElement>(`[${HINT_ATTRIBUTE}]`);
  if (!hint) {
    hint = document.createElement('div');
    hint.setAttribute(HINT_ATTRIBUTE, 'true');
    hint.setAttribute('role', 'status');
    hint.style.cssText =
      'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:120;' +
      'padding:8px 14px;border-radius:8px;border:1px solid var(--af-danger);background:var(--af-danger-bg);color:var(--af-danger);' +
      'font-size:12px;font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif;' +
      'box-shadow:var(--af-shadow);pointer-events:none;';
    document.body.append(hint);
  }
  hint.textContent = message;
  const timer = Number(hint.dataset.timer || 0);
  if (timer) window.clearTimeout(timer);
  hint.dataset.timer = String(window.setTimeout(() => hint?.remove(), HINT_VISIBLE_MS));
}

export function installMiniMaxH3CanvasAdapter({
  onReject = showMiniMaxH3RejectionHint,
}: { onReject?: (message: string) => void } = {}): MiniMaxH3CanvasAdapter {
  const reject = (node: MiniMaxH3CanvasNode, sourceNode?: MiniMaxH3CanvasNode | null) => {
    const message = getMiniMaxH3RejectionMessage(node, sourceNode);
    if (message) onReject(message);
  };

  const adapter: MiniMaxH3CanvasAdapter = Object.freeze({
    modes: MINIMAX_H3_MODE_OPTIONS,
    inputCount: MINIMAX_H3_INPUT_COUNT,
    duration: MINIMAX_H3_DURATION,
    describeDuration: describeMiniMaxH3Duration,
    getModeLabel: getMiniMaxH3ModeLabel,
    getVisualPorts: getMiniMaxH3VisualPorts,
    getPortY: getMiniMaxH3PortY,
    isConnectionAllowed(
      node: MiniMaxH3CanvasNode,
      sourceNode?: MiniMaxH3CanvasNode | null,
      portIndex?: number,
    ) {
      const allowed = isMiniMaxH3ConnectionAllowed(node, sourceNode, portIndex);
      if (!allowed) reject(node, sourceNode);
      return allowed;
    },
    resolvePortIndex(
      node: MiniMaxH3CanvasNode,
      relativeY: number,
      sourceNode?: MiniMaxH3CanvasNode | null,
    ) {
      const portIndex = resolveMiniMaxH3PortIndex(node, relativeY, sourceNode);
      if (portIndex === MINIMAX_H3_REJECTED_PORT) reject(node, sourceNode);
      return portIndex;
    },
    remapParentIds: remapMiniMaxH3ParentIds,
    migrateLegacyNode: migrateLegacyMiniMaxH3Node,
    buildRequest: buildMiniMaxH3Request,
  });
  window.__FISHERAI_MINIMAX_H3__ = adapter;
  return adapter;
}
