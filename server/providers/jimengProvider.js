/**
 * jimengProvider.js
 * 分别封装即梦 3.0 和 3.1 的生成逻辑
 * 合并了原 services/jimeng.js 的核心逻辑，减少文件层级
 */
import crypto from 'crypto';
import { resolveImageToBase64 } from '../utils/imageHelpers.js';
import { getModelDimensions } from '../utils/resolutionMapper.js';
import { BaseProvider } from './baseProvider.js';

// ============================================================================
// CONFIGURATION (From original jimeng service)
// ============================================================================

const SERVICE = 'cv';
const REGION = 'cn-north-1';
const VERSION = '2022-08-31';

// ============================================================================
// V4 SIGNATURE LOGIC
// ============================================================================

/**
 * 使用 SHA256 算法计算数据的哈希值
 */
function hashSHA256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * 使用 HMAC-SHA256 算法计算 HMAC 值
 */
function hmacSHA256(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * 生成用于签名的派生密钥（Signing Key）
 */
function getSigningKey(secretKey, date, region, service) {
    const kDate = hmacSHA256(secretKey, date);
    const kRegion = hmacSHA256(kDate, region);
    const kService = hmacSHA256(kRegion, service);
    const kSigning = hmacSHA256(kService, 'request');
    return kSigning;
}

/**
 * 火山引擎 V4 签名实现逻辑
 * @param {string} accessKey - 访问密钥 ID
 * @param {string} secretKey - 安全密钥
 * @param {string} action - API 动作（如 CVSync2AsyncSubmitTask）
 * @param {Object} body - 请求体对象
 * @param {string} endpoint - API 服务端点
 * @param {string} customVersion - 可选的 API 版本号
 */
async function signV4(accessKey, secretKey, action, body, url, customVersion = null) {
    const now = new Date();
    // 强制使用符合火山引擎要求的 ISO 时间格式（去除分隔符）
    const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = xDate.slice(0, 8);

    // 从配置的 url 中动态提取 Host (例如 visual.volcengineapi.com)
    const urlObj = new URL(url);
    const host = urlObj.host;

    // 优先从配置中提取 Action 和 Version
    let finalAction = action;
    let finalVersion = customVersion || VERSION;

    // 尝试从 URL 查询参数中解析 Action 和 Version (如果 URL 中包含则优先使用，除非明确传入了不同 action)
    const actionMatch = url.match(/Action=([^&]+)/);
    const versionMatch = url.match(/Version=([^&]+)/);
    
    // 逻辑：如果传入的 action 是通用的提交动作，但 URL 里有更具体的动作，则用 URL 的。
    // 如果传入的是特定的动作（如 GetResult），则必须用传入的。
    if (action === 'CVSync2AsyncSubmitTask' && actionMatch) {
        finalAction = actionMatch[1];
    }
    
    if (versionMatch) finalVersion = versionMatch[1];
    
    // 基础路径 (去掉 query 部分)
    const finalEndpoint = url.split('?')[0];

    const query = `Action=${finalAction}&Version=${finalVersion}`;
    
    const bodyStr = JSON.stringify(body);
    const payloadHash = hashSHA256(bodyStr);
    const contentType = 'application/json';

    // 1. 构建规范化请求头（Canonical Headers）
    const headers = {
        'content-type': contentType,
        'host': host,
        'x-content-sha256': payloadHash,
        'x-date': xDate
    };
    
    const signedHeadersList = Object.keys(headers).sort();
    const canonicalHeaders = signedHeadersList
        .map(key => `${key}:${headers[key]}\n`)
        .join('');
    const signedHeaders = signedHeadersList.join(';');

    // 2. 构建规范化请求字符串（Canonical Request）
    const canonicalRequest = [
        'POST',
        '/',
        query,
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');

    // 3. 构建待签名字符串（String to Sign）
    const credentialScope = `${date}/${REGION}/${SERVICE}/request`;
    const stringToSign = [
        'HMAC-SHA256',
        xDate,
        credentialScope,
        hashSHA256(canonicalRequest)
    ].join('\n');

    // 4. 计算签名值
    const signingKey = getSigningKey(secretKey, date, REGION, SERVICE);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    // 5. 生成 Authorization 认证头
    const authorization = `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
        // 最终用于发送请求的参数对象
        request: {
            url: `${finalEndpoint}?${query}`,
            method: 'POST',
            headers: {
                'Content-Type': contentType,
                'X-Date': xDate,
                'X-Content-Sha256': payloadHash,
                'Authorization': authorization
            },
            body: bodyStr
        },
        // 调试信息
        debug: {
            canonicalRequest,
            stringToSign,
            payloadHash
        }
    };
}

// ============================================================================
// API METHODS (Internal)
// ============================================================================

/**
 * 查询即梦任务结果（轮询方法）
 */
async function getJimengTaskResult(taskId, accessKey, secretKey, customReqKey, url, useProxy = false) {
    const action = 'CVSync2AsyncGetResult'; 
    
    // 构建查询参数，要求返回 URL
    const reqJsonObj = {
        return_url: true,
    };

    const body = {
        req_key: customReqKey || "jimeng_t2i_v30",
        task_id: taskId,
        req_json: JSON.stringify(reqJsonObj)
    };

    const signingInfo = await signV4(accessKey, secretKey, action, body, url);

    const fetchOptions = {
        method: 'POST',
        headers: signingInfo.request.headers,
        body: signingInfo.request.body 
    };

    // 注入代理
    BaseProvider.injectProxy(fetchOptions, useProxy);

    const response = await BaseProvider.fetch(signingInfo.request.url, fetchOptions);
    const result = await response.json();
    return { result, signingInfo };
}

/**
 * 执行完整的即梦图像生成流程（提交 -> 轮询 -> 下载）
 */
async function processJimengImageGeneration(params) {
    const { 
        nodeId, prompt, binary_data_base64, image_urls, width, height, 
        scale, use_pre_llm, 
        accessKey, secretKey, customReqKey, logsDir, imageModel, url,
        timeEstimate, useProxy
    } = params;
    const actualTimeoutMs = BaseProvider.parseTimeToMs(timeEstimate);
    const signal = AbortSignal.timeout(actualTimeoutMs);

    // 1. 提交任务
    console.log(`[Jimeng-Provider] 正在提交任务: ${prompt.substring(0, 30)}...`);
    const action = 'CVSync2AsyncSubmitTask';
    const body = {
        req_key: customReqKey || "jimeng_t2i_v30",
        prompt,
        width: width || 1328,
        height: height || 1328,
        scale: scale || 50,
        use_pre_llm: use_pre_llm !== false
    };

    // 优先使用 Base64 数据，否则使用图片 URL
    if (binary_data_base64 && binary_data_base64.length > 0) {
        body.binary_data_base64 = binary_data_base64;
    } else if (image_urls && image_urls.length > 0) {
        body.image_urls = image_urls;
    }

    const signingInfo = await signV4(accessKey, secretKey, action, body, url);
    const modelPrefix = imageModel || 'jimeng-image';

    // 提取 projectId 供后续日志使用
    const finalProjectId = params?.projectId || 'default';

    const submitData = await BaseProvider.fetchWithLogs({
        url: signingInfo.request.url,
        fetchOptions: {
            method: 'POST',
            headers: signingInfo.request.headers,
            body: signingInfo.request.body,
            signal
        },
        nodeId,
        logsDir,
        modelId: modelPrefix,
        projectId: finalProjectId,
        isArk: false,
        useProxy: params.useProxy
    });

    const resData = submitData.data || submitData.resp_data || submitData;
    const taskId = resData?.task_id;
    
    if (!taskId) {
        throw new Error(`Jimeng submission failed: ${submitData.ResponseMetadata?.Error?.Message || 'No task ID returned'}`);
    }

    // 2. Polling
    console.log(`[Jimeng] Task submitted: ${taskId}. Starting poll (Timeout: ${actualTimeoutMs / 1000 / 60}min)...`);
    const interval = 5000;

    const resultImageUrl = await BaseProvider.pollTask({
        interval,
        timeoutMs: actualTimeoutMs,
        pollFn: async () => {
            const { result: queryResult } = await getJimengTaskResult(taskId, accessKey, secretKey, customReqKey, url, useProxy);
            const pollData = queryResult?.data || queryResult?.resp_data || queryResult;
            const status = pollData?.status;
            const isSuccessCode = queryResult.code === 10000 || queryResult.code === 0;

            if (status === 'failed' || status === 'error') {
                BaseProvider.saveDebugLog(logsDir, `${modelPrefix}_POLL_RES_FAILED`, nodeId, queryResult, finalProjectId);
                return { error: `Jimeng task failed: ${pollData?.fail_reason || 'Unknown error'}` };
            }

            if (status === 'success' || status === 'done' || status === 'finished' || (isSuccessCode && (pollData?.image_list?.length > 0 || pollData?.image_urls?.length > 0))) {
                const imageList = pollData?.image_list || pollData?.image_urls || [];
                if (imageList.length > 0) {
                    const firstItem = imageList[0];
                    const url = typeof firstItem === 'string' ? firstItem : (firstItem.url || firstItem.data);
                    if (url) {
                        BaseProvider.saveDebugLog(logsDir, `${modelPrefix}_POLL_RES_SUCCESS`, nodeId, queryResult, finalProjectId);
                        return { done: true, data: url };
                    }
                }
            }

            return { done: false };
        }
    });

    // 3. Download Buffer
    let imageBuffer;
    let imageFormat;

    if (resultImageUrl.startsWith('http')) {
        imageBuffer = await BaseProvider.asyncDownloadToBuffer(resultImageUrl, useProxy);
        imageFormat = resultImageUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
    } else {
        const base64Data = resultImageUrl.includes(',') ? resultImageUrl.split(',')[1] : resultImageUrl;
        imageBuffer = Buffer.from(base64Data, 'base64');
        imageFormat = resultImageUrl.includes('png') ? 'png' : 'jpg';
    }

    return { imageBuffer, imageFormat };
}

// ============================================================================
// PUBLIC PROVIDERS
// ============================================================================

/**
 * 通用的图像解析逻辑
 */
function resolveImages(rawImageBase64) {
    let resolvedBase64 = [];
    let resolvedUrls = [];

    if (rawImageBase64) {
        const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
        rawImages.forEach(img => {
            const resolved = resolveImageToBase64(img);
            if (resolved) {
                if (resolved.startsWith('data:image')) {
                    resolvedBase64.push(resolved.split(',')[1]);
                } else if (resolved.startsWith('http')) {
                    resolvedUrls.push(resolved);
                }
            }
        });
    }
    return { resolvedBase64, resolvedUrls };
}

/**
 * 即梦图像处理器 (支持 3.0, 3.1 等版本)
 */
export const JimengImageProvider = {
    async generateImage(params, config) {
        const { JIMENG_ACCESS_KEY, JIMENG_SECRET_KEY, LOGS_DIR } = config;
        const { nodeId, prompt, aspectRatio, resolution, imageModel, cfg_scale, use_pre_llm, generateCount, url, timeEstimate } = params;

        if (!JIMENG_ACCESS_KEY || !JIMENG_SECRET_KEY) {
            throw new Error("Jimeng API credentials not configured.");
        }

        const { images: rawImages } = BaseProvider.getAssets(params);

        // 在提示词前追加生成数量，以确保模型理解真正需要生成的张数
        const finalPrompt = `生成${generateCount || 1}张图\n${prompt}`;

        const { resolvedBase64, resolvedUrls } = resolveImages(rawImages);
        
        // 优先使用传入的 imageModel 作为 req_key，实现环境变量覆盖逻辑
        let jimengReqKey = imageModel;
        
        // 如果没有传入或传入的是逻辑名称，则回退到默认映射逻辑
        if (!jimengReqKey || jimengReqKey === 'Jimeng 3.0' || jimengReqKey === 'Jimeng 3.1') {
            if (imageModel && imageModel.includes('v31')) {
                jimengReqKey = "jimeng_t2i_v31";
            } else {
                const hasImages = resolvedBase64.length > 0 || resolvedUrls.length > 0;
                jimengReqKey = hasImages ? "jimeng_i2i_v30" : "jimeng_t2i_v30";
            }
        }

        const { width, height } = getModelDimensions(params.mappingKey || imageModel, resolution, aspectRatio);

        const result = await processJimengImageGeneration({
            nodeId, prompt: finalPrompt, binary_data_base64: resolvedBase64, image_urls: resolvedUrls,
            width, height, scale: cfg_scale || 50, use_pre_llm: use_pre_llm !== false,
            accessKey: JIMENG_ACCESS_KEY, secretKey: JIMENG_SECRET_KEY,
            customReqKey: jimengReqKey, logsDir: LOGS_DIR, imageModel, url,
            timeEstimate, projectId: params.projectId, useProxy: params.useProxy
        });

        return { buffer: result.imageBuffer, format: result.imageFormat };
    }
};
