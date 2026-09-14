import { annotateProviderError } from '../telemetry/providerDiagnostics.js';
/**
 * baseProvider.js
 * 供应商处理器的基类/通用工具
 */
import fs from 'fs';
import path from 'path';
import { resolveImageToBase64 } from '../utils/imageHelpers.js';
import { signTOSV4 } from '../utils/tosSigner.js';

// Node 18+ already ships a maintained undici-backed fetch.  Prefer it so the
// packaged app does not depend on an optional undici copy being present.  Keep
// dynamic imports as fallbacks for older/custom runtimes.
let networkFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
let NetworkFormData = networkFetch ? globalThis.FormData : null;
let ProxyAgent = null;
try {
    const undici = await import('undici');
    if (!networkFetch && typeof undici.fetch === 'function') {
        networkFetch = undici.fetch;
        NetworkFormData = undici.FormData;
    }
    ProxyAgent = undici.ProxyAgent;
} catch {
    console.warn('[BaseProvider] undici not found, proxy features disabled.');
}
if (!networkFetch) {
    try {
        const nodeFetch = await import('node-fetch');
        networkFetch = nodeFetch.default || nodeFetch.fetch || null;
        NetworkFormData = nodeFetch.FormData;
    } catch {
        console.warn('[BaseProvider] No HTTP fetch implementation available.');
    }
}
if (!networkFetch) throw new Error('当前 Node 运行时不支持 HTTP Fetch。');

export const BaseProvider = {
    /**
     * 判断是否为可重试的瞬时网络错误
     */
    isRetryableNetworkError(error) {
        const code = error?.cause?.code || error?.code;
        const retryableCodes = ['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'];
        return retryableCodes.includes(code);
    },

    /**
     * 判断是否为可重试的响应解析错误
     */
    isRetryableResponseError(error) {
        const code = error?.code;
        return code === 'EMPTY_RESPONSE'
            || code === 'INVALID_JSON_RESPONSE'
            || error?.name === 'SyntaxError';
    },

    /**
     * 状态查询可安全重试的 HTTP 响应。这里只用于 GET/轮询，不能拿去重提生成任务。
     */
    isRetryablePollHttpStatus(status) {
        const numericStatus = Number(status);
        return numericStatus === 408
            || numericStatus === 425
            || numericStatus === 429
            || numericStatus >= 500;
    },
    /**
     * 获取 HTTP Fetch 引用
     */
    get fetch() {
        return networkFetch;
    },

    createFormData() {
        // Node 24 fetch does not recognize FormData from a separately installed undici.
        // Keep multipart construction paired with the selected transport.
        return new NetworkFormData();
    },

    /**
     * 获取 ProxyAgent 引用
     */
    get ProxyAgent() {
        return ProxyAgent;
    },

    /**
     * 规范化代理地址
     */
    normalizeProxy(proxy) {
        if (!proxy) return null;
        let p = String(proxy).trim();
        if (!p) return null;
        if (!p.startsWith('http')) {
            p = `http://${p}`;
        }
        return p.replace('localhost', '127.0.0.1');
    },

    /**
     * 为请求注入代理分发器
     */
    injectProxy(fetchOptions, forceProxy = false) {
        const rawProxy = process.env.HTTPS_PROXY;
        const useProxy = forceProxy === true; // 仅当参数明确为 true 时使用
        const proxy = (useProxy && rawProxy) ? this.normalizeProxy(rawProxy) : null;

        if (proxy && ProxyAgent) {
            try {
                fetchOptions.dispatcher = new ProxyAgent(proxy);
                return proxy;
            } catch (e) {
                console.error(`[BaseProvider] Proxy Injection Error: ${e.message}`);
            }
        } else {
            // 关键修复：如果不用代理，确保对象中没有 dispatcher 属性
            delete fetchOptions.dispatcher;
        }
        return null;
    },

    /**
     * 封装通用的请求与日志记录逻辑
     */
    async fetchWithLogs({ url, fetchOptions, nodeId, logsDir, modelId, projectId, useProxy = false, logBody = null, maxAttempts = 3, singleAttempt = false }) {
        // 1. 处理代理
        const activeProxy = this.injectProxy(fetchOptions, useProxy);
        if (activeProxy) {
            console.log(`[${modelId}] Using Proxy: ${activeProxy}`);
        }

        // 2. 准备日志数据 (脱敏并移除 dispatcher)
        const { dispatcher, ...restOptions } = fetchOptions;
        let maskedOptions = { ...restOptions, post_url: url };
        
        // 如果提供了 logBody，则使用它替换日志中的 body
        if (logBody) {
            maskedOptions.body = logBody;
        }
        
        if (maskedOptions.headers) {
            const headers = { ...maskedOptions.headers };
            const sensitiveHeaderMap = {
                'Authorization': '[API_KEY]',
                'authorization': '[API_KEY]',
                'x-goog-api-key': '[GEMINI_API_KEY]',
                'X-Goog-Api-Key': '[GEMINI_API_KEY]',
                'api-key': '[ARK_API_KEY]',
                'Api-Key': '[ARK_API_KEY]'
            };

            Object.keys(sensitiveHeaderMap).forEach(h => {
                if (headers[h]) {
                    if (headers[h].startsWith('Bearer ')) {
                        const keyLabel = modelId.toLowerCase().includes('gpt') ? '[OPENAI_API_KEY]' : '[API_KEY]';
                        headers[h] = `Bearer ${keyLabel}`;
                    } else if (headers[h].includes('HMAC-SHA256')) {
                        // 火山引擎 V4 签名脱敏
                        headers[h] = 'HMAC-SHA256 Credential=[JIMENG_ACCESS_KEY]/... Signature=[V4_SIGNATURE]';
                    } else {
                        headers[h] = sensitiveHeaderMap[h];
                    }
                }
            });
            maskedOptions.headers = headers;
        }

        const finalProjectId = projectId || fetchOptions.projectId || 'default';
        this.saveDebugLog(logsDir, `${modelId}_SUBMIT_REQ`, nodeId, maskedOptions, finalProjectId);

        // 3. 执行请求，对代理链路瞬时异常做有限重试
        let response;
        let result;
        maxAttempts = singleAttempt === true ? 1 : Math.max(1, Math.min(3, Math.trunc(Number(maxAttempts) || 1)));
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                response = undefined;
                result = undefined;
                response = await networkFetch(url, fetchOptions);
                const rawText = await response.text();
                if (!rawText || !rawText.trim()) {
                    const emptyErr = new Error('上游返回空响应');
                    emptyErr.code = 'EMPTY_RESPONSE';
                    emptyErr.upstreamStatus = response.status;
                    throw emptyErr;
                }
                try {
                    result = JSON.parse(rawText);
                } catch (parseError) {
                    const jsonErr = new Error(`上游返回非 JSON 响应: ${String(parseError.message || parseError)}`);
                    jsonErr.code = 'INVALID_JSON_RESPONSE';
                    jsonErr.upstreamStatus = response.status;
                    jsonErr.rawBodySnippet = rawText.slice(0, 300);
                    throw jsonErr;
                }
                break;
            } catch (error) {
                const shouldRetry = (this.isRetryableNetworkError(error) || this.isRetryableResponseError(error)) && attempt < maxAttempts;
                if (!shouldRetry) throw annotateProviderError(error, { stage: 'submit', response, payload: result, requestBody: fetchOptions.body });
                const waitMs = 300 * Math.pow(2, attempt - 1);
                console.warn(`[${modelId}] 请求异常，准备第 ${attempt + 1}/${maxAttempts} 次重试: ${error?.cause?.code || error?.code || error?.message}`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }

        // 4. 保存响应日志
        const logResult = typeof result === 'object' && result !== null 
            ? { ...result, post_url: url } 
            : { data: result, post_url: url };
            
        this.saveDebugLog(logsDir, `${modelId}_SUBMIT_RES`, nodeId, logResult, finalProjectId);

        // 5. 校验响应状态
        if (!response.ok) {
            const errorMsg = result.error?.message || result.message || `HTTP ${response.status}`;
            throw annotateProviderError(Object.assign(new Error(`API 错误 (${modelId}): ${errorMsg}`), {
                status: response.status, upstreamStatus: response.status,
            }), { stage: 'submit', response, payload: result, taskId: result?.task_id || result?.id, requestBody: fetchOptions.body });
        }

        return result;
    },
    /**
     * 将文件上传到火山引擎 TOS
     * @param {Buffer} buffer 文件内容
     * @param {string} fileName 文件名
     * @param {Object} config TOS 配置 (AK, SK, Bucket, Endpoint, Region)
     */
    async uploadToTOS(buffer, fileName, config) {
        const { JIMENG_ACCESS_KEY, JIMENG_SECRET_KEY, TOS_BUCKET, TOS_ENDPOINT, TOS_REGION } = config;
        
        if (!JIMENG_ACCESS_KEY || !JIMENG_SECRET_KEY || !TOS_BUCKET) {
            console.warn('[TOS] 未配置必要的密钥或存储桶，跳过上传。');
            return null;
        }

        // 使用虚拟托管风格的域名 (Virtual Hosted-Style)
        // 例如: bucket.tos-cn-beijing.volces.com
        const baseEndpoint = TOS_ENDPOINT || 'tos-cn-beijing.volces.com';
        const host = `${TOS_BUCKET}.${baseEndpoint}`;

        // 自动识别 Content-Type
        let contentType = 'application/octet-stream';
        const ext = path.extname(fileName).toLowerCase();
        if (ext === '.mp4') contentType = 'video/mp4';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.gif') contentType = 'image/gif';
        else if (ext === '.mp3') contentType = 'audio/mpeg';
        else if (ext === '.wav') contentType = 'audio/wav';

        const signingParams = {
            accessKey: JIMENG_ACCESS_KEY,
            secretKey: JIMENG_SECRET_KEY,
            method: 'PUT',
            endpoint: host,
            region: TOS_REGION || 'cn-beijing',
            bucket: TOS_BUCKET,
            object: fileName,
            body: buffer,
            headers: {
                'Content-Type': contentType,
                'x-tos-acl': 'public-read' // 默认设置为公共读，方便前端直接访问
            }
        };

        const { url, headers } = signTOSV4(signingParams);

        try {
            console.log(`[TOS] 正在上传到: ${url}`);
            const response = await fetch(url, {
                method: 'PUT',
                headers,
                body: buffer
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[TOS] 上传失败详情: ${response.status} ${errorText}`);
                throw new Error(`TOS 上传失败: ${response.status} ${errorText}`);
            }

            console.log(`[TOS] 文件已成功上传: ${url}`);
            return url;
        } catch (error) {
            console.error(`[TOS] 上传过程中出错:`, error.message);
            return null;
        }
    },

    /**
     * 将 '5min' 或 '30s' 字符串转换为毫秒，并自动乘以 3 倍作为安全余量
     */
    parseTimeToMs(timeStr) {
        if (!timeStr) return 900000; // 默认 5min * 3 = 15 分钟
        // number 视为已计算好的毫秒值，避免被重复放大
        if (typeof timeStr === 'number') return timeStr;
        
        const val = parseInt(timeStr);
        if (isNaN(val)) return 900000;

        let ms = 300000;
        const str = String(timeStr).toLowerCase();
        if (str.includes('min')) {
            ms = val * 60 * 1000;
        } else if (str.includes('s') && !str.includes('ms')) {
            ms = val * 1000;
        } else if (str.includes('ms')) {
            ms = val;
        }

        // 自动乘以 3 倍安全余量
        return ms * 3;
    },

    /**
     * 统一超时处理包装函数
     */
    async withTimeout(promise, timeEstimate = '5min') {
        const timeoutMs = this.parseTimeToMs(timeEstimate);
        const timeoutLabel = typeof timeEstimate === 'number'
            ? `${Math.ceil(timeoutMs / 1000)}秒`
            : timeEstimate;

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`生成超时（限制为 ${timeoutLabel}），请重试。`));
            }, timeoutMs);
        });

        return Promise.race([promise, timeoutPromise]);
    },

    /**
    * 统一处理输入音频，支持单音频或数组
    */
    resolveInputAudios(rawAudios) {
        if (!rawAudios) return [];
        const audios = Array.isArray(rawAudios) ? rawAudios : [rawAudios];
        return audios.map(audio => resolveImageToBase64(audio)).filter(Boolean);
    },

    /**
    * 统一处理输入视频，支持单视频或数组
    */
    resolveInputVideos(rawVideos) {
        if (!rawVideos) return [];
        const videos = Array.isArray(rawVideos) ? rawVideos : [rawVideos];
        return videos
            .map(video => typeof video === 'string' ? video.trim() : '')
            .filter(video => /^https?:\/\//i.test(video));
    },
    /**
     * 统一处理输入图像，支持单图或数组，并过滤掉空值
     */
    resolveInputImages(rawImages) {
        if (!rawImages) return [];
        // 兼容旧版单一字段和新版资产数组
        const images = Array.isArray(rawImages) ? rawImages : [rawImages];
        return images.map(img => {
            const value = typeof img === 'string' ? img.trim() : '';
            // Agent 上传的图片历史上会把 data URL 的前缀拆掉，只留下裸 Base64。
            // 保留为 data URL，RelayTextProvider 才能将本机图片上传为公网参考图。
            if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 128) {
                return `data:image/png;base64,${value.replace(/\s+/g, '')}`;
            }
            return resolveImageToBase64(value);
        }).filter(Boolean);
    },

    /**
     * 获取资产包中的核心数据 (用于 Provider 内部解耦)
     */
    getAssets(params) {
        return {
            images: this.resolveInputImages(params.images || params.imageBase64),
            videos: this.resolveInputVideos(params.videos || params.videoUrl),
            audios: this.resolveInputAudios(params.audios || params.audioBase64)
        };
    },

    /**
     * 通用的下载 Buffer 逻辑 (带代理支持)
     */
    async asyncDownloadToBuffer(url, useProxy = false, { signal } = {}) {
        const fetchOptions = { signal };
        this.injectProxy(fetchOptions, useProxy);
        let response;
        try {
            response = await networkFetch(url, fetchOptions);
            if (!response.ok) throw new Error(`素材下载失败：HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            throw annotateProviderError(error, { stage: 'download', response });
        }
    },

    /**
     * 辅助函数：根据扩展名获取 MIME 类型
     */
    getMimeType(urlOrExt) {
        const ext = urlOrExt.includes('.') ? urlOrExt.split('.').pop().toLowerCase().split('?')[0] : urlOrExt;
        const mimeMap = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'webp': 'image/webp',
            'gif': 'image/gif',
            'mp4': 'video/mp4',
            'mov': 'video/quicktime',
            'mpeg': 'video/mpeg',
            'mpg': 'video/mpeg',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'json': 'application/json'
        };
        return mimeMap[ext] || 'application/octet-stream';
    },

    /**
     * 通用的任务轮询工具
     */
    async pollTask({ pollFn, interval = 5000, timeoutMs, onProgress, taskId }) {
        const startTime = Date.now();
        while (true) {
            if (timeoutMs && (Date.now() - startTime > timeoutMs)) {
                throw annotateProviderError(new Error('任务执行超时'), { stage: 'poll', taskId });
            }
            let result;
            try {
                result = await pollFn();
            } catch (error) {
                const retryable = this.isRetryableNetworkError(error)
                    || this.isRetryableResponseError(error);
                if (!retryable) throw annotateProviderError(error, { stage: 'poll', taskId });
                console.warn(`[Poll] 状态查询瞬时失败，将继续查询同一任务: ${error?.cause?.code || error?.code || error?.message}`);
                await new Promise(r => setTimeout(r, interval));
                continue;
            }
            if (result.done) return result.data;
            if (result.error && !result.retryable) throw annotateProviderError(new Error(result.error), { stage: 'poll', taskId, payload: { message: result.error } });
            if (result.error) {
                console.warn(`[Poll] 状态接口暂时不可用，将继续查询同一任务: ${result.error}`);
            } else if (onProgress) {
                onProgress(result.progress);
            }
            await new Promise(r => setTimeout(r, interval));
        }
    },

    /**
     * 辅助函数：将调试日志保存为 JSON 文件，按项目 ID 和卡片 ID 创建文件夹
     */
    saveDebugLog(logsDir, type, nodeId, data, projectId = 'default') {
        try {
            if (!logsDir || !nodeId) return;

            // 简化目录结构: logsDir / projectId / nodeId
            const taskLogDir = path.join(logsDir, projectId, nodeId);
            if (!fs.existsSync(taskLogDir)) {
                fs.mkdirSync(taskLogDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safeType = String(type || 'LOG')
                .replace(/[^A-Za-z0-9._-]+/g, '_')
                .slice(0, 160) || 'LOG';
            const filename = `${safeType}_${timestamp}.json`;
            const filePath = path.join(taskLogDir, filename);
            
            // 复制数据，如果 body 是 JSON 字符串，尝试解析它以提高日志可读性
            let logData = data;
            if (data && typeof data.body === 'string') {
                try {
                    // 仅当 body 是有效的 JSON 字符串时进行解析
                    logData = { ...data, body: JSON.parse(data.body) };
                } catch {
                    // 如果不是 JSON，保持原样
                }
            }
            
            fs.writeFileSync(filePath, JSON.stringify(logData, null, 2));
            console.log(`[Log] Debug log saved: ${nodeId}/${filename}`);
        } catch (err) {
            console.error(`[Log] Failed to save debug log:`, err.message);
        }
    }
};
