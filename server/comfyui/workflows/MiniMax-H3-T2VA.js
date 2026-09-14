import fsp from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME_PATHS } from '../../workspace/runtimePaths.js';

const directory = path.join(RUNTIME_PATHS.SERVER_DIR, 'comfyui', 'workflows');

const ASPECT_RATIOS = Object.freeze({
  '1:1': '1:1 (Square)',
  '2:3': '2:3 (Portrait Photo)',
  '3:2': '3:2 (Photo)',
  '3:4': '3:4 (Portrait Standard)',
  '4:3': '4:3 (Standard)',
  '9:16': '9:16 (Portrait Widescreen)',
  '16:9': '16:9 (Widescreen)',
  '21:9': '21:9 (Ultrawide)',
});

export const MINIMAX_H3_MODES = Object.freeze([
  't2va',
  'i2va',
  'fl2va',
  'l2va',
  'ref2va',
]);

// 画布模式 → MiniMax H3 条件节点的 task_type 枚举。
const TASK_TYPES = Object.freeze({
  t2va: 'T2VA',
  i2va: 'I2VA',
  fl2va: 'FL2VA',
  l2va: 'L2VA',
  ref2va: 'Ref2VA',
});

const MAX_REFERENCES = Object.freeze({ image: 9, video: 3, audio: 3 });

const CONDITIONING_NODE = '307';

// 运行时追加的素材节点 ID，与模板固有的 17 个节点不冲突。
const NODE_IDS = Object.freeze({
  firstFrame: '320',
  lastFrame: '321',
  refImage: (index) => String(330 + index),
  refVideo: (index) => String(340 + index),
  refAudio: (index) => String(350 + index),
});

export function canonicalizeMiniMaxH3Mentions(text) {
  return String(text || '')
    .replace(/@图片\s*(\d+)/gi, '<Picture $1>')
    .replace(/\{image\s*(\d+)\}/gi, '<Picture $1>')
    .replace(/\bimage\s+(\d+)\b/gi, '<Picture $1>')
    .replace(/\bvideo\s+(\d+)\b/gi, '<Video $1>')
    .replace(/\{video\s*(\d+)\}/gi, '<Video $1>')
    .replace(/@视频\s*(\d+)/gi, '<Video $1>')
    .replace(/\baudio\s+(\d+)\b/gi, '<Audio $1>')
    .replace(/\{audio\s*(\d+)\}/gi, '<Audio $1>')
    .replace(/@音频\s*(\d+)/gi, '<Audio $1>');
}

function uniqueUrls(values, maximum) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].slice(0, maximum);
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function addLoadImage(workflow, comfyClient, nodeId, url, title) {
  const image = await comfyClient.uploadImage(url);
  workflow[nodeId] = {
    inputs: { image },
    class_type: 'LoadImage',
    _meta: { title },
  };
  return [nodeId, 0];
}

async function addLoadAudio(workflow, comfyClient, nodeId, url, title) {
  const audio = await comfyClient.uploadImage(url);
  workflow[nodeId] = {
    inputs: { audio },
    class_type: 'LoadAudio',
    _meta: { title },
  };
  return [nodeId, 0];
}

async function addLoadVideo(workflow, comfyClient, nodeId, url, title) {
  const video = await comfyClient.uploadImage(url);
  workflow[nodeId] = {
    inputs: {
      video,
      force_rate: 0,
      custom_width: 0,
      custom_height: 0,
      frame_load_cap: 0,
      skip_first_frames: 0,
      select_every_nth: 1,
    },
    class_type: 'VHS_LoadVideo',
    _meta: { title },
  };
  // 输出序号按 ComfyUI object_info 核对：0=IMAGE，1=frame_count，2=AUDIO，3=video_info。
  return { images: [nodeId, 0], audio: [nodeId, 2] };
}

function referenceUrls(params) {
  return {
    images: uniqueUrls(
      params.referenceImageUrls || params.refImageUrls || (params.imageUrl ? [params.imageUrl] : []),
      MAX_REFERENCES.image,
    ),
    videos: uniqueUrls(params.referenceVideoUrls || params.refVideoUrls, MAX_REFERENCES.video),
    audios: uniqueUrls(params.referenceAudioUrls || params.refAudioUrls, MAX_REFERENCES.audio),
  };
}

async function configureKeyframes(workflow, comfyClient, params, mode) {
  const conditioning = workflow[CONDITIONING_NODE].inputs;
  const firstFrameUrl = params.firstFrameUrl || (mode === 'i2va' ? params.imageUrl : null);
  const lastFrameUrl = params.lastFrameUrl || (mode === 'l2va' ? params.imageUrl : null);

  if ((mode === 'i2va' || mode === 'fl2va') && firstFrameUrl) {
    conditioning.first_frame = await addLoadImage(
      workflow, comfyClient, NODE_IDS.firstFrame, firstFrameUrl, 'AIFISHER 首帧',
    );
  }
  if ((mode === 'l2va' || mode === 'fl2va') && lastFrameUrl) {
    conditioning.last_frame = await addLoadImage(
      workflow, comfyClient, NODE_IDS.lastFrame, lastFrameUrl, 'AIFISHER 尾帧',
    );
  }
}

async function configureReferences(workflow, comfyClient, params) {
  const conditioning = workflow[CONDITIONING_NODE].inputs;
  const references = referenceUrls(params);

  // 这些是 Autogrow 动态输入，键名必须是「父名.子名」形式；
  // 写成别的形式不会报错，只会被静默丢弃。
  for (const [index, url] of references.images.entries()) {
    conditioning[`ref_images.ref_image_${index}`] = await addLoadImage(
      workflow, comfyClient, NODE_IDS.refImage(index), url, `AIFISHER 参考图片 ${index + 1}`,
    );
  }
  for (const [index, url] of references.videos.entries()) {
    const loaded = await addLoadVideo(
      workflow, comfyClient, NODE_IDS.refVideo(index), url, `AIFISHER 参考视频 ${index + 1}`,
    );
    conditioning[`ref_videos.ref_video_${index}`] = loaded.images;
    conditioning[`ref_video_audios.ref_video_audio_${index}`] = loaded.audio;
  }
  for (const [index, url] of references.audios.entries()) {
    conditioning[`ref_audios.ref_audio_${index}`] = await addLoadAudio(
      workflow, comfyClient, NODE_IDS.refAudio(index), url, `AIFISHER 参考音频 ${index + 1}`,
    );
  }
}

export async function prepareMiniMaxH3T2VAWorkflow(comfyClient, params) {
  const templatePath = path.join(directory, 'MiniMax-H3-T2VA-api.json');
  const workflow = JSON.parse(await fsp.readFile(templatePath, 'utf8'));
  const mode = MINIMAX_H3_MODES.includes(params.mode)
    ? params.mode
    : (params.imageUrl ? 'ref2va' : 't2va');

  workflow['234'].inputs.value = canonicalizeMiniMaxH3Mentions(params.text);
  workflow['235'].inputs.aspect_ratio = ASPECT_RATIOS[params.aspectRatio] || ASPECT_RATIOS['16:9'];
  workflow['235'].inputs.megapixels = numberOr(params.megapixels, workflow['235'].inputs.megapixels);
  workflow['236'].inputs.value = numberOr(params.duration, workflow['236'].inputs.value);

  // 画布用 -1 表示随机种子。
  const seed = numberOr(params.seed, -1);
  workflow['306'].inputs.noise_seed = seed >= 0 ? seed : Math.floor(Math.random() * 4294967296);

  workflow[CONDITIONING_NODE].inputs.task_type = TASK_TYPES[mode];

  if (mode === 'ref2va') await configureReferences(workflow, comfyClient, params);
  else await configureKeyframes(workflow, comfyClient, params, mode);

  return workflow;
}
