import crypto from 'node:crypto';
import fs from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { classifyGenerationError } from '../generation/generationErrors.js';
import { DoubaoImageProvider, DoubaoTextProvider } from '../providers/doubaoProvider.js';

const DEFAULT_TEXT_MODEL = 'doubao-seed-2-0-mini-260428';
const DEFAULT_IMAGE_MODEL = 'doubao-seedream-5-0-260128';
const REFERENCE_CATEGORIES = new Set(['Character', 'Scene', 'Item', 'Style', 'Other']);

class StoryboardError extends Error {
  constructor(message, status = 400, code = 'INVALID_STORYBOARD_REQUEST') {
    super(message);
    this.name = 'StoryboardError';
    this.status = status;
    this.code = code;
  }
}

function boundedText(value, label, maximumLength, fallback = '') {
  const text = String(value ?? '').trim() || fallback;
  if (!text || text.length > maximumLength) {
    throw new StoryboardError(`${label}无效`);
  }
  return text;
}

function projectId(value) {
  const id = String(value || 'storyboard').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    throw new StoryboardError('项目标识无效');
  }
  return id;
}

function normalizeCharacters(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new StoryboardError('角色信息无效');
  }
  return value.map((character) => ({
    name: boundedText(character?.name, '角色名称', 100),
    description: String(character?.description || '').trim().slice(0, 2_000),
  }));
}

function normalizeCharacterNames(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new StoryboardError('角色名称无效');
  }
  return value.map((name) => boundedText(name, '角色名称', 100));
}

function normalizeSceneCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new StoryboardError('分镜数量必须是 1 到 10 的整数');
  }
  return count;
}

function safeFilename(value) {
  const filename = String(value || '');
  if (
    !filename
    || filename.length > 255
    || filename === '.'
    || filename === '..'
    || filename.includes('/')
    || filename.includes('\\')
    || filename.includes('\0')
  ) {
    throw new StoryboardError('参考图片文件名无效');
  }
  return filename;
}

function decodeReferenceUrl(value) {
  try {
    return decodeURIComponent(String(value || '').split(/[?#]/)[0]);
  } catch {
    throw new StoryboardError('参考图片地址无效');
  }
}

async function readReferenceImages(libraryDirectory, currentProjectId, value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 12) {
    throw new StoryboardError('参考图片无效');
  }
  const results = [];
  for (const reference of value) {
    const name = boundedText(reference?.name, '参考图片名称', 100);
    const category = REFERENCE_CATEGORIES.has(reference?.category)
      ? reference.category
      : 'Other';
    const cleanUrl = decodeReferenceUrl(reference?.url);
    const prefix = `/library/media/${currentProjectId}/images/`;
    if (!cleanUrl.startsWith(prefix)) {
      throw new StoryboardError('参考图片不属于当前项目', 403, 'CROSS_PROJECT_MEDIA');
    }
    const filename = safeFilename(cleanUrl.slice(prefix.length));
    const filePath = path.join(libraryDirectory, 'media', currentProjectId, 'images', filename);
    if (!fs.existsSync(filePath)) {
      throw new StoryboardError('参考图片不存在', 404, 'MEDIA_NOT_FOUND');
    }
    const fileStats = await stat(filePath);
    if (fileStats.size > 10 * 1024 * 1024) {
      throw new StoryboardError('单张参考图片不能超过 10MB', 413, 'MEDIA_TOO_LARGE');
    }
    let metadata;
    try {
      metadata = await sharp(filePath).metadata();
    } catch {
      throw new StoryboardError('参考图片格式不受支持', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    const mimeTypes = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    const mimeType = mimeTypes[metadata.format];
    if (!mimeType || !metadata.width || !metadata.height) {
      throw new StoryboardError('参考图片格式不受支持', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    if (metadata.width > 4096 || metadata.height > 4096) {
      throw new StoryboardError('参考图片尺寸不能超过 4096×4096', 413, 'MEDIA_DIMENSIONS_EXCEEDED');
    }
    const data = (await readFile(filePath)).toString('base64');
    results.push({ name, category, url: cleanUrl, mimeType, data, dataUrl: `data:${mimeType};base64,${data}` });
  }
  return results;
}

function referenceLines(references) {
  const labels = {
    Character: '角色参考',
    Scene: '场景参考',
    Item: '道具参考',
    Style: '风格参考',
    Other: '其他参考',
  };
  return references.map((reference) =>
    `- ${labels[reference.category]}：@${reference.name}`,
  );
}

function requireArkKey(getCredentials) {
  const apiKey = String(getCredentials()?.arkApiKey || '').trim();
  if (!apiKey) {
    throw new StoryboardError(
      '请先配置 Ark API Key',
      503,
      'AI_CONFIGURATION_REQUIRED',
    );
  }
  return apiKey;
}

function normalizeProviderText(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 20_000) {
    throw new StoryboardError('AI 服务未返回有效内容', 502, 'AI_INVALID_RESPONSE');
  }
  return text;
}

function sendError(response, error) {
  if (error instanceof StoryboardError) {
    response.status(error.status).json({
      error: error.message,
      code: error.code,
      retryable: false,
    });
    return;
  }
  const classified = classifyGenerationError(error);
  console.error('[Storyboard] Request failed:', classified.code);
  response.status(classified.status).json({
    error: classified.message,
    code: classified.code,
    retryable: classified.retryable,
  });
}

function createDoubaoTextGenerator({ logsDirectory, textModel }) {
  return async ({ apiKey, purpose, prompt, images, projectId: currentProjectId }) => {
    const result = await DoubaoTextProvider.generateText({
      nodeId: `storyboard-${purpose}`,
      prompt,
      imageBase64: images,
      textModel,
      url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      projectId: currentProjectId,
    }, {
      ARK_API_KEY: apiKey,
      LOGS_DIR: logsDirectory,
    });
    return result?.text;
  };
}

function createDoubaoImageGenerator({ imageProvider, imageModel, logsDirectory }) {
  return async ({ apiKey, projectId, parts }) => {
    const prompt = parts
      .filter((part) => typeof part?.text === 'string')
      .map((part) => part.text)
      .join('\n');
    const images = parts
      .filter((part) => part?.inlineData?.data && part?.inlineData?.mimeType)
      .map((part) => `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
    const generated = await imageProvider.generateImage({
      nodeId: 'storyboard-composite',
      projectId,
      prompt,
      imageBase64: images,
      imageModel,
      mappingKey: imageModel,
      resolution: '2K',
      aspectRatio: '16:9',
      generateCount: 1,
      url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      useProxy: false,
    }, {
      ARK_API_KEY: apiKey,
      LOGS_DIR: logsDirectory,
    });
    const result = Array.isArray(generated) ? generated[0] : generated;
    if (!result?.buffer) return null;
    const format = result.format === 'jpg' || result.format === 'jpeg' ? 'jpeg' : 'png';
    return {
      mimeType: `image/${format}`,
      data: Buffer.from(result.buffer).toString('base64'),
    };
  };
}

function buildBrainstormPrompt({ characters, genre, references }) {
  const characterLines = characters.length
    ? characters.map((character) =>
      `- @${character.name}: ${character.description || '请根据故事需要补充视觉特征'}`,
    ).join('\n')
    : '- 可以按故事需要创建原创角色';
  return [
    '你是专业的视觉故事策划师。',
    `类型偏好：${genre}`,
    '角色：',
    characterLines,
    ...(references.length ? ['参考素材：', ...referenceLines(references)] : []),
    '创作一个适合分镜生成的中文故事梗概，3 至 5 句，包含明确的开端、发展、高潮和结尾。',
    '突出可以被画面表现的动作、环境与情绪。已命名角色必须使用 @角色名。',
    '只输出故事正文，不添加标题或解释。',
  ].join('\n');
}

function buildOptimizePrompt({ story, characterNames }) {
  const names = characterNames.length
    ? characterNames.map((name) => `@${name}`).join('、')
    : '无指定角色';
  return [
    '你是专业的分镜编剧。请重写并优化下面的故事，使其适合 AI 分镜与画面生成。',
    `原始故事：${story}`,
    `指定角色：${names}`,
    '保留核心叙事、角色与关键事件；增强动作、环境、光线、情绪和视觉转折。',
    '语言简洁、电影化，控制在 500 个汉字以内。指定角色出现时必须使用 @角色名。',
    '只输出优化后的故事正文，不添加解释。',
  ].join('\n');
}

function buildScriptsPrompt({ story, sceneCount, characters, references }) {
  const characterLines = characters.length
    ? characters.map((character) =>
      `- @${character.name}: ${character.description || '保持外观一致'}`,
    ).join('\n')
    : '- 没有预设角色';
  return [
    '你是专业的电影分镜师与摄影指导。',
    `故事：${story}`,
    '角色：',
    characterLines,
    ...(references.length ? ['参考素材：', ...referenceLines(references)] : []),
    `生成恰好 ${sceneCount} 个连续分镜，形成开端、发展、高潮和结尾。`,
    '每个分镜必须包含 sceneNumber、description、cameraAngle、cameraMovement、lighting、mood。',
    '已命名角色在 description 中使用 @角色名；动作、环境、光线和情绪必须可被画面直接表现。',
    '只返回 JSON：{"styleAnchor":"...","characterDNA":{"角色":"..."},"scenes":[...]}。',
  ].join('\n');
}

function parseProviderJson(value) {
  const text = normalizeProviderText(value);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  try {
    return JSON.parse((fenced?.[1] || text).trim());
  } catch {
    throw new StoryboardError('AI 服务返回的分镜格式无效', 502, 'AI_INVALID_RESPONSE');
  }
}

function normalizeScriptsOutput(value, expectedCount) {
  const parsed = parseProviderJson(value);
  const rawScenes = Array.isArray(parsed?.scenes)
    ? parsed.scenes
    : Array.isArray(parsed?.scripts)
      ? parsed.scripts
      : Array.isArray(parsed)
        ? parsed
        : null;
  if (!rawScenes || rawScenes.length !== expectedCount) {
    throw new StoryboardError('AI 服务返回的分镜数量无效', 502, 'AI_INVALID_RESPONSE');
  }
  const scripts = rawScenes.map((scene, index) => ({
    sceneNumber: index + 1,
    description: boundedText(scene?.description, '分镜描述', 4_000),
    cameraAngle: boundedText(scene?.cameraAngle, '镜头景别', 500),
    cameraMovement: boundedText(scene?.cameraMovement, '镜头运动', 500, '静止'),
    lighting: boundedText(scene?.lighting, '分镜光线', 1_000),
    mood: boundedText(scene?.mood, '分镜情绪', 500),
  }));
  const rawDna = parsed?.characterDNA;
  const characterDNA = rawDna && typeof rawDna === 'object' && !Array.isArray(rawDna)
    ? Object.fromEntries(Object.entries(rawDna).slice(0, 20).map(([name, description]) => [
      boundedText(name, '角色名称', 100),
      boundedText(description, '角色设定', 2_000),
    ]))
    : {};
  return {
    scripts,
    styleAnchor: String(parsed?.styleAnchor || '电影感光线，高细节，统一色彩').trim().slice(0, 2_000),
    characterDNA,
  };
}

function normalizeCompositeScripts(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new StoryboardError('组合图分镜必须包含 1 到 10 项');
  }
  return value.map((scene, index) => ({
    sceneNumber: index + 1,
    description: boundedText(scene?.description, '分镜描述', 4_000),
    cameraAngle: boundedText(scene?.cameraAngle, '镜头景别', 500),
    cameraMovement: boundedText(scene?.cameraMovement, '镜头运动', 500, '静止'),
    lighting: boundedText(scene?.lighting, '分镜光线', 1_000),
    mood: boundedText(scene?.mood, '分镜情绪', 500),
  }));
}

function normalizeCharacterDna(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 20) {
    throw new StoryboardError('角色设定无效');
  }
  return Object.fromEntries(Object.entries(value).map(([name, description]) => [
    boundedText(name, '角色名称', 100),
    boundedText(description, '角色设定', 2_000),
  ]));
}

function compositeLayout(count) {
  if (count <= 3) return `1x${count}`;
  if (count === 4) return '2x2';
  if (count <= 6) return '2x3';
  if (count <= 9) return '3x3';
  return '2x5';
}

function buildCompositePrompt({ scripts, layout, styleAnchor, characterDNA, references }) {
  const panels = scripts.map((scene) => [
    `Panel ${scene.sceneNumber}: ${scene.description}`,
    `Camera: ${scene.cameraAngle}; Movement: ${scene.cameraMovement}; Lighting: ${scene.lighting}; Mood: ${scene.mood}.`,
  ].join(' ')).join('\n');
  const dna = Object.entries(characterDNA).map(([name, description]) =>
    `- @${name}: ${description}`,
  );
  return [
    `Create one professional cinematic storyboard sheet in a strict ${layout} grid with ${scripts.length} equal-size panels.`,
    'Draw clear borders and a high-contrast scene number in the top-left of every panel.',
    'Keep character identity, clothing, environment, art style and color grading consistent across all panels.',
    `Art style: ${styleAnchor}`,
    ...(dna.length ? ['Character consistency:', ...dna] : []),
    ...(references.length ? ['Reference bindings:', ...referenceLines(references)] : []),
    'Panel instructions:',
    panels,
    'Return a single image only.',
  ].join('\n');
}

async function normalizeGeneratedImage(value) {
  const data = String(value?.data || '').trim();
  if (!data || data.length > 34 * 1024 * 1024) {
    throw new StoryboardError('AI 服务未返回有效组合图', 502, 'AI_INVALID_RESPONSE');
  }
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) {
    throw new StoryboardError('AI 服务返回的组合图体积无效', 502, 'AI_INVALID_RESPONSE');
  }
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new StoryboardError('AI 服务返回的组合图格式无效', 502, 'AI_INVALID_RESPONSE');
  }
  const formats = {
    png: { extension: 'png', mimeType: 'image/png' },
    jpeg: { extension: 'jpg', mimeType: 'image/jpeg' },
    webp: { extension: 'webp', mimeType: 'image/webp' },
  };
  const format = formats[metadata.format];
  if (!format || !metadata.width || !metadata.height) {
    throw new StoryboardError('AI 服务返回的组合图格式无效', 502, 'AI_INVALID_RESPONSE');
  }
  return { buffer, width: metadata.width, height: metadata.height, ...format };
}

async function saveCompositeAsset({
  libraryDirectory,
  currentProjectId,
  generated,
  imageModel,
  layout,
  sceneCount,
}) {
  const id = `storyboard-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const filename = `${id}.${generated.extension}`;
  const metadataFilename = `${id}.json`;
  const directory = path.join(libraryDirectory, 'media', currentProjectId, 'images');
  const imagePath = path.join(directory, filename);
  const metadataPath = path.join(directory, metadataFilename);
  const temporaryImagePath = `${imagePath}.${crypto.randomUUID()}.tmp`;
  const temporaryMetadataPath = `${metadataPath}.${crypto.randomUUID()}.tmp`;
  const createdAt = new Date().toISOString();
  const metadata = {
    id,
    filename,
    projectId: currentProjectId,
    type: 'images',
    model: imageModel,
    prompt: `Storyboard composite (${sceneCount} panels)`,
    width: generated.width,
    height: generated.height,
    mimeType: generated.mimeType,
    createdAt,
    source: { operation: 'storyboard-composite', layout, sceneCount },
  };
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryImagePath, generated.buffer, { flag: 'wx' });
    await writeFile(temporaryMetadataPath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryImagePath, imagePath);
    try {
      await rename(temporaryMetadataPath, metadataPath);
    } catch (error) {
      await rm(imagePath, { force: true });
      throw error;
    }
  } finally {
    await rm(temporaryImagePath, { force: true });
    await rm(temporaryMetadataPath, { force: true });
  }
  return {
    imageUrl: `/library/media/${currentProjectId}/images/${filename}`,
    layout,
  };
}

export function createStoryboardRouter({
  libraryDirectory,
  getCredentials = () => ({}),
  generateText: injectedGenerateText,
  logsDirectory,
  textModel = DEFAULT_TEXT_MODEL,
  generateImage: injectedGenerateImage,
  imageProvider = DoubaoImageProvider,
  imageModel = DEFAULT_IMAGE_MODEL,
  telemetryReporter = null,
}) {
  const router = express.Router();
  const generateText = injectedGenerateText
    || createDoubaoTextGenerator({ logsDirectory, textModel });
  const generateImage = injectedGenerateImage
    || createDoubaoImageGenerator({ imageProvider, imageModel, logsDirectory });

  function beginTelemetry(request, { operation, mediaType, modelName, provider, source }) {
    return telemetryReporter?.begin({
      category: 'storyboard',
      mediaType,
      operation,
      modelName,
      modelId: modelName,
      provider,
      source,
      requestId: request.requestId,
    });
  }

  router.post('/brainstorm-story', async (request, response) => {
    let telemetryCall;
    try {
      const currentProjectId = projectId(request.body?.projectId);
      const characters = normalizeCharacters(request.body?.characterDescriptions);
      const genre = boundedText(request.body?.genre, '故事类型', 200, '电影感剧情');
      const references = await readReferenceImages(
        libraryDirectory,
        currentProjectId,
        request.body?.referenceImages,
      );
      const apiKey = requireArkKey(getCredentials);
      telemetryCall = beginTelemetry(request, {
        operation: 'brainstorm-story', mediaType: 'text', modelName: textModel,
        provider: 'DoubaoTextProvider', source: 'volcengine_official',
      });
      const story = normalizeProviderText(await generateText({
        purpose: 'brainstorm-story',
        projectId: currentProjectId,
        apiKey,
        prompt: buildBrainstormPrompt({ characters, genre, references }),
        images: references.map((reference) => reference.dataUrl),
      }));
      telemetryCall?.success();
      response.json({ story });
    } catch (error) {
      telemetryCall?.fail(error);
      sendError(response, error);
    }
  });

  router.post('/optimize-story', async (request, response) => {
    let telemetryCall;
    try {
      const currentProjectId = projectId(request.body?.projectId);
      const story = boundedText(request.body?.story, '故事内容', 20_000);
      const characterNames = normalizeCharacterNames(request.body?.characterNames);
      const apiKey = requireArkKey(getCredentials);
      telemetryCall = beginTelemetry(request, {
        operation: 'optimize-story', mediaType: 'text', modelName: textModel,
        provider: 'DoubaoTextProvider', source: 'volcengine_official',
      });
      const optimizedStory = normalizeProviderText(await generateText({
        purpose: 'optimize-story',
        projectId: currentProjectId,
        apiKey,
        prompt: buildOptimizePrompt({ story, characterNames }),
        images: [],
      }));
      telemetryCall?.success();
      response.json({ optimizedStory });
    } catch (error) {
      telemetryCall?.fail(error);
      sendError(response, error);
    }
  });

  router.post('/generate-scripts', async (request, response) => {
    let telemetryCall;
    try {
      const currentProjectId = projectId(request.body?.projectId);
      const story = boundedText(request.body?.story, '故事内容', 20_000);
      const sceneCount = normalizeSceneCount(request.body?.sceneCount);
      const characters = normalizeCharacters(request.body?.characterDescriptions);
      const references = await readReferenceImages(
        libraryDirectory,
        currentProjectId,
        request.body?.referenceImages,
      );
      const apiKey = requireArkKey(getCredentials);
      telemetryCall = beginTelemetry(request, {
        operation: 'generate-scripts', mediaType: 'text', modelName: textModel,
        provider: 'DoubaoTextProvider', source: 'volcengine_official',
      });
      const result = normalizeScriptsOutput(await generateText({
        purpose: 'generate-scripts',
        projectId: currentProjectId,
        apiKey,
        prompt: buildScriptsPrompt({ story, sceneCount, characters, references }),
        images: references.map((reference) => reference.dataUrl),
      }), sceneCount);
      telemetryCall?.success();
      response.json(result);
    } catch (error) {
      telemetryCall?.fail(error);
      sendError(response, error);
    }
  });

  router.post('/generate-composite', async (request, response) => {
    let telemetryCall;
    try {
      const currentProjectId = projectId(request.body?.projectId);
      const scripts = normalizeCompositeScripts(request.body?.scripts);
      const layout = compositeLayout(scripts.length);
      const styleAnchor = boundedText(
        request.body?.styleAnchor,
        '视觉风格',
        2_000,
        '电影感光线，高细节，统一色彩',
      );
      const characterDNA = normalizeCharacterDna(request.body?.characterDNA);
      const references = await readReferenceImages(
        libraryDirectory,
        currentProjectId,
        request.body?.referenceImages,
      );
      const prompt = buildCompositePrompt({
        scripts,
        layout,
        styleAnchor,
        characterDNA,
        references,
      });
      const parts = [
        ...references.flatMap((reference) => [
          { text: `${reference.category} reference: @${reference.name}` },
          { inlineData: { mimeType: reference.mimeType, data: reference.data } },
        ]),
        { text: prompt },
      ];
      const apiKey = requireArkKey(getCredentials);
      telemetryCall = beginTelemetry(request, {
        operation: 'generate-composite', mediaType: 'image', modelName: imageModel,
        provider: 'DoubaoImageProvider', source: 'volcengine_official',
      });
      const generated = await normalizeGeneratedImage(await generateImage({
        apiKey,
        projectId: currentProjectId,
        layout,
        parts,
      }));
      const saved = await saveCompositeAsset({
        libraryDirectory,
        currentProjectId,
        generated,
        imageModel,
        layout,
        sceneCount: scripts.length,
      });
      telemetryCall?.success();
      response.json(saved);
    } catch (error) {
      telemetryCall?.fail(error);
      sendError(response, error);
    }
  });

  return router;
}
