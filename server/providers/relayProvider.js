import { annotateProviderError } from '../telemetry/providerDiagnostics.js';
import { normalizeMidjourneyPrompt } from '../../src/shared/midjourneyPrompt.js';
/**
 * relayProvider.js
 *
 * 「AIFISHER API」生成来源。与官方各家、RunningHub 完全隔离：
 * 独立密钥 `RELAY_API_KEY`、独立地址 `RELAY_BASE_URL`、独立适配器、独立模型条目。
 * 不复用也不改写任何官方模型的地址。
 *
 * 协议要点（来自 api.work-fisher.com 的 llms.txt，非 OpenAI 兼容）：
 * - 异步任务网关：提交拿 task_id → 轮询 → 取媒体直链
 * - 图片状态机是大写的 NOT_START / SUBMITTED / IN_PROGRESS / SUCCESS / FAILURE，
 *   而视频那套是小写的 queued / in_progress / completed / failed——两套不能共用解析
 * - 参考素材必须是公网 HTTP(S) 直链，明确不收 base64、不收文件路径。
 *   画布的素材只在 127.0.0.1 上可见，所以每次都得先过 /v1/files/upload
 * - 结果直链约 24 小时过期且带签名，必须立刻下载转存
 */

import sharp from 'sharp';
import { assertRelayReferenceCounts } from './relayReferenceLimits.js';
import { setTimeout as wait } from 'node:timers/promises';
import { BaseProvider } from './baseProvider.js';
import { buildJsonFetchOptions, submitJsonWithLogs, submitOpenAiChatWithLogs } from './providerKit.js';
import { getSeedreamV5ProDimensions } from '../utils/resolutionMapper.js';
import { matchesRemoteTask, remoteTaskReference } from '../generation/generationTaskRecovery.js';
import { validateRecoveredVideo } from '../media/recoveredVideo.js';

const DEFAULT_BASE_URL = 'https://api.work-fisher.com';
/** 文档建议 3–5 秒。取中间值，既不刷接口也不让用户干等。 */
const POLL_INTERVAL_MS = 4_000;
export const RELAY_QUOTA_PER_CNY = 500_000;

function observeSubmittedRelayTask(config, details) {
  try {
    config?.relayAccountActivity?.submitted?.(details);
  } catch (error) {
    console.warn('[RelayAccount] 无法记录上游任务引用：', error?.message || error);
  }
}

function observeSettledRelayTask(config, receipt) {
  try {
    config?.relayAccountActivity?.settled?.(receipt);
  } catch (error) {
    console.warn('[RelayAccount] 无法记录上游终态结算：', error?.message || error);
  }
}

function relayReceiptTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return relayReceiptTimestamp(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function createRelayFinalReceipt(payload, { localTaskId, upstreamTaskId } = {}) {
  const task = payload?.data && !Array.isArray(payload.data) && typeof payload.data === 'object'
    ? payload.data
    : payload;
  const status = String(task?.status || '').trim().toUpperCase();
  if (!['SUCCESS', 'COMPLETED', 'SUCCEEDED'].includes(status)) return null;
  const expectedTaskId = String(upstreamTaskId || '').trim();
  const actualTaskId = String(task?.task_id || task?.id || '').trim();
  const normalizedLocalTaskId = String(localTaskId || '').trim();
  const safeId = /^[A-Za-z0-9._:-]{1,200}$/u;
  if (
    !safeId.test(expectedTaskId)
    || !safeId.test(actualTaskId)
    || !safeId.test(normalizedLocalTaskId)
    || actualTaskId !== expectedTaskId
  ) return null;
  if (typeof task?.quota !== 'number' &&
    !(typeof task?.quota === 'string' && /^\d+$/.test(task.quota))) return null;
  const quota = Number(task.quota);
  if (!Number.isSafeInteger(quota) || quota < 0) return null;
  const occurredAt = relayReceiptTimestamp(
    task?.finish_time ?? task?.finished_at ?? task?.updated_at,
  );
  if (!occurredAt) return null;
  return {
    receiptId: `relay-task:${actualTaskId}`,
    localTaskId: normalizedLocalTaskId,
    upstreamTaskId: actualTaskId,
    amount: quota / RELAY_QUOTA_PER_CNY,
    currency: 'CNY',
    occurredAt,
    final: true,
  };
}

function observeTerminalRelayReceipt(config, payload, parsed, identifiers) {
  if (!parsed?.done) return;
  const receipt = createRelayFinalReceipt(payload, identifiers);
  if (receipt) observeSettledRelayTask(config, receipt);
}

const IMAGE_TERMINAL_SUCCESS = 'SUCCESS';
const IMAGE_TERMINAL_FAILURE = 'FAILURE';
const GROK_QUALITY_MODEL_IDS = new Set([
  'workfisher-image-gk-v2',
]);
const SEEDREAM_V5_PRO_IMAGE_IDS = /^(?:seedream-v5-pro|dola-seedream-5\.0-pro)-(?:t2i|i2i)$/u;

function normalizeRequestedImageCount(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.max(1, Math.min(maximum, Math.trunc(Number(value) || 1)));
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function readSetting(config, key, fallback = '') {
  const value = config?.[key] ?? process.env[key] ?? fallback;
  return String(value ?? '').trim();
}

export function resolveRelayCredentials(config) {
  const apiKey = readSetting(config, 'RELAY_API_KEY');
  if (!apiKey) {
    throw Object.assign(new Error('AIFISHER API Key 未配置（RELAY_API_KEY）。'), {
      code: 'PROVIDER_CREDENTIAL_MISSING',
      credentialSource: 'aifisher_relay',
    });
  }
  return {
    apiKey,
    baseUrl: trimSlash(readSetting(config, 'RELAY_BASE_URL', DEFAULT_BASE_URL)),
    gateway: false,
  };
}

export function resolveRelayRequestUrl(relay, value) {
  const requestUrl = new URL(String(value || ''));
  return requestUrl.href;
}

/**
 * 提交地址 → 轮询地址。AIFISHER API的查询就是提交路径加 /{task_id}，
 * 直接从已解析的 url 推导，避免再拼一次 base 而与 MODEL_URL 覆盖不一致。
 */
export function buildPollUrl(submitUrl, taskId) {
  return `${trimSlash(submitUrl)}/${encodeURIComponent(taskId)}`;
}

/**
 * 把画布本机素材换成AIFISHER API能访问的公网直链。
 * 已经是公网 http(s) 的原样返回——重复上传只是浪费配额。
 */
export function needsUpload(asset) {
  const value = String(asset || '').trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) {
    return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/i.test(value);
  }
  return true;
}

function assetToBlob(asset) {
  const value = String(asset || '');
  const dataUrl = value.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (dataUrl) {
    const [, mimeType, base64Flag, payload] = dataUrl;
    const buffer = base64Flag
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return { buffer, mimeType: mimeType || 'image/png' };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 512) {
    return { buffer: Buffer.from(value.replace(/\s/g, ''), 'base64'), mimeType: 'image/png' };
  }
  return null;
}

function extensionFor(mimeType) {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
  };
  return map[String(mimeType).toLowerCase()] || 'bin';
}

function imageFormatFromBuffer(buffer, fallback = 'png') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'gif';
  return fallback;
}

export async function uploadRelayAsset({ relay, asset, useProxy, signal, fetchImpl = BaseProvider.fetch }) {
  let payload = assetToBlob(asset);
  if (!payload) {
    // 回环地址的素材：先由本机取回字节，再上传。AIFISHER API抓不到 127.0.0.1。
    let buffer;
    try { buffer = await BaseProvider.asyncDownloadToBuffer(asset, useProxy, { signal }); }
    catch (cause) {
      if (signal?.aborted) throw cause;
      throw annotateProviderError(Object.assign(new Error('参考素材读取失败', { cause }), { code: 'REFERENCE_READ_FAILED' }), { stage: 'local' });
    }
    payload = { buffer, mimeType: BaseProvider.getMimeType(String(asset)) };
  }

  const form = BaseProvider.createFormData();
  form.append(
    'file',
    new Blob([payload.buffer], { type: payload.mimeType }),
    `reference.${extensionFor(payload.mimeType)}`,
  );

  const options = { method: 'POST', headers: { Authorization: `Bearer ${relay.apiKey}` }, body: form, ...(signal ? { signal } : {}) };
  BaseProvider.injectProxy(options, useProxy);
  let response, result;
  try {
    response = await fetchImpl(`${relay.baseUrl}/v1/files/upload`, options);
    result = await response.json();
    if (!response.ok || !result?.url) throw new Error('素材上传未返回公网直链');
    return result.url;
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw annotateProviderError(Object.assign(new Error('AIFISHER API素材上传失败，无法获得公网直链。', { cause }), {
      code: 'REFERENCE_UPLOAD_FAILED', status: response?.status, upstreamStatus: response?.status,
    }), { stage: 'upload', response, payload: result });
  }
}

export async function resolveReferenceUrls({ relay, assets, useProxy, signal, upload = uploadRelayAsset }) {
  const usable = (assets || []).filter((item) => typeof item === 'string' && item.trim());
  const resolved = [];
  for (const asset of usable) {
    resolved.push(needsUpload(asset) ? await upload({ relay, asset, useProxy, ...(signal ? { signal } : {}) }) : asset);
  }
  return resolved;
}

/**
 * 解析图片任务的轮询响应。
 * 结构是两层 data：{ code, data: { status, result_url, data: { content: { image_urls } } } }
 * 刻意不写成 `status || data` 这类兼容多种形状的写法——那会在 data 是对象时
 * 算出 "[OBJECT OBJECT]" 并永远等不到终态。
 */
export function parseImageTaskResult(payload) {
  const task = payload?.data;
  const status = String(task?.status || '').toUpperCase();

  if (status === IMAGE_TERMINAL_FAILURE) {
    const reason = task?.fail_reason || task?.failed_reason || task?.message || payload?.message || '';
    return { error: `AIFISHER API图片任务失败。${reason}`.trim() };
  }
  if (status !== IMAGE_TERMINAL_SUCCESS) return { done: false };

  const content = task?.data?.content || {};
  const urls = [];
  if (Array.isArray(content.image_urls)) urls.push(...content.image_urls);
  if (!urls.length && content.image_url) urls.push(content.image_url);
  if (!urls.length && task.result_url) urls.push(task.result_url);
  if (!urls.length) return { error: 'AIFISHER API图片任务已成功但没有返回图片地址。' };

  return { done: true, data: urls.filter((url) => typeof url === 'string' && url.trim()) };
}

function matchesImageTaskIdentity(payload, taskId) {
  // Relay task_id is the receipt. data.id is a database row ID, and
  // data.data.id belongs to the upstream provider, not this relay task.
  const ids = [payload?.task_id, payload?.data?.task_id].filter((id) => id != null);
  return ids.length > 0 && ids.every((id) => String(id) === taskId);
}

export function parseAudioTaskResult(payload) {
  const task = payload?.data;
  const status = String(task?.status || '').toUpperCase();

  if (status === IMAGE_TERMINAL_FAILURE) {
    const reason = task?.fail_reason || task?.failed_reason || task?.message || payload?.message || '';
    return { error: `AIFISHER API音频任务失败。${reason}`.trim() };
  }
  if (status !== IMAGE_TERMINAL_SUCCESS) return { done: false };

  const content = task?.data?.content || {};
  const urls = [];
  if (Array.isArray(content.audio_urls)) urls.push(...content.audio_urls);
  if (!urls.length && content.audio_url) urls.push(content.audio_url);
  if (!urls.length && task.result_url) urls.push(task.result_url);
  if (!urls.length) return { error: 'AIFISHER API音频任务已成功但没有返回音频地址。' };

  return { done: true, data: urls.filter((url) => typeof url === 'string' && url.trim()) };
}

export function parseMusicTaskResult(payload) {
  const task = payload?.data;
  const status = String(task?.status || '').toLowerCase();
  if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(status)) {
    const reason = task?.error?.message || task?.error || task?.message || payload?.message || '';
    return { error: `AIFISHER API音乐任务失败。${reason}`.trim() };
  }
  if (!['completed', 'success', 'succeeded'].includes(status)) {
    return { done: false, progress: `${task?.progress ?? 0}%` };
  }

  const result = task?.result || {};
  const candidates = [
    ...(Array.isArray(result.music) ? result.music : []),
    ...(Array.isArray(result.stems) ? result.stems : []),
  ];
  const urls = candidates
    .map((item) => item?.audio_url || item?.url)
    .filter((url) => typeof url === 'string' && url.trim());
  if (Array.isArray(result.audio_urls)) urls.push(...result.audio_urls);
  if (!urls.length && result.audio_url) urls.push(result.audio_url);
  if (!urls.length) return { error: 'AIFISHER API音乐任务已成功但没有返回音频地址。' };
  return { done: true, data: urls };
}

export function parseMidjourneyTaskResult(payload) {
  const task = payload?.data || payload;
  const status = String(task?.status || '').toUpperCase();
  if (['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(status)) {
    const reason = task?.error?.message || task?.error || task?.fail_reason || task?.message || '';
    return { error: `AIFISHER API Midjourney 任务失败。${reason}`.trim() };
  }
  if (!['SUCCESS', 'COMPLETED', 'SUCCEEDED'].includes(status)) {
    return { done: false, progress: `${task?.progress ?? 0}%` };
  }

  const urls = [];
  if (Array.isArray(task.image_urls)) urls.push(...task.image_urls);
  if (!urls.length && task.grid_image_url) urls.push(task.grid_image_url);
  if (!urls.length && task.image_url) urls.push(task.image_url);
  if (!urls.length && task.result_url) urls.push(task.result_url);
  if (!urls.length) return { error: 'AIFISHER API Midjourney 任务已成功但没有返回图片地址。' };
  return { done: true, data: urls.filter((url) => typeof url === 'string' && url.trim()) };
}

function definedEntries(source, keys) {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined && source[key] !== null && source[key] !== '')
      .map((key) => [key, source[key]]),
  );
}

export function buildAudioRequestBody({ modelId, prompt, images, audios, params }) {
  const body = { model: modelId, prompt: String(prompt || '').trim() };
  const metadata = {};

  if (modelId === 'doubao-seed-audio-1.0') {
    Object.assign(metadata, definedEntries(params, [
      'format', 'sample_rate', 'speaker', 'speech_rate', 'loudness_rate', 'pitch_rate',
    ]));
    if (images.length) body.images = images.slice(0, 1);
    if (audios.length) metadata.audio_urls = audios.slice(0, 3);
  } else if (modelId === 'minimax-voice-clone') {
    if (!audios.length) throw new Error('MiniMax Voice Clone 至少需要一条参考音频。');
    Object.assign(metadata, definedEntries(params, [
      'custom_voice_id', 'accuracy', 'need_noise_reduction', 'need_volume_normalization',
      'tts_model', 'language_boost',
    ]));
    metadata.audio_url = audios[0];
  } else if (modelId === 'qwen3-tts-flash') {
    Object.assign(metadata, definedEntries(params, ['voice', 'language_type']));
  }

  if (Object.keys(metadata).length) body.metadata = metadata;
  return body;
}

export function buildMusicRequestBody({ modelId, prompt, params }) {
  if (modelId === 'suno-stems') {
    if (!params.task_id) throw new Error('Suno Stems 需要原始 Suno task_id。');
    return {
      model: 'suno',
      task_id: String(params.task_id).trim(),
      audio_index: Math.max(1, Number(params.audio_index) || 1),
    };
  }
  return {
    model: 'suno',
    prompt: String(prompt || '').trim(),
    ...definedEntries(params, [
      'version', 'custom', 'instrumental', 'title', 'style', 'vocal_gender',
    ]),
  };
}

export function buildMidjourneyRequestBody({
  prompt,
  aspectRatio,
  references,
  referenceRoles = {},
  params,
}) {
  const nativeParams = String(params?.quality || '').toLowerCase() === 'auto'
    ? { ...params, quality: '1' }
    : params;
  const body = {
    prompt: normalizeMidjourneyPrompt(prompt),
    size: aspectRatio && aspectRatio !== 'Auto' ? aspectRatio : '1:1',
    ...definedEntries(nativeParams, [
      'version', 'speed', 'quality', 'seed', 'stylize', 'chaos', 'weird', 'tile', 'niji',
      'iw', 'cw', 'sw', 'negative_prompt', 'dw', 'raw',
      'draft', 'hd', 'stop',
    ]),
  };
  if (references.length) body.image_urls = references.slice(0, 10);
  for (const role of ['cref', 'sref', 'dref']) {
    const value = referenceRoles?.[role];
    if (typeof value === 'string' && value.trim()) body[role] = value;
  }
  return body;
}

export function buildImageRequestBody({ modelId, prompt, references, resolution, aspectRatio, count, params = {} }) {
  assertRelayReferenceCounts(modelId, 'image', { images: references }, params.imageMode);
  const image25 = /^(?:workfisher-image-g-v2\.5-|zhenzhen-image-g-v2\.5-)(lowprice|flare|sunburst)$/.exec(modelId);
  if (image25) {
    const lowprice = image25[1] === 'lowprice';
    const normalizedPrompt = String(prompt || '').trim();
    if (lowprice && normalizedPrompt.length > 5000) throw new Error('GPT Image 2.5 低价扩展版提示词最多 5000 字符');
    if (references.length > (lowprice ? 15 : 16)) throw new Error('GPT Image 2.5 参考图片数量超出模型限制');
    if (lowprice && count > 1) throw new Error('GPT Image 2.5 低价扩展版每个任务只支持 1 张图片');
    const body = {
      model: modelId, prompt: normalizedPrompt, n: count || 1,
      resolution: String(resolution || '1K').toLowerCase(),
      ...(aspectRatio && aspectRatio !== 'Auto' ? { size: aspectRatio } : {}),
      ...(references.length ? { images: references } : {}),
    };
    if (!lowprice) {
      const options = {
        quality: ['low', 'auto', 'medium', 'high', 'xhigh', 'max'],
        output_format: ['png', 'jpeg', 'webp'],
        background: ['auto', 'transparent', 'opaque'],
        moderation: ['low', 'auto'],
      };
      for (const [key, values] of Object.entries(options)) {
        const value = params[key] ?? values[0];
        if (!values.includes(value)) throw new Error(`GPT Image 2.5 参数 ${key} 无效`);
        body[key] = value;
      }
      if (body.output_format === 'jpeg' && body.background === 'transparent') {
        throw new Error('透明背景请选择 PNG 或 WebP 格式');
      }
      if (body.output_format !== 'png' && params.output_compression != null) {
        const compression = Number(params.output_compression);
        if (!Number.isInteger(compression) || compression < 0 || compression > 100) throw new Error('输出压缩质量须为 0–100 的整数');
        body.output_compression = compression;
      }
    }
    return body;
  }
  const metadata = { output_format: 'png' };
  if (resolution && resolution !== 'Auto') {
    metadata.resolution = GROK_QUALITY_MODEL_IDS.has(modelId)
      ? 'quality'
      : String(resolution).toLowerCase();
  }
  if (aspectRatio && aspectRatio !== 'Auto') metadata.ratio = aspectRatio;

  const dimensions = SEEDREAM_V5_PRO_IMAGE_IDS.test(modelId)
    ? getSeedreamV5ProDimensions(resolution, aspectRatio)
    : null;
  if (dimensions) metadata.size = `${dimensions.width}x${dimensions.height}`;

  const normalizedPrompt = String(prompt || '').trim();
  const outputSpecification = dimensions
    ? `输出规格：${dimensions.width}×${dimensions.height} 像素，严格保持 ${aspectRatio}。`
    : '';
  const body = {
    model: modelId,
    prompt: outputSpecification ? `${normalizedPrompt}\n\n${outputSpecification}` : normalizedPrompt,
    metadata,
  };
  if (references.length) body.images = references;
  if (count > 1) body.n = count;
  return body;
}

/**
 * 解析视频任务的轮询响应。
 *
 * **不能复用图片那套。** 两条链路的状态机连大小写都不一样：
 * 图片是大写的 `SUCCESS`/`FAILURE`、结果埋在两层 data 里；
 * 视频是小写的 `queued`/`in_progress`/`completed`/`failed`、结果在 `metadata.url`。
 * 混用的结果是永远等不到终态，一直轮询到超时。
 */
export function parseVideoTaskResult(payload) {
  const status = String(payload?.status || '').toLowerCase();

  if (status === 'failed') {
    const reason = payload?.error?.message || payload?.error?.code || '';
    return { error: `AIFISHER API视频任务失败。${reason}`.trim() };
  }
  if (status !== 'completed') return { done: false, progress: `${payload?.progress ?? 0}%` };

  const url = payload?.metadata?.url;
  if (!url) return { error: 'AIFISHER API视频任务已成功但没有返回视频地址。' };
  return { done: true, data: [url] };
}

/**
 * 视频请求体。
 *
 * 模型名的后缀就是任务类型：`-t2v` 文生 / `-i2v` 图生 / `-r2v` 参考图 / `-multi` 多模态。
 * 素材的位置随类型变：`-i2v` 走顶层 `images`（1 张首帧、2 张时第 2 张是尾帧），
 * `-multi` 走 `metadata.content` 数组。**两者不能同时传**——文档写明
 * `metadata.content` 会整体覆盖顶层 `images`，混着传等于把首帧悄悄丢了。
 */
// 各中转扩展视频模型能收的参考图张数——上游按张数判模式，超了会被当成另一种模式。
// v31-lite 不在表里：它禁止传 images，落不到这个分支正是想要的行为。
const WORKFISHER_VIDEO_IMAGE_CAP = [
  [/-g-omni(-|$)/, 16],
  [/-gk-v15$/, 7],
  [/-v31-(fast|quality)$/, 3],
];

export function buildVideoRequestBody({
  modelId,
  prompt,
  seconds,
  resolution,
  aspectRatio,
  images,
  videos,
  audios,
  generateAudio,
  seed,
  returnLastFrame,
}) {
  const metadata = {};
  assertRelayReferenceCounts(modelId, 'video', { images, videos, audios });
  if (resolution && resolution !== 'Auto') metadata.resolution = String(resolution).toLowerCase();
  if (aspectRatio && aspectRatio !== 'Auto') metadata.ratio = aspectRatio;
  if (generateAudio !== undefined) metadata.generate_audio = Boolean(generateAudio);
  if (seed !== undefined && seed !== '') metadata.seed = Number(seed);
  if (returnLastFrame !== undefined) metadata.return_last_frame = Boolean(returnLastFrame);

  const body = { model: modelId, prompt: String(prompt || '').trim() };
  // seconds 是字符串类型，不是数字——按数字传会被拒。
  if (seconds) body.seconds = String(seconds);

  const workfisherCap = WORKFISHER_VIDEO_IMAGE_CAP.find(([pattern]) => pattern.test(modelId))?.[1];
  if (workfisherCap) {
    // 中转扩展视频模型不遵守 -i2v/-multi 那套后缀约定：参考图一律走顶层 images。
    // 上游靠张数区分模式（v31-fast 传 3 张就是多图参考），所以张数上限必须按模型钉死。
    if (images.length > workfisherCap) throw new Error(`当前模型最多支持 ${workfisherCap} 张参考图片`);
    if (images.length) body.images = images;
    // 只有 g-omni 收待编辑视频，且只收一条。
    if (/-g-omni(-|$)/.test(modelId) && videos.length) metadata.video_url = videos[0];
  } else if (/-multi$/.test(modelId)) {
    const content = [
      ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ...videos.map((url) => ({ type: 'video_url', video_url: { url } })),
      ...audios.map((url) => ({ type: 'audio_url', audio_url: { url } })),
    ];
    if (!content.length) throw new Error('AIFISHER API多模态视频至少需要一个参考素材。');
    metadata.content = content;
  } else if (/-r2v(?:-fast)?$/.test(modelId)) {
    if (!images.length) throw new Error('AIFISHER API参考生视频需要至少一张输入图片。');
    body.images = images;
  } else if (/-i2v(?:-fast)?$/.test(modelId)) {
    if (!images.length) throw new Error('AIFISHER API图生视频需要至少一张输入图片。');
    if (images.length > 2) throw new Error('首尾帧模式最多支持 2 张图片');
    body.images = images;
  }

  if (Object.keys(metadata).length) body.metadata = metadata;
  return body;
}

export const RelayVideoProvider = {
  canRecoverVideo(reference, params, config) {
    try {
      return matchesRemoteTask(reference, {
        providerName: 'RelayVideoProvider', modelId: params.videoModel,
        submitUrl: params.url, apiKey: resolveRelayCredentials(config).apiKey,
      });
    } catch {
      return false;
    }
  },

  async recoverVideo(reference, params, config, signal) {
    if (!RelayVideoProvider.canRecoverVideo(reference, params, config)) return { status: 'unknown' };
    const relay = resolveRelayCredentials(config);
    const options = {
      method: 'GET', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      headers: { Authorization: `Bearer ${relay.apiKey}` },
    };
    BaseProvider.injectProxy(options, params.useProxy);
    const response = await BaseProvider.fetch(buildPollUrl(new URL(params.url).href, reference.taskId), options);
    if (!response.ok) return { status: 'unknown' };
    const payload = await response.json();
    // Some deployments omit the echoed ID. A conflicting ID is never accepted.
    if ([payload?.id, payload?.task_id].some((id) => id != null && String(id) !== reference.taskId)) {
      return { status: 'unknown' };
    }
    if (String(payload?.status).toLowerCase() === 'failed') return { status: 'failed' };
    const parsed = parseVideoTaskResult(payload);
    if (!parsed.done) return { status: parsed.error ? 'unknown' : 'pending' };
    if (!RelayVideoProvider.canRecoverVideo(reference, params, config)) return { status: 'unknown' };
    const mediaUrl = new URL(parsed.data[0]);
    if (!['https:', 'http:'].includes(mediaUrl.protocol) || mediaUrl.username || mediaUrl.password) {
      return { status: 'unknown' };
    }
    // Media requests never carry the provider Authorization header.
    const mediaOptions = { signal };
    BaseProvider.injectProxy(mediaOptions, params.useProxy);
    const media = await BaseProvider.fetch(mediaUrl.href, mediaOptions);
    if (!media.ok) return { status: 'unknown' };
    const buffer = Buffer.from(await media.arrayBuffer());
    if (!buffer.length || !RelayVideoProvider.canRecoverVideo(reference, params, config)) return { status: 'unknown' };
    const verified = await validateRecoveredVideo(buffer, signal);
    observeTerminalRelayReceipt(config, payload, parsed, {
      localTaskId: params.nodeId, upstreamTaskId: reference.taskId,
    });
    return { status: 'success', buffer, format: verified.format };
  },

  async generateVideo(params, config) {
    const relay = resolveRelayCredentials(config);
    const { nodeId, prompt, resolution, aspectRatio, videoModel, duration, projectId } = params;
    const logsDir = config?.LOGS_DIR;

    // 参考素材必须是公网直链——画布的素材只在 127.0.0.1 上可见，得先过 /v1/files/upload。
    const assets = BaseProvider.getAssets(params);
    assertRelayReferenceCounts(videoModel, 'video', assets, params.videoMode);
    const [images, videos, audios] = await Promise.all([
      resolveReferenceUrls({ relay, assets: assets.images, useProxy: params.useProxy, signal: params.signal }),
      resolveReferenceUrls({ relay, assets: assets.videos, useProxy: params.useProxy, signal: params.signal }),
      resolveReferenceUrls({ relay, assets: assets.audios, useProxy: params.useProxy, signal: params.signal }),
    ]);

    const body = buildVideoRequestBody({
      modelId: videoModel,
      prompt,
      seconds: duration,
      resolution,
      aspectRatio,
      images,
      videos,
      audios,
      generateAudio: params.generate_audio,
      seed: params.seed,
      returnLastFrame: params.return_last_frame,
    });

    const submitUrl = resolveRelayRequestUrl(relay, params.url);
    params.signal?.throwIfAborted();
    config?.generationTaskSubmitting?.();
    let submitted;
    try {
      submitted = await submitJsonWithLogs({
        url: submitUrl,
        fetchOptions: { ...buildJsonFetchOptions({
          headers: { Authorization: `Bearer ${relay.apiKey}` },
          body,
          signal: params.signal,
        }), redirect: 'error' },
        nodeId,
        logsDir,
        modelId: videoModel,
        projectId,
        useProxy: params.useProxy,
        logBody: body,
        maxAttempts: 1,
      });
    } catch (error) {
      // A lost submission response does not prove that no paid task was created.
      if (![400, 401, 402, 403, 404, 422, 429].includes(error?.status)) error.submissionUncertain = true;
      throw error;
    }

    // 视频提交返回的是 `id`，不是图片那条链路的 `task_id`。
    const taskId = submitted?.id || submitted?.task_id;
    config?.generationTaskSubmitted?.(remoteTaskReference({
      taskId, providerName: 'RelayVideoProvider', modelId: videoModel, submitUrl, apiKey: relay.apiKey,
    }));
    if (!taskId) throw new Error('AIFISHER API没有返回任务 ID，无法轮询结果。');
    observeSubmittedRelayTask(config, {
      localTaskId: nodeId,
      upstreamTaskId: taskId,
      model: videoModel,
      kind: 'video',
      estimatedCost: params.cost,
    });

    const pollUrl = buildPollUrl(submitUrl, taskId);
    const urls = await BaseProvider.pollTask({
      taskId,
      interval: POLL_INTERVAL_MS,
      // 视频比图片慢得多，超时跟着模型自己报的耗时走，别拿图片那套 10min 卡死。
      timeoutMs: BaseProvider.parseTimeToMs(params.timeEstimate || '15min'),
      pollFn: async () => {
        params.signal?.throwIfAborted();
        const options = { headers: { Authorization: `Bearer ${relay.apiKey}` }, signal: params.signal };
        BaseProvider.injectProxy(options, params.useProxy);
        const response = await BaseProvider.fetch(pollUrl, options);
        if (!response.ok) {
          // Gateways may return HTML; check HTTP before decoding a task payload.
          await response.body?.cancel().catch(() => undefined);
          const error = Object.assign(new Error(`AIFISHER API任务查询失败：HTTP ${response.status}`), {
            status: response.status, upstreamStatus: response.status,
          });
          if (BaseProvider.isRetryablePollHttpStatus(response.status)) {
            return { error: error.message, retryable: true };
          }
          throw annotateProviderError(error, { stage: 'poll', response, taskId });
        }
        let payload;
        try { payload = await response.json(); }
        catch (cause) {
          if (params.signal?.aborted) throw cause;
          throw annotateProviderError(Object.assign(new Error('AIFISHER API视频任务查询返回无效响应。'), {
            code: 'INVALID_JSON_RESPONSE', upstreamStatus: response.status,
          }), { stage: 'poll', response, taskId });
        }
        BaseProvider.saveDebugLog(logsDir, 'RELAY_VIDEO_POLL_RES', nodeId, payload, projectId);
        const parsed = parseVideoTaskResult(payload);
        if (String(payload?.status).toLowerCase() === 'failed') {
          throw annotateProviderError(Object.assign(new Error(parsed.error), {
            providerTaskFailed: true, upstreamStatus: response.status,
            ...(typeof payload?.error?.code === 'string' ? { code: payload.error.code.slice(0, 100) } : {}),
          }), { stage: 'poll', response, payload, taskId, requestBody: body });
        }
        observeTerminalRelayReceipt(config, payload, parsed, {
          localTaskId: nodeId,
          upstreamTaskId: taskId,
        });
        return parsed;
      },
    });

    // 结果直链带签名且很快过期，必须立刻取回本地。
    const downloaded = await Promise.all(
      urls.map(async (url) => ({
        buffer: await downloadCompletedRelayVideo(url, params.useProxy, params.signal),
        format: 'mp4',
      })),
    );
    return downloaded.length === 1 ? downloaded[0] : downloaded;
  },
};

export async function downloadCompletedRelayVideo(url, useProxy, signal) {
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await BaseProvider.asyncDownloadToBuffer(url, useProxy, { signal });
    } catch (error) {
      const transient = BaseProvider.isRetryableNetworkError(error)
        || ['EAI_AGAIN', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error?.cause?.code)
        || (error instanceof TypeError && error.message === 'fetch failed');
      if (!transient || attempt >= 2 || signal?.aborted) throw error;
      // Only retry GET for this completed result. Never replay the paid submission.
      await wait(250 * (attempt + 1), undefined, { signal });
    }
  }
}

export const RelayImageProvider = {
  canRecoverImage(reference, params, config) {
    try {
      return matchesRemoteTask(reference, {
        providerName: 'RelayImageProvider', modelId: params.imageModel,
        submitUrl: params.url, apiKey: resolveRelayCredentials(config).apiKey,
      });
    } catch { return false; }
  },

  async recoverImage(task, params, config, signal) {
    const references = task.remoteTasks || [];
    // A submitted task without its receipt may still be billed. Never guess its identity.
    if (!Number.isSafeInteger(task.requestedCount) || task.requestedCount < 1
      || !Array.isArray(references) || !references.length || references.length !== task.remoteSubmissionCount
      || references.some((ref) => !RelayImageProvider.canRecoverImage(ref, params, config))) return { status: 'unknown' };
    const relay = resolveRelayCredentials(config);
    const urls = [];
    let failureError;
    for (let slot = 0; slot < references.length; slot += 1) {
      const reference = references[slot];
      if (!RelayImageProvider.canRecoverImage(reference, params, config)) return { status: 'unknown' };
      const options = {
        method: 'GET', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        headers: { Authorization: `Bearer ${relay.apiKey}` },
      };
      BaseProvider.injectProxy(options, params.useProxy);
      const response = await BaseProvider.fetch(buildPollUrl(new URL(params.url).href, reference.taskId), options);
      if (!response.ok) return { status: 'unknown', reason: [401, 403].includes(response.status) ? 'query_auth_failed' : 'query_unavailable' };
      const payload = await response.json();
      if (!matchesImageTaskIdentity(payload, reference.taskId)) return { status: 'unknown', reason: 'task_mismatch' };
      const parsed = parseImageTaskResult(payload);
      if (String(payload?.data?.status).toUpperCase() === 'FAILURE') {
        failureError ||= new Error(parsed.error);
        continue;
      }
      if (!parsed.done) return { status: !parsed.error && ['NOT_START', 'SUBMITTED', 'IN_PROGRESS'].includes(String(payload?.data?.status).toUpperCase()) ? 'pending' : 'unknown' };
      if (!parsed.data.length) return { status: 'unknown' };
      for (const url of parsed.data) if (!urls.includes(url)) urls.push(url);
      observeTerminalRelayReceipt(config, payload, parsed, {
        localTaskId: task.requestedCount === 1 ? params.nodeId : `${params.nodeId}:${slot + 1}`,
        upstreamTaskId: reference.taskId,
      });
    }
    if (!urls.length) return { status: 'failed', error: failureError };
    const results = [];
    for (const url of urls.slice(0, task.requestedCount)) {
      if (!references.every((ref) => RelayImageProvider.canRecoverImage(ref, params, config))) return { status: 'unknown' };
      const mediaUrl = new URL(url);
      if (!['https:', 'http:'].includes(mediaUrl.protocol) || mediaUrl.username || mediaUrl.password) return { status: 'unknown' };
      const options = { signal };
      BaseProvider.injectProxy(options, params.useProxy);
      const response = await BaseProvider.fetch(mediaUrl.href, options);
      if (!response.ok) return { status: 'unknown' };
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > 50 * 1024 * 1024) return { status: 'unknown' };
      const image = sharp(buffer, { failOn: 'warning' });
      const metadata = await image.metadata();
      if (!['png', 'jpeg', 'webp', 'gif', 'tiff', 'avif'].includes(metadata.format)) return { status: 'unknown' };
      await image.stats();
      signal.throwIfAborted();
      results.push({ buffer, format: metadata.format === 'jpeg' ? 'jpg' : metadata.format });
    }
    return { status: results.length >= task.requestedCount ? 'success' : 'partial', results };
  },

  async generateImage(params, config) {
    const relay = resolveRelayCredentials(config);
    const { nodeId, prompt, resolution, aspectRatio, imageModel, generateCount, projectId } = params;
    const logsDir = config?.LOGS_DIR;

    const { images } = BaseProvider.getAssets(params);
    assertRelayReferenceCounts(imageModel, 'image', { images }, params.imageMode);
    const references = await resolveReferenceUrls({
      relay,
      assets: images,
      useProxy: params.useProxy,
      signal: params.signal,
    });

    const submitUrl = resolveRelayRequestUrl(relay, params.url);
    const requestedCount = normalizeRequestedImageCount(generateCount);
    // Submit explicit user-requested tasks with n=1, respecting every route's per-task limit,
    // until enough unique results arrive. A task that returns multiple images fills several
    // slots at once, so the loop stops without creating unnecessary paid tasks.
    const taskCount = requestedCount;
    const bodyCount = 1;
    const totalEstimatedCost = Number(params.cost);
    const estimatedCostPerTask = Number.isFinite(totalEstimatedCost)
      ? Math.round((totalEstimatedCost / taskCount) * 1_000_000) / 1_000_000
      : params.cost;
    const resultUrls = [];

    for (let taskIndex = 0; taskIndex < taskCount && resultUrls.length < requestedCount; taskIndex += 1) {
      const body = buildImageRequestBody({
        modelId: imageModel,
        prompt,
        references,
        resolution,
        aspectRatio,
        count: bodyCount,
        params,
      });
      params.signal?.throwIfAborted();
      config?.generationTaskSubmitting?.(taskIndex);
      let submitted;
      try {
        submitted = await submitJsonWithLogs({
          url: submitUrl,
          fetchOptions: { ...buildJsonFetchOptions({
            headers: { Authorization: `Bearer ${relay.apiKey}` },
            body,
            signal: params.signal,
          }), redirect: 'error' },
          nodeId,
          logsDir,
          modelId: imageModel,
          projectId,
          useProxy: params.useProxy,
          logBody: body,
          maxAttempts: 1,
          singleAttempt: config?.AIFISHER_SINGLE_SUBMIT_ATTEMPT === true,
        });
      } catch (error) {
        if (![400, 401, 402, 403, 404, 422, 429].includes(error?.status)) error.submissionUncertain = true;
        else config?.generationTaskSubmissionRejected?.(taskIndex);
        throw error;
      }

      const taskId = submitted?.task_id || submitted?.id;
      config?.generationTaskSubmitted?.(remoteTaskReference({
        taskId, providerName: 'RelayImageProvider', modelId: imageModel, submitUrl, apiKey: relay.apiKey,
      }), taskIndex);
      if (!taskId) throw new Error('AIFISHER API没有返回任务 ID，无法轮询结果。');
      const localTaskId = taskCount === 1 ? nodeId : `${nodeId}:${taskIndex + 1}`;
      observeSubmittedRelayTask(config, {
        localTaskId,
        upstreamTaskId: taskId,
        model: imageModel,
        kind: 'image',
        estimatedCost: estimatedCostPerTask,
      });

      const pollUrl = buildPollUrl(submitUrl, taskId);
      const urls = await BaseProvider.pollTask({
      taskId,
        interval: POLL_INTERVAL_MS,
        timeoutMs: BaseProvider.parseTimeToMs(params.timeEstimate || '10min'),
        pollFn: async () => {
          params.signal?.throwIfAborted();
          const options = { headers: { Authorization: `Bearer ${relay.apiKey}` }, signal: params.signal };
          BaseProvider.injectProxy(options, params.useProxy);
          const response = await BaseProvider.fetch(pollUrl, options);
          let payload;
          try { payload = await response.json(); }
          catch (cause) {
            throw annotateProviderError(Object.assign(new Error('AIFISHER API任务查询返回无效响应。', { cause }), {
              code: 'INVALID_JSON_RESPONSE', upstreamStatus: response.status,
            }), { stage: 'poll', response, taskId });
          }
          BaseProvider.saveDebugLog(logsDir, 'RELAY_IMAGE_POLL_RES', nodeId, payload, projectId);
          if (!response.ok) throw annotateProviderError(Object.assign(new Error(`AIFISHER API任务查询失败：HTTP ${response.status}`), { status: response.status }), { stage: 'poll', response, payload, taskId });
          if (!matchesImageTaskIdentity(payload, String(taskId))) throw annotateProviderError(new Error('AIFISHER API返回的任务编号无法核对。'), { stage: 'poll', response, taskId });
          const parsed = parseImageTaskResult(payload);
          if (String(payload?.data?.status).toUpperCase() === 'FAILURE') {
            throw annotateProviderError(Object.assign(new Error(parsed.error), { providerTaskFailed: true }), {
              stage: 'poll', response, taskId, requestBody: body,
              payload: { error: { code: payload?.data?.error?.code, message: payload?.data?.fail_reason || payload?.data?.failed_reason || payload?.data?.message || payload?.message } },
            });
          }
          observeTerminalRelayReceipt(config, payload, parsed, {
            localTaskId,
            upstreamTaskId: taskId,
          });
          return parsed;
        },
      });
      for (const url of urls) {
        if (!resultUrls.includes(url)) resultUrls.push(url);
        if (resultUrls.length >= requestedCount) break;
      }
    }

    // 结果直链约 24 小时过期，必须立刻取回本地，不能把签名地址存进素材库。
    const downloaded = await Promise.all(
      resultUrls.slice(0, requestedCount).map(async (url) => {
        const buffer = await BaseProvider.asyncDownloadToBuffer(url, params.useProxy);
        return { buffer, format: imageFormatFromBuffer(buffer, 'png') };
      }),
    );
    return downloaded.length === 1 ? downloaded[0] : downloaded;
  },
};

function formatFromUrl(url, fallback) {
  const pathname = String(url || '').split('?')[0];
  const extension = pathname.includes('.') ? pathname.split('.').pop().toLowerCase() : '';
  return /^[a-z0-9]{2,5}$/.test(extension) ? extension : fallback;
}

async function downloadRelayResults(urls, useProxy, fallbackFormat, signal) {
  signal?.throwIfAborted();
  return Promise.all(
    urls.map(async (url) => ({
      buffer: await BaseProvider.asyncDownloadToBuffer(url, useProxy, { signal }),
      format: formatFromUrl(url, fallbackFormat),
    })),
  );
}

export const RelayAudioProvider = {
  async generateAudio(params, config) {
    params.signal?.throwIfAborted();
    const relay = resolveRelayCredentials(config);
    const { nodeId, prompt, audioModel, projectId } = params;
    const logsDir = config?.LOGS_DIR;
    const assets = BaseProvider.getAssets(params);
    assertRelayReferenceCounts(audioModel, 'audio', assets, params.audioMode);
    const [images, audios] = await Promise.all([
      resolveReferenceUrls({ relay, assets: assets.images, useProxy: params.useProxy, signal: params.signal }),
      resolveReferenceUrls({ relay, assets: assets.audios, useProxy: params.useProxy, signal: params.signal }),
    ]);
    const body = buildAudioRequestBody({ modelId: audioModel, prompt, images, audios, params });
    const submitUrl = resolveRelayRequestUrl(relay, params.url);
    params.signal?.throwIfAborted();
    const submitted = await submitJsonWithLogs({
      maxAttempts: 1,
      url: submitUrl,
      fetchOptions: buildJsonFetchOptions({
        headers: { Authorization: `Bearer ${relay.apiKey}` },
        body,
        signal: params.signal,
      }),
      nodeId,
      logsDir,
      modelId: audioModel,
      projectId,
      useProxy: params.useProxy,
      logBody: body,
    });
    const taskId = submitted?.task_id || submitted?.id;
    if (!taskId) throw new Error('AIFISHER API没有返回音频任务 ID，无法轮询结果。');
    observeSubmittedRelayTask(config, {
      localTaskId: nodeId,
      upstreamTaskId: taskId,
      model: audioModel,
      kind: 'audio',
      estimatedCost: params.cost,
    });

    const urls = await BaseProvider.pollTask({
      taskId,
      interval: POLL_INTERVAL_MS,
      timeoutMs: BaseProvider.parseTimeToMs(params.timeEstimate || '10min'),
      pollFn: async () => {
        params.signal?.throwIfAborted();
        const options = { headers: { Authorization: `Bearer ${relay.apiKey}` }, signal: params.signal };
        BaseProvider.injectProxy(options, params.useProxy);
        const response = await BaseProvider.fetch(buildPollUrl(submitUrl, taskId), options);
        const payload = await response.json();
        BaseProvider.saveDebugLog(logsDir, 'RELAY_AUDIO_POLL_RES', nodeId, payload, projectId);
        if (!response.ok) return { error: `AIFISHER API音频任务查询失败：${response.statusText}` };
        const parsed = parseAudioTaskResult(payload);
        observeTerminalRelayReceipt(config, payload, parsed, {
          localTaskId: nodeId,
          upstreamTaskId: taskId,
        });
        return parsed;
      },
    });
    const downloaded = await downloadRelayResults(urls, params.useProxy, params.format || 'mp3', params.signal);
    return downloaded.length === 1 ? downloaded[0] : downloaded;
  },
};

export const RelayMusicProvider = {
  async generateAudio(params, config) {
    params.signal?.throwIfAborted();
    const relay = resolveRelayCredentials(config);
    const { nodeId, prompt, audioModel, projectId } = params;
    const logsDir = config?.LOGS_DIR;
    const body = buildMusicRequestBody({ modelId: audioModel, prompt, params });
    const submitUrl = resolveRelayRequestUrl(relay, params.url);
    params.signal?.throwIfAborted();
    const submitted = await submitJsonWithLogs({
      maxAttempts: 1,
      url: submitUrl,
      fetchOptions: buildJsonFetchOptions({
        headers: { Authorization: `Bearer ${relay.apiKey}` },
        body,
        signal: params.signal,
      }),
      nodeId,
      logsDir,
      modelId: audioModel,
      projectId,
      useProxy: params.useProxy,
      logBody: body,
    });
    const taskId = submitted?.data?.[0]?.task_id || submitted?.task_id || submitted?.id;
    if (!taskId) throw new Error('AIFISHER API没有返回音乐任务 ID，无法轮询结果。');
    observeSubmittedRelayTask(config, {
      localTaskId: nodeId,
      upstreamTaskId: taskId,
      model: audioModel,
      kind: 'audio',
      estimatedCost: params.cost,
    });

    const pollUrl = `${relay.baseUrl}/v1/music/tasks/${encodeURIComponent(taskId)}`;
    const urls = await BaseProvider.pollTask({
      taskId,
      interval: POLL_INTERVAL_MS,
      timeoutMs: BaseProvider.parseTimeToMs(params.timeEstimate || '10min'),
      pollFn: async () => {
        params.signal?.throwIfAborted();
        const options = { headers: { Authorization: `Bearer ${relay.apiKey}` }, signal: params.signal };
        BaseProvider.injectProxy(options, params.useProxy);
        const response = await BaseProvider.fetch(pollUrl, options);
        const payload = await response.json();
        BaseProvider.saveDebugLog(logsDir, 'RELAY_MUSIC_POLL_RES', nodeId, payload, projectId);
        if (!response.ok) return { error: `AIFISHER API音乐任务查询失败：${response.statusText}` };
        const parsed = parseMusicTaskResult(payload);
        observeTerminalRelayReceipt(config, payload, parsed, {
          localTaskId: nodeId,
          upstreamTaskId: taskId,
        });
        return parsed;
      },
    });
    const downloaded = await downloadRelayResults(urls, params.useProxy, 'mp3', params.signal);
    return downloaded.length === 1 ? downloaded[0] : downloaded;
  },
};

export const RelayMidjourneyProvider = {
  async generateImage(params, config) {
    params.signal?.throwIfAborted();
    const relay = resolveRelayCredentials(config);
    const { nodeId, prompt, aspectRatio, projectId } = params;
    const logsDir = config?.LOGS_DIR;
    const { images } = BaseProvider.getAssets(params);
    const requestedRoles = params?.midjourneyReferences
      && typeof params.midjourneyReferences === 'object'
      && !Array.isArray(params.midjourneyReferences)
      ? params.midjourneyReferences
      : {};
    const roleAssets = Object.fromEntries(
      ['cref', 'sref', 'dref']
        .map((role) => [role, requestedRoles[role]])
        .filter(([, value]) => typeof value === 'string' && value.trim()),
    );
    const specialisedAssets = new Set(Object.values(roleAssets));
    const references = await resolveReferenceUrls({
      relay,
      assets: images.filter((asset) => !specialisedAssets.has(asset)),
      useProxy: params.useProxy,
      signal: params.signal,
    });
    const referenceRoles = {};
    for (const [role, asset] of Object.entries(roleAssets)) {
      const [resolved] = await resolveReferenceUrls({
        relay,
        assets: [asset],
        useProxy: params.useProxy,
        signal: params.signal,
      });
      if (resolved) referenceRoles[role] = resolved;
    }
    const body = buildMidjourneyRequestBody({
      prompt,
      aspectRatio,
      references,
      referenceRoles,
      params,
    });
    const submitUrl = resolveRelayRequestUrl(relay, params.url);
    params.signal?.throwIfAborted();
    const submitted = await submitJsonWithLogs({
      maxAttempts: 1,
      url: submitUrl,
      fetchOptions: buildJsonFetchOptions({
        headers: { Authorization: `Bearer ${relay.apiKey}` },
        body,
        signal: params.signal,
      }),
      nodeId,
      logsDir,
      modelId: 'midjourney-imagine',
      projectId,
      useProxy: params.useProxy,
      logBody: body,
    });
    const taskId = submitted?.data?.[0]?.task_id || submitted?.task_id || submitted?.id;
    if (!taskId) throw new Error('AIFISHER API没有返回 Midjourney 任务 ID，无法轮询结果。');
    observeSubmittedRelayTask(config, {
      localTaskId: nodeId,
      upstreamTaskId: taskId,
      model: 'midjourney-imagine',
      kind: 'image',
      estimatedCost: params.cost,
    });

    const pollUrl = `${relay.baseUrl}/v1/midjourney/tasks/${encodeURIComponent(taskId)}`;
    const urls = await BaseProvider.pollTask({
      taskId,
      interval: POLL_INTERVAL_MS,
      timeoutMs: BaseProvider.parseTimeToMs(params.timeEstimate || '15min'),
      pollFn: async () => {
        params.signal?.throwIfAborted();
        const options = { headers: { Authorization: `Bearer ${relay.apiKey}` }, signal: params.signal };
        BaseProvider.injectProxy(options, params.useProxy);
        const response = await BaseProvider.fetch(pollUrl, options);
        const payload = await response.json();
        BaseProvider.saveDebugLog(logsDir, 'RELAY_MIDJOURNEY_POLL_RES', nodeId, payload, projectId);
        if (!response.ok) return { error: `AIFISHER API Midjourney 任务查询失败：${response.statusText}` };
        const parsed = parseMidjourneyTaskResult(payload);
        observeTerminalRelayReceipt(config, payload, parsed, {
          localTaskId: nodeId,
          upstreamTaskId: taskId,
        });
        return parsed;
      },
    });
    // Imagine always returns four candidates. generateCount controls how many candidates the
    // canvas keeps; it must never become MJ repeat, which would create additional paid tasks.
    const requestedCount = normalizeRequestedImageCount(params.generateCount, 4);
    const downloaded = await downloadRelayResults(
      urls.slice(0, requestedCount),
      params.useProxy,
      'png',
      params.signal,
    );
    return downloaded.length === 1 ? downloaded[0] : downloaded;
  },
};

export const RelayTextProvider = {
  async generateText(params, config) {
    const relay = resolveRelayCredentials(config);
    const { nodeId, prompt, textModel, projectId } = params;
    const logsDir = config?.LOGS_DIR;
    const assets = BaseProvider.getAssets(params);
    const [images, videos] = await Promise.all([
      resolveReferenceUrls({ relay, assets: assets.images, useProxy: params.useProxy, signal: params.signal }),
      resolveReferenceUrls({ relay, assets: assets.videos, useProxy: params.useProxy, signal: params.signal }),
    ]);
    const content = [{ type: 'text', text: String(prompt || '') }];
    content.push(...images.map((url) => ({ type: 'image_url', image_url: { url } })));
    content.push(...videos.map((url) => ({ type: 'video_url', video_url: { url } })));
    const body = {
      model: textModel,
      stream: true,
      messages: [{ role: 'user', content: content.length === 1 ? content[0].text : content }],
    };
    const result = await submitOpenAiChatWithLogs({
      url: resolveRelayRequestUrl(relay, params.url),
      headers: { Authorization: `Bearer ${relay.apiKey}` },
      body,
      signal: params.signal || config?.signal,
      onToken: params.onToken,
      nodeId,
      logsDir,
      modelId: textModel,
      projectId,
      useProxy: params.useProxy,
    });
    const text = result.text.trim();
    if (!text) throw new Error('AIFISHER API文本响应中未包含内容。');
    return { text, ...(result.reasoning ? { reasoning: result.reasoning } : {}) };
  },
};
