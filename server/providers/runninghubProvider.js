import { BaseProvider } from './baseProvider.js';
import { buildJsonFetchOptions, submitJsonWithLogs } from './providerKit.js';
import { matchesRemoteTask, remoteTaskReference } from '../generation/generationTaskRecovery.js';
import { validateRecoveredVideo } from '../media/recoveredVideo.js';
import sharp from 'sharp';

const DEFAULT_BASE_URL = 'https://www.runninghub.cn';

function trimSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function setting(config, key, fallback = '') {
    const value = config?.[key] ?? process.env[key] ?? fallback;
    return String(value ?? '').trim();
}

function scopedSetting(config, scope, key, fallback = '') {
    return setting(config, `RUNNINGHUB_${scope}_${key}`, setting(config, `RUNNINGHUB_${key}`, fallback));
}

function numberSetting(config, scope, key) {
    const value = scopedSetting(config, scope, key, '');
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function splitList(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function parseJsonList(value, label) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) throw new Error('value is not an array');
        return parsed;
    } catch (error) {
        throw new Error(`${label} must be a JSON array: ${error.message}`, { cause: error });
    }
}

function hasMeaningfulValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(value);
}

/**
 * RunningHub 的标准模型 API 只认「企业级-共享」那把 Key，个人 Key 一律回 1014。
 * 原文只说「仅限企业级-共享API Key调用」，不说去哪换——补一句去处，
 * 否则用户只能怀疑是自己填错了密钥，反复重填同一把。
 */
const RUNNINGHUB_ERROR_HINTS = Object.freeze({
    1014: '请到 RunningHub 控制台的「密钥」页改用「企业级-共享」API Key，个人 Key 调不了标准模型。',
});

export function formatRunningHubError(result, fallback = 'RunningHub task failed.') {
    if (!result || typeof result !== 'object') return fallback;
    const hint = RUNNINGHUB_ERROR_HINTS[Number(result.errorCode)];
    if (hint) return `${result.errorMessage || result.msg || ''} ${hint}`.trim();
    const candidates = [
        result.errorMessage,
        result.msg,
        result.message,
        result.errorCode,
        result.failedReason
    ];
    const meaningful = candidates.find(hasMeaningfulValue);
    if (!hasMeaningfulValue(meaningful)) return fallback;
    return typeof meaningful === 'string' ? meaningful : JSON.stringify(meaningful);
}

function cloneNodeInfoList(nodes) {
    return (nodes || []).map(node => ({ ...node }));
}

function upsertNodeInfo(nodes, { nodeId, fieldName, fieldValue }) {
    if (!nodeId || !fieldName) return false;
    const existing = nodes.find(node => String(node.nodeId) === String(nodeId) && node.fieldName === fieldName);
    if (existing) {
        existing.fieldValue = fieldValue;
        return true;
    }
    nodes.push({ nodeId: String(nodeId), fieldName, fieldValue });
    return true;
}

function findPromptNode(nodes) {
    return nodes.find(node =>
        /prompt|text|positive|caption/i.test(String(node.fieldName || '')) &&
        !/negative/i.test(String(node.fieldName || ''))
    ) || nodes.find(node => {
        const type = String(node.fieldType || '').toUpperCase();
        const desc = `${node.description || ''} ${node.descriptionEn || ''}`;
        return type === 'STRING' && /prompt|text|input|文本|提示|输入/i.test(desc);
    }) || nodes.find(node => String(node.fieldType || '').toUpperCase() === 'STRING');
}

function findMediaNode(nodes, mediaType) {
    const type = mediaType.toUpperCase();
    const fieldHints = {
        image: /image|upload/i,
        video: /video/i,
        audio: /audio/i
    };
    return nodes.find(node => String(node.fieldType || '').toUpperCase() === type) ||
        nodes.find(node => fieldHints[mediaType]?.test(String(node.fieldName || '')));
}

function findFieldNode(nodes, fieldNames) {
    return nodes.find(node => fieldNames.some(fieldName => String(node.fieldName || '').toLowerCase() === fieldName)) ||
        nodes.find(node => fieldNames.some(fieldName => String(node.fieldName || '').toLowerCase().includes(fieldName)));
}

function inferMimeFromUrl(value, fallback = 'application/octet-stream') {
    return BaseProvider.getMimeType(String(value || '').split('?')[0]) || fallback;
}

function extensionFromMime(mimeType, fallback = 'bin') {
    const map = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav'
    };
    return map[mimeType] || fallback;
}

function normalizeRhartResolution(resolution) {
    const value = String(resolution || '1K').trim().toLowerCase();
    if (value === '512') return '1k';
    if (['1k', '2k', '4k'].includes(value)) return value;
    return '1k';
}

function normalizeRhartAspectRatio(aspectRatio) {
    const value = String(aspectRatio || '1:1').trim();
    return value && value !== 'Auto' ? value : '1:1';
}

function bufferFromDataUrl(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
        buffer: Buffer.from(match[2], 'base64'),
        mimeType: match[1]
    };
}

async function assetToUploadPayload(asset, useProxy) {
    if (!asset) return null;
    if (asset.startsWith('data:')) {
        const parsed = bufferFromDataUrl(asset);
        if (!parsed) return null;
        return parsed;
    }

    if (/^https?:\/\//i.test(asset)) {
        const buffer = await BaseProvider.asyncDownloadToBuffer(asset, useProxy);
        return {
            buffer,
            mimeType: inferMimeFromUrl(asset)
        };
    }

    return null;
}

async function uploadRunningHubAsset({ baseUrl, apiKey, asset, mediaType, params }) {
    const payload = await assetToUploadPayload(asset, params.useProxy);
    if (!payload) {
        throw new Error('RunningHub input asset could not be resolved for upload.');
    }

    const ext = extensionFromMime(payload.mimeType, mediaType === 'video' ? 'mp4' : 'png');
    const file = new Blob([payload.buffer], { type: payload.mimeType });
    const form = new FormData();
    form.append('file', file, `fisherai-${Date.now()}.${ext}`);

    const fetchOptions = {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`
        },
        body: form
    };
    BaseProvider.injectProxy(fetchOptions, params.useProxy);

    const response = await BaseProvider.fetch(`${baseUrl}/openapi/v2/media/upload/binary`, fetchOptions);
    const result = await response.json();
    BaseProvider.saveDebugLog(params.logsDir, 'RUNNINGHUB_UPLOAD_RES', params.nodeId, result, params.projectId);

    if (!response.ok || Number(result.code) !== 0) {
        throw new Error(`RunningHub upload failed: ${result.message || result.msg || response.statusText}`);
    }

    const fileName = result.data?.fileName;
    const downloadUrl = result.data?.download_url || result.data?.downloadUrl || result.data?.downloadURL;
    if (!fileName && !downloadUrl) throw new Error('RunningHub upload did not return data.fileName or data.download_url.');
    return { fileName, downloadUrl };
}

async function fetchAiAppDemo({ baseUrl, apiKey, webappId, params }) {
    const url = `${baseUrl}/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(apiKey)}&webappId=${encodeURIComponent(webappId)}`;
    const fetchOptions = {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`
        }
    };
    BaseProvider.injectProxy(fetchOptions, params.useProxy);

    const response = await BaseProvider.fetch(url, fetchOptions);
    const result = await response.json();
    BaseProvider.saveDebugLog(params.logsDir, 'RUNNINGHUB_APP_DEMO_RES', params.nodeId, result, params.projectId);

    if (!response.ok || Number(result.code) !== 0) {
        throw new Error(`RunningHub AI app demo fetch failed: ${result.msg || result.message || response.statusText}`);
    }

    return result.data?.nodeInfoList || [];
}

function buildScopedConfig(config, scope) {
    const apiKey = setting(config, 'RUNNINGHUB_API_KEY');
    if (!apiKey) throw new Error('RunningHub API Key is not configured. Set RUNNINGHUB_API_KEY in Settings or .env.');

    const baseUrl = trimSlash(setting(config, 'RUNNINGHUB_BASE_URL', DEFAULT_BASE_URL));
    const webappId = scopedSetting(config, scope, 'WEBAPP_ID');
    const workflowId = scopedSetting(config, scope, 'WORKFLOW_ID');
    const explicitMode = scopedSetting(config, scope, 'MODE').toLowerCase();
    const mode = explicitMode || (webappId ? 'ai-app' : 'workflow');

    return {
        apiKey,
        baseUrl,
        mode,
        webappId,
        workflowId,
        accessPassword: scopedSetting(config, scope, 'ACCESS_PASSWORD'),
        instanceType: scopedSetting(config, scope, 'INSTANCE_TYPE'),
        retainSeconds: numberSetting(config, scope, 'RETAIN_SECONDS'),
        nodeInfoJson: scopedSetting(config, scope, 'NODE_INFO_JSON')
    };
}

function applyScalarInputs(nodes, config, scope, params) {
    const promptNodeId = scopedSetting(config, scope, 'PROMPT_NODE_ID');
    const promptField = scopedSetting(config, scope, 'PROMPT_FIELD', 'prompt');
    if (promptNodeId) {
        upsertNodeInfo(nodes, { nodeId: promptNodeId, fieldName: promptField, fieldValue: params.prompt || '' });
    } else {
        const promptNode = findPromptNode(nodes);
        if (promptNode) promptNode.fieldValue = params.prompt || '';
    }

    const aspectNodeId = scopedSetting(config, scope, 'ASPECT_NODE_ID');
    const aspectField = scopedSetting(config, scope, 'ASPECT_FIELD', 'aspect_ratio');
    if (params.aspectRatio && aspectNodeId) {
        upsertNodeInfo(nodes, { nodeId: aspectNodeId, fieldName: aspectField, fieldValue: params.aspectRatio });
    } else if (params.aspectRatio) {
        const aspectNode = findFieldNode(nodes, ['aspect_ratio', 'ratio']);
        if (aspectNode) aspectNode.fieldValue = params.aspectRatio;
    }

    const durationNodeId = scopedSetting(config, scope, 'DURATION_NODE_ID');
    const durationField = scopedSetting(config, scope, 'DURATION_FIELD', 'duration');
    if (params.duration && durationNodeId) {
        upsertNodeInfo(nodes, { nodeId: durationNodeId, fieldName: durationField, fieldValue: String(params.duration) });
    }

    const modelNodeId = scopedSetting(config, scope, 'MODEL_NODE_ID');
    const modelField = scopedSetting(config, scope, 'MODEL_FIELD', 'model');
    const modelValue = scopedSetting(config, scope, 'MODEL_VALUE');
    if (modelValue && modelNodeId) {
        upsertNodeInfo(nodes, { nodeId: modelNodeId, fieldName: modelField, fieldValue: modelValue });
    } else if (modelValue) {
        const modelNode = findFieldNode(nodes, ['model']);
        if (modelNode) modelNode.fieldValue = modelValue;
    }
}

async function applyMediaInputs(nodes, config, scope, params, mediaType, assets) {
    if (!assets.length) return;

    const fieldFallback = mediaType === 'image' ? 'image' : mediaType;
    const configuredIds = splitList(scopedSetting(config, scope, `${mediaType.toUpperCase()}_NODE_ID`) ||
        scopedSetting(config, scope, 'INPUT_NODE_ID'));
    const fieldName = scopedSetting(config, scope, `${mediaType.toUpperCase()}_FIELD`, scopedSetting(config, scope, 'INPUT_FIELD', fieldFallback));

    const targets = configuredIds.length
        ? configuredIds.map(nodeId => ({ nodeId, fieldName }))
        : [findMediaNode(nodes, mediaType)].filter(Boolean).map(node => ({ nodeId: node.nodeId, fieldName: node.fieldName || fieldName }));

    if (!targets.length) return;

    for (let i = 0; i < Math.min(targets.length, assets.length); i++) {
        const uploaded = await uploadRunningHubAsset({
            baseUrl: params.baseUrl,
            apiKey: params.apiKey,
            asset: assets[i],
            mediaType,
            params
        });
        if (!uploaded.fileName) {
            throw new Error('RunningHub upload did not return data.fileName for workflow node input.');
        }
        upsertNodeInfo(nodes, {
            nodeId: targets[i].nodeId,
            fieldName: targets[i].fieldName,
            fieldValue: uploaded.fileName
        });
    }
}

async function buildNodeInfoList({ config, scope, params, mediaKind }) {
    const rh = buildScopedConfig(config, scope);
    const baseJson = parseJsonList(rh.nodeInfoJson, `RUNNINGHUB_${scope}_NODE_INFO_JSON`);
    let nodes = cloneNodeInfoList(baseJson);

    if (rh.mode === 'ai-app') {
        if (!rh.webappId) throw new Error(`RUNNINGHUB_${scope}_WEBAPP_ID is required for RunningHub AI app mode.`);
        if (nodes.length === 0) {
            nodes = cloneNodeInfoList(await fetchAiAppDemo({
                baseUrl: rh.baseUrl,
                apiKey: rh.apiKey,
                webappId: rh.webappId,
                params: { ...params, ...rh }
            }));
        }
    } else if (!rh.workflowId) {
        throw new Error(`RUNNINGHUB_${scope}_WORKFLOW_ID is required for RunningHub workflow mode.`);
    }

    applyScalarInputs(nodes, config, scope, params);

    const assets = BaseProvider.getAssets(params);
    await applyMediaInputs(nodes, config, scope, { ...params, ...rh }, 'image', assets.images);
    if (mediaKind === 'video') {
        await applyMediaInputs(nodes, config, scope, { ...params, ...rh }, 'video', assets.videos);
        await applyMediaInputs(nodes, config, scope, { ...params, ...rh }, 'audio', assets.audios);
    }

    const hasPrompt = nodes.some(node => String(node.fieldValue || '').includes(params.prompt || ''));
    if (!hasPrompt && !scopedSetting(config, scope, 'PROMPT_NODE_ID')) {
        throw new Error(`RunningHub prompt node could not be inferred. Set RUNNINGHUB_${scope}_PROMPT_NODE_ID and RUNNINGHUB_${scope}_PROMPT_FIELD.`);
    }

    return { rh, nodes };
}

async function submitRunningHubTask({ config, scope, params, mediaKind }) {
    const { rh, nodes } = await buildNodeInfoList({ config, scope, params, mediaKind });
    const isAiApp = rh.mode === 'ai-app';
    const submitPath = isAiApp ? '/task/openapi/ai-app/run' : '/task/openapi/create';
    const body = {
        apiKey: rh.apiKey,
        nodeInfoList: nodes
    };

    if (isAiApp) {
        body.webappId = rh.webappId;
    } else {
        body.workflowId = rh.workflowId;
    }
    if (rh.instanceType) body.instanceType = rh.instanceType;
    if (rh.accessPassword) body.accessPassword = rh.accessPassword;
    if (rh.retainSeconds) body.retainSeconds = rh.retainSeconds;

    const result = await submitJsonWithLogs({
        url: `${rh.baseUrl}${submitPath}`,
        fetchOptions: buildJsonFetchOptions({
            headers: {
                Host: 'www.runninghub.cn',
                Authorization: `Bearer ${rh.apiKey}`
            },
            body
        }),
        nodeId: params.nodeId,
        logsDir: params.logsDir,
        modelId: `runninghub-${scope.toLowerCase()}`,
        projectId: params.projectId,
        useProxy: params.useProxy,
        logBody: { ...body, apiKey: '[RUNNINGHUB_API_KEY]' }
    });

    if (Number(result.code) !== 0) {
        throw new Error(`RunningHub submit failed: ${result.msg || result.message || JSON.stringify(result)}`);
    }

    const taskId = result.data?.taskId;
    if (!taskId) throw new Error('RunningHub submit response did not include data.taskId.');
    return { taskId, rh };
}

/**
 * RH CN 站与 RH AI站是两个互不相通的账号：各自注册、各自充值、各自的 API Key。
 * 「全能图片」整个标准模型系列已从 CN 站下线迁到 AI 站，所以它们必须走这一套凭证，
 * 不能共用 RUNNINGHUB_API_KEY——共用的话填了 CN 的密钥会把 AI 站的模型显示成"可用"，
 * 用户点下去才发现调不通，而且账单去向也说不清。
 */
export const RUNNINGHUB_CN_CREDENTIALS = Object.freeze({
    apiKeyName: 'RUNNINGHUB_API_KEY',
    baseUrlName: 'RUNNINGHUB_BASE_URL',
    defaultBaseUrl: DEFAULT_BASE_URL,
    label: 'RH CN 站',
});

export const RUNNINGHUB_GLOBAL_CREDENTIALS = Object.freeze({
    apiKeyName: 'RUNNINGHUB_GLOBAL_API_KEY',
    baseUrlName: 'RUNNINGHUB_GLOBAL_BASE_URL',
    defaultBaseUrl: 'https://www.runninghub.ai',
        label: 'RH AI站',
});

function buildStandardImageConfig(config, credentials = RUNNINGHUB_CN_CREDENTIALS) {
    const apiKey = setting(config, credentials.apiKeyName);
    if (!apiKey) {
        throw new Error(`${credentials.label} API Key 未配置。请在设置中填写 ${credentials.apiKeyName}。`);
    }

    return {
        apiKey,
        baseUrl: trimSlash(setting(config, credentials.baseUrlName, credentials.defaultBaseUrl))
    };
}

function resolveRunningHubStandardUrl(baseUrl, configuredUrl, fallbackPath) {
    const value = String(configuredUrl || fallbackPath || '').trim();
    if (/^https?:\/\//i.test(value)) return value;

    const path = value.replace(/^\/+/, '');
    if (/^rhart-/i.test(path)) {
        return `${baseUrl}/openapi/v2/${path}`;
    }
    return `${baseUrl}/${path || String(fallbackPath || '').replace(/^\/+/, '')}`;
}

function shouldUseStandardImageApi(params, config) {
    const explicitMode = scopedSetting(config, 'IMAGE', 'MODE').toLowerCase();
    if (['ai-app', 'workflow'].includes(explicitMode)) return false;
    if (['standard', 'standard-model', 'model', 'rhart'].includes(explicitMode)) return true;

    // /openapi/v2/ 就是标准模型 API 的前缀，认前缀而不是认末段动作名。
    // 早前只认 text-to-image / image-to-image 两个末段，于是
    // /alibaba/qwen-image-3.0/image-edit、/seedream-v5-pro/layer-decomposition、
    // /rhart-image-n-pro/edit 这些会被判成"不是标准模型"，掉进工作流分支，
    // 报一句莫名其妙的「WEBAPP_ID is required」。
    const url = String(params.url || '');
    return /\/openapi\/v2\//i.test(url) || /rhart-image-g-2/i.test(url);
}

async function resolveStandardImageUrls({ rh, params, assets }) {
    if (!assets.length) {
        throw new Error('RunningHub RHArt image-to-image requires at least one input image.');
    }

    const imageUrls = [];
    for (const asset of assets.slice(0, 10)) {
        const uploaded = await uploadRunningHubAsset({
            baseUrl: rh.baseUrl,
            apiKey: rh.apiKey,
            asset,
            mediaType: 'image',
            params
        });
        if (!uploaded.downloadUrl) {
            throw new Error('RunningHub upload did not return data.download_url for standard model image input.');
        }
        imageUrls.push(uploaded.downloadUrl);
    }
    return imageUrls;
}

/**
 * 标准模型的请求体。
 *
 * gpt-image-2 的官方稳定版把 quality 列为**必填**（详情页参数表带 *，Playground 默认 medium），
 * 不带这个字段请求会被直接打回——这跟价格无关，是条链路能不能通的问题。
 * 其它模型没有这个参数，多传会被当成未知字段，所以只对这一族补。
 *
 * 而且钉死在 medium：目录里那份 ¥ 单价就是按 medium 档折算的。
 * 放开让用户选画质而价格不跟着变，high 档会把费用少报 3.7 倍
 * （medium 1K $0.054，high 1K $0.198）。要支持 high 得单独开一条目录条目。
 */
export function buildStandardImageBody(finalUrl, params) {
    const body = {
        prompt: params.prompt || '',
        aspectRatio: normalizeRhartAspectRatio(params.aspectRatio),
        resolution: normalizeRhartResolution(params.resolution)
    };
    // 认接口路径里的 slug，不是 RH 页面上的显示名：显示名叫 gpt-image-2/…/stable，
    // 真实路径是 /rhart-image-g-2-official/…。低价渠道 /rhart-image-g-2/… 没有这个参数，
    // 多传会被当成非法字段，所以必须带 -official 才匹配。
    if (/\/rhart-image-g-2-official\//i.test(String(finalUrl || ''))) {
        // 写死 medium，连传进来的 quality 都不认：目录里的 cost 只按分辨率索引，
        // 表达不了画质这一维。让画质可变而报价不变，等于按 medium 报价、按 high 收钱。
        body.quality = 'medium';
    }
    return body;
}

async function submitRunningHubStandardImageTask({ config, params, credentials }) {
    const recoveryContext = standardRecoveryContext(params, config, credentials, 'image');
    const rh = recoveryContext;
    const finalUrl = recoveryContext.submitUrl;
    const requestMode = /\/image-to-image(?:\?|$)/i.test(finalUrl) || params.imageMode === 'image-to-image'
        ? 'image-to-image'
        : 'text-to-image';

    const body = buildStandardImageBody(finalUrl, params);

    if (requestMode === 'image-to-image') {
        const assets = BaseProvider.getAssets(params).images;
        body.imageUrls = await resolveStandardImageUrls({ rh, params, assets });
    }

    return submitStandardTask({ config, params, recoveryContext, body });
}

async function pollRunningHubResult({ rh, taskId, params, scope }) {
    return BaseProvider.pollTask({
        interval: 5000,
        timeoutMs: BaseProvider.parseTimeToMs(params.timeEstimate || '10min') * Math.max(1, Number(params.generateCount || 1)),
        pollFn: async () => {
            const fetchOptions = buildJsonFetchOptions({
                headers: {
                    Authorization: `Bearer ${rh.apiKey}`
                },
                body: { taskId }
            });
            BaseProvider.injectProxy(fetchOptions, params.useProxy);
            const response = await BaseProvider.fetch(`${rh.baseUrl}/openapi/v2/query`, fetchOptions);
            const result = await response.json();
            BaseProvider.saveDebugLog(params.logsDir, `RUNNINGHUB_${scope}_POLL_RES`, params.nodeId, result, params.projectId);

            if (!response.ok) {
                return { error: `RunningHub query failed: ${response.statusText}` };
            }

            const status = String(result.status || result.data || '').toUpperCase();
            if (status === 'SUCCESS') return { done: true, data: result.results || [] };
            if (status === 'FAILED' || hasMeaningfulValue(result.failedReason)) {
                return { error: formatRunningHubError(result) };
            }
            if (hasMeaningfulValue(result.errorCode) || hasMeaningfulValue(result.errorMessage)) {
                return { error: formatRunningHubError(result) };
            }
            return { done: false, progress: status || 'RUNNING' };
        }
    });
}

function outputExt(item, fallback) {
    const raw = String(item.outputType || item.fileType || '').replace(/^\./, '').toLowerCase();
    if (raw) return raw === 'jpeg' ? 'jpg' : raw;
    const url = String(item.url || item.fileUrl || '');
    const match = url.split('?')[0].match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : fallback;
}

async function downloadResults(results, params, mediaKind) {
    const urls = (results || [])
        .map(item => ({ url: item.url || item.fileUrl, ext: outputExt(item, mediaKind === 'video' ? 'mp4' : 'png') }))
        .filter(item => item.url);
    if (!urls.length) throw new Error('RunningHub task completed but returned no result URLs.');

    const downloaded = await Promise.all(urls.map(async item => ({
        buffer: await BaseProvider.asyncDownloadToBuffer(item.url, params.useProxy),
        format: item.ext
    })));

    return downloaded.length === 1 ? downloaded[0] : downloaded;
}

async function generateWithRunningHub(params, config, scope, mediaKind) {
    const scopedParams = {
        ...params,
        logsDir: config.LOGS_DIR
    };
    const { taskId, rh } = await submitRunningHubTask({ config, scope, params: scopedParams, mediaKind });
    const results = await pollRunningHubResult({ rh, taskId, params: scopedParams, scope });
    return downloadResults(results, scopedParams, mediaKind);
}

async function generateWithRunningHubStandardImage(params, config, credentials) {
    const scopedParams = {
        ...params,
        logsDir: config.LOGS_DIR
    };
    const { taskId, rh, initialResults } = await submitRunningHubStandardImageTask({
        config,
        params: scopedParams,
        credentials
    });
    return finishStandardTask({ rh, taskId, initialResults, params: scopedParams, kind: 'image' });
}

export const RunningHubImageProvider = {
    canRecoverImage: (reference, params, config) => canRecoverStandard(reference, params, config, RUNNINGHUB_CN_CREDENTIALS, 'image'),
    recoverImage: (task, params, config, signal) => recoverStandardImage(task, params, config, RUNNINGHUB_CN_CREDENTIALS, signal),
    async generateImage(params, config) {
        if (shouldUseStandardImageApi(params, config)) {
            return generateWithRunningHubStandardImage(params, config, RUNNINGHUB_CN_CREDENTIALS);
        }
        return generateWithRunningHub(params, config, 'IMAGE', 'image');
    }
};

/**
 * RH AI站（runninghub.ai）的标准模型。只有凭证与默认地址不同，
 * 请求体、轮询、素材上传与 CN 站完全一致——迁站只换了域名，路径和 slug 都没动。
 */
export const RunningHubGlobalImageProvider = {
    canRecoverImage: (reference, params, config) => canRecoverStandard(reference, params, config, RUNNINGHUB_GLOBAL_CREDENTIALS, 'image'),
    recoverImage: (task, params, config, signal) => recoverStandardImage(task, params, config, RUNNINGHUB_GLOBAL_CREDENTIALS, signal),
    async generateImage(params, config) {
        return generateWithRunningHubStandardImage(params, config, RUNNINGHUB_GLOBAL_CREDENTIALS);
    }
};

/**
 * 视频分辨率原样传。
 *
 * 别复用图片那个 normalizeRhartResolution——它把一切不认识的都压成 1k，
 * 视频档位是 480p/540p/720p/1080p/2k/4k，压完就全成 1k 了，
 * 用户选 1080p 却出 480p，而且账单还按 1080p 报。
 */
function normalizeVideoResolution(resolution) {
    const value = String(resolution || '720p').trim().toLowerCase();
    return /^(480p|540p|720p|1080p|2k|4k)$/.test(value) ? value : '720p';
}

/**
 * 从接口路径的末段判断这次是哪种生成，决定要不要上传素材、上传什么。
 * 认路径不认节点的模式名：同一个模式名在不同模型上可能落到不同末段。
 */
export function standardVideoMode(finalUrl) {
    const path = String(finalUrl || '').split('?')[0];
    if (/\/(video-edit|edit-video)$/i.test(path)) return 'video-edit';
    if (/\/multimodal-video$/i.test(path)) return 'multimodal-video';
    if (/\/(reference-to-video|video-to-video)$/i.test(path)) return 'reference-to-video';
    if (/\/(image-to-video|first-last-frame|start-end-to-video|multi-image-to-video)$/i.test(path)) return 'image-to-video';
    return 'text-to-video';
}

/**
 * 标准视频的请求体。
 *
 * 音频开关钉死在开：RH 这几个模型（Seedance 1.5 Pro 的 generateAudio、
 * 可灵 o3 的 sound）**价格随它翻倍**，而目录里的 cost 只按分辨率索引，
 * 表达不了这一维。放开让节点自己传，就成了按带音频报价、按无音频出片——
 * 或者反过来按无音报价、按带音收钱。要便宜的无音档得单开一条目录条目。
 * 这和 gpt-image-2 把 quality 钉死在 medium 是同一个理由。
 */
export function buildStandardVideoBody(finalUrl, params) {
    const mode = standardVideoMode(finalUrl);
    const body = { prompt: params.prompt || '' };
    const aspectRatio = normalizeRhartAspectRatio(params.aspectRatio);
    const resolution = normalizeVideoResolution(params.resolution);
    // duration 在 RH 详情页的参数表里带 *，是必填。之前写成"有才传"，
    // 节点没给就整个字段消失，请求会被打回。缺省按 5 秒——
    // 目录里的 ¥/秒 也是按 5 秒片子折算的，两边对齐。
    const duration = Number(params.duration);
    const normalizedDuration = Number.isFinite(duration) && duration > 0 ? duration : 5;

    // 这三家标准视频 API 看起来都是 RHArt，但字段契约并不通用。
    // 只发详情页明确列出的字段；多传 resolution / aspectRatio 也会被上游当成非法参数。
    if (/\/rhart-video\/sparkvideo-2\.0/i.test(finalUrl)) {
        body.resolution = resolution;
        body.duration = normalizedDuration;
        body.ratio = aspectRatio;
        body.generateAudio = true;
        return { body, mode };
    }

    if (/\/kling-video-o3-/i.test(finalUrl)) {
        if (mode === 'video-edit') {
            body.keepOriginalSound = true;
            return { body, mode };
        }
        body.duration = normalizedDuration;
        if (mode === 'text-to-video' || mode === 'reference-to-video') {
            body.aspectRatio = aspectRatio;
        }
        body.sound = true;
        return { body, mode };
    }

    if (/\/vidu\//i.test(finalUrl)) {
        body.resolution = resolution;
        body.duration = normalizedDuration;
        if (mode === 'text-to-video' || mode === 'reference-to-video') {
            body.aspectRatio = aspectRatio;
        }
        if (/q3-/i.test(finalUrl) || /-q3$/i.test(finalUrl)) body.audio = true;
        return { body, mode };
    }

    body.aspectRatio = aspectRatio;
    body.resolution = resolution;
    body.duration = normalizedDuration;
    if (/\/seedance-v1\.5-pro/i.test(finalUrl)) body.generateAudio = true;
    // 可灵 3.0 和 o3 都带 sound 这一维，价格差约 1.5 倍。目录里的 cost 记的是带音价，
    // 所以这里必须钉死开——放开就成了按带音报价、按无音出片。
    if (/\/kling-(video-o3|v3\.0)/i.test(finalUrl)) body.sound = true;
    return { body, mode };
}

export async function uploadStandardVideoInputs({
    rh,
    params,
    finalUrl,
    mode,
    body,
    uploadAsset = uploadRunningHubAsset
}) {
    const assets = BaseProvider.getAssets(params);
    const upload = async (asset, mediaType) => {
        const uploaded = await uploadAsset({
            baseUrl: rh.baseUrl,
            apiKey: rh.apiKey,
            asset,
            mediaType,
            params
        });
        if (!uploaded.downloadUrl) {
            throw new Error('RunningHub upload did not return data.download_url for standard model video input.');
        }
        return uploaded.downloadUrl;
    };

    if (mode === 'multimodal-video') {
        if (!assets.images.length && !assets.videos.length && !assets.audios.length) {
            throw new Error('RunningHub Seedance 全能参考至少需要一个图片、视频或音频素材。');
        }
        if (assets.images.length) {
            body.imageUrls = [];
            for (const asset of assets.images.slice(0, 9)) body.imageUrls.push(await upload(asset, 'image'));
        }
        if (assets.videos.length) {
            body.videoUrls = [];
            for (const asset of assets.videos.slice(0, 3)) body.videoUrls.push(await upload(asset, 'video'));
        }
        if (assets.audios.length) {
            body.audioUrls = [];
            for (const asset of assets.audios.slice(0, 3)) body.audioUrls.push(await upload(asset, 'audio'));
        }
        return;
    }

    if (mode === 'image-to-video') {
        if (!assets.images.length) {
            throw new Error('RunningHub 标准视频的图生视频需要至少一张输入图片。');
        }
        const imageUrls = [];
        for (const asset of assets.images.slice(0, 2)) imageUrls.push(await upload(asset, 'image'));

        if (/\/rhart-video\/sparkvideo-2\.0/i.test(finalUrl)) {
            body.firstFrameUrl = imageUrls[0];
            if (imageUrls[1]) body.lastFrameUrl = imageUrls[1];
        } else if (/\/kling-video-o3-/i.test(finalUrl)) {
            body.firstImageUrl = imageUrls[0];
            if (imageUrls[1]) body.lastImageUrl = imageUrls[1];
        } else if (/\/vidu\/start-end-to-video-/i.test(finalUrl)) {
            body.firstImageUrl = imageUrls[0];
            if (imageUrls[1]) body.lastImageUrl = imageUrls[1];
        } else if (/\/vidu\/image-to-video-/i.test(finalUrl)) {
            body.imageUrl = imageUrls[0];
        } else if (/\/rhart-video-v3\.1-/i.test(finalUrl)) {
            body.imageUrl = imageUrls[0];
            if (imageUrls[1]) body.lastImageUrl = imageUrls[1];
        } else {
            body.imageUrls = imageUrls;
        }
        return;
    }

    if (mode === 'reference-to-video') {
        if (!assets.images.length && !assets.videos.length) {
            throw new Error('RunningHub 标准视频的参考生视频需要至少一张参考图或一段参考视频。');
        }
        // Vidu Q3 只需要 1–7 张参考图；可灵 O3 还能额外接一段视频，
        // 接视频时参考图上限从 7 张降为 4 张。两类接口共用这个动作名，不能把视频设成必填。
        if (assets.images.length) {
            body.imageUrls = [];
            const imageLimit = assets.videos.length ? 4 : 7;
            for (const asset of assets.images.slice(0, imageLimit)) {
                body.imageUrls.push(await upload(asset, 'image'));
            }
        }
        if (assets.videos.length) {
            if (/\/vidu\/reference-to-video-q2-pro/i.test(finalUrl)) {
                body.videos = [];
                for (const asset of assets.videos.slice(0, 3)) body.videos.push(await upload(asset, 'video'));
            } else {
                body.videoUrl = await upload(assets.videos[0], 'video');
            }
        }
        return;
    }

    if (mode === 'video-edit') {
        if (!assets.videos.length) {
            throw new Error('RunningHub 标准视频的视频编辑需要一段输入视频。');
        }
        body.videoUrl = await upload(assets.videos[0], 'video');
        // 参考生视频常常还能带一张图当画面参考，有就一起传。
        if (assets.images.length) body.imageUrls = [await upload(assets.images[0], 'image')];
    }
}

/**
 * 判断走标准模型视频 API 还是老的工作流/AI 应用模式。
 *
 * 与图片那条同构：认 `/openapi/v2/` 前缀，不认末段动作名——
 * 末段有 text-to-video / image-to-video / reference-to-video / video-edit 好几种，
 * 逐个列举必然漏，漏了就掉进工作流分支报一句莫名其妙的「WEBAPP_ID is required」。
 */
export function shouldUseStandardVideoApi(params, config) {
    const explicitMode = scopedSetting(config, 'VIDEO', 'MODE').toLowerCase();
    if (['ai-app', 'workflow'].includes(explicitMode)) return false;
    if (['standard', 'standard-model', 'model'].includes(explicitMode)) return true;
    return /\/openapi\/v2\//i.test(String(params.url || ''));
}

function standardRecoveryContext(params, config, credentials, kind = 'video') {
    const rh = buildStandardImageConfig(config, credentials);
    const suffix = kind === 'image' ? 'ImageProvider' : 'VideoProvider';
    return {
        ...rh,
        providerName: `RunningHub${credentials === RUNNINGHUB_GLOBAL_CREDENTIALS ? 'Global' : ''}${suffix}`,
        modelId: (kind === 'image' ? params.imageModel : params.videoModel) || params.mappingKey
            || (kind === 'image' ? 'rhart-image-g-2' : 'runninghub-standard-video'),
        submitUrl: resolveRunningHubStandardUrl(rh.baseUrl, params.url, kind === 'image' ? '/openapi/v2/rhart-image-g-2/text-to-image' : ''),
        queryUrl: `${rh.baseUrl}/openapi/v2/query`,
    };
}

function canRecoverStandard(reference, params, config, credentials, kind = 'video') {
    try {
        const isStandard = kind === 'image' ? shouldUseStandardImageApi : shouldUseStandardVideoApi;
        if (credentials === RUNNINGHUB_CN_CREDENTIALS && !isStandard(params, config)) return false;
        // The query host is configured separately from an absolute submission URL.
        return Boolean(reference?.queryEndpointFingerprint)
            && matchesRemoteTask(reference, standardRecoveryContext(params, config, credentials, kind));
    } catch { return false; }
}

async function queryStandardTask({ rh, taskId, params, signal, kind = 'video' }) {
    signal?.throwIfAborted();
    const options = {
        ...buildJsonFetchOptions({
            headers: { Authorization: `Bearer ${rh.apiKey}` }, body: { taskId },
            signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]),
        }),
        redirect: 'error',
    };
    BaseProvider.injectProxy(options, params.useProxy);
    // POST here is the documented read-only query, never a task-creation endpoint.
    const response = await BaseProvider.fetch(`${rh.baseUrl}/openapi/v2/query`, options);
    if (!response.ok) throw new Error('RunningHub 原任务查询暂不可用。');
    const result = await response.json();
    if (String(result?.taskId || '') !== String(taskId)
        || (result.code !== undefined && Number(result.code) !== 0)) return { status: 'unknown' };
    const status = String(result.status || '').toUpperCase();
    if (status === 'FAILED') return { status: 'failed' };
    if (hasMeaningfulValue(result.errorCode) || hasMeaningfulValue(result.errorMessage)
        || hasMeaningfulValue(result.failedReason)) return { status: 'unknown' };
    if (status !== 'SUCCESS') return { status: status === 'RUNNING' || status === 'QUEUED' ? 'pending' : 'unknown' };
    if (!Array.isArray(result.results) || !result.results.length
        || (kind === 'video' && result.results.length !== 1)) return { status: 'unknown' };
    for (const item of result.results) {
        const value = item?.url || item?.fileUrl;
        if (typeof value !== 'string' || !value) return { status: 'unknown' };
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { status: 'unknown' };
    }
    return { status: 'success', results: result.results };
}

async function recoverStandardImage(task, params, config, credentials, signal) {
    // Standard image requests create one task; that task can return several images/layers.
    if (!Number.isInteger(task.requestedCount) || task.requestedCount < 1 || task.requestedCount > 10
        || task.remoteSubmissionCount !== 1 || !Array.isArray(task.remoteTasks) || task.remoteTasks.length !== 1) return { status: 'unknown' };
    const reference = task.remoteTasks[0];
    const matches = () => canRecoverStandard(reference, params, config, credentials, 'image');
    if (!matches()) return { status: 'unknown' };
    const rh = buildStandardImageConfig(config, credentials);
    const result = await queryStandardTask({ rh, taskId: reference.taskId, params, signal, kind: 'image' });
    if (result.status !== 'success') return result;
    const urls = [...new Set(result.results.map((item) => item.url || item.fileUrl))];
    const results = [];
    for (const url of urls) {
        if (!matches()) return { status: 'unknown' };
        signal?.throwIfAborted();
        const options = { signal };
        BaseProvider.injectProxy(options, params.useProxy);
        const response = await BaseProvider.fetch(url, options);
        if (!response.ok) return { status: 'unknown' };
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length || buffer.length > 50 * 1024 * 1024) return { status: 'unknown' };
        const image = sharp(buffer, { failOn: 'warning' });
        const metadata = await image.metadata();
        if (!['png', 'jpeg', 'webp', 'gif', 'tiff', 'avif'].includes(metadata.format)) return { status: 'unknown' };
        await image.stats();
        signal?.throwIfAborted();
        results.push({ buffer, format: metadata.format === 'jpeg' ? 'jpg' : metadata.format });
    }
    if (!matches()) return { status: 'unknown' };
    return { status: results.length >= task.requestedCount ? 'success' : 'partial', results };
}

async function recoverStandardVideo(reference, params, config, credentials, signal) {
    if (!canRecoverStandard(reference, params, config, credentials)) return { status: 'unknown' };
    const rh = buildStandardImageConfig(config, credentials);
    const result = await queryStandardTask({ rh, taskId: reference.taskId, params, signal });
    if (result.status !== 'success') return result;
    if (!canRecoverStandard(reference, params, config, credentials)) return { status: 'unknown' };
    const options = { signal };
    BaseProvider.injectProxy(options, params.useProxy);
    const media = await BaseProvider.fetch(result.results[0].url || result.results[0].fileUrl, options);
    if (!media.ok) return { status: 'unknown' };
    const buffer = Buffer.from(await media.arrayBuffer());
    const verified = await validateRecoveredVideo(buffer, signal);
    if (!canRecoverStandard(reference, params, config, credentials)) return { status: 'unknown' };
    return { status: 'success', buffer, format: verified.format };
}

async function submitRunningHubStandardVideoTask({ config, params, credentials }) {
    const recoveryContext = standardRecoveryContext(params, config, credentials);
    const rh = recoveryContext;
    const finalUrl = recoveryContext.submitUrl;
    const { body, mode } = buildStandardVideoBody(finalUrl, params);
    await uploadStandardVideoInputs({ rh, params, finalUrl, mode, body });
    return submitStandardTask({ config, params, recoveryContext, body });
}

async function submitStandardTask({ config, params, recoveryContext, body }) {
    const rh = recoveryContext;
    const { modelId, submitUrl: finalUrl } = recoveryContext;
    params.signal?.throwIfAborted();
    config.generationTaskSubmitting?.();
    let result;
    try {
        result = await submitJsonWithLogs({
            url: finalUrl,
            fetchOptions: { ...buildJsonFetchOptions({
                headers: { Authorization: `Bearer ${rh.apiKey}` },
                body, signal: params.signal,
            }), redirect: 'error' },
            nodeId: params.nodeId,
            logsDir: params.logsDir,
            modelId,
            projectId: params.projectId,
            useProxy: params.useProxy,
            logBody: body,
            maxAttempts: 1,
        });
    } catch (error) {
        if (![400, 401, 402, 403, 404, 422, 429].includes(error?.status)) error.submissionUncertain = true;
        throw error;
    }

    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Object.assign(
        new Error('RunningHub 提交响应无法确认，请先核对原任务。'), { submissionUncertain: true });
    const taskId = result.taskId || result.data?.taskId;
    const initialResults = Array.isArray(result.results) ? result.results : [];
    if (taskId) {
        if (typeof taskId === 'number' && !Number.isSafeInteger(taskId)) throw Object.assign(
            new Error('RunningHub 任务编号精度不足，无法自动核对。'), { submissionUncertain: true });
        const reference = remoteTaskReference({ taskId, ...recoveryContext });
        if (!reference) throw Object.assign(new Error('RunningHub 未返回可核对的任务编号。'), { submissionUncertain: true });
        config.generationTaskSubmitted?.(reference);
    }
    const status = String(result.status || '').toUpperCase();
    if ((result.code !== undefined && Number(result.code) !== 0)
        || status === 'FAILED' || hasMeaningfulValue(result.errorCode) || hasMeaningfulValue(result.errorMessage) || hasMeaningfulValue(result.failedReason)) {
        throw Object.assign(new Error(`RunningHub 标准任务提交失败：${formatRunningHubError(result)}`), {
            providerTaskFailed: Boolean(taskId && status === 'FAILED'),
        });
    }
    if (!taskId && !initialResults.length) throw Object.assign(
        new Error('RunningHub 标准任务提交返回里既没有 taskId 也没有结果。'), { submissionUncertain: true });
    return { taskId, rh, initialResults };
}

async function generateWithRunningHubStandardVideo(params, config, credentials) {
    const scopedParams = { ...params, logsDir: config.LOGS_DIR };
    const { taskId, rh, initialResults } = await submitRunningHubStandardVideoTask({
        config,
        params: scopedParams,
        credentials
    });
    return finishStandardTask({ rh, taskId, initialResults, params: scopedParams, kind: 'video' });
}

async function finishStandardTask({ rh, taskId, initialResults, params, kind }) {
    const results = initialResults.length
        ? initialResults
        : await BaseProvider.pollTask({
            interval: 5000,
            timeoutMs: BaseProvider.parseTimeToMs(params.timeEstimate || '10min') * (kind === 'image' ? Math.max(1, Number(params.generateCount || 1)) : 1),
            pollFn: async () => {
                const result = await queryStandardTask({ rh, taskId, params, signal: params.signal, kind });
                if (result.status === 'failed') throw Object.assign(new Error('RunningHub 已确认原生成任务失败。'), { providerTaskFailed: true });
                return { done: result.status === 'success', data: result.results };
            },
        });
    params.signal?.throwIfAborted();
    try {
        if (kind === 'image') {
            const requestedCount = Math.max(1, Math.min(10, Math.trunc(Number(params.generateCount) || 1)));
            const uniqueCount = new Set(results.map((item) => item?.url || item?.fileUrl).filter(Boolean)).size;
            if (uniqueCount < requestedCount) throw new Error('RunningHub 返回图片不足，需核对原任务结果。');
        }
        return await downloadResults(results, params, kind);
    } catch (error) {
        if (!taskId) error.submissionUncertain = true;
        throw error;
    }
}

export const RunningHubVideoProvider = {
    canRecoverVideo: (reference, params, config) => canRecoverStandard(reference, params, config, RUNNINGHUB_CN_CREDENTIALS),
    recoverVideo: (reference, params, config, signal) => recoverStandardVideo(reference, params, config, RUNNINGHUB_CN_CREDENTIALS, signal),
    async generateVideo(params, config) {
        // CN 站：可灵 / Seedance / 海螺 / 快乐马 / 万相 / Vidu / SkyReels 都在这儿，
        // 详情页没有 api-migration-block（2026-08-12 逐个核过）。
        if (shouldUseStandardVideoApi(params, config)) {
            return generateWithRunningHubStandardVideo(params, config, RUNNINGHUB_CN_CREDENTIALS);
        }
        return generateWithRunningHub(params, config, 'VIDEO', 'video');
    }
};

/**
 * RH 全球站的标准视频。
 *
 * 「全能视频」整族（X=Grok / V=Veo / S）已从 CN 站下线迁到 runninghub.ai——
 * CN 站的详情页全部带 `api-migration-block`，路径只有在全球站才拿得到
 * （`/rhart-video-g-official/*`、`/rhart-video-v3.1-*`）。
 * 和图片的 `rhart-image-*` 完全同构：只换域名与密钥，slug 和请求体都不变。
 */
export const RunningHubGlobalVideoProvider = {
    canRecoverVideo: (reference, params, config) => canRecoverStandard(reference, params, config, RUNNINGHUB_GLOBAL_CREDENTIALS),
    recoverVideo: (reference, params, config, signal) => recoverStandardVideo(reference, params, config, RUNNINGHUB_GLOBAL_CREDENTIALS, signal),
    async generateVideo(params, config) {
        return generateWithRunningHubStandardVideo(params, config, RUNNINGHUB_GLOBAL_CREDENTIALS);
    }
};
