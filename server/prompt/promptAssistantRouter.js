import fs from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { classifyGenerationError } from '../generation/generationErrors.js';
import { GlmTextProvider } from '../providers/officialTextProvider.js';

const DEFAULT_MODEL = 'glm-5.3-flash';
const GLM_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const DESCRIBE_IMAGE_INSTRUCTION = [
  '你是专业的视觉描述与生成提示词助手。',
  '准确描述主体、动作、环境、构图、镜头、光线、色彩、材质、风格和氛围。',
  '输出可以直接用于图片或视频生成的中文提示词，不添加分析过程或标题。',
].join('');
const OPTIMIZE_PROMPT_INSTRUCTION = [
  '你是专业的 AI 视觉提示词工程师。',
  '保留用户原意，补全主体、动作、环境、构图、镜头、光线、色彩、材质、风格和氛围。',
  '输出一段可直接用于图片或视频生成的中文提示词，不添加解释、标题或引号。',
].join('');

class PromptAssistantError extends Error {
  constructor(message, status = 400, code = 'INVALID_PROMPT_ASSISTANT_REQUEST') {
    super(message);
    this.name = 'PromptAssistantError';
    this.status = status;
    this.code = code;
  }
}

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
    throw new PromptAssistantError(`${label}无效`);
  }
  return value;
}

function normalizeText(value, label, maximumLength, fallback = '') {
  const text = String(value ?? '').trim() || fallback;
  if (!text || text.length > maximumLength) {
    throw new PromptAssistantError(`${label}无效`);
  }
  return text;
}

function normalizeOutput(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 20000) {
    throw new PromptAssistantError(
      'AI 服务未返回有效内容',
      502,
      'AI_INVALID_RESPONSE',
    );
  }
  return text;
}

async function readProjectImage(libraryDirectory, projectId, imageUrl) {
  const prefix = `/library/media/${encodeURIComponent(projectId)}/images/`;
  const decodedUrl = decodeURIComponent(String(imageUrl || '').split(/[?#]/)[0]);
  const decodedPrefix = decodeURIComponent(prefix);
  if (!decodedUrl.startsWith(decodedPrefix)) {
    throw new PromptAssistantError('图片不属于当前项目', 403, 'CROSS_PROJECT_MEDIA');
  }
  const filename = assertSafeSegment(decodedUrl.slice(decodedPrefix.length), '图片文件名');
  const filePath = path.join(libraryDirectory, 'media', projectId, 'images', filename);
  if (!fs.existsSync(filePath)) {
    throw new PromptAssistantError('图片不存在', 404, 'MEDIA_NOT_FOUND');
  }
  const fileStats = await stat(filePath);
  if (fileStats.size > 10 * 1024 * 1024) {
    throw new PromptAssistantError('图片不能超过 10MB', 413, 'MEDIA_TOO_LARGE');
  }
  let metadata;
  try {
    metadata = await sharp(filePath).metadata();
  } catch {
    throw new PromptAssistantError(
      '图片格式不受支持',
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }
  const mimeTypes = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const mimeType = mimeTypes[metadata.format];
  if (!mimeType || !metadata.width || !metadata.height) {
    throw new PromptAssistantError('图片格式不受支持', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  if (metadata.width > 4096 || metadata.height > 4096) {
    throw new PromptAssistantError('图片尺寸不能超过 4096×4096', 413, 'MEDIA_DIMENSIONS_EXCEEDED');
  }
  return {
    mimeType,
    data: (await readFile(filePath)).toString('base64'),
  };
}

function sendError(response, error) {
  if (error instanceof PromptAssistantError) {
    response.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  const classified = classifyGenerationError(error);
  console.error('[Prompt Assistant] Request failed:', classified.code);
  response.status(classified.status).json({
    error: classified.message,
    code: classified.code,
    retryable: classified.retryable,
  });
}

function requireApiKey(getApiKey) {
  const apiKey = String(getApiKey() || '').trim();
  if (!apiKey) {
    throw new PromptAssistantError(
      '请先配置智谱 GLM API Key',
      503,
      'AI_CONFIGURATION_REQUIRED',
    );
  }
  return apiKey;
}

function removeWrapperQuotes(value) {
  const text = String(value || '').trim();
  for (const [opening, closing] of [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']]) {
    if (text.startsWith(opening) && text.endsWith(closing)) {
      return text.slice(opening.length, -closing.length).trim();
    }
  }
  return text;
}

function createGlmGenerator({ textProvider, model, logsDirectory }) {
  return async ({ apiKey, purpose, text, media, projectId }) => {
    const instruction = purpose === 'describe-image'
      ? DESCRIBE_IMAGE_INSTRUCTION
      : OPTIMIZE_PROMPT_INSTRUCTION;
    const result = await textProvider.generateText({
      nodeId: `prompt-assistant-${purpose}`,
      projectId: projectId || 'prompt-assistant',
      prompt: `${instruction}\n\n${text}`,
      ...(media ? { imageBase64: `data:${media.mimeType};base64,${media.data}` } : {}),
      textModel: model,
      url: GLM_CHAT_URL,
      reasoning_effort: 'low',
      useProxy: false,
    }, {
      ZHIPU_API_KEY: apiKey,
      LOGS_DIR: logsDirectory,
    });
    return result.text;
  };
}

export function createPromptAssistantRouter({
  libraryDirectory,
  getApiKey = () => '',
  generateContent: injectedGenerateContent,
  textProvider = GlmTextProvider,
  model = DEFAULT_MODEL,
  logsDirectory = null,
  telemetryReporter = null,
}) {
  const router = express.Router();
  const generateContent = injectedGenerateContent || createGlmGenerator({
    textProvider,
    model,
    logsDirectory,
  });

  router.post('/api/prompt-assistant/describe-image', async (request, response) => {
    let telemetryCall;
    try {
      const projectId = assertSafeSegment(request.body?.projectId, '项目标识');
      const media = await readProjectImage(
        libraryDirectory,
        projectId,
        request.body?.imageUrl,
      );
      const text = normalizeText(
        request.body?.prompt,
        '描述要求',
        4000,
        '请详细描述这张图片的主体、构图、光线、色彩、材质、风格和氛围。',
      );
      const apiKey = requireApiKey(getApiKey);
      telemetryCall = telemetryReporter?.begin({
        category: 'prompt',
        mediaType: 'text',
        operation: 'describe-image',
        modelName: model,
        modelId: model,
        provider: 'GlmTextProvider',
        source: 'zhipu_official',
        requestId: request.requestId,
      });
      const description = normalizeOutput(
        await generateContent({ apiKey, purpose: 'describe-image', text, media, projectId }),
      );
      telemetryCall?.success();
      response.json({ description });
    } catch (error) {
      telemetryCall?.fail(error);
      sendError(response, error);
    }
  });

  router.post('/api/prompt-assistant/optimize-prompt', async (request, response) => {
    let telemetryCall;
    try {
      const text = normalizeText(request.body?.prompt, '提示词', 8000);
      const apiKey = requireApiKey(getApiKey);
      telemetryCall = telemetryReporter?.begin({
        category: 'prompt',
        mediaType: 'text',
        operation: 'optimize-prompt',
        modelName: model,
        modelId: model,
        provider: 'GlmTextProvider',
        source: 'zhipu_official',
        requestId: request.requestId,
      });
      const optimizedPrompt = normalizeOutput(
        removeWrapperQuotes(
          await generateContent({
            apiKey,
            purpose: 'optimize-prompt',
            text,
            projectId: request.body?.projectId,
          }),
        ),
      );
      telemetryCall?.success();
      response.json({ optimizedPrompt });
    } catch (error) {
      telemetryCall?.fail(error);
      sendError(response, error);
    }
  });

  return router;
}
