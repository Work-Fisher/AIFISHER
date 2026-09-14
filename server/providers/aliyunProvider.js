/**
 * aliyunProvider.js
 * 封装阿里云通义万相 (DashScope) 快乐马 1.0 视频生成逻辑
 */
import { BaseProvider } from './baseProvider.js';
import { buildJsonFetchOptions, submitJsonWithLogs, pollJsonTask } from './providerKit.js';

export const AliyunVideoProvider = {
    async generateVideo(params, config) {
        const { ALIYUN_API_KEY, LOGS_DIR } = config;
        const { 
            nodeId, prompt, aspectRatio, resolution, 
            duration, videoMode, videoModel, url: finalUrl 
        } = params;

        if (!ALIYUN_API_KEY) {
            throw new Error("阿里云 API Key (ALIYUN_API_KEY) 未配置。");
        }

        // 从 URL 动态解析出 BaseUrl (用于后续轮询)
        const urlObj = new URL(finalUrl);
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

        // 获取所有关联资产
        const { images: allImages, videos: allVideos } = BaseProvider.getAssets(params);

        // 阿里云 DashScope 要求分辨率为大写 "720P" 或 "1080P"
        const finalResolution = (resolution || '720p').toUpperCase();
        
        // 优先使用传入的 videoModel 作为请求模型 ID，实现环境变量覆盖逻辑
        let model = videoModel || 'happyhorse-1.0-t2v';
        let input = { prompt };
        
        // 只有当没有传入自定义 ID (或者是原始逻辑名称) 时才根据模式自动切换
        if (!videoModel || videoModel === 'HappyHorse 1.0') {
            if (videoMode === 'first-frame') {
                model = 'happyhorse-1.0-i2v';
            } else if (videoMode === 'reference-video') {
                model = 'happyhorse-1.0-r2v';
            } else if (videoMode === 'video-edit') {
                model = 'happyhorse-1.0-video-edit';
            } else {
                model = 'happyhorse-1.0-t2v';
            }
        }

        // 处理输入资产
        if (model === 'happyhorse-1.0-i2v') {
            input.media = [{ type: 'first_frame', url: allImages[0] }];
        } else if (model === 'happyhorse-1.0-r2v') {
            input.media = allImages.map(url => ({ type: 'reference_image', url }));
        } else if (model === 'happyhorse-1.0-video-edit') {
            input.media = [];
            if (allVideos[0]) input.media.push({ type: 'video', url: allVideos[0] });
            allImages.forEach(url => input.media.push({ type: 'reference_image', url }));
        }

        const body = {
            model,
            input,
            parameters: {
                watermark: false,
                resolution: finalResolution,
                ratio: aspectRatio || '16:9',
                duration: duration || 5
            }
        };

        const fetchOptions = buildJsonFetchOptions({
            headers: {
                'Authorization': `Bearer ${ALIYUN_API_KEY}`,
                'X-DashScope-Async': 'enable'
            },
            body
        });

        const result = await submitJsonWithLogs({
            url: finalUrl,
            fetchOptions,
            nodeId,
            logsDir: LOGS_DIR,
            modelId: videoModel,
            projectId: params.projectId,
            useProxy: params.useProxy,
            logBody: body
        });

        // 错误处理
        if (result.code) {
            throw new Error(`阿里云提交失败: [${result.code}] ${result.message}`);
        }

        const taskId = result.output?.task_id;
        if (!taskId) throw new Error("阿里云未返回有效任务 ID");

        const pollUrl = `${baseUrl}/api/v1/tasks/${taskId}`;

        const videoUrl = await pollJsonTask({
            pollUrl,
            interval: 5000,
            headers: { 'Authorization': `Bearer ${ALIYUN_API_KEY}` },
            nodeId,
            logsDir: LOGS_DIR,
            modelId: videoModel,
            projectId: params.projectId,
            useProxy: params.useProxy,
            parse: (pollResult) => {
                if (pollResult.code) {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, pollResult, params.projectId);
                    return { error: `阿里云查询失败: [${pollResult.code}] ${pollResult.message}` };
                }

                const status = pollResult.output?.task_status;
                if (status === 'SUCCEEDED') {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, pollResult, params.projectId);
                    return { done: true, data: pollResult.output?.video_url };
                }

                if (status === 'FAILED') {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, pollResult, params.projectId);
                    return { error: `阿里云生成失败: ${pollResult.output?.message || '未知错误'}` };
                }

                if (status === 'CANCELED') {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, pollResult, params.projectId);
                    return { error: "阿里云生成任务已被取消" };
                }

                return { done: false };
            }
        });

        if (!videoUrl) throw new Error("阿里云生成成功但未返回视频链接");
        const videoBuffer = await BaseProvider.asyncDownloadToBuffer(videoUrl, params.useProxy);
        return { buffer: videoBuffer, format: 'mp4' };
    }
};
