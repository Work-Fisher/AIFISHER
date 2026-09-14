import { installCanvasSession } from '../persistence/canvasSession';
import { preferenceStorage } from '../persistence/preferenceStore';

type MediaKind = 'Image' | 'Video';
interface Dimensions {
  aspectRatio?: string;
  resolution?: string;
}
interface ModelDimensions {
  aspectRatios?: string[];
  resolutions?: string[];
}

function storageKey(projectId?: string) {
  const project = projectId || installCanvasSession().load()?.workflowId;
  return project ? `fisherai.node-dimensions.v1:${encodeURIComponent(project)}` : undefined;
}

function dimension(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 32 ? value : undefined;
}

function read(key: string): Partial<Record<MediaKind, Dimensions>> {
  try {
    const record = JSON.parse(preferenceStorage().getItem(key) || '{}');
    return Object.fromEntries(
      ['Image', 'Video'].map((kind) => [
        kind,
        {
          aspectRatio: dimension(record?.[kind]?.aspectRatio),
          resolution: dimension(record?.[kind]?.resolution),
        },
      ]),
    );
  } catch {
    return {};
  }
}

/** Called only by an explicit dimension choice, never by restore or generation results. */
export function rememberNodeDimensions(
  kind: MediaKind,
  projectId: string | undefined,
  values: Dimensions,
) {
  const key = storageKey(projectId);
  if (!key) return;
  try {
    const record = read(key);
    record[kind] = {
      aspectRatio: dimension(values.aspectRatio),
      resolution: dimension(values.resolution),
    };
    preferenceStorage().setItem(key, JSON.stringify(record));
  } catch {
    // A blocked or full browser store must not prevent editing a node.
  }
}

export function newNodeDimensions(
  kind: MediaKind,
  projectId: string | undefined,
  model?: ModelDimensions,
): Dimensions {
  const key = storageKey(projectId);
  const remembered = key ? read(key)[kind] : undefined;
  const supported = (value: string | undefined, choices: string[] | undefined, fallback: string) =>
    value && (!choices?.length || choices.includes(value)) ? value : choices?.[0] || fallback;
  return {
    aspectRatio: supported(
      remembered?.aspectRatio,
      model?.aspectRatios,
      kind === 'Image' ? '1:1' : '16:9',
    ),
    resolution: supported(
      remembered?.resolution,
      model?.resolutions,
      kind === 'Image' ? '1K' : '720p',
    ),
  };
}
