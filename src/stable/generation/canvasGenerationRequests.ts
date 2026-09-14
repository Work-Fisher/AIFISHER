import type { CanvasNode } from '../nodes/canvasNodeOperations';
import { resolveImageGenerationMode } from './imageMode';
import { resolveVideoGenerationMode, type VideoModeDefinition } from './videoMode';
import { resolveMidjourneyReferencePayload } from './midjourneyReferences';

export interface GenerationModel {
  name: string;
  source?: string;
  maxInputs?: number;
  cost?: number | Partial<Record<string, number>>;
  costByMode?: Partial<Record<string, number | Partial<Record<string, number>>>>;
  timeEstimate?: string;
  fixedDuration?: number;
  advancedParams?: { key: string; default?: unknown; min?: number; max?: number }[];
  videoModes?: VideoModeDefinition[];
  imageModes?: VideoModeDefinition[];
  audioModes?: { value: string }[];
  languageModes?: { value: string }[];
}
export interface GenerationModels {
  imageModels: GenerationModel[];
  videoModels: GenerationModel[];
  textModels: GenerationModel[];
  audioModels: GenerationModel[];
}

/** Missing mode/resolution evidence must not become a generic quote. */
export function generationUnitPrice(
  quoted: number | null | undefined,
  model: GenerationModel | undefined,
  mode: string,
  resolution: string,
): number | null {
  if (typeof quoted === 'number' && Number.isFinite(quoted) && quoted >= 0) return quoted;
  const price = model?.costByMode ? model.costByMode[mode] : model?.cost;
  const key = price && typeof price === 'object'
    ? Object.keys(price).find(candidate => candidate.toLowerCase() === resolution.toLowerCase())
    : undefined;
  const value = typeof price === 'object' ? (key ? price[key] : undefined) : price;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export const videoUnitPrice = generationUnitPrice;
export const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;
export const finite = (value: unknown, fallback: number) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const count = (node: CanvasNode) => Math.max(1, Math.trunc(finite(node.generateCount, 1)));
const advanced = (node: CanvasNode, model?: GenerationModel) =>
  Object.fromEntries(
    (model?.advancedParams ?? []).map((parameter) => [
      parameter.key,
      node[parameter.key] ?? parameter.default,
    ]),
  );
const ratio = (node: CanvasNode, fallback: string) =>
  node.aspectRatio && node.aspectRatio !== 'Auto' ? node.aspectRatio : fallback;
const resolution = (node: CanvasNode, fallback: string) =>
  typeof node.resolution === 'string' && node.resolution !== 'Auto' ? node.resolution : fallback;

/** Resolve the selected workflow output, preserving its media type and port. */
export function inputMedia(
  source: CanvasNode,
  sourcePort = 0,
): { kind: string; url?: string; value?: unknown } {
  if (source.kind === 'workflow') {
    const ports = Array.isArray(source.outputPorts)
      ? (source.outputPorts as { id: string; mediaKind?: string }[])
      : [];
    const outputs = Array.isArray(source.workflowOutputs)
      ? (source.workflowOutputs as {
          portId: string;
          mediaKind: string;
          url?: string;
          value?: unknown;
        }[])
      : [];
    const port = ports[sourcePort];
    const output = outputs.find((item) => item.portId === port?.id);
    // A selected but unavailable output cannot fall back to another output.
    return {
      kind: output?.mediaKind ?? port?.mediaKind ?? 'unknown',
      url: output?.url,
      value: output?.value,
    };
  }
  const type = source.type.toLowerCase();
  const kind = type.includes('video')
    ? 'video'
    : type.includes('audio')
      ? 'audio'
      : type === 'text'
        ? 'text'
        : 'image';
  return {
    kind,
    url:
      text(kind === 'video' ? source.networkUrl || source.resultUrl : source.resultUrl) ||
      undefined,
    value: source.textContent,
  };
}
export function connectedMedia(nodes: CanvasNode[], node: CanvasNode) {
  return (node.parentIds ?? []).flatMap((id, index) => {
    const source = nodes.find((candidate) => candidate.id === id);
    return source ? [inputMedia(source, node.sourcePortIndices?.[index] ?? 0)] : [];
  });
}
export function imageReferences(nodes: CanvasNode[], node: CanvasNode, maxReferences = 14): string[] {
  const urls: string[] = [];
  for (const [index, parentId] of (node.parentIds ?? []).entries()) {
    const visited = new Set<string>();
    let currentId: string | undefined = parentId,
      port = node.sourcePortIndices?.[index] ?? 0;
    while (currentId && urls.length < maxReferences && !visited.has(currentId)) {
      visited.add(currentId);
      const parent = nodes.find((candidate) => candidate.id === currentId);
      if (!parent) break;
      const media = inputMedia(parent, port);
      if (media.kind === 'text') break;
      if (media.url) {
        if (media.kind === 'image' || media.kind === 'mask') urls.push(media.url);
        break;
      }
      // Workflow ports have explicit output identity; do not substitute upstream inputs.
      if (parent.kind === 'workflow') break;
      currentId = parent.parentIds?.[0];
      port = parent.sourcePortIndices?.[0] ?? 0;
    }
  }
  return urls;
}
export function effectiveVideoMode(nodes: CanvasNode[], node: CanvasNode, model?: GenerationModel) {
  const inputs = connectedMedia(nodes, node);
  return resolveVideoGenerationMode(
    node.videoMode,
    {
      images: inputs.filter((input) => input.kind === 'image' || input.kind === 'mask').length,
      videos: inputs.filter((input) => input.kind === 'video').length,
      audios: inputs.filter((input) => input.kind === 'audio').length,
    },
    model?.videoModes,
  );
}
export function buildImageRequest(
  nodes: CanvasNode[],
  node: CanvasNode,
  prompt: string,
  projectId: string | undefined,
  models: GenerationModels,
) {
  const model = models.imageModels.find((candidate) => candidate.name === node.imageModel);
  const images = imageReferences(nodes, node, Infinity),
    size = resolution(node, '1K'),
    aspectRatio = ratio(node, '1:1');
  const mode = resolveImageGenerationMode(node.imageMode, images.length > 0);
  const maximum = model?.imageModes?.find(item => item.value === mode)?.allowedInputs?.image
    ?? model?.maxInputs ?? 14;
  if (images.length > maximum) throw new Error(`参考图片数量超限：当前模型最多支持 ${maximum} 张，已连接 ${images.length} 张，请调整后重试。`);
  const quoted = window.__FISHERAI_MODEL_PRICING__?.priceFor(
    model?.name ?? text(node.imageModel),
    mode,
    size,
    aspectRatio,
    null,
    text(node.speed) || (model?.name === 'Midjourney Imagine · API' ? 'fast' : null),
  );
  const unitPrice = generationUnitPrice(quoted, model, mode, size);
  const estimated = ['dreamina_cli', 'libtv_cli'].includes(model?.source || '')
    ? 0
    : unitPrice === null
      ? undefined
      : unitPrice * (model?.name === 'Midjourney Imagine · API' ? 1 : count(node));
  return {
    ...advanced(node, model),
    prompt,
    aspectRatio,
    resolution: size,
    imageBase64: images.length ? images : undefined,
    imageModel: node.imageModel,
    nodeId: node.id,
    projectId: projectId || undefined,
    cost: estimated,
    klingReferenceMode: node.klingReferenceMode,
    klingFaceIntensity: node.klingFaceIntensity,
    klingSubjectIntensity: node.klingSubjectIntensity,
    generateCount: count(node),
    imageMode: mode,
    midjourneyReferences:
      model?.name === 'Midjourney Imagine · API'
        ? resolveMidjourneyReferencePayload(node, nodes)
        : null,
    web_search: node.web_search,
    detail: node.detail || 'low',
    quality: node.quality || 'auto',
  };
}
export async function buildVideoRequest(
  nodes: CanvasNode[],
  node: CanvasNode,
  prompt: string,
  projectId: string | undefined,
  models: GenerationModels,
) {
  const model = models.videoModels.find((candidate) => candidate.name === node.videoModel),
    parameters = advanced(node, model);
  const durationParameter = model?.advancedParams?.find(
    (parameter) => parameter.key === 'duration',
  );
  const requested = finite(
    parameters.duration ?? durationParameter?.default ?? 4,
    finite(durationParameter?.default, 4),
  );
  const duration =
    model?.fixedDuration && Number.isFinite(model.fixedDuration) && model.fixedDuration > 0
      ? model.fixedDuration
      : Math.min(
          finite(durationParameter?.max, Infinity),
          Math.max(finite(durationParameter?.min, -Infinity), requested),
        );
  const size = resolution(node, '720p'),
    aspectRatio = ratio(node, '16:9'),
    mode = effectiveVideoMode(nodes, node, model);
  const generateAudio = typeof node.generate_audio === 'boolean' ? node.generate_audio : undefined;
  await window.__FISHERAI_MODEL_PRICING__?.ensure(size, mode, {
    aspectRatio,
    duration,
    generateAudio,
  });
  const quoted = window.__FISHERAI_MODEL_PRICING__?.priceFor(
    model?.name ?? text(node.videoModel),
    mode,
    size,
    aspectRatio,
    duration,
    null,
    generateAudio,
  );
  const unitPrice = videoUnitPrice(quoted, model, mode, size);
  const estimated =
    ['dreamina_cli', 'libtv_cli'].includes(model?.source || '')
      ? 0
      : unitPrice === null ? undefined : unitPrice * duration * count(node);
  const media = connectedMedia(nodes, node);
  return {
    ...parameters,
    duration,
    prompt,
    images: media
      .filter((input) => ['image', 'mask'].includes(input.kind) && input.url)
      .map((input) => input.url!),
    videos: media.filter((input) => input.kind === 'video' && input.url).map((input) => input.url!),
    audios: media.filter((input) => input.kind === 'audio' && input.url).map((input) => input.url!),
    aspectRatio,
    resolution: size,
    videoModel: node.videoModel,
    videoMode: mode,
    generate_audio: node.generate_audio,
    nodeId: node.id,
    projectId: projectId || undefined,
    cost: estimated,
    generateCount: count(node),
  };
}
export function buildTextRequest(
  nodes: CanvasNode[],
  node: CanvasNode,
  prompt: string,
  projectId: string | undefined,
  models: GenerationModels,
) {
  const model = models.textModels.find((candidate) => candidate.name === node.textModel),
    media = connectedMedia(nodes, node);
  const images = media
    .filter((input) => ['image', 'mask'].includes(input.kind) && input.url)
    .map((input) => input.url!);
  const audios = media
    .filter((input) => input.kind === 'audio' && input.url)
    .map((input) => input.url!);
  return {
    ...advanced(node, model),
    prompt,
    textModel: node.textModel,
    nodeId: node.id,
    projectId: projectId || undefined,
    cost: finite(model?.cost, 0),
    imageBase64: images.length ? images : undefined,
    videoUrl: media.find((input) => input.kind === 'video' && input.url)?.url,
    audios: audios.length ? audios : undefined,
    detail: node.detail || 'low',
    web_search: node.web_search,
    languageMode:
      node.languageMode || node.textMode || model?.languageModes?.[0]?.value || 'multimodal-chat',
  };
}
export function buildAudioRequest(
  nodes: CanvasNode[],
  node: CanvasNode,
  prompt: string,
  projectId: string | undefined,
  models: GenerationModels,
) {
  const model =
    models.audioModels.find((candidate) => candidate.name === node.audioModel) ??
    models.audioModels[0];
  const media = connectedMedia(nodes, node),
    images = media
      .filter((input) => ['image', 'mask'].includes(input.kind) && input.url)
      .map((input) => input.url!);
  return {
    ...advanced(node, model),
    prompt,
    lyrics: text(node.lyrics).trim(),
    audioModel: node.audioModel || model?.name,
    audioMode: node.audioMode || model?.audioModes?.[0]?.value || 'instrumental',
    audios: media.filter((input) => input.kind === 'audio' && input.url).map((input) => input.url!),
    imageBase64: images.length ? images : undefined,
    nodeId: node.id,
    projectId: projectId || undefined,
    cost: finite(model?.cost, 0) * count(node),
    generateCount: count(node),
  };
}
