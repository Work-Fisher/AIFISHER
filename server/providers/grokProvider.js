/**
 * grokProvider.js
 * 封装 Grok (xAI) 的视频生成逻辑
 */
import { BaseProvider } from './baseProvider.js';
import { buildJsonFetchOptions, submitJsonWithLogs } from './providerKit.js';

/**
 * 构建 Grok 视频请求体
 */
function buildGrokBody(params) {
    const { 
        prompt, videoModel, aspectRatio, resolution, duration, 
        videoMode,
    } = params;

    const body = {
        model: videoModel || 'grok-imagine-video',
        prompt,
        duration: duration || 10,
        aspect_ratio: aspectRatio || '16:9',
        resolution: resolution || '720p',
        watermark: false
    };

    // 获取所有关联资产的 URL (优先使用网络 URL)
    const { images: allImages, videos: allVideos } = BaseProvider.getAssets(params);

    if (videoMode === 'video-edit') {
        if (allVideos.length === 0) throw new Error('视频编辑模式需要提供视频参考。');
        body.video_url = allVideos[0];
        // 视频编辑通常不需要分辨率和比例参数，由原视频决定
        delete body.aspect_ratio;
        delete body.resolution;
    } else if (videoMode === 'image-to-video') {
        if (allImages.length === 1) {
            // 单图首帧模式
            body.image = { url: allImages[0] };
        } else if (allImages.length > 1) {
            // 多图参考模式
            body.reference_images = allImages.map(url => ({ url }));
        } else {
            throw new Error('图生视频模式至少需要 1 张图片参考。');
        }
    }

    return body;
}

export const GrokVideoProvider = {
    async generateVideo(params, config) {
        const { GROK_API_KEY, LOGS_DIR } = config;
        const { nodeId, videoModel, url: finalUrl, useProxy, projectId } = params;

        if (!GROK_API_KEY) {
            throw new Error("Grok API Key 未配置。");
        }

        const body = buildGrokBody(params);
        
        const fetchOptions = buildJsonFetchOptions({
            headers: { 'Authorization': `Bearer ${GROK_API_KEY}` },
            body
        });

        const result = await submitJsonWithLogs({
            url: finalUrl,
            fetchOptions,
            nodeId,
            logsDir: LOGS_DIR,
            modelId: videoModel,
            projectId,
            useProxy,
            logBody: body
        });

        // Grok 响应包含 request_id
        const requestId = result.request_id;
        if (!requestId) {
            throw new Error(`Grok 提交失败: 未返回 request_id`);
        }

        // 轮询 URL: https://api.x.ai/v1/videos/{request_id}
        // 注意：支持智增增中转路径转换 /xai/v1/... 或官方路径 /v1/...
        const pollUrl = finalUrl.replace(/\/(generations|edits)$/, `/${requestId}`);

        const videoUrl = await BaseProvider.pollTask({
            interval: 5000,
            pollFn: async () => {
                const fetchOptions = {};
                BaseProvider.injectProxy(fetchOptions, useProxy);
                
                const response = await BaseProvider.fetch(pollUrl, {
                    ...fetchOptions,
                    headers: { 'Authorization': `Bearer ${GROK_API_KEY}` }
                });
                
                const pollResult = await response.json();

                // 智增增兼容性处理：如果任务还在处理中，会返回 400 错误和 "no api_result yet"
                if (pollResult.code === "400" && pollResult.error?.includes("no api_result yet")) {
                    return { done: false };
                }

                if (pollResult.status === 'done') {
                    // 成功时记录一次最终日志
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_SUCCESS`, nodeId, pollResult, projectId);
                    return { done: true, data: pollResult.video?.url };
                } else if (pollResult.status === 'failed' || pollResult.error) {
                    // 失败时记录一次详细日志
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_FAILED`, nodeId, pollResult, projectId);
                    
                    const errMsg = pollResult.error?.message || pollResult.status || '未知错误';
                    const failReason = pollResult.video?.fail_reason || '';
                    return { error: `Grok 生成失败: ${errMsg} ${failReason}` };
                }

                // 继续轮询
                return { done: false };
            }
        });

        if (!videoUrl) {
            throw new Error("Grok 未返回有效的视频地址。");
        }

        // 核心修复：Grok 的视频资源域名 (vidgen.x.ai) 必须翻墙下载
        // 即使提交和轮询走的是智增增直连，下载资源时也强制开启代理
        const downloadProxy = true; 
        const videoBuffer = await BaseProvider.asyncDownloadToBuffer(videoUrl, downloadProxy);
        return { buffer: videoBuffer, format: 'mp4' };
    }
};
