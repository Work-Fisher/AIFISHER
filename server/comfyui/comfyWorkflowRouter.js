import crypto from 'node:crypto';
import fs from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

class ComfyWorkflowError extends Error {
  constructor(message, status = 400, code = 'INVALID_COMFY_WORKFLOW') {
    super(message);
    this.name = 'ComfyWorkflowError';
    this.status = status;
    this.code = code;
  }
}

const MINIMAX_CAPABILITY = Object.freeze({
  workflowType: 'minimax-h3-t2va',
  category: 'minimax-h3',
  outputType: 'videos',
  requiredInputs: ['text'],
});
const MINIMAX_MODES = new Set(['t2va', 'i2va', 'fl2va', 'l2va', 'ref2va']);
const ASPECT_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9']);

function assertSafeSegment(value, label) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > 255
    || value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || value.includes('\0')
  ) {
    throw new ComfyWorkflowError(`${label}无效`);
  }
  return value;
}

function assertProjectMedia(libraryDirectory, projectId, mediaType, mediaUrl, label) {
  const cleanUrl = decodeURIComponent(String(mediaUrl || '').split(/[?#]/)[0]);
  const prefix = `/library/media/${projectId}/${mediaType}/`;
  if (!cleanUrl.startsWith(prefix)) {
    throw new ComfyWorkflowError(`${label}不属于当前项目`, 403, 'CROSS_PROJECT_MEDIA');
  }
  const filename = assertSafeSegment(cleanUrl.slice(prefix.length), `${label}文件名`);
  const filePath = path.join(libraryDirectory, 'media', projectId, mediaType, filename);
  if (!fs.existsSync(filePath)) {
    throw new ComfyWorkflowError(`${label}不存在`, 404, 'MEDIA_NOT_FOUND');
  }
  return cleanUrl;
}

function normalizeMediaList(value, maximum, assertMedia, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ComfyWorkflowError(`${label}最多支持 ${maximum} 个`);
  }
  return [...new Set(value.map((url, index) => assertMedia(url, `${label}${index + 1}`)))];
}

function assertLocalComfyServer(serverUrl) {
  if (!serverUrl) return;
  let hostname;
  try {
    hostname = new URL(`http://${serverUrl}`).hostname;
  } catch {
    throw new ComfyWorkflowError('ComfyUI 本机地址无效', 503, 'INVALID_COMFY_SERVER');
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
    throw new ComfyWorkflowError(
      'AIFISHER 画布只允许连接本机 ComfyUI',
      403,
      'NON_LOCAL_COMFY_SERVER',
    );
  }
}

function normalizeText(value, label, maximumLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw new ComfyWorkflowError(`${label}无效`);
  }
  return value.trim();
}

function normalizeNumber(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new ComfyWorkflowError(`${label}无效`);
  }
  return number;
}

function withSeed(params, value) {
  if (value == null || value === '') return params;
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < -1 || seed > 0xffffffff) {
    throw new ComfyWorkflowError('随机种子无效');
  }
  return { ...params, seed };
}

function normalizeRequest(body, libraryDirectory) {
  const projectId = assertSafeSegment(body?.projectId, '项目标识');
  const nodeId = body?.nodeId ? assertSafeSegment(body.nodeId, '节点标识') : null;
  const aspectRatio = String(body?.aspectRatio || '16:9');
  if (!ASPECT_RATIOS.has(aspectRatio)) throw new ComfyWorkflowError('视频画面比例无效');

  const inferredMode = body?.imageUrl && !body?.mode ? 'ref2va' : 't2va';
  const mode = String(body?.mode || inferredMode).toLowerCase();
  if (!MINIMAX_MODES.has(mode)) throw new ComfyWorkflowError('MiniMax H3 生成模式无效');

  const image = (value, label) => value
    ? assertProjectMedia(libraryDirectory, projectId, 'images', value, label)
    : undefined;
  const firstFrameUrl = image(
    body?.firstFrameUrl || (mode === 'i2va' ? body?.imageUrl : null),
    '首帧图片',
  );
  const lastFrameUrl = image(
    body?.lastFrameUrl || (mode === 'l2va' ? body?.imageUrl : null),
    '尾帧图片',
  );
  const legacyReference = mode === 'ref2va' && body?.imageUrl ? [body.imageUrl] : [];
  const referenceImageUrls = normalizeMediaList(
    body?.referenceImageUrls ?? legacyReference,
    9,
    (url, label) => assertProjectMedia(libraryDirectory, projectId, 'images', url, label),
    '参考图片',
  );
  const referenceVideoUrls = normalizeMediaList(
    body?.referenceVideoUrls,
    3,
    (url, label) => assertProjectMedia(libraryDirectory, projectId, 'videos', url, label),
    '参考视频',
  );
  const referenceAudioUrls = normalizeMediaList(
    body?.referenceAudioUrls,
    3,
    (url, label) => assertProjectMedia(libraryDirectory, projectId, 'audios', url, label),
    '参考音频',
  );

  if (mode === 'i2va' && !firstFrameUrl) {
    throw new ComfyWorkflowError('首帧模式需要连接一张首帧图片');
  }
  if (mode === 'fl2va' && (!firstFrameUrl || !lastFrameUrl)) {
    throw new ComfyWorkflowError('首尾帧模式需要同时连接首帧和尾帧图片');
  }
  if (mode === 'l2va' && !lastFrameUrl) {
    throw new ComfyWorkflowError('尾帧模式需要连接一张尾帧图片');
  }
  if (
    mode === 'ref2va'
    && referenceImageUrls.length + referenceVideoUrls.length + referenceAudioUrls.length === 0
  ) {
    throw new ComfyWorkflowError('参考模式至少需要连接一个图片、视频或音频素材');
  }

  return {
    projectId,
    nodeId,
    params: withSeed({
      text: normalizeText(body?.text, '视频提示词', 20_000),
      mode,
      ...(firstFrameUrl ? { firstFrameUrl } : {}),
      ...(lastFrameUrl ? { lastFrameUrl } : {}),
      ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
      ...(referenceVideoUrls.length ? { referenceVideoUrls } : {}),
      ...(referenceAudioUrls.length ? { referenceAudioUrls } : {}),
      aspectRatio,
      megapixels: normalizeNumber(body?.megapixels ?? 0.4, '视频像素规模', 0.1, 2),
      duration: normalizeNumber(body?.duration ?? 8, '视频时长', 1, 60),
    }, body?.seed),
  };
}

async function defaultDownloadResult(resultUrl) {
  const parsed = new URL(resultUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new ComfyWorkflowError('ComfyUI 结果地址必须来自本机', 502, 'NON_LOCAL_COMFY_RESULT');
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ComfyUI 结果下载失败 (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > 200 * 1024 * 1024) {
    throw new ComfyWorkflowError('ComfyUI 结果大小无效', 502, 'INVALID_COMFY_RESULT');
  }
  return { buffer, contentType: response.headers.get('content-type') || 'video/mp4' };
}

function collectSourceUrls(params) {
  const urls = [];
  const visit = (value) => {
    if (typeof value === 'string' && value.startsWith('/library/media/')) urls.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(params);
  return [...new Set(urls)];
}

function withoutSourceUrls(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => collectSourceUrls(value).length === 0),
  );
}

function videoFormat(contentType) {
  const mimeType = String(contentType || '').split(';')[0].trim().toLowerCase();
  const formats = {
    'video/mp4': ['mp4', 'video/mp4'],
    'video/webm': ['webm', 'video/webm'],
    'video/quicktime': ['mov', 'video/quicktime'],
  };
  const format = formats[mimeType];
  if (!format) {
    throw new ComfyWorkflowError('视频工作流返回了不支持的视频格式', 502, 'INVALID_COMFY_RESULT');
  }
  return { extension: format[0], mimeType: format[1] };
}

async function saveResultAsset({ libraryDirectory, projectId, nodeId, config, params, result }) {
  const id = crypto.randomUUID();
  const { extension, mimeType } = videoFormat(result.contentType);
  const filename = `${id}.${extension}`;
  const directory = path.join(libraryDirectory, 'media', projectId, 'videos');
  const filePath = path.join(directory, filename);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(filePath, result.buffer);
    const sourceUrls = collectSourceUrls(params);
    const asset = {
      id,
      filename,
      projectId,
      type: 'videos',
      url: `/library/media/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(filename)}`,
      nodeId,
      createdAt: new Date().toISOString(),
      favorite: false,
      prompt: params.text || `${config.title} 结果`,
      model: 'ComfyUI',
      mode: 'minimax-h3-t2va',
      operation: 'comfy-workflow',
      workflowType: 'minimax-h3-t2va',
      sourceUrl: sourceUrls[0] || null,
      sourceUrls,
      sourceStatus: 'available',
      parameters: withoutSourceUrls(params),
      format: extension,
      mimeType,
    };
    await writeFile(path.join(directory, `${id}.json`), JSON.stringify(asset, null, 2), 'utf8');
    return asset;
  } catch (error) {
    await rm(filePath, { force: true });
    throw error;
  }
}

function sendError(response, error, logger) {
  const status = error instanceof ComfyWorkflowError ? error.status : 500;
  if (status >= 500) logger.error('ComfyUI workflow error:', error);
  response.status(status).json({
    error: error instanceof ComfyWorkflowError
      ? error.message
      : 'ComfyUI 执行失败，请确认本机服务已启动并安装 MiniMax H3 工作流。',
    code: error instanceof ComfyWorkflowError ? error.code : 'COMFY_WORKFLOW_FAILED',
  });
}

export function createComfyWorkflowRouter({
  libraryDirectory,
  workflowRegistry,
  comfyClient,
  downloadResult = defaultDownloadResult,
  logger = console,
  telemetryReporter = null,
}) {
  if (!libraryDirectory || !workflowRegistry || !comfyClient) {
    throw new Error('libraryDirectory, workflowRegistry, and comfyClient are required');
  }
  const router = express.Router();

  router.get('/comfy/capabilities', (request, response) => {
    try {
      const outputType = request.query.outputType;
      if (outputType && !['images', 'audios', 'videos'].includes(outputType)) {
        throw new ComfyWorkflowError('能力输出类型无效');
      }
      const config = workflowRegistry[MINIMAX_CAPABILITY.workflowType];
      const capabilities = config && (!outputType || outputType === 'videos')
        ? [{ ...MINIMAX_CAPABILITY, title: config.title }]
        : [];
      response.json({ capabilities });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/comfy/:workflowType', async (request, response, next) => {
    let telemetryCall;
    try {
      const workflowType = assertSafeSegment(request.params.workflowType, '工作流类型');
      if (workflowType !== MINIMAX_CAPABILITY.workflowType) return next();
      const config = workflowRegistry[workflowType];
      if (!config) return next();
      const normalized = normalizeRequest(request.body, libraryDirectory);
      telemetryCall = telemetryReporter?.begin({
        category: 'workflow',
        mediaType: 'workflow',
        operation: workflowType,
        modelName: config.title || 'ComfyUI workflow',
        modelId: workflowType,
        provider: 'ComfyUIProvider',
        source: 'comfyui_local',
        requestId: request.requestId,
      });
      assertLocalComfyServer(comfyClient.serverUrl);
      const workflow = await config.handler(comfyClient, normalized.params);
      const resultUrl = await comfyClient.queuePrompt(
        workflow,
        config.timeout || 1_800_000,
        config.outputNodeId,
      );
      if (!resultUrl) throw new Error('ComfyUI 未返回结果');
      const result = await downloadResult(resultUrl);
      const asset = await saveResultAsset({
        libraryDirectory,
        projectId: normalized.projectId,
        nodeId: normalized.nodeId,
        config,
        params: normalized.params,
        result,
      });
      telemetryCall?.success();
      response.json({ success: true, url: asset.url, asset });
    } catch (error) {
      telemetryCall?.fail(error);
      sendError(response, error, logger);
    }
  });

  return router;
}

export { ComfyWorkflowError };
