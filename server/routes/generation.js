/**
 * generation.js
 * 
 * Routes for AI image and video generation.
 * Supports Gemini, Veo, Kling AI, Hailuo AI, and OpenAI GPT Image providers.
 */

import express from 'express';
import { saveMediaBufferToFile, generateAssetId, downloadAndSaveAsset } from '../utils/imageHelpers.js';
import { getUrlPrefix } from '../workspace/workspacePaths.js';
import { getGenerationProvider } from '../generation/generationProviderCatalog.js';
import { loadModelCatalog, normalizeModelDuration } from '../config/modelCatalog.js';
import { executeGenerationTask } from '../generation/generationExecution.js';
import { classifyGenerationError } from '../generation/generationErrors.js';
import { createGenerationRecoveryRouter } from '../generation/generationRecoveryRouter.js';
import { createGenerationTaskRecovery } from '../generation/generationTaskRecovery.js';

import { BaseProvider } from '../providers/baseProvider.js';

/**
 * 模型元数据的唯一来源。开发工作区读 src/config/modelConfig.ts，
 * 便携包里没有 src/，回退到构建期落在 server/config/ 的 JSON 快照。
 * 解析细节见 server/config/modelCatalog.js。
 */
function getModelRegistry() {
    return loadModelCatalog();
}

/**
 * 仅用于读取旧画布：runninghub.ai 的展示后缀曾写过「RH 国际站」「RH国际站」，
 * 也曾短暂被误写成「宽审核」。现在统一恢复为「RH AI站」，但旧节点保存的是
 * 完整模型名，生成时仍要能解析到同一条配置。AiFisher 的「API宽审核」不受影响。
 */
export function normalizeLegacyModelName(modelName) {
    return String(modelName || '')
        .replace(' · RH 国际站', ' · RH AI站')
        .replace(' · RH国际站', ' · RH AI站')
        .replace(' · 宽审核', ' · RH AI站');
}

function modelConfigFor(registry, modelName) {
    return registry[modelName] || registry[normalizeLegacyModelName(modelName)];
}

/**
 * 并发控制工具：统一标准化 URL Key，避免 query 顺序差异导致误判。
 */
function normalizeUrlKey(inputUrl = '') {
    try {
        const parsed = new URL(inputUrl);
        const entries = Array.from(parsed.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
        const normalizedQuery = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        return `${parsed.origin}${normalizedPath}${normalizedQuery ? `?${normalizedQuery}` : ''}`;
    } catch {
        return String(inputUrl || '').trim();
    }
}

/**
 * 统一解析最终执行目标（与真实请求分发口径一致）。
 * 返回：最终 URL、最终模型 ID、并发上限等。
 */
function resolveFinalExecutionContext(modelName, mode) {
    const registry = getModelRegistry();
    const config = modelConfigFor(registry, modelName);
    if (!config) return null;

    const modelKey = config.name.replace(/[\s.-]/g, '_').toUpperCase();
    const envModelIdKey = `MODEL_ID_${modelKey}`;

    const endpointMap = config.endpoint || {};
    const endpointKeys = Object.keys(endpointMap);
    const matchedMode = mode && endpointMap[mode] ? mode : '';
    const resolvedMode = matchedMode || (endpointKeys.length === 1 ? endpointKeys[0] : '');

    const fallbackModeConfig = Object.values(endpointMap)[0];
    const modeConfig = endpointMap[resolvedMode] || endpointMap[mode] || fallbackModeConfig;
    let finalUrl = typeof modeConfig === 'object' ? modeConfig?.url : modeConfig;
    const defaultModelId = typeof modeConfig === 'object' ? modeConfig?.model : '';
    let finalModelId = defaultModelId;

    const modeEnvSuffix = (resolvedMode || mode || '').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();

    // 覆盖优先级：模式级 > 模型通用级 > 配置默认
    const envUrlModeKey = modeEnvSuffix ? `MODEL_URL_${modelKey}_${modeEnvSuffix}` : '';
    const envUrlCommonKey = `MODEL_URL_${modelKey}`;
    if (envUrlModeKey && process.env[envUrlModeKey]) {
        finalUrl = String(process.env[envUrlModeKey]).trim();
    } else if (process.env[envUrlCommonKey]) {
        finalUrl = String(process.env[envUrlCommonKey]).trim();
    }

    const envModeModelKey = modeEnvSuffix ? `MODEL_ID_${modelKey}_${modeEnvSuffix}` : '';
    if (envModeModelKey && process.env[envModeModelKey]) {
        finalModelId = String(process.env[envModeModelKey]).trim();
    } else if (process.env[envModelIdKey]) {
        finalModelId = String(process.env[envModelIdKey]).trim();
    }

    // 若未取到模型 ID，则回退到模型名，保证并发 key 始终可用
    if (!finalModelId) {
        finalModelId = config.name;
    }

    return {
        modelName: config.name,
        modelIdKey: String(finalModelId).trim(),
        rawUrl: finalUrl,
        normalizedUrl: normalizeUrlKey(finalUrl || ''),
        finalModelId,
        maxConcurrent: config.maxConcurrent === 0 ? 0 : Math.max(1, Number(config.maxConcurrent || 1)),
        timeEstimate: config.timeEstimate || '5min',
        useProxy: config.useProxy
    };
}

/**
 * 统一分发器
 */
const PROVIDERS = {
    get: (modelName) => {
        if (!modelName) return null;
        
        const registry = getModelRegistry();
        const config = modelConfigFor(registry, modelName);
        
        if (!config || !config.provider) {
            console.error(`[Generation] Unknown model: ${modelName}`);
            return null;
        }

        // 直接根据配置文件中的 provider 字符串从全局集合中查找对应的处理器对象
        const handler = getGenerationProvider(config.provider);
        if (!handler) {
            console.error(`[Generation] No handler found for provider: ${config.provider}`);
            return null;
        }

        // 检查是否有覆盖的环境变量: MODEL_PROXY_model_name, MODEL_ID_model_name (空格点号转下划线)
        // 使用配置中的逻辑名称来生成 Key，确保旧节点也能匹配到正确的环境变量
        const modelKey = config.name.replace(/[\s.-]/g, '_').toUpperCase();
        const envProxyKey = `MODEL_PROXY_${modelKey}`;
        
        // 环境变量覆盖优先级：环境变量 > 代码默认值
        const finalUseProxy = process.env[envProxyKey] !== undefined 
            ? process.env[envProxyKey] === 'true' 
            : config.useProxy;
        
        // 包装函数，透传 url, modelId, timeEstimate 和 useProxy 到处理器参数中
        const wrap = (fn) => {
            if (!fn) return undefined;
            return (params, ctx) => {
                // 动态确定当前模式并解析最终生效目标（URL + 模型ID）
                const currentMode = params.imageMode || params.videoMode || params.audioMode || params.languageMode || params.mode;
                const finalCtx = resolveFinalExecutionContext(config.name, currentMode);
                if (!finalCtx) {
                    throw new Error(`无法解析模型执行上下文: ${config.name}`);
                }
                const finalUrl = finalCtx.rawUrl;
                const finalModelId = finalCtx.finalModelId;
                const defaultModelId = finalModelId;

                const executionPromise = fn({ 
                    ...params, 
                    // 确保透传解析后的物理模型 ID 到对应的参数字段
                    imageModel: params.imageModel ? finalModelId : params.imageModel,
                    videoModel: params.videoModel ? finalModelId : params.videoModel,
                    textModel: params.textModel ? finalModelId : params.textModel,
                    audioModel: params.audioModel ? finalModelId : params.audioModel,
                    // 传递原始默认 ID 作为映射键，防止自定义 ID 导致解析器失效
                    mappingKey: defaultModelId,
                    url: finalUrl,
                    timeEstimate: config.timeEstimate,
                    useProxy: finalUseProxy
                }, ctx);
                
                // parseTimeToMs 已包含 3 倍安全余量：视频按 duration 放大，其它类型按 generateCount 放大
                const baseMs = BaseProvider.parseTimeToMs(config.timeEstimate || '5min');
                const totalMs = params.videoModel
                    ? baseMs * Math.max(1, Number(params.duration) || 1)
                    : baseMs * Math.max(1, Number(params.generateCount) || 1);

                // 外部兜底超时
                return BaseProvider.withTimeout(executionPromise, totalMs);
            };
        };

        return {
            ...handler,
            providerName: config.provider,
            recoveryParameters: (task) => {
                const context = resolveFinalExecutionContext(config.name, task.videoMode || task.imageMode);
                return { nodeId: task.nodeId, videoModel: context?.finalModelId, imageModel: context?.finalModelId, url: context?.rawUrl, useProxy: finalUseProxy };
            },
            generateImage: wrap(handler.generateImage),
            generateVideo: wrap(handler.generateVideo),
            generateText: wrap(handler.generateText),
            generateAudio: wrap(handler.generateAudio)
        };
    }
};

function sendGenerationError(res, error, logLabel) {
    console.error(logLabel, error);
    if (res.headersSent) return;
    const details = error?.status && error?.code
        ? error
        : classifyGenerationError(error);
    res.status(details.status || 500).json({
        error: details.message || '生成失败，请重试。',
        code: details.code || 'GENERATION_FAILED',
        retryable: Boolean(details.retryable),
        ...(details.inFlight === undefined ? {} : { inFlight: details.inFlight }),
        ...(details.maxConcurrent === undefined ? {} : { maxConcurrent: details.maxConcurrent })
    });
}

// ============================================================================
// IMAGE GENERATION
// ============================================================================

export function createGenerationRouter({ generationCoordinator, telemetryReporter = null }) {
if (!generationCoordinator) {
    throw new Error('Generation router requires the shared generation coordinator');
}
const router = express.Router();

function beginTelemetry(request, { kind, modelName, providerName, executionContext, mode }) {
    if (!telemetryReporter) return null;
    return telemetryReporter.begin({
        category: 'generation',
        mediaType: kind,
        operation: mode || `generate-${kind}`,
        modelName,
        modelId: executionContext.modelIdKey,
        provider: providerName,
        requestId: request.requestId
    });
}

router.post('/generate-image', async (req, res) => {
    const { imageModel, nodeId, prompt, projectId, cost, aspectRatio, resolution, imageMode } = req.body;
    let telemetryCall;
    try {
        const provider = PROVIDERS.get(imageModel);
        if (!provider || !provider.generateImage) {
            return res.status(400).json({
                error: `Unsupported or disabled image model: ${imageModel}`,
                code: 'UNSUPPORTED_GENERATION_PROVIDER',
                retryable: false
            });
        }
        const concurrencyCtx = resolveFinalExecutionContext(imageModel, imageMode);
        if (!concurrencyCtx) {
            return res.status(400).json({ error: `Cannot resolve concurrency key for model: ${imageModel}` });
        }
        telemetryCall = beginTelemetry(req, {
            kind: 'image', modelName: imageModel, providerName: provider.providerName,
            executionContext: concurrencyCtx, mode: imageMode
        });
        console.log(`[Generation] Routing image request to model: ${imageModel}, project: ${projectId}`);
        const response = await executeGenerationTask({
            kind: 'image',
            nodeId,
            modelName: imageModel,
            providerName: provider.providerName,
            executionContext: concurrencyCtx,
            request: req.body,
            appContext: req.app.locals,
            provider,
            coordinator: generationCoordinator,
            saveResult: (providerResult) => {
                const results = Array.isArray(providerResult) ? providerResult : [providerResult];
                const savedResults = results.map((item, index) => {
                    const assetId = index === 0
                        ? (nodeId || generateAssetId())
                        : `${nodeId || generateAssetId()}-${index}`;
                    const saved = saveMediaBufferToFile(
                        item.buffer,
                        projectId || 'default',
                        'images',
                        item.format,
                        {
                            id: assetId,
                            prompt,
                            model: imageModel,
                            mode: imageMode || '',
                            aspectRatio,
                            resolution,
                            ...(provider.providerName === 'SeedVr2ImageProvider'
                                ? { cost: null, costStatus: 'unknown', operation: 'seedvr2-upscale' }
                                : { cost: typeof cost === 'number' ? cost : 0 })
                        },
                        assetId
                    );
                    return saved.url;
                });
                return savedResults.length === 1
                    ? { resultUrl: savedResults[0], type: 'image' }
                    : { resultUrls: savedResults, type: 'image' };
            }
        });
        telemetryCall?.success();
        return response.resultUrls
            ? res.json({ resultUrls: response.resultUrls })
            : res.json({ resultUrl: response.resultUrl });
    } catch (error) {
        telemetryCall?.fail(error);
        sendGenerationError(res, error, 'Server Image Gen Error:');
    }
});

// ============================================================================
// VIDEO GENERATION
// ============================================================================

router.post('/generate-video', async (req, res) => {
    const { videoModel, nodeId, prompt, aspectRatio, resolution, duration, projectId, cost, videoMode } = req.body;
    let telemetryCall;
    try {
        const modelConfig = modelConfigFor(getModelRegistry(), videoModel);
        const effectiveDuration = normalizeModelDuration(modelConfig, duration);
        const normalizedRequest = effectiveDuration == null
            ? req.body
            : { ...req.body, duration: effectiveDuration };
        const provider = PROVIDERS.get(videoModel);
        if (!provider || !provider.generateVideo) {
            return res.status(400).json({
                error: `Unsupported or disabled video model: ${videoModel}`,
                code: 'UNSUPPORTED_GENERATION_PROVIDER',
                retryable: false
            });
        }
        const concurrencyCtx = resolveFinalExecutionContext(videoModel, videoMode);
        if (!concurrencyCtx) {
            return res.status(400).json({ error: `Cannot resolve concurrency key for model: ${videoModel}` });
        }
        telemetryCall = beginTelemetry(req, {
            kind: 'video', modelName: videoModel, providerName: provider.providerName,
            executionContext: concurrencyCtx, mode: videoMode
        });
        const response = await executeGenerationTask({
            kind: 'video',
            nodeId,
            modelName: videoModel,
            providerName: provider.providerName,
            executionContext: concurrencyCtx,
            request: normalizedRequest,
            appContext: req.app.locals,
            provider,
            coordinator: generationCoordinator,
            saveResult: ({ buffer, format }) => {
                const assetId = nodeId || generateAssetId();
                const saved = saveMediaBufferToFile(
                    buffer,
                    projectId || 'default',
                    'videos',
                    format || 'mp4',
                    {
                        id: assetId,
                        prompt,
                        model: videoModel,
                        mode: videoMode || '',
                        aspectRatio,
                        resolution,
                        duration: normalizedRequest.duration,
                        cost: typeof cost === 'number' ? cost : 0
                    },
                    assetId
                );
                return { resultUrl: saved.url, type: 'video' };
            }
        });
        telemetryCall?.success();
        console.log('[Generation] 视频生成成功', { nodeId, videoModel, resultUrl: response.resultUrl });
        return res.json({ resultUrl: response.resultUrl });
    } catch (error) {
        telemetryCall?.fail(error);
        sendGenerationError(res, error, 'Server Video Gen Error:');
    }
});

// ============================================================================
// AUDIO GENERATION
// ============================================================================

router.post('/generate-audio', async (req, res) => {
    const { audioModel, nodeId, prompt, projectId, cost, audioMode } = req.body;
    let telemetryCall;
    try {
        const provider = PROVIDERS.get(audioModel);
        if (!provider || !provider.generateAudio) {
            return res.status(400).json({
                error: `Unsupported or disabled audio model: ${audioModel}`,
                code: 'UNSUPPORTED_GENERATION_PROVIDER',
                retryable: false
            });
        }
        const concurrencyCtx = resolveFinalExecutionContext(audioModel, audioMode);
        if (!concurrencyCtx) {
            return res.status(400).json({ error: `Cannot resolve concurrency key for model: ${audioModel}` });
        }
        telemetryCall = beginTelemetry(req, {
            kind: 'audio', modelName: audioModel, providerName: provider.providerName,
            executionContext: concurrencyCtx, mode: audioMode
        });
        console.log(`[Generation] Routing audio request to model: ${audioModel}, project: ${projectId}`);
        const response = await executeGenerationTask({
            kind: 'audio',
            nodeId,
            modelName: audioModel,
            providerName: provider.providerName,
            executionContext: concurrencyCtx,
            request: req.body,
            appContext: req.app.locals,
            provider,
            coordinator: generationCoordinator,
            saveResult: (providerResult) => {
                const results = Array.isArray(providerResult) ? providerResult : [providerResult];
                const savedResults = results.map(({ buffer, format }, index) => {
                    const assetId = index === 0
                        ? (nodeId || generateAssetId())
                        : `${nodeId || generateAssetId()}-${index}`;
                    return saveMediaBufferToFile(
                        buffer,
                        projectId || 'default',
                        'audios',
                        format || 'mp3',
                        {
                            id: assetId,
                            prompt,
                            model: audioModel,
                            mode: audioMode || '',
                            cost: typeof cost === 'number' ? cost : 0
                        },
                        assetId
                    ).url;
                });
                return savedResults.length === 1
                    ? { resultUrl: savedResults[0], type: 'audio' }
                    : { resultUrls: savedResults, type: 'audio' };
            }
        });
        telemetryCall?.success();
        return response.resultUrls
            ? res.json({ resultUrls: response.resultUrls })
            : res.json({ resultUrl: response.resultUrl });
    } catch (error) {
        telemetryCall?.fail(error);
        sendGenerationError(res, error, 'Server Audio Gen Error:');
    }
});

// ============================================================================
// TEXT GENERATION
// ============================================================================

router.post('/generate-text', async (req, res) => {
    const { textModel, nodeId, projectId } = req.body;
    let telemetryCall;
    try {
        const provider = PROVIDERS.get(textModel);
        if (!provider || !provider.generateText) {
            return res.status(400).json({
                error: `Unsupported or disabled text model: ${textModel}`,
                code: 'UNSUPPORTED_GENERATION_PROVIDER',
                retryable: false
            });
        }
        const concurrencyCtx = resolveFinalExecutionContext(textModel, req.body.languageMode || req.body.mode);
        if (!concurrencyCtx) {
            return res.status(400).json({ error: `Cannot resolve concurrency key for model: ${textModel}` });
        }
        telemetryCall = beginTelemetry(req, {
            kind: 'text', modelName: textModel, providerName: provider.providerName,
            executionContext: concurrencyCtx, mode: req.body.languageMode || req.body.mode
        });
        console.log(`[Generation] Routing text request to model: ${textModel}, project: ${projectId}`);
        const response = await executeGenerationTask({
            kind: 'text',
            nodeId,
            modelName: textModel,
            providerName: provider.providerName,
            executionContext: concurrencyCtx,
            request: req.body,
            appContext: req.app.locals,
            provider,
            coordinator: generationCoordinator,
            saveResult: (providerResult) => {
                const persistedResult = {
                    ...providerResult,
                    type: 'text',
                    createdAt: new Date().toISOString(),
                    model: textModel
                };
                if (nodeId) {
                    const cache = req.app.locals.textResultCache || new Map();
                    cache.set(nodeId, persistedResult);
                    req.app.locals.textResultCache = cache;
                }
                return persistedResult;
            }
        });
        telemetryCall?.success();
        const publicResponse = { ...response };
        delete publicResponse.type;
        delete publicResponse.createdAt;
        delete publicResponse.model;
        return res.json(publicResponse);
    } catch (error) {
        telemetryCall?.fail(error);
        sendGenerationError(res, error, 'Server Text Gen Error:');
    }
});

/**
 * 查询模型并发状态（前端用于禁用生成按钮）。
 */
router.get('/generation-concurrency', (req, res) => {
    try {
        const modelName = String(req.query.modelName || '');
        const mode = String(req.query.mode || '');
        if (!modelName) {
            return res.status(400).json({ error: 'modelName is required' });
        }

        const concurrencyCtx = resolveFinalExecutionContext(modelName, mode);
        if (!concurrencyCtx) {
            return res.status(400).json({ error: `Cannot resolve concurrency key for model: ${modelName}` });
        }

        const concurrency = generationCoordinator.getConcurrency(
            concurrencyCtx.modelIdKey,
            concurrencyCtx.maxConcurrent
        );
        return res.json({
            modelName,
            mode,
            modelId: concurrencyCtx.finalModelId,
            url: concurrencyCtx.rawUrl,
            key: concurrencyCtx.modelIdKey,
            ...concurrency
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'generation concurrency check failed' });
    }
});

// ============================================================================
// ASSET LOCALIZATION
// ============================================================================

router.post('/localize-asset', async (req, res) => {
    const { url, projectId, type } = req.body;
    try {
        const saved = await downloadAndSaveAsset(url, projectId || 'default', type || 'images');
        res.json(saved);
    } catch (error) {
        console.error("Localization Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// STATUS / RECOVERY
// ============================================================================

const recoverTask = createGenerationTaskRecovery({
    coordinator: generationCoordinator,
    resolveProvider: (task) => {
        const provider = PROVIDERS.get(task.modelName);
        const suffix = task.kind === 'image' ? 'Image' : 'Video';
        if (provider?.providerName !== task.providerName || !provider?.[`recover${suffix}`]) return null;
        const params = provider.recoveryParameters(task);
        return {
            canRecover: (reference, context) => provider[`canRecover${suffix}`](reference, params, context),
            recover: (record, context, signal) => provider[`recover${suffix}`](task.kind === 'image' ? record : record.remoteTask, params, context, signal),
        };
    },
    saveResult: ({ buffer, format, results }, task) => {
        if (task.kind === 'image') {
            const resultUrls = results.map((image) => saveMediaBufferToFile(image.buffer, task.projectId || 'default', 'images', image.format, {
                prompt: task.prompt, model: task.modelName, mode: task.imageMode || '',
                aspectRatio: task.aspectRatio, resolution: task.resolution,
                ...(task.providerName === 'SeedVr2ImageProvider'
                    ? { cost: null, costStatus: 'unknown', operation: 'seedvr2-upscale' }
                    : { cost: task.estimatedCost || 0 }), generationAttemptId: task.attemptId,
            }, task.nodeId).url);
            return { resultUrl: resultUrls[0], resultUrls, type: 'image' };
        }
        const saved = saveMediaBufferToFile(buffer, task.projectId || 'default', 'videos', format || 'mp4', {
            prompt: task.prompt, model: task.modelName, mode: task.videoMode || '',
            aspectRatio: task.aspectRatio, resolution: task.resolution, duration: task.duration,
            cost: task.estimatedCost || 0, generationAttemptId: task.attemptId,
        }, task.nodeId);
        return { resultUrl: saved.url, type: 'video' };
    },
});
router.use(createGenerationRecoveryRouter({
    coordinator: generationCoordinator,
    getUrlPrefix,
    recoverTask,
}));

return router;
}
