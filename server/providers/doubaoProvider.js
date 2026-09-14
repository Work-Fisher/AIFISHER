import { doubaoThinkingParameters } from './doubaoThinking.js';
/**
 * doubaoProvider.js
 * 封装火山引擎 Ark 平台 (豆包) 的生成逻辑
 */
import { resolveImageToBase64 } from '../utils/imageHelpers.js';
import { getModelDimensions } from '../utils/resolutionMapper.js';
import { BaseProvider } from './baseProvider.js';
import { buildJsonFetchOptions, submitJsonWithLogs, submitOpenAiChatWithLogs, pollJsonTask } from './providerKit.js';

/**
 * 豆包图像生成处理器
 */
export const DoubaoImageProvider = {
    async generateImage(params, config) {
        const { ARK_API_KEY, LOGS_DIR } = config;
        const { nodeId, prompt, aspectRatio, resolution, imageBase64: rawImageBase64, imageModel, generateCount, web_search, url: finalUrl } = params;

        if (!ARK_API_KEY) throw new Error("Ark API Key 未配置。");

        // 统一处理图片：本地转 Base64，远程 URL 保持 URL
        const finalImages = BaseProvider.resolveInputImages(rawImageBase64);

        // 根据模型 ID、分辨率和比例获取目标宽高
        const { width, height } = getModelDimensions(params.mappingKey || imageModel, resolution, aspectRatio);

        const body = {
            model: imageModel, // 直接使用前端传来的 id
            prompt: `生成${generateCount || 1}张图\n${prompt}`,
            size: `${width}x${height}`,
            stream: false,
            watermark: false,
            sequential_image_generation: (generateCount || 1) > 1 ? "auto" : "disabled"
        };

        // 处理多图生成选项
        if ((generateCount || 1) > 1) body.sequential_image_generation_options = { max_images: generateCount || 1 };
        // 处理参考图输入
        if (finalImages.length > 0) body.image = finalImages.length === 1 ? finalImages[0] : finalImages;
        // 5.0 模型支持联网搜索
        if (imageModel.includes('5-0') && web_search) body.tools = [{ type: "web_search" }];

        const fetchOptions = buildJsonFetchOptions({
            headers: { 'Authorization': `Bearer ${ARK_API_KEY}` },
            body
        });

        const result = await submitJsonWithLogs({
            url: finalUrl,
            fetchOptions,
            nodeId,
            logsDir: LOGS_DIR,
            modelId: imageModel,
            projectId: params.projectId,
            useProxy: params.useProxy,
            logBody: body
        });

        if (result.error || (!result.data && !result.resp_data)) {
            throw new Error(`Ark 生成失败: ${result.error?.message || result.message || '未知错误'}`);
        }

        // 统一处理返回的图片数据结构
        const dataList = result.data || result.resp_data?.image_list || result.resp_data?.image_urls || [];
        const finalResults = Array.isArray(dataList) ? dataList : [dataList];

        // 异步下载所有生成的图片并转换为 Buffer
        const processedResults = await Promise.all(finalResults.map(async (res) => {
            let resultUrl = res.url || res.b64_json || (typeof res === 'string' ? res : null);
            if (!resultUrl) return null;
            resultUrl = resultUrl.trim().replace(/^[`'"]|[`'"]$/g, '');

            let imgBuffer;
            let imgFormat = 'png';
            if (resultUrl.startsWith('http')) {
                imgBuffer = await BaseProvider.asyncDownloadToBuffer(resultUrl, params.useProxy);
                imgFormat = resultUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
            } else {
                imgBuffer = Buffer.from(resultUrl.includes(',') ? resultUrl.split(',')[1] : resultUrl, 'base64');
            }
            return { buffer: imgBuffer, format: imgFormat };
        }));

        const filteredResults = processedResults.filter(r => r !== null);
        return filteredResults.length === 1 ? filteredResults[0] : filteredResults;
    }
};

/**
 * 豆包文本生成处理器
 */
export const DoubaoTextProvider = {
    async generateText(params, config) {
        const { ARK_API_KEY, LOGS_DIR } = config;
        const { nodeId, prompt, imageBase64, videoUrl, textModel, detail, url: finalUrl } = params;
        if (!ARK_API_KEY) throw new Error("Ark API Key 未配置。");

        const content = [];
        // 处理多模态输入：图片
        if (imageBase64) {
            (Array.isArray(imageBase64) ? imageBase64 : [imageBase64]).forEach(img => {
                const resolved = resolveImageToBase64(img);
                if (resolved) content.push({ type: "image_url", image_url: { detail: detail || "low", url: resolved } });
            });
        }
        // 处理多模态输入：视频
        if (videoUrl) {
            const resolvedVideo = resolveImageToBase64(videoUrl);
            if (resolvedVideo && /^https?:\/\//i.test(resolvedVideo)) {
                content.push({ type: "video_url", video_url: { url: resolvedVideo } });
            } else {
                throw new Error('视频输入必须是网络 URL(http/https)。请先将视频上传到可公网访问的地址。');
            }
        }
        // 添加文本提示词
        content.push({ type: "text", text: prompt });

        const body = { model: textModel, messages: [{ role: "user", content }], max_output_tokens: 131072, temperature: 1, top_p: 0.7, ...doubaoThinkingParameters(params.reasoning) };
        const result = await submitOpenAiChatWithLogs({
            url: finalUrl,
            headers: { 'Authorization': `Bearer ${ARK_API_KEY}` },
            body,
            signal: params.signal,
            nodeId,
            logsDir: LOGS_DIR,
            modelId: textModel,
            projectId: params.projectId,
            useProxy: params.useProxy,
            logBody: body
        });

        if (result.text) return result;
        throw new Error(`Ark API 文本生成失败: ${JSON.stringify(result)}`);
    }
};

/**
 * 豆包视频生成处理器
 */
export const DoubaoVideoProvider = {
    async generateVideo(params, config) {
        const { ARK_API_KEY, LOGS_DIR } = config;
        const { 
            nodeId, prompt, aspectRatio, resolution, 
            duration, generate_audio, videoMode, videoModel, url: finalUrl
        } = params;

        if (!ARK_API_KEY) throw new Error("Ark API Key 未配置。");

        const { images: allImages, videos: allVideos, audios: allAudios } = BaseProvider.getAssets(params);
        const content = [];
        
        // 1. 添加文本提示词
        if (prompt) content.push({ type: "text", text: prompt });

        // 2. 处理参考图片 (支持多图并分配角色)
        if (allImages.length > 0) {
            allImages.forEach((url, index) => {
                const imgObj = { type: "image_url", image_url: { url } };
                // 供应商自行决定角色映射：合并后的首尾帧逻辑
                if (videoMode === 'i2v-first-last-frame') {
                    if (allImages.length === 1) {
                        imgObj.role = "first_frame";
                    } else {
                        imgObj.role = index === 0 ? "first_frame" : "last_frame";
                    }
                } else {
                    imgObj.role = "reference_image";
                }
                content.push(imgObj);
            });
        }

        // 3. 处理参考音频
        allAudios.forEach(url => {
            content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
        });

        // 4. 处理参考视频
        allVideos.forEach(url => {
            content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
        });

        const body = { 
            model: videoModel, 
            content, 
            duration: duration || 5, 
            generate_audio: generate_audio !== false, 
            ratio: aspectRatio || "16:9", 
            resolution: resolution || "720p", 
            watermark: false 
        };
        const fetchOptions = buildJsonFetchOptions({
            headers: { 'Authorization': `Bearer ${ARK_API_KEY}` },
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

        const taskId = result.id || result.task_id || result.data?.id || result.resp_data?.id;
        if (!taskId) throw new Error(`豆包视频任务提交失败: ${result.error?.message || '未返回任务 ID'}`);

        // 轮询视频生成状态
        const pollUrl = `${finalUrl}/${taskId}`;
        const videoUrl = await pollJsonTask({
            pollUrl,
            interval: 5000,
            headers: { 'Authorization': `Bearer ${ARK_API_KEY}` },
            nodeId,
            logsDir: LOGS_DIR,
            modelId: videoModel,
            projectId: params.projectId,
            useProxy: params.useProxy,
            parse: (task) => {
                if (task.error) {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, task, params.projectId);
                    return { error: `视频生成失败: ${task.error.message || '未知错误'}` };
                }

                if (task.status === 'succeeded') {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, task, params.projectId);
                    return { done: true, data: task.content?.video_url };
                }

                if (['failed', 'expired'].includes(task.status)) {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, task, params.projectId);
                    return { error: `视频生成失败: ${task.status}` };
                }

                return { done: false };
            }
        });

        if (!videoUrl) throw new Error(`视频生成失败，未获取到 URL`);
        const videoBuffer = await BaseProvider.asyncDownloadToBuffer(videoUrl, params.useProxy);
        return { buffer: videoBuffer, format: 'mp4' };
    }
};
